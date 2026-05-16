import { Hono } from "hono";
import { Env } from "./types";
import { OpenAIRoute } from "./routes/openai";
import { openAIApiKeyAuth } from "./middlewares/auth";
import { loggingMiddleware } from "./middlewares/logging";
import { setDebugFromEnv } from "./log";
import { getConfig } from "./runtime/config";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
	(c as unknown as { env: Env }).env = getConfig();
	setDebugFromEnv(c.env);
	await next();
});

app.use("*", loggingMiddleware);

const DEFAULT_CORS_ORIGINS = [
	"http://localhost:8787",
	"http://127.0.0.1:8787",
	"http://[::1]:8787"
];

app.use("*", async (c, next) => {
	const raw = (c.env.CORS_ALLOWED_ORIGINS ?? "").trim();
	const allowList = raw
		? raw.split(",").map((s) => s.trim()).filter(Boolean)
		: DEFAULT_CORS_ORIGINS;
	const reqOrigin = c.req.header("origin");
	let allowOrigin: string | null = null;
	if (allowList.includes("*")) {
		allowOrigin = "*";
	} else if (reqOrigin && allowList.includes(reqOrigin)) {
		allowOrigin = reqOrigin;
	}
	if (allowOrigin) {
		c.header("Access-Control-Allow-Origin", allowOrigin);
		if (allowOrigin !== "*") c.header("Vary", "Origin");
	}
	c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

	if (c.req.method === "OPTIONS") {
		c.status(204);
		return c.body(null);
	}

	await next();
});

app.use("/v1/*", openAIApiKeyAuth);

app.route("/v1", OpenAIRoute);

app.get("/info", (c) => {
	const requiresAuth = !!c.env.OPENAI_API_KEY;
	return c.json({
		name: "Google Reverse Proxy",
		description: "OpenAI-compatible reverse proxy for Google AI products",
		version: "1.0.0",
		authentication: {
			required: requiresAuth,
			type: requiresAuth ? "Bearer token in Authorization header" : "None"
		},
		endpoints: {
			chat_completions: "/v1/chat/completions",
			models: "/v1/models"
		}
	});
});

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

export default app;
