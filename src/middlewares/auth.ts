import { MiddlewareHandler } from "hono";
import { Env } from "../types";
import { safeEqual } from "../utils/safe-equal";

export const openAIApiKeyAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {

	const publicEndpoints = ["/", "/health"];
	if (publicEndpoints.some((endpoint) => c.req.path === endpoint)) {
		await next();
		return;
	}

	if (c.req.path.startsWith("/v1/auth/")) {
		await next();
		return;
	}

	if (c.env.OPENAI_API_KEY) {
		const authHeader = c.req.header("Authorization");

		if (!authHeader) {
			return c.json(
				{
					error: {
						message: "Missing Authorization header",
						type: "authentication_error",
						code: "missing_authorization"
					}
				},
				401
			);
		}

		const match = authHeader.match(/^Bearer\s+(.+)$/);
		if (!match) {
			return c.json(
				{
					error: {
						message: "Invalid Authorization header format. Expected: Bearer <token>",
						type: "authentication_error",
						code: "invalid_authorization_format"
					}
				},
				401
			);
		}

		const providedKey = match[1];
		if (!safeEqual(providedKey, c.env.OPENAI_API_KEY)) {
			return c.json(
				{
					error: {
						message: "Invalid API key",
						type: "authentication_error",
						code: "invalid_api_key"
					}
				},
				401
			);
		}

	}

	await next();
};
