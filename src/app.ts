import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { Env } from "./types";
import { OpenAIRoute } from "./routes/openai";
import { AuthRoute } from "./routes/auth";
import { AccountLimitsRoute } from "./routes/account-limits";
import { WebuiApiRoute } from "./routes/webui-api";
import { openAIApiKeyAuth } from "./middlewares/auth";
import { webuiPasswordGate } from "./middlewares/webui-auth";
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

// Wildcard CORS with no dashboard password lets any browsing tab read account state.
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
	c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-webui-password");

	if (c.req.method === "OPTIONS") {
		c.status(204);
		return c.body(null);
	}

	await next();
});

app.use("/v1/*", openAIApiKeyAuth);

app.use("/api/*", webuiPasswordGate);
app.use("/account-limits", webuiPasswordGate);

app.use("/v1/auth/accounts", webuiPasswordGate);
app.use("/v1/auth/remove", webuiPasswordGate);
app.use("/v1/auth/onboard", webuiPasswordGate);
app.use("/v1/auth/reset", webuiPasswordGate);

app.route("/account-limits", AccountLimitsRoute);
app.route("/api", WebuiApiRoute);
app.route("/v1/auth", AuthRoute);
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
			models: "/v1/models",
			auth: {
				login: "/v1/auth/login",
				accounts: "/v1/auth/accounts",
				remove: "/v1/auth/remove?id=<accountId>",
				reset: "/v1/auth/reset?confirm=yes"
			}
		}
	});
});

app.get("/health", (c) => {
	return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

const noStore = (_path: string, c: { header: (k: string, v: string) => void }) => c.header("Cache-Control", "no-store");
app.use("/*", serveStatic({ root: "./public", onFound: noStore }));
app.get("*", serveStatic({ path: "./public/index.html", onFound: noStore }));

export default app;
