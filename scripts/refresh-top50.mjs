#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "openrouter-top50.json");
const FIND_URL = "https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=top-weekly";
const API_URL = "https://openrouter.ai/api/v1/models";
const PI_AI_OPENROUTER =
	"/home/lepton/.npm-global/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/openrouter.json";

function loadPiAiCatalog() {
	if (!existsSync(PI_AI_OPENROUTER)) return new Map();
	const raw = JSON.parse(readFileSync(PI_AI_OPENROUTER, "utf8"));
	const map = new Map();
	for (const group of Object.values(raw)) {
		const entries = Array.isArray(group) ? group : Object.values(group);
		for (const model of entries) {
			if (model?.id && !map.has(model.id)) map.set(model.id, model);
		}
	}
	return map;
}

function perMillion(raw) {
	const num = Number(raw);
	if (!Number.isFinite(num) || num <= 0) return 0;
	return Number((num * 1_000_000).toFixed(6));
}

export function inferThinkingLevelMap(id, supportedParams, piModel, supportsReasoning = false) {
	if (piModel?.thinkingLevelMap) return piModel.thinkingLevelMap;
	const params = new Set(supportedParams ?? []);
	if (!params.has("reasoning") && !supportsReasoning) return undefined;
	if (id.startsWith("google/gemini-4")) {
		return { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
	}
	if (params.has("reasoning_effort")) {
		return { off: "none", minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null };
	}
	return { off: "none", minimal: null, low: null, medium: null, high: "high", xhigh: null, max: null };
}

export function buildModelEntry(card, apiModel, piModel) {
	const id = card?.slug ?? apiModel?.id;
	const isAnthropic = id.startsWith("anthropic/");
	const api = piModel?.api ?? (isAnthropic ? "anthropic-messages" : "openai-completions");
	const baseUrl =
		piModel?.baseUrl ?? (api === "anthropic-messages" ? "https://openrouter.ai/api" : "https://openrouter.ai/api/v1");
	const params = new Set(apiModel.supported_parameters ?? []);
	const reasoning = piModel?.reasoning ?? (params.has("reasoning") || Boolean(card.supports_reasoning));
	const rawInputs = piModel?.input ?? apiModel.architecture?.input_modalities ?? ["text"];
	const input = rawInputs.filter((m) => m === "text" || m === "image");
	if (input.length === 0) input.push("text");

	const pricing = apiModel.pricing ?? {};
	const cost = piModel?.cost ?? {
		input: perMillion(pricing.prompt),
		output: perMillion(pricing.completion),
		cacheRead: perMillion(pricing.input_cache_read),
		cacheWrite: perMillion(pricing.input_cache_write),
	};

	const thinkingLevelMap = inferThinkingLevelMap(
		id,
		apiModel.supported_parameters,
		piModel,
		Boolean(card.supports_reasoning),
	);
	const compat =
		piModel?.compat ??
		(api === "anthropic-messages"
			? { forceAdaptiveThinking: true, supportsMidConvoEffort: true }
			: {
					supportsDeveloperRole: false,
					...(reasoning ? { thinkingFormat: "openrouter" } : {}),
					supportsStrictMode: true,
					sendSessionAffinityHeaders: true,
				});

	return {
		id,
		name: piModel?.name ?? apiModel.name ?? card.name ?? id,
		api,
		baseUrl,
		reasoning,
		...(thinkingLevelMap ? { thinkingLevelMap } : {}),
		input,
		cost,
		contextWindow: piModel?.contextWindow ?? apiModel.context_length ?? card.context_length ?? 128000,
		maxTokens: piModel?.maxTokens ?? apiModel.top_provider?.max_completion_tokens ?? 16384,
		...(compat ? { compat } : {}),
		...(piModel?.inputLimits ? { inputLimits: piModel.inputLimits } : {}),
	};
}

async function main() {
	const [findRes, apiRes] = await Promise.all([fetch(FIND_URL), fetch(API_URL)]);
	if (!findRes.ok) throw new Error(`OpenRouter find failed: HTTP ${findRes.status}`);
	if (!apiRes.ok) throw new Error(`OpenRouter models failed: HTTP ${apiRes.status}`);

	const findJson = await findRes.json();
	const apiJson = await apiRes.json();
	const apiMap = new Map((apiJson.data ?? []).map((m) => [m.id, m]));
	const piAiMap = loadPiAiCatalog();

	const models = [];
	const seen = new Set();
	for (const card of findJson.data?.models ?? []) {
		const id = card?.slug;
		if (typeof id !== "string" || id.startsWith("openrouter/") || seen.has(id)) continue;
		seen.add(id);
		const apiModel = apiMap.get(id);
		if (!apiModel) continue;
		const outMods = apiModel.architecture?.output_modalities ?? card.output_modalities ?? ["text"];
		if (!outMods.includes("text")) continue;

		const piModel = piAiMap.get(id);
		models.push(buildModelEntry(card, apiModel, piModel));
		if (models.length >= 50) break;
	}

	const snapshot = {
		checkedAt: Date.now(),
		source: FIND_URL,
		count: models.length,
		models,
	};
	writeFileSync(OUTPUT, JSON.stringify(snapshot, null, 2) + "\n");
	console.log(`Wrote ${models.length} models to ${OUTPUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
