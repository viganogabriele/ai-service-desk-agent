import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		env: {
			DASHBOARD_ORIGIN: "http://localhost:5173",
		},
	},
});
