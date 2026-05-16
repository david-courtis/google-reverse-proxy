interface GaxiosLike {
	status?: number;
	code?: string | number;
	message?: string;
	response?: { status?: number; data?: unknown };
}

export function upstreamStatus(err: unknown): number | undefined {
	const e = err as GaxiosLike;
	if (typeof e?.status === "number") return e.status;
	if (typeof e?.response?.status === "number") return e.response.status;
	if (typeof e?.code === "number") return e.code;
	if (typeof e?.code === "string" && /^\d+$/.test(e.code)) return Number(e.code);
	return undefined;
}

export function upstreamBody(err: unknown): string {
	const e = err as GaxiosLike;
	const d = e?.response?.data;
	if (d == null) return e?.message ?? String(err);
	return typeof d === "string" ? d : JSON.stringify(d);
}

export function isInvalidGrant(err: unknown): boolean {
	const e = err as GaxiosLike;
	const d = e?.response?.data as { error?: string; error_description?: string } | string | undefined;
	const dataStr = typeof d === "string" ? d : JSON.stringify(d ?? "");
	const hay = `${e?.message ?? ""} ${dataStr}`.toLowerCase();
	return hay.includes("invalid_grant");
}
