import type { Env } from "../types";

const dailyBuckets: Map<string, { day: string; count: number }> = new Map();

function dayKey(ts = Date.now()): string {
	return new Date(ts).toISOString().slice(0, 10);
}

export async function recordUsage(_env: Env, accountId: string, _modelId: string): Promise<void> {
	const today = dayKey();
	const cur = dailyBuckets.get(accountId);
	if (!cur || cur.day !== today) {
		dailyBuckets.set(accountId, { day: today, count: 1 });
	} else {
		cur.count += 1;
	}
}

export async function usageForAccounts(
	_env: Env,
	ids: string[]
): Promise<Record<string, { today: number }>> {
	const today = dayKey();
	const out: Record<string, { today: number }> = {};
	for (const id of ids) {
		const cur = dailyBuckets.get(id);
		out[id] = { today: cur && cur.day === today ? cur.count : 0 };
	}
	return out;
}
