const SIGNATURE_DELIMITER = "__sig__";

export function encodeSignatureInToolCallId(signature: string | undefined): string {
	const baseId = `call_${crypto.randomUUID()}`;
	if (signature) {
		const encodedSig = btoa(signature);
		return `${baseId}${SIGNATURE_DELIMITER}${encodedSig}`;
	}
	return baseId;
}

export function extractSignatureFromToolCallId(toolCallId: string | undefined): string | undefined {
	if (!toolCallId || !toolCallId.includes(SIGNATURE_DELIMITER)) {
		return undefined;
	}

	const sigPart = toolCallId.split(SIGNATURE_DELIMITER)[1];
	if (sigPart) {
		try {
			return atob(sigPart);
		} catch (e) {
			console.error("Failed to decode thought_signature from tool_call id:", e);
		}
	}

	return undefined;
}
