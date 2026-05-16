import { serve } from "@hono/node-server";
import app from "./app";
import { getConfig, runtimeHome, ensureOpenAIApiKey } from "./runtime/config";
import { color as C } from "./log";

const cfg = getConfig();
const port = Number(cfg.PORT || 8787);
const hostname = cfg.HOST || "0.0.0.0";
const { key: apiKey, generated } = ensureOpenAIApiKey(cfg);

serve({ fetch: app.fetch, port, hostname }, (info) => {
	const host = info.address === "::" || info.address === "0.0.0.0" ? "localhost" : info.address;
	const base = `http://${host}:${info.port}`;

	const rows: [string, string][] = [
		["OpenAI Compatible Endpoint", `${base}/v1`],
		["API Key", apiKey]
	];
	const labelW = Math.max(...rows.map(([l]) => l.length));
	const plain = rows.map(([l, v]) => `${l.padEnd(labelW)}   ${v}`);
	const innerW = Math.max(...plain.map((s) => s.length));
	const pad = 2;

	const border = (l: string, m: string, r: string) => `${C.dim}${l}${m.repeat(innerW + pad * 2)}${r}${C.reset}`;

	console.log("");
	console.log("  " + border("╭", "─", "╮"));
	const SECRET_LABELS = new Set(["API Key"]);
	rows.forEach(([l, v], i) => {
		const label = `${C.dim}${l.padEnd(labelW)}${C.reset}`;
		const value = SECRET_LABELS.has(l) ? `${C.green}${v}${C.reset}` : `${C.cyan}${v}${C.reset}`;
		const trail = " ".repeat(innerW - plain[i].length);
		console.log(`  ${C.dim}│${C.reset}${" ".repeat(pad)}${label}   ${value}${trail}${" ".repeat(pad)}${C.dim}│${C.reset}`);
	});
	console.log("  " + border("╰", "─", "╯"));

	if (generated) {
		console.log(
			`  ${C.dim}auto-generated bearer token, saved to ${runtimeHome()}/bearer.key.` +
				` Set OPENAI_API_KEY or server.bearer_token in config.yaml to override.${C.reset}`
		);
	}
	console.log("");
});
