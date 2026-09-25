import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import {
	type OAuthClient,
	OAuthError,
} from "../clients/atlassian/oauth-client";
import type { JiraClient } from "../clients/jira/jira-client";
import {
	createFakeJiraClient,
	fakeIssue,
} from "../clients/jira/jira-client.fake";
import { testBackend } from "../db/test-db";
import { log } from "../lib/log";
import { createAuth } from "../services/auth";
import { closureOf } from "../services/core-sync";
import { toTicketRecord } from "../services/tickets";

const fakeOAuth: OAuthClient = {
	authorizeUrl: (state) => `https://auth.example/authorize?state=${state}`,
	async exchangeCode(code) {
		if (code !== "good") throw new OAuthError("Token exchange failed (400)");
		return { accessToken: "maria-token", expiresIn: 3600 };
	},
	sites: async () => [{ cloudId: "c1", url: "https://jira.invalid/" }],
	me: async () => ({
		accountId: "a1",
		email: "maria.rossi@intcom.com",
		name: "Maria Rossi",
	}),
};

async function setup(oauth = fakeOAuth) {
	const jira = createFakeJiraClient([fakeIssue("SUP-1")]);
	const backend = await testBackend({ jira, withCore: false });
	await backend.syncer.syncNow();
	const calls: string[] = [];
	// The user's client: the same fake Jira, recording which token made each call.
	const asUser = (baseUrl: string, token: string): JiraClient =>
		new Proxy(jira, {
			get(target, name) {
				const value = Reflect.get(target, name);
				return typeof value === "function"
					? (...args: unknown[]) => {
							calls.push(`${baseUrl} ${token} ${String(name)}`);
							return value.apply(target, args);
						}
					: value;
			},
		});
	const auth = createAuth(oauth, "https://jira.invalid", asUser);
	const app = createApp({
		jira,
		sql: backend.sql,
		syncer: backend.syncer,
		core: { baseUrl: undefined },
		auth,
	});
	return { app, calls, jira, auth };
}

afterEach(() => vi.restoreAllMocks());

function cookie(res: Response, name: string): string {
	const found = res.headers
		.getSetCookie()
		.find((c) => c.startsWith(`${name}=`));
	if (!found) throw new Error(`${name} cookie not set`);
	return found.split(";")[0] ?? "";
}

async function signIn(app: Awaited<ReturnType<typeof setup>>["app"]) {
	const login = await app.request("/auth/login");
	expect(login.status).toBe(302);
	const state = new URL(login.headers.get("Location") ?? "").searchParams.get(
		"state",
	);
	const callback = await app.request(
		`/auth/callback?code=good&state=${state}`,
		{ headers: { Cookie: cookie(login, "tb_oauth_state") } },
	);
	expect(callback.status).toBe(302);
	expect(callback.headers.get("Location")).toBe("http://localhost:5173/");
	return cookie(callback, "tb_session");
}

describe("sign in with Atlassian", () => {
	it("keeps callback credentials out of request logs", async () => {
		const { app } = await setup();
		const logged = vi.spyOn(log, "info").mockImplementation(() => {});
		await app.request("/auth/callback?code=private-code&state=private-state");
		const output = logged.mock.calls.flat().join("\n");
		expect(output).toContain("/auth/callback");
		expect(output).not.toContain("private-code");
		expect(output).not.toContain("private-state");
	});

	it.each(["expired", "missing", "signed-out", "restarted"])(
		"rejects an expected user write with a %s session without changing Jira",
		async (scenario) => {
			const { app, jira, auth, calls } = await setup();
			const session = await signIn(app);
			const sessionId = session.slice("tb_session=".length);
			if (scenario === "expired")
				vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3_601_000);
			if (scenario === "signed-out") auth.end(sessionId);
			const before = structuredClone(await jira.getIssue("SUP-1", []));
			const res = await app.request("/tickets", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Atlassian-Account-Id": "a1",
					...(scenario === "missing"
						? {}
						: {
								Cookie:
									scenario === "restarted"
										? "tb_session=lost-session"
										: session,
							}),
				},
				body: JSON.stringify({ Key: "SUP-1", Summary: "Must not be written" }),
			});
			expect(res.status).toBe(401);
			expect(await jira.getIssue("SUP-1", [])).toEqual(before);
			expect(calls).toEqual([]);
		},
	);

	it.each(["shared", "other-account"])(
		"rejects a write when the UI expects %s but the session belongs to a1",
		async (expected) => {
			const { app, calls } = await setup();
			const session = await signIn(app);
			const res = await app.request("/tickets", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: session,
					"X-Atlassian-Account-Id": expected,
				},
				body: JSON.stringify({ Key: "SUP-1", Summary: "Must not be written" }),
			});
			expect(res.status).toBe(409);
			expect(calls).toEqual([]);
		},
	);

	it("allows credentialed requests and write preflights only from the dashboard origin", async () => {
		const { app } = await setup();
		const session = await signIn(app);
		const res = await app.request("/auth/me", {
			headers: { Origin: "http://localhost:5173", Cookie: session },
		});
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://localhost:5173",
		);
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
		expect(await res.json()).toMatchObject({ user: { accountId: "a1" } });
		const preflight = await app.request("/tickets", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5173",
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type,x-atlassian-account-id",
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBe(
			"true",
		);
		expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
			"x-atlassian-account-id",
		);
		const foreign = await app.request("/auth/me", {
			headers: { Origin: "https://other.invalid" },
		});
		expect(foreign.headers.get("Access-Control-Allow-Origin")).not.toBe(
			"https://other.invalid",
		);
	});

	it("writes to Jira as the signed-in user", async () => {
		const { app, calls } = await setup();
		const session = await signIn(app);

		const me = await app.request("/auth/me", { headers: { Cookie: session } });
		expect(await me.json()).toEqual({
			enabled: true,
			user: {
				accountId: "a1",
				email: "maria.rossi@intcom.com",
				name: "Maria Rossi",
			},
		});

		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: session },
			body: JSON.stringify({ Key: "SUP-1", Urgency: "High" }),
		});
		expect(res.status).toBe(200);
		expect(calls).toContain(
			"https://api.atlassian.com/ex/jira/c1 maria-token updateIssue",
		);
	});

	it("writes as the shared account without a session", async () => {
		const { app, calls } = await setup();
		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ Key: "SUP-1", Urgency: "High" }),
		});
		expect(res.status).toBe(200);
		expect(calls).toEqual([]);
	});

	it("keeps a signed operator comment through Jira and closure extraction", async () => {
		const { app, jira } = await setup();
		const session = await signIn(app);
		const res = await app.request("/tickets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: session,
				"X-Atlassian-Account-Id": "a1",
			},
			body: JSON.stringify({
				Key: "SUP-1",
				Assignee: "another.assignee@intcom.com",
				Resolution: "done",
				"All Comments": [
					"maria.rossi@intcom.com: Resolution: Renewed the certificate.",
				],
			}),
		});
		expect(res.status).toBe(200);
		const record = toTicketRecord(await jira.getIssue("SUP-1", []));
		expect(record["All Comments"]).toEqual([
			"maria.rossi@intcom.com: Resolution: Renewed the certificate.",
		]);
		expect(closureOf(record)).toEqual({
			resolutionNote: "Resolution: Renewed the certificate.",
			resolver: "maria.rossi@intcom.com",
		});
	});

	it("clears a lost session before an explicit retry with the shared account", async () => {
		const { app, calls } = await setup();
		const patch = { Key: "SUP-1", Urgency: "High" };
		const rejected = await app.request("/tickets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: "tb_session=lost",
			},
			body: JSON.stringify(patch),
		});
		expect(rejected.status).toBe(401);
		const me = await app.request("/auth/me", {
			headers: { Cookie: "tb_session=lost" },
		});
		expect(await me.json()).toEqual({ enabled: true, user: null });
		expect(me.headers.get("Cache-Control")).toBe("no-store");
		expect(cookie(me, "tb_session")).toBe("tb_session=");
		const retry = await app.request("/tickets", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Atlassian-Account-Id": "shared",
			},
			body: JSON.stringify(patch),
		});
		expect(retry.status).toBe(200);
		expect(calls).toEqual([]);
	});

	it("rejects a callback whose state does not match", async () => {
		const { app } = await setup();
		const login = await app.request("/auth/login");
		const res = await app.request("/auth/callback?code=good&state=forged", {
			headers: { Cookie: cookie(login, "tb_oauth_state") },
		});
		expect(res.status).toBe(400);
		expect(res.headers.getSetCookie().join()).not.toContain("tb_session=");
	});

	it("explains a sign-in that did not authorize this Jira site", async () => {
		const { app } = await setup({
			...fakeOAuth,
			sites: async () => [{ cloudId: "c2", url: "https://other.invalid" }],
		});
		const login = await app.request("/auth/login");
		const state = new URL(login.headers.get("Location") ?? "").searchParams.get(
			"state",
		);
		const res = await app.request(`/auth/callback?code=good&state=${state}`, {
			headers: { Cookie: cookie(login, "tb_oauth_state") },
		});
		expect(res.status).toBe(502);
		expect(await res.text()).toContain("https://jira.invalid");
	});

	it("signs out", async () => {
		const { app } = await setup();
		const session = await signIn(app);
		await app.request("/auth/logout", {
			method: "POST",
			headers: { Cookie: session },
		});
		const me = await app.request("/auth/me", { headers: { Cookie: session } });
		expect(((await me.json()) as { user: unknown }).user).toBeNull();
	});
});
