import { Hono } from "hono";
import { getHealthStatus } from "../services/health";

export const healthRoute = new Hono().get("/", (c) => {
	return c.json(getHealthStatus());
});
