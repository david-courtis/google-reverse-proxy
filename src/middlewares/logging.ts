import { Context, Next } from "hono";
import { isDebug, logInfo, logAccess, logReq, logFin } from "../log";
import { Env } from "../types";

const MODEL_PATHS = new Set(["/v1/chat/completions", "/v1/audio/transcriptions"]);

export const loggingMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
	const method = c.req.method;
	const path = c.req.path;
	const startTime = Date.now();

	if (isDebug()) {
		let bodyLog = "";
		if (["POST", "PUT", "PATCH"].includes(method)) {
			try {
				const body = await c.req.raw.clone().text();
				const truncated = body.length > 500 ? body.substring(0, 500) + "..." : body;
				const masked = truncated.replace(
					/"(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|client_secret|password)":\s*"[^"]*"/gi,
					'"$1": "***"'
				);
				bodyLog = ` - Body: ${masked}`;
			} catch {
				bodyLog = " - Body: [unable to parse]";
			}
		}
		logInfo(`${method} ${path}${bodyLog} - request started`);
		await next();
		if (method !== "OPTIONS") logAccess(method, path, c.res.status, Date.now() - startTime);
		return;
	}

	if (!(method === "POST" && MODEL_PATHS.has(path))) {
		await next();
		return;
	}

	let detail = "audio/transcriptions";
	if (path === "/v1/chat/completions") {
		try {
			const b = (await c.req.raw.clone().json()) as {
				stream?: boolean;
				messages?: unknown[];
				model?: string;
			};
			const stream = b?.stream !== false ? "Enabled" : "Disabled";
			const msgs = Array.isArray(b?.messages) ? b.messages.length : 0;
			const model = typeof b?.model === "string" && b.model ? b.model : "(default)";
			detail = `stream: ${stream}, msgs: ${msgs}, model: ${model}`;
		} catch {
			detail = "stream: ?, msgs: ?, model: (unparsed)";
		}
	}

	logReq(detail);
	await next();
	logFin(c.res.status, Date.now() - startTime);
};
