import { MiddlewareHandler } from "hono";
import { Env } from "../types";
import { effectiveConfig } from "../webui-store";
import { safeEqual } from "../utils/safe-equal";

export const webuiPasswordGate: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	const cfg = await effectiveConfig(c.env);
	if (!cfg.uiPassword) {
		await next();
		return;
	}
	const provided = c.req.header("x-webui-password");
	if (!provided || !safeEqual(provided, cfg.uiPassword)) {
		return c.json({ status: "error", error: "Unauthorized: invalid or missing web UI password" }, 401);
	}
	await next();
};
