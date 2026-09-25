import { randomBytes } from "node:crypto";
import {
	type AtlassianUser,
	type OAuthClient,
	OAuthError,
} from "../clients/atlassian/oauth-client";
import {
	createRealJiraClient,
	type JiraClient,
} from "../clients/jira/jira-client";

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

const origin = (url: string) => new URL(url).origin;

/**
 * Sign-in with Atlassian for the demo: sessions live in memory (a restart signs
 * everyone out) and last as long as the access token, with no refresh.
 */
export function createAuth(
	oauth: OAuthClient,
	jiraBaseUrl: string,
	makeJira: (baseUrl: string, accessToken: string) => JiraClient = (
		baseUrl,
		accessToken,
	) => createRealJiraClient({ baseUrl, accessToken }),
): Auth {
	const sessions = new Map<string, Session>();

	function live(sessionId: string | undefined): Session | null {
		const session = sessionId ? sessions.get(sessionId) : undefined;
		if (!session || !sessionId) return null;
		if (session.expiresAt > Date.now()) return session;
		sessions.delete(sessionId);
		return null;
	}

	return {
		start() {
			const state = randomBytes(24).toString("base64url");
			return { url: oauth.authorizeUrl(state), state };
		},

		async complete(code) {
			const { accessToken, expiresIn } = await oauth.exchangeCode(code);
			const site = (await oauth.sites(accessToken)).find(
				(s) => origin(s.url) === origin(jiraBaseUrl),
			);
			if (!site)
				throw new OAuthError(
					`Authorize the ${origin(jiraBaseUrl)} site when signing in`,
				);
			const user = await oauth.me(accessToken);
			const sessionId = randomBytes(32).toString("base64url");
			sessions.set(sessionId, {
				user,
				jira: makeJira(
					`https://api.atlassian.com/ex/jira/${site.cloudId}`,
					accessToken,
				),
				expiresAt: Date.now() + expiresIn * 1000,
			});
			return { sessionId, maxAge: expiresIn };
		},

		user: (sessionId) => live(sessionId)?.user ?? null,
		jira: (sessionId) => live(sessionId)?.jira ?? null,
		end(sessionId) {
			if (sessionId) sessions.delete(sessionId);
		},
	};
}
