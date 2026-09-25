import { type OAuthClient, OAuthError } from "./oauth-client";

/**
 * In-memory Atlassian sign-in for tests and local dev: the code "good" signs
 * in Maria Rossi on https://jira.invalid with a one-hour token.
 */
export function createFakeOAuthClient(
	overrides: Partial<OAuthClient> = {},
): OAuthClient {
	return {
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
		...overrides,
	};
}
