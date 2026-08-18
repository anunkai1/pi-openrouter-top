#!/usr/bin/env node
/**
 * sync-top50.mjs — refresh the OpenRouter "top 50 weekly" snapshot.
 *
 * Fetches OpenRouter's own top-weekly ranking (the data behind
 * https://openrouter.ai/models?order=top-weekly) plus the full model list
 * for pricing/limits, maps the top 50 to pi model cards, and writes
 * ~/.pi/agent/openrouter-top50.json — the file pi-openrouter-top's
 * extension reads at every pi startup to replace pi's built-in OpenRouter
 * catalog with exactly these 50 models.
 *
 * Usage:
 *   node scripts/sync-top50.mjs [--out <path>]
 *
 * Default output: ~/.pi/agent/openrouter-top50.json. After syncing, restart
 * agentchatbox so its picker cache re-probes pi.
 *
 * Notes:
 * - Order comes from OpenRouter's own ranking (data.models is returned in
 *   top-weekly order; `order=top-weekly` in the query).
 * - The ranking endpoint strips `:free` variant suffixes that the website
 *   shows on some rows (e.g. nvidia/...:free); we use the canonical slug,
 *   which is the same model family without the free-tier marker.
 * - Pricing is $/1M tokens (OpenRouter's API reports per-token strings).
 *   cacheWrite is unavailable from the public API and left 0.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOP_WEEKLY_URL =
	"https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=top-weekly";
const LIVE_MODELS_URL = "https://openrouter.ai/api/v1/models";
const TOP_N = 50;

const DEFAULT_OUT = join(homedir(), ".pi", "agent", "openrouter-top50.json");

// Extra compat flags pi needs for correct streaming on specific models —
// mirroring what our own ~/.pi/agent/models.json used to carry before the
// top-50 override made it redundant. Keyed by OpenRouter slug.
const COMPAT_EXTRA = {
	"deepseek/deepseek-v4-flash-0731": {
		requiresReasoningContentOnAssistantMessages: true,
	},
};

function parseArgs(argv) {
	const args = { out: DEFAULT_OUT };
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--out" && argv[i + 1]) args.out = argv[i + 1];
	}
	return args;
}

const usdToPerMillion = (s) => {
	const n = Number.parseFloat(s);
	return Number.isFinite(n) && n >= 0 ? Number((n * 1e6).toFixed(6)) : 0;
};

function toPiModel(card, live) {
	const pricing = live?.pricing ?? {};
	const maxTokens = Number.isFinite(live?.top_provider?.max_completion_tokens)
		? live.top_provider.max_completion_tokens
		: 16384;
	const input = (card.input_modalities ?? ["text"]).filter((m) => m === "text" || m === "image");
	const reasoning = card.supports_reasoning === true || live?.reasoning != null;
	const compat = {
		...(reasoning ? { thinkingFormat: "openrouter" } : {}),
		...(COMPAT_EXTRA[card.slug] ?? {}),
	};
	return {
		id: card.slug,
		name: card.name ?? card.slug,
		reasoning,
		input: input.length > 0 ? input : ["text"],
		cost: {
			input: usdToPerMillion(pricing?.prompt),
			output: usdToPerMillion(pricing?.completion),
			cacheRead: usdToPerMillion(pricing?.input_cache_read),
			cacheWrite: 0,
		},
		contextWindow: card.context_length ?? 128000,
		maxTokens,
		...(Object.keys(compat).length > 0 ? { compat } : {}),
	};
}

async function main() {
	const args = parseArgs(process.argv);
	const out = resolve(args.out);

	console.log(`[sync-top50] fetching ${TOP_WEEKLY_URL}`);
	const [rankingRes, liveRes] = await Promise.all([
		fetch(TOP_WEEKLY_URL, {
			headers: { accept: "application/json", "User-Agent": "pi-openrouter-top/0.1.0" },
		}),
		fetch(LIVE_MODELS_URL, {
			headers: { accept: "application/json", "User-Agent": "pi-openrouter-top/0.1.0" },
		}),
	]);
	if (!rankingRes.ok) throw new Error(`ranking request failed: HTTP ${rankingRes.status}`);
	if (!liveRes.ok) throw new Error(`live models request failed: HTTP ${liveRes.status}`);

	const ranking = await rankingRes.json();
	const live = await liveRes.json();

	const cards = ranking?.data?.models;
	if (!Array.isArray(cards) || cards.length === 0) {
		throw new Error("ranking response had no data.models array");
	}
	const liveById = new Map((live?.data ?? []).map((m) => [m.id, m]));

	const top = cards.slice(0, TOP_N);
	const models = top.map((card, i) => {
		const model = toPiModel(card, liveById.get(card.slug));
		if (!liveById.has(card.slug)) {
			console.warn(`[sync-top50]   ! no pricing/limits data for ${card.slug} (used defaults)`);
		}
		return model;
	});

	const snapshot = {
		checkedAt: Date.now(),
		source: TOP_WEEKLY_URL,
		count: models.length,
		models,
	};

	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o644 });

	console.log(`[sync-top50] wrote ${models.length} models to ${out}`);
	console.log(`[sync-top50] top 5: ${models.slice(0, 5).map((m) => m.id).join(", ")}`);
}

main().catch((err) => {
	console.error(`[sync-top50] failed: ${err instanceof Error ? err.message : err}`);
	process.exit(1);
});
