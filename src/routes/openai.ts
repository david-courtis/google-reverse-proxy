import { Hono, type Context } from "hono";
import { logInfo } from "../log";
import {
	Env,
	ChatCompletionRequest,
	ChatCompletionResponse,
	ChatMessage,
	ModelInfo,
	MessageContent,
	StreamChunk
} from "../types";
import { DEFAULT_MODEL, getAllModelIds, parseModelId } from "../models";
import { API_MODEL_SUFFIX, CLI_MODEL_SUFFIX } from "../config";
import { OPENAI_MODEL_OWNER } from "../config";
import { DEFAULT_THINKING_BUDGET, MIME_TYPE_MAP } from "../constants";
import { AuthManager, InvalidGrantError } from "../auth";
import { GeminiApiClient } from "../gemini-client";
import { AccountPool } from "../account-pool";
import { recordUsage, effectiveConfig, usageForAccounts } from "../webui-store";
import { AutoModelSwitchingHelper } from "../helpers/auto-model-switching";
import { createOpenAIStreamTransformer } from "../stream-transformer";
import { isMediaTypeSupported, validateContent, validateModel } from "../utils/validation";
import { Buffer } from "node:buffer";

function trackUsage(c: Context<{ Bindings: Env }>, accountId: string, model: string): void {
	const p = recordUsage(c.env, accountId, model).catch((e) => console.error("trackUsage:", e));
	try {
		c.executionCtx.waitUntil(p);
	} catch {
		void p;
	}
}

export const OpenAIRoute = new Hono<{ Bindings: Env }>();

OpenAIRoute.get("/models", async (c) => {
	const cfg = await effectiveConfig(c.env);
	const visibleBase = getAllModelIds().filter((modelId) => cfg.modelVisibility[modelId] !== false);
	const expanded = [
		...visibleBase,
		...visibleBase.map((m) => `${m}${CLI_MODEL_SUFFIX}`),
		...visibleBase.map((m) => `${m}${API_MODEL_SUFFIX}`)
	];
	const modelData = expanded.map((modelId) => ({
		id: modelId,
		object: "model",
		created: Math.floor(Date.now() / 1000),
		owned_by: OPENAI_MODEL_OWNER
	}));

	return c.json({
		object: "list",
		data: modelData
	});
});

OpenAIRoute.post("/chat/completions", async (c) => {
	try {
		logInfo("Chat completions request received");
		const body = await c.req.json<ChatCompletionRequest>();
		const model = body.model || DEFAULT_MODEL;
		const { baseModel, route } = parseModelId(model);
		const messages = body.messages || [];

		const stream = body.stream !== false;

		const isRealThinkingEnabled = c.env.ENABLE_REAL_THINKING === "true";
		let includeReasoning = isRealThinkingEnabled;
		let thinkingBudget = body.thinking_budget ?? DEFAULT_THINKING_BUDGET;

		const reasoning_effort =
			body.reasoning_effort || body.extra_body?.reasoning_effort || body.model_params?.reasoning_effort;

		const generationOptions = {
			max_tokens: body.max_tokens,
			temperature: body.temperature,
			top_p: body.top_p,
			stop: body.stop,
			presence_penalty: body.presence_penalty,
			frequency_penalty: body.frequency_penalty,
			seed: body.seed,
			response_format: body.response_format,
			reasoning_effort: reasoning_effort
		};

		if (reasoning_effort) {
			includeReasoning = true;
			const isFlashModel = baseModel.includes("flash");
			switch (reasoning_effort) {
				case "low":
					thinkingBudget = 1024;
					break;
				case "medium":
					thinkingBudget = isFlashModel ? 12288 : 16384;
					break;
				case "high":
					thinkingBudget = isFlashModel ? 24576 : 32768;
					break;
				case "none":
					thinkingBudget = 0;
					includeReasoning = false;
					break;
			}
		}

		const tools = body.tools;
		const tool_choice = body.tool_choice;

		logInfo("Request body parsed:", {
			model,
			messageCount: messages.length,
			stream,
			includeReasoning,
			thinkingBudget,
			tools,
			tool_choice,
			reasoning_effort,
			isRealThinkingEnabled
		});

		if (!messages.length) {
			return c.json({ error: "messages is a required field" }, 400);
		}

		const modelValidation = validateModel(model);
		if (!modelValidation.isValid) {
			return c.json({ error: modelValidation.error }, 400);
		}

		const mediaChecks: {
			type: string;
			supportKey: keyof ModelInfo;
			name: string;
		}[] = [
			{ type: "image_url", supportKey: "supportsImages", name: "image inputs" },
			{ type: "input_audio", supportKey: "supportsAudios", name: "audio inputs" },
			{ type: "input_video", supportKey: "supportsVideos", name: "video inputs" },
			{ type: "input_pdf", supportKey: "supportsPdfs", name: "PDF inputs" }
		];

		for (const { type, supportKey, name } of mediaChecks) {
			const messagesWithMedia = messages.filter(
				(msg) => Array.isArray(msg.content) && msg.content.some((content) => content.type === type)
			);

			if (messagesWithMedia.length > 0) {
				if (!isMediaTypeSupported(model, supportKey)) {
					return c.json(
						{
							error: `Model '${model}' does not support ${name}. Please use a model that supports this feature.`
						},
						400
					);
				}

				for (const msg of messagesWithMedia) {
					for (const content of msg.content as MessageContent[]) {
						if (content.type === type) {
							const { isValid, error } = validateContent(type, content);
							if (!isValid) {
								return c.json({ error }, 400);
							}
						}
					}
				}
			}
		}

		let systemPrompt = "";
		const otherMessages = messages.filter((msg) => {
			if (msg.role === "system") {

				if (typeof msg.content === "string") {
					systemPrompt = msg.content;
				} else if (Array.isArray(msg.content)) {

					const textContent = msg.content
						.filter((part) => part.type === "text")
						.map((part) => part.text || "")
						.join(" ");
					systemPrompt = textContent;
				}
				return false;
			}
			return true;
		});

		let pool: AccountPool;
		try {
			pool = await AccountPool.create(c.env);
		} catch (poolError: unknown) {
			const msg = poolError instanceof Error ? poolError.message : String(poolError);
			console.error("Credential pool error:", msg);
			return c.json({ error: "Authentication configuration error: " + msg }, 401);
		}

		const rlHelper = new AutoModelSwitchingHelper(c.env);
		const cfg = await effectiveConfig(c.env);
		const rawOrder = await pool.selectionOrderForRoute(route, cfg.preferredAccountKind);

		const apiKeyIds = rawOrder.filter((a) => a.kind === "apikey").map((a) => a.id);
		const exhaustedApiKeys = new Set<string>();
		if (apiKeyIds.length > 0) {
			const usage = await usageForAccounts(c.env, apiKeyIds);
			for (const id of apiKeyIds) {
				if ((usage[id]?.today || 0) >= cfg.apiKeyDailyQuota) {
					exhaustedApiKeys.add(id);
					await pool.reportDailyExhausted(id);
				}
			}
		}

		const attemptOrder = rawOrder.filter((a) => !(a.kind === "apikey" && exhaustedApiKeys.has(a.id)));
		logInfo(
			`Account pool: ${pool.size} account(s), route=${route}, preferred=${cfg.preferredAccountKind}, order: ${attemptOrder.map((a) => `${a.id}(${a.kind})`).join(", ")}`
		);

		if (attemptOrder.length === 0) {
			const hint =
				route === "api"
					? `No Google AI Studio API-key accounts available for '${model}'. Every key is at its daily request budget (resets at midnight America/Los_Angeles) or none are configured, add a key in the dashboard or set GEMINI_API_KEYS.`
					: route === "cli"
						? `No OAuth accounts available for '${model}'. Add an account via /v1/auth/login or set GCP_SERVICE_ACCOUNT.`
						: `No accounts available for '${model}'. Add a Google OAuth account or AI Studio API key in the dashboard.`;
			return c.json({ error: hint }, route === "api" ? 429 : 401);
		}

		const genOptions = {
			includeReasoning,
			thinkingBudget,
			tools,
			tool_choice,
			...generationOptions
		};

		if (stream) {

			let chosen: { iterator: AsyncIterator<StreamChunk>; first: IteratorResult<StreamChunk> } | null = null;
			let lastErr: unknown = null;

			for (let i = 0; i < attemptOrder.length; i++) {
				const acct = attemptOrder[i];
				const isLast = i === attemptOrder.length - 1;
				if (exhaustedApiKeys.has(acct.id)) {
					lastErr = new Error("API-key daily budget reached");
					if (!isLast) continue;
				}
				const am = new AuthManager(c.env, acct);
				const gc = new GeminiApiClient(c.env, am);
				gc.setModelSwitchSuppressed(!isLast); 

				try {
					await am.initializeAuth();
					const gen = gc.streamContent(baseModel, systemPrompt, otherMessages, genOptions);
					const iterator = gen[Symbol.asyncIterator]();
					const first = await iterator.next(); 
					chosen = { iterator, first };
					logInfo(`Streaming via account ${acct.id}`);
					trackUsage(c, acct.id, model);
					break;
				} catch (err: unknown) {
					lastErr = err;
					if (err instanceof InvalidGrantError) {
						await pool.reportDead(acct.id);
						continue;
					}
					if (rlHelper.isRateLimitError(err)) {
						if (acct.kind === "apikey") {
							logInfo(`API-key account ${acct.id} hit daily quota, cooling down until Pacific midnight...`);
							await pool.reportDailyExhausted(acct.id);
						} else {
							logInfo(`Account ${acct.id} rate-limited, rotating...`);
							await pool.reportRateLimited(acct.id);
						}
						continue;
					}

					const msg = err instanceof Error ? err.message : String(err);
					return c.json({ error: msg }, 500);
				}
			}

			if (!chosen) {
				const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
				return c.json({ error: `All ${pool.size} account(s) unavailable (last: ${msg})` }, 429);
			}

			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const openAITransformer = createOpenAIStreamTransformer(model);
			const openAIStream = readable.pipeThrough(openAITransformer);

			const committed = chosen;
			(async () => {
				try {
					if (!committed.first.done) {
						await writer.write(committed.first.value);
					}
					while (true) {
						const next = await committed.iterator.next();
						if (next.done) break;
						await writer.write(next.value);
					}
					logInfo("Stream completed successfully");
					await writer.close();
				} catch (streamError: unknown) {
					const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
					console.error("Stream error (post-commit, cannot rotate):", errorMessage);
					await writer.write({ type: "text", data: `Error: ${errorMessage}` });
					await writer.close();
				}
			})();

			logInfo("Returning streaming response");
			return new Response(openAIStream, {
				headers: {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type, Authorization"
				}
			});
		} else {

			let lastErr: unknown = null;
			for (let i = 0; i < attemptOrder.length; i++) {
				const acct = attemptOrder[i];
				const isLast = i === attemptOrder.length - 1;
				if (exhaustedApiKeys.has(acct.id)) {
					lastErr = new Error("API-key daily budget reached");
					if (!isLast) continue;
				}
				const am = new AuthManager(c.env, acct);
				const gc = new GeminiApiClient(c.env, am);
				gc.setModelSwitchSuppressed(!isLast);

				try {
					await am.initializeAuth();
					const completion = await gc.getCompletion(baseModel, systemPrompt, otherMessages, genOptions);

					const response: ChatCompletionResponse = {
						id: `chatcmpl-${crypto.randomUUID()}`,
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: model,
						choices: [
							{
								index: 0,
								message: {
									role: "assistant",
									content: completion.content,
									tool_calls: completion.tool_calls
								},
								finish_reason: completion.tool_calls && completion.tool_calls.length > 0 ? "tool_calls" : "stop"
							}
						]
					};

					if (completion.usage) {
						response.usage = {
							prompt_tokens: completion.usage.inputTokens,
							completion_tokens: completion.usage.outputTokens,
							total_tokens: completion.usage.inputTokens + completion.usage.outputTokens
						};
					}

					logInfo(`Non-streaming completion via account ${acct.id}`);
					trackUsage(c, acct.id, model);
					return c.json(response);
				} catch (err: unknown) {
					lastErr = err;
					if (err instanceof InvalidGrantError) {
						await pool.reportDead(acct.id);
						continue;
					}
					if (rlHelper.isRateLimitError(err)) {
						if (acct.kind === "apikey") {
							logInfo(`API-key account ${acct.id} hit daily quota, cooling down until Pacific midnight...`);
							await pool.reportDailyExhausted(acct.id);
						} else {
							logInfo(`Account ${acct.id} rate-limited, rotating...`);
							await pool.reportRateLimited(acct.id);
						}
						continue;
					}
					const msg = err instanceof Error ? err.message : String(err);
					return c.json({ error: msg }, 500);
				}
			}
			const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
			return c.json({ error: `All ${pool.size} account(s) unavailable (last: ${msg})` }, 429);
		}
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Top-level error:", e);
		return c.json({ error: errorMessage }, 500);
	}
});

OpenAIRoute.post("/audio/transcriptions", async (c) => {
	try {
		logInfo("Audio transcription request received");
		const body = await c.req.parseBody();
		const file = body["file"];
		const model = (body["model"] as string) || DEFAULT_MODEL;
		const { baseModel, route } = parseModelId(model);
		const prompt = (body["prompt"] as string) || "Transcribe this audio in detail.";

		if (!file || !(file instanceof File)) {
			return c.json({ error: "File is required" }, 400);
		}

		const modelValidation = validateModel(model);
		if (!modelValidation.isValid) {
			return c.json({ error: modelValidation.error }, 400);
		}

		let mimeType = file.type;

		if (mimeType === "application/octet-stream" && file.name) {
			const ext = file.name.split(".").pop()?.toLowerCase();
			if (ext && MIME_TYPE_MAP[ext]) {
				mimeType = MIME_TYPE_MAP[ext];
				logInfo(`Detected MIME type from extension .${ext}: ${mimeType}`);
			}
		}

		const isVideo = mimeType.startsWith("video/");

		const isAudio = mimeType.startsWith("audio/");

		if (isVideo) {
			if (!isMediaTypeSupported(model, "supportsVideos")) {
				return c.json(
					{
						error: `Model '${model}' does not support video inputs.`
					},
					400
				);
			}
		} else if (isAudio) {
			if (!isMediaTypeSupported(model, "supportsAudios")) {
				return c.json(
					{
						error: `Model '${model}' does not support audio inputs.`
					},
					400
				);
			}
		} else {
			return c.json(
				{
					error: `Unsupported media type: ${mimeType}. Only audio and video files are supported.`
				},
				400
			);
		}

		const arrayBuffer = await file.arrayBuffer();
		logInfo(`Processing audio file: size=${arrayBuffer.byteLength} bytes, type=${file.type}`);

		let base64Audio: string;
		try {
			base64Audio = Buffer.from(arrayBuffer).toString("base64");
		} catch (e: unknown) {
			const errorMessage = e instanceof Error ? e.message : String(e);
			console.error("Base64 conversion failed:", errorMessage);
			throw new Error(`Failed to process audio file: ${errorMessage}`);
		}

		const messages: ChatMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: prompt
					},
					{
						type: "input_audio",
						input_audio: {
							data: base64Audio,
							format: mimeType
						}
					}
				]
			}
		];

		let transcribeAccount;
		try {
			const pool = await AccountPool.create(c.env);
			const cfg = await effectiveConfig(c.env);
			transcribeAccount = (await pool.selectionOrderForRoute(route, cfg.preferredAccountKind))[0];
		} catch {
			transcribeAccount = undefined;
		}
		if (!transcribeAccount) {
			return c.json(
				{
					error:
						route === "api"
							? `No Google AI Studio API-key accounts available for '${model}'. Add a key in the dashboard or set GEMINI_API_KEYS.`
							: route === "cli"
								? `No Google accounts available for '${model}'. Add an account in the dashboard or set GCP_SERVICE_ACCOUNT.`
								: `No accounts available for '${model}'. Add a Google OAuth account or AI Studio API key.`
				},
				400
			);
		}

		const authManager = new AuthManager(c.env, transcribeAccount);
		const geminiClient = new GeminiApiClient(c.env, authManager);

		const completion = await geminiClient.getCompletion(baseModel, "", messages);

		return c.json({ text: completion.content });
	} catch (e: unknown) {
		const errorMessage = e instanceof Error ? e.message : String(e);
		console.error("Transcription error:", errorMessage);
		return c.json({ error: errorMessage }, 500);
	}
});
