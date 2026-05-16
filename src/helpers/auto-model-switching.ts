import { AUTO_SWITCH_MODEL_MAP, RATE_LIMIT_STATUS_CODES } from "../constants";
import { logInfo } from "../log";
import { Env, ChatMessage, UsageData, StreamChunk } from "../types";

export class AutoModelSwitchingHelper {
	private env: Env;

	constructor(env: Env) {
		this.env = env;
	}

	isEnabled(): boolean {
		return this.env.ENABLE_AUTO_MODEL_SWITCHING === "true";
	}

	getFallbackModel(originalModel: string): string | null {
		return AUTO_SWITCH_MODEL_MAP[originalModel as keyof typeof AUTO_SWITCH_MODEL_MAP] || null;
	}

	isRateLimitError(error: unknown): boolean {
		return (
			error instanceof Error &&
			(error.message.includes("Stream request failed: 429") || error.message.includes("Stream request failed: 503"))
		);
	}

	isRateLimitStatus(status: number): boolean {
		return (RATE_LIMIT_STATUS_CODES as readonly number[]).includes(status);
	}

	shouldAttemptFallback(originalModel: string): boolean {
		return this.isEnabled() && this.getFallbackModel(originalModel) !== null;
	}

	createSwitchNotification(originalModel: string, fallbackModel: string): string {
		return `[Auto-switched from ${originalModel} to ${fallbackModel} due to rate limiting]\n\n`;
	}

	async handleNonStreamingFallback(
		originalModel: string,
		systemPrompt: string,
		messages: ChatMessage[],
		options:
			| {
					includeReasoning?: boolean;
					thinkingBudget?: number;
			  }
			| undefined,
		streamContentFn: (
			modelId: string,
			systemPrompt: string,
			messages: ChatMessage[],
			options?: {
				includeReasoning?: boolean;
				thinkingBudget?: number;
			}
		) => AsyncGenerator<StreamChunk>
	): Promise<{ content: string; usage?: UsageData } | null> {
		const fallbackModel = this.getFallbackModel(originalModel);
		if (!fallbackModel || !this.isEnabled()) {
			return null;
		}

		logInfo(`Got rate limit error for model ${originalModel}, switching to fallback model: ${fallbackModel}`);

		let content = "";
		let usage: UsageData | undefined;

		content += this.createSwitchNotification(originalModel, fallbackModel);

		for await (const chunk of streamContentFn(fallbackModel, systemPrompt, messages, options)) {
			if (chunk.type === "text" && typeof chunk.data === "string") {
				content += chunk.data;
			} else if (chunk.type === "usage" && typeof chunk.data === "object") {
				usage = chunk.data as UsageData;
			}
		}

		return { content, usage };
	}
}
