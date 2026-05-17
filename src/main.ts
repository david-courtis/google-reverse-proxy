import { serve } from "@hono/node-server";
import { randomBytes } from "node:crypto";
import app from "./app";
import { getConfig, runtimeHome, ensureOpenAIApiKey } from "./runtime/config";
import { color as C } from "./log";
import { effectiveConfig, getSettings, patchSettings } from "./webui-store";

const cfg = getConfig();
const port = Number(cfg.PORT || 8787);
const hostname = cfg.HOST || "0.0.0.0";
const { key: apiKey, generated } = ensureOpenAIApiKey(cfg);

let uiPassword = (await effectiveConfig(cfg)).uiPassword;
let uiPasswordGenerated = false;
if (!uiPassword) {
	const settings = await getSettings(cfg);
	if (!settings.uiPasswordInitialized) {
		const next = randomBytes(12).toString("base64url");
		await patchSettings(cfg, { uiPassword: next, uiPasswordInitialized: true });
		uiPassword = next;
		uiPasswordGenerated = true;
	}
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
	const host = info.address === "::" || info.address === "0.0.0.0" ? "localhost" : info.address;
	const base = `http://${host}:${info.port}`;

	const rows: [string, string][] = [
		["Web UI", `${base}/`],
		["OpenAI Compatible Endpoint", `${base}/v1`],
		["API Key", apiKey]
	];
	if (uiPassword) {
		rows.push(["Dashboard Password", uiPassword]);
	}
	const labelW = Math.max(...rows.map(([l]) => l.length));
	const plain = rows.map(([l, v]) => `${l.padEnd(labelW)}   ${v}`);
	const innerW = Math.max(...plain.map((s) => s.length));
	const pad = 2;

	const border = (l: string, m: string, r: string) => `${C.dim}${l}${m.repeat(innerW + pad * 2)}${r}${C.reset}`;

	console.log("");
	console.log("  " + border("╭", "─", "╮"));
	const SECRET_LABELS = new Set(["API Key", "Dashboard Password"]);
	rows.forEach(([l, v], i) => {
		const label = `${C.dim}${l.padEnd(labelW)}${C.reset}`;
		const value = SECRET_LABELS.has(l) ? `${C.green}${v}${C.reset}` : `${C.cyan}${v}${C.reset}`;
		const trail = " ".repeat(innerW - plain[i].length);
		console.log(`  ${C.dim}│${C.reset}${" ".repeat(pad)}${label}   ${value}${trail}${" ".repeat(pad)}${C.dim}│${C.reset}`);
	});
	console.log("  " + border("╰", "─", "╯"));

	if (generated) {
		console.log(
			`  ${C.dim}auto-generated key, saved to ${runtimeHome()}/config.json.` +
				` Set OPENAI_API_KEY to override.${C.reset}`
		);
	}
	if (uiPasswordGenerated) {
		console.log(
			`  ${C.dim}auto-generated dashboard password.` +
				` Change or clear it in Settings, Dashboard Password.${C.reset}`
		);
	}
	console.log("");
});
