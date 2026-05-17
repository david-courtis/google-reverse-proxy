import { Env, AccountCredential } from "./types";
import { AuthManager } from "./auth";
import { classifyApiError } from "./quota";

interface GeminiTier {
	id?: string;
	name?: string;
	isDefault?: boolean;
}
interface LoadCodeAssistResp {
	currentTier?: GeminiTier | null;
	paidTier?: GeminiTier | null;
	allowedTiers?: GeminiTier[] | null;
	cloudaicompanionProject?: string | null;
}
interface LroResp {
	name?: string;
	done?: boolean;
	response?: { cloudaicompanionProject?: { id?: string } };
}

const FREE_TIER = "free-tier";
const LEGACY_TIER = "legacy-tier";
const CLIENT_META = { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" };

export interface OnboardResult {
	ok: boolean;
	projectId?: string;
	alreadyOnboarded?: boolean;
	state?: "banned" | "verify" | "error";
	appealUrl?: string;
	validationUrl?: string;
	error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function onboardAccount(
	env: Env,
	account: AccountCredential,
	deadlineMs = 110000
): Promise<OnboardResult> {
	const deadline = Date.now() + deadlineMs;
	try {
		const am = new AuthManager(env, account);
		await am.initializeAuth();

		let projectId = (await am.getCachedProjectId()) || undefined;
		let load: LoadCodeAssistResp;
		try {
			load = (await am.callEndpoint("loadCodeAssist", {
				cloudaicompanionProject: projectId,
				metadata: { ...CLIENT_META, duetProject: projectId },
				mode: "HEALTH_CHECK"
			})) as LoadCodeAssistResp;
		} catch (e) {
			const cls = classifyApiError(e instanceof Error ? e.message : String(e));
			if (cls.state === "banned" || cls.state === "verify") {
				return { ok: false, state: cls.state, appealUrl: cls.appealUrl, validationUrl: cls.validationUrl };
			}
			return { ok: false, state: "error", error: e instanceof Error ? e.message : String(e) };
		}

		if (load.cloudaicompanionProject) {
			projectId = load.cloudaicompanionProject;
			await am.setCachedProjectId(projectId);
			return { ok: true, projectId, alreadyOnboarded: true };
		}

		const tier = (load.allowedTiers || []).find((t) => t.isDefault) || { id: LEGACY_TIER, name: "" };

		const onboardReq =
			tier.id === FREE_TIER
				? { tierId: tier.id, cloudaicompanionProject: undefined, metadata: CLIENT_META }
				: {
						tierId: tier.id,
						cloudaicompanionProject: projectId,
						metadata: { ...CLIENT_META, duetProject: projectId }
					};

		let lro: LroResp;
		try {
			lro = (await am.callEndpoint("onboardUser", onboardReq)) as LroResp;
		} catch (e) {
			const cls = classifyApiError(e instanceof Error ? e.message : String(e));
			if (cls.state === "banned" || cls.state === "verify") {
				return { ok: false, state: cls.state, appealUrl: cls.appealUrl, validationUrl: cls.validationUrl };
			}
			return { ok: false, state: "error", error: e instanceof Error ? e.message : String(e) };
		}

		while (!lro.done && lro.name && Date.now() < deadline) {
			await sleep(3000);
			lro = (await am.getOperation(lro.name)) as LroResp;
		}

		const provisioned = lro.response?.cloudaicompanionProject?.id;
		if (!provisioned) {
			return {
				ok: false,
				state: "error",
				error: lro.done
					? "Onboarding completed but no project was returned (account may be ineligible)"
					: "Onboarding timed out, try again shortly"
			};
		}

		await am.setCachedProjectId(provisioned);
		return { ok: true, projectId: provisioned };
	} catch (e) {
		return { ok: false, state: "error", error: e instanceof Error ? e.message : String(e) };
	}
}
