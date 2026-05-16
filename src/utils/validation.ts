import { geminiCliModels, getAllModelIdsWithVariants, parseModelId } from "../models";
import { ModelInfo, MessageContent } from "../types";
import { validateImageUrl } from "./image-utils";
import { validatePdfBase64 } from "./pdf-utils";

export function isMediaTypeSupported(modelId: string, supportKey: keyof ModelInfo): boolean {
	return !!geminiCliModels[parseModelId(modelId).baseModel]?.[supportKey];
}

export function validateModel(modelId: string): { isValid: boolean; error?: string } {
	if (!(parseModelId(modelId).baseModel in geminiCliModels)) {
		return {
			isValid: false,
			error: `Model '${modelId}' not found. Available models: ${getAllModelIdsWithVariants().join(", ")}`
		};
	}
	return { isValid: true };
}

export function validateContent(
	type: string,
	content: MessageContent
): { isValid: boolean; error?: string; mimeType?: string } {
	switch (type) {
		case "image_url":

			const imageUrl = content.image_url?.url;
			if (!imageUrl) {
				return { isValid: false, error: "Missing image URL." };
			}
			const validation = validateImageUrl(imageUrl);
			if (!validation.isValid) {
				return { isValid: false, error: "Invalid image URL or format." };
			}
			return { isValid: true, mimeType: validation.mimeType };

		case "input_pdf":

			const pdfData = content.input_pdf?.data;
			if (!pdfData) {
				return { isValid: false, error: "Missing PDF data." };
			}
			if (!validatePdfBase64(pdfData)) {
				return { isValid: false, error: "Invalid PDF data. Please ensure the content is a valid base64 encoded PDF." };
			}
			return { isValid: true };

		default:
			return { isValid: true };
	}
}
