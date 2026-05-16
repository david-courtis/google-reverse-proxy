import { GeminiUrlContextMetadata, GroundingMetadata, NativeToolResponse } from "../types/native-tools";
import { GeminiPart } from "../gemini-client";

export class NativeToolsResponseProcessor {

	public processNativeToolResponse(part: GeminiPart): NativeToolResponse | null {

		if (part.url_context_metadata) {
			return {
				type: "url_context",
				data: part.url_context_metadata as GeminiUrlContextMetadata
			};
		}

		return null;
	}

	public processGroundingMetadata(metadata: GroundingMetadata): NativeToolResponse {
		return {
			type: "search",
			data: metadata.groundingChunks || [],
			metadata: metadata
		};
	}
}
