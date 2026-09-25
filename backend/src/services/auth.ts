import { randomBytes } from "node:crypto";
import {
	type AtlassianUser,
	type OAuthClient,
	OAuthError,
} from "../clients/atlassian/oauth-client";
import { JiraApiError, type JiraClient } from "../clients/jira/jira-client";

type Session = {
	user: AtlassianUser;
	jira: JiraClient;
	expiresAt: number;
};

export type Auth = {
	/** Where to send the browser to sign in; `state` must come back unchanged. */
	start(): { url: string; state: string };
	/** Finishes the sign-in: the session id to set as a cookie, and its lifetime. */
	complete(code: string): Promise<{ sessionId: string; maxAge: number }>;
	user(sessionId: string | undefined): AtlassianUser | null;
	/** A Jira client acting as the signed-in user, or null without a live session. */
	jira(sessionId: string | undefined): JiraClient | null;
	end(sessionId: string | undefined): void;
};

// The session ends a little before the token, so a write never starts on a token about to expire.
const EXPIRY_MARGIN_MS = 60_000;

function sameOrigin(url: string, expected: string) {
	return URL.canParse(url) && new URL(url).origin === new URL(expected).origin;
}

/** Ends the session as soon as Jira refuses its token, e.g. after the app is revoked in Atlassian. */
function endOnUnauthorized(jira: JiraClient, end: () => void): JiraClient {
	return new Proxy(jira, {
		get(target, name) {
			const value = Reflect.get(target, name);
			if (typeof value !== "function") return value;
			return async (...args: unknown[]) => {
				try {
					return await value.apply(target, args);
				} catch (error) {
					if (error instanceof JiraApiError && error.status === 401) end();
					throw error;
				}
			};
		},
	});
}

/**
 * Sign-in with Atlassian for the demo: sessions live in memory (a restart signs
 * everyone out) and last as long as the access token, with no refresh.
 */
export function createAuth(
	oauth: OAuthClient,
	jiraBaseUrl: string,
	makeJira: (baseUrl: string, accessToken: string) => JiraClient,
): Auth {
	const sessions = new Map<string, Session>();

	function live(sessionId: string | undefined): Session | null {
		const session = sessionId ? sessions.get(sessionId) : undefined;
		if (!session || !sessionId) return null;
		if (session.expiresAt > Date.now()) return session;
		sessions.delete(sessionId);
		return null;
	}

	function sweep() {
		const now = Date.now();
		for (const [id, session] of sessions)
			if (session.expiresAt <= now) sessions.delete(id);
	}

	return {
		start() {
			const state = randomBytes(24).toString("base64url");
			return { url: oauth.authorizeUrl(state), state };
		},

		async complete(code) {
			const issuedAt = Date.now();
			const { accessToken, expiresIn } = await oauth.exchangeCode(code);
			const site = (await oauth.sites(accessToken)).find((s) =>
				sameOrigin(s.url, jiraBaseUrl),
			);
			if (!site)
				throw new OAuthError(
					`Authorize the ${new URL(jiraBaseUrl).origin} site when signing in`,
				);
			const user = await oauth.me(accessToken);
			const expiresAt = issuedAt + expiresIn * 1000 - EXPIRY_MARGIN_MS;
			const maxAge = Math.floor((expiresAt - Date.now()) / 1000);
			if (maxAge <= 0)
				throw new OAuthError(
					"Atlassian issued a token that is about to expire",
				);
			sweep();
			const sessionId = randomBytes(32).toString("base64url");
			sessions.set(sessionId, {
				user,
				jira: endOnUnauthorized(
					makeJira(
						`https://api.atlassian.com/ex/jira/${site.cloudId}`,
						accessToken,
					),
					() => sessions.delete(sessionId),
				),
				expiresAt,
			});
			return { sessionId, maxAge };
		},

		user: (sessionId) => live(sessionId)?.user ?? null,
		jira: (sessionId) => live(sessionId)?.jira ?? null,
		end(sessionId) {
			if (sessionId) sessions.delete(sessionId);
		},
	};
}

export type Writer =
	| { ok: true; jira: JiraClient }
	| { ok: false; reason: "session_expired" | "account_changed" };

/**
 * Who writes a dashboard change to Jira: the signed-in user, else the shared
 * account. `expected` is the account the dashboard showed ("shared" when
 * signed out); a mismatch stops the write instead of changing its author.
 */
export function writerFor(
	auth: Auth | null,
	shared: JiraClient,
	sessionId: string | undefined,
	expected: string | undefined,
): Writer {
	const user = auth?.user(sessionId) ?? null;
	const userClient = auth?.jira(sessionId) ?? null;
	if (
		(auth && sessionId && !userClient) ||
		(expected && expected !== "shared" && !userClient)
	)
		return { ok: false, reason: "session_expired" };
	if (expected && expected !== (user?.accountId ?? "shared"))
		return { ok: false, reason: "account_changed" };
	return { ok: true, jira: userClient ?? shared };
}
