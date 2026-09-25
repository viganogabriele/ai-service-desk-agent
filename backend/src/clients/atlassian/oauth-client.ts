import { z } from "zod";

// Atlassian OAuth 2.0 (3LO): developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps

export const OAUTH_SCOPES = ["read:jira-work", "write:jira-work", "read:me"];

export class OAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OAuthError";
	}
}

export type OAuthConfig = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
};

export type AtlassianUser = { accountId: string; email: string; name: string };
export type AtlassianSite = { cloudId: string; url: string };

export interface OAuthClient {
	authorizeUrl(state: string): string;
	/** Exchanges an authorization code for an access token. */
	exchangeCode(
		code: string,
	): Promise<{ accessToken: string; expiresIn: number }>;
	sites(accessToken: string): Promise<AtlassianSite[]>;
	me(accessToken: string): Promise<AtlassianUser>;
}

const tokenResponse = z.object({
	access_token: z.string(),
	expires_in: z.number(),
});
const sitesResponse = z.array(z.object({ id: z.string(), url: z.string() }));
const meResponse = z.object({
	account_id: z.string(),
	email: z.string(),
	name: z.string(),
});

export function createRealOAuthClient(config: OAuthConfig): OAuthClient {
	async function json<T>(
		res: Response,
		what: string,
		schema: z.ZodType<T>,
	): Promise<T> {
		const text = await res.text();
		// Never echo the body: a token response may carry secrets.
		if (!res.ok) throw new OAuthError(`${what} failed (${res.status})`);
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new OAuthError(`${what} returned invalid JSON`);
		}
		const parsed = schema.safeParse(body);
		if (!parsed.success)
			throw new OAuthError(`${what} returned an unexpected response`);
		return parsed.data;
	}

	return {
		authorizeUrl(state) {
			const url = new URL("https://auth.atlassian.com/authorize");
			url.search = new URLSearchParams({
				audience: "api.atlassian.com",
				client_id: config.clientId,
				scope: OAUTH_SCOPES.join(" "),
				redirect_uri: config.redirectUri,
				state,
				response_type: "code",
				prompt: "consent",
			}).toString();
			return url.toString();
		},

		async exchangeCode(code) {
			const res = await fetch("https://auth.atlassian.com/oauth/token", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					grant_type: "authorization_code",
					client_id: config.clientId,
					client_secret: config.clientSecret,
					code,
					redirect_uri: config.redirectUri,
				}),
			});
			const data = await json(res, "Token exchange", tokenResponse);
			return { accessToken: data.access_token, expiresIn: data.expires_in };
		},

		async sites(accessToken) {
			const res = await fetch(
				"https://api.atlassian.com/oauth/token/accessible-resources",
				{ headers: { Authorization: `Bearer ${accessToken}` } },
			);
			return (
				await json(res, "Reading the authorized sites", sitesResponse)
			).map((s) => ({ cloudId: s.id, url: s.url }));
		},

		async me(accessToken) {
			const res = await fetch("https://api.atlassian.com/me", {
				headers: { Authorization: `Bearer ${accessToken}` },
			});
			const data = await json(res, "Reading the user", meResponse);
			return { accountId: data.account_id, email: data.email, name: data.name };
		},
	};
}
