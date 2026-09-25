import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  server: {
    proxy: {
      // The backend behind the dashboard's own origin, so its sign-in cookie is first-party.
      "/api": {
        target: "http://127.0.0.1:8787",
        rewrite: (path) => path.replace(/^\/api/, ""),
        configure: (proxy) => {
          // A stopped backend answers 502, which the dashboard reads as "offline".
          proxy.on("error", (_error, _request, response) => {
            if ("writeHead" in response && !response.headersSent) {
              response.writeHead(502, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: { message: "backend unreachable" } }));
            }
          });
        },
      },
    },
  },
});
