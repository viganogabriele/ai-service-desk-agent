import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OAuthError } from "../clients/atlassian/oauth-client";
import { log } from "../lib/log";
import type { Auth } from "../services/auth";

export const SESSION_COOKIE = "tb_session";
const STATE_COOKIE = "tb_oauth_state";
const COOKIE = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

/** Sign in with Atlassian (OAuth 2.0 3LO); `dashboard` is where the browser returns. */
export function createAuthRoute(auth: Auth | null, dashboard: string) {
	return new Hono()
		.get("/me", (c) =>
			c.json({
				enabled: auth !== null,
				user: auth?.user(getCookie(c, SESSION_COOKIE)) ?? null,
			}),
		)
		.get("/login", (c) => {
			if (!auth) return c.text("Sign-in is not configured", 404);
			const { url, state } = auth.start();
			setCookie(c, STATE_COOKIE, state, { ...COOKIE, maxAge: 600 });
			return c.redirect(url);
		})
		.get("/callback", async (c) => {
			if (!auth) return c.text("Sign-in is not configured", 404);
			const state = getCookie(c, STATE_COOKIE);
			deleteCookie(c, STATE_COOKIE, COOKIE);
			const code = c.req.query("code");
			if (!code || !state || c.req.query("state") !== state)
				return c.text("Sign-in expired or was tampered with. Try again.", 400);
			try {
				const { sessionId, maxAge } = await auth.complete(code);
				setCookie(c, SESSION_COOKIE, sessionId, { ...COOKIE, maxAge });
				return c.redirect(dashboard);
			} catch (error) {
				if (!(error instanceof OAuthError)) throw error;
				log.warn(`Sign-in failed: ${error.message}`);
				return c.text(`Sign-in failed: ${error.message}`, 502);
			}
		})
		.post("/logout", (c) => {
			auth?.end(getCookie(c, SESSION_COOKIE));
			deleteCookie(c, SESSION_COOKIE, COOKIE);
			return c.json({ ok: true });
		});
}
