import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { OAuthError } from "../clients/atlassian/oauth-client";
import { log } from "../lib/log";
import type { Auth } from "../services/auth";

export const SESSION_COOKIE = "tb_session";
// One cookie per sign-in attempt, so a second tab does not invalidate the first.
const stateCookie = (state: string) => `tb_oauth_${state}`;
const STATE = /^[\w-]{32}$/;
const COOKIE = { httpOnly: true, sameSite: "Lax", path: "/" } as const;

/** Sign in with Atlassian (OAuth 2.0 3LO); `dashboard` is where the browser returns. */
export function createAuthRoute(auth: Auth | null, dashboard: string) {
	return new Hono()
		.get("/me", (c) => {
			const sessionId = getCookie(c, SESSION_COOKIE);
			const user = auth?.user(sessionId) ?? null;
			if (sessionId && !user) deleteCookie(c, SESSION_COOKIE, COOKIE);
			c.header("Cache-Control", "no-store");
			return c.json({
				enabled: auth !== null,
				user,
			});
		})
		.get("/login", (c) => {
			if (!auth) return c.text("Sign-in is not configured", 404);
			const { url, state } = auth.start();
			setCookie(c, stateCookie(state), state, { ...COOKIE, maxAge: 600 });
			return c.redirect(url);
		})
		.get("/callback", async (c) => {
			if (!auth) return c.text("Sign-in is not configured", 404);
			const state = c.req.query("state") ?? "";
			const expected = STATE.test(state)
				? getCookie(c, stateCookie(state))
				: undefined;
			if (expected) deleteCookie(c, stateCookie(state), COOKIE);
			if (!expected || expected !== state)
				return c.text("Sign-in expired or was tampered with. Try again.", 400);
			// Atlassian returns error=access_denied when the user declines consent.
			const code = c.req.query("code");
			if (!code)
				return c.text(
					c.req.query("error") === "access_denied"
						? "Sign-in was cancelled in Atlassian."
						: "Atlassian did not complete the sign-in. Try again.",
					400,
				);
			try {
				const { sessionId, maxAge } = await auth.complete(code);
				// Signing in again replaces the previous session instead of leaving it alive.
				auth.end(getCookie(c, SESSION_COOKIE));
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
