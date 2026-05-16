import { Env } from "../types";
import { GroundingMetadata, CitationSource } from "../types/native-tools";

export class CitationsProcessor {
	private enableInlineCitations: boolean;

	constructor(env: Env) {
		this.enableInlineCitations = env.ENABLE_INLINE_CITATIONS === "true";
	}

	private findSafeInsertionPoint(text: string, index: number): number {

		if (index >= text.length) {
			return text.length;
		}

		const charAtIndex = text.charAt(index);
		if (/\s|[.,!?;:]/.test(charAtIndex)) {
			return index;
		}

		for (let i = index; i < text.length; i++) {
			const char = text.charAt(i);
			if (/\s|[.,!?;:]/.test(char)) {
				return i;
			}
		}

		return index;
	}

	public processChunk(textChunk: string, metadata?: GroundingMetadata): string {
		if (!this.enableInlineCitations) {
			return textChunk;
		}

		let citedTextChunk = textChunk;
		let offset = 0;

		if (metadata && metadata.groundingSupports && metadata.groundingChunks) {
			const sortedSupports = [...metadata.groundingSupports].sort(
				(a, b) => (a.segment?.startIndex ?? 0) - (b.segment?.startIndex ?? 0)
			);

			for (const support of sortedSupports) {
				const originalStartIndex = support.segment?.startIndex;
				const originalEndIndex = support.segment?.endIndex;

				if (
					originalStartIndex === undefined ||
					originalEndIndex === undefined ||
					!support.groundingChunkIndices?.length ||
					originalStartIndex < 0 ||
					originalEndIndex > textChunk.length
				) {
					continue;
				}

				const citationLinks = support.groundingChunkIndices
					.map((i) => {
						const uri = metadata.groundingChunks[i]?.web?.uri;
						if (uri) {
							return `[${i + 1}](${uri})`;
						}
						return null;
					})
					.filter(Boolean);

				if (citationLinks.length > 0) {
					const citationString = citationLinks.join(", ");

					const insertionIndex = originalEndIndex + offset;
					const safeInsertionIndex = this.findSafeInsertionPoint(citedTextChunk, insertionIndex);

					citedTextChunk =
						citedTextChunk.slice(0, safeInsertionIndex) + citationString + citedTextChunk.slice(safeInsertionIndex);

					offset += citationString.length; 
				}
			}
		}
		return citedTextChunk;
	}

	public extractSearchQueries(groundingMetadata: GroundingMetadata): string[] {
		return groundingMetadata.webSearchQueries || [];
	}

	public extractSourceList(groundingMetadata: GroundingMetadata): CitationSource[] {
		return groundingMetadata.groundingChunks.map((chunk, index) => ({
			id: index + 1,
			title: chunk.web.title,
			uri: chunk.web.uri
		}));
	}

	public getSearchEntryPoint(groundingMetadata: GroundingMetadata): string | null {
		return groundingMetadata.searchEntryPoint?.renderedContent || null;
	}

	public createGroundingSummary(groundingMetadata: GroundingMetadata): {
		queryCount: number;
		sourceCount: number;
		supportCount: number;
		queries: string[];
		sources: CitationSource[];
	} {
		return {
			queryCount: groundingMetadata.webSearchQueries?.length || 0,
			sourceCount: groundingMetadata.groundingChunks?.length || 0,
			supportCount: groundingMetadata.groundingSupports?.length || 0,
			queries: this.extractSearchQueries(groundingMetadata),
			sources: this.extractSourceList(groundingMetadata)
		};
	}
}
