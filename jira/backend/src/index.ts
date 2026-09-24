import { app } from "./app";
import { env } from "./env";

Bun.serve({
	fetch: app.fetch,
	hostname: "127.0.0.1",
	port: env.PORT,
});

// biome-ignore lint/suspicious/noConsole: startup announcement, not app logging
console.log(`Listening on http://127.0.0.1:${env.PORT}`);
