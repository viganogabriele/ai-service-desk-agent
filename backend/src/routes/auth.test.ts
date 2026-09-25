import { describe, expect, it } from "vitest";
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
import { createAuth } from "../services/auth";

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
	return { app, calls };
}

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

	it("refuses writes without a session", async () => {
		const { app } = await setup();
		const res = await app.request("/tickets", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ Key: "SUP-1", Urgency: "High" }),
		});
		expect(res.status).toBe(401);
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
