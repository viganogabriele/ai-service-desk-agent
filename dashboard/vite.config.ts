import { connect } from "node:net";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

function backendAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(8787, "127.0.0.1");
    let settled = false;

    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    proxy: {
      // The backend behind the dashboard's own origin, so its sign-in cookie is first-party.
      "/api": {
        target: "http://127.0.0.1:8787",
        bypass: async (request, response) => {
          if (!response || (await backendAvailable())) return;

          response.writeHead(502, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              error: { message: "backend unreachable", code: "backend_unreachable" },
            }),
          );

          return request.url ?? "/api";
        },
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          // A stopped backend answers 502, which the dashboard reads as "offline".
          proxy.on("error", (_error, _request, response) => {
            if ("writeHead" in response && !response.headersSent) {
              response.writeHead(502, { "Content-Type": "application/json" });
              response.end(
                JSON.stringify({
                  error: { message: "backend unreachable", code: "backend_unreachable" },
                }),
              );
            }
          });
        },
      },
    },
  },
});
