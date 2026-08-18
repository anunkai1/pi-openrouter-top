/**
 * pi-openrouter-top — OpenRouter "Top 50 weekly" provider override.
 *
 * Replaces pi's built-in OpenRouter model catalog (a ~300-model snapshot
 * baked into the pi-ai package at release time, plus pi's never-used-in-ACB
 * remote pi.dev catalog) with the top 50 models by weekly token usage, as
 * ranked on https://openrouter.ai/models?order=top-weekly.
 *
 * Why an extension and not ~/.pi/agent/models.json: models.json MERGES
 * custom definitions into a built-in SDK provider (replace by id, append
 * the rest) — it cannot shrink the list. An extension-registered provider
 * with `models` REPLACES the entire list (pi docs: "If provided, replaces
 * all existing models for this provider"), which is what shrinking to 50
 * requires. Auth is untouched: the override supplies only api/baseUrl/models,
 * so the OpenRouter key from ~/.pi/agent/auth.json keeps working (pi's
 * provider composition falls back to the built-in provider's auth).
 *
 * Data flow:
 *   1. scripts/sync-top50.mjs fetches OpenRouter's top-weekly ranking and
 *      writes ~/.pi/agent/openrouter-top50.json (pi-format model cards).
 *   2. This extension reads that snapshot at pi startup and registers the
 *      openrouter provider override with exactly those 50 models.
 *   3. If the snapshot is missing, fall back to the copy committed in this
 *      repo (snapshots/openrouter-top50.json); if that is missing too, we
 *      skip registration and pi shows its built-in catalog (safety net).
 *
 * Because ACB spawns every pi child with `--offline`, and this override
 * replaces the provider's entire model list, pi's remote-catalog machinery
 * (the 4-hourly pi.dev refresh that ACB never triggers anyway) becomes
 * irrelevant for openrouter: its models are exactly what the snapshot says.
 *
 * To refresh the list: `npm run sync` in this repo (or run the script
 * directly) and restart agentchatbox so the picker cache re-probes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_DIR_SNAPSHOT = join(homedir(), ".pi", "agent", "openrouter-top50.json");
const REPO_FALLBACK = join(dirname(fileURLToPath(import.meta.url)), "..", "snapshots", "openrouter-top50.json");

interface Snapshot {
	checkedAt?: number;
	source?: string;
	models?: Array<{
		id: string;
		name: string;
		reasoning?: boolean;
		input?: string[];
		cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow?: number;
		maxTokens?: number;
		compat?: Record<string, unknown>;
	}>;
}

async function loadSnapshot(): Promise<Snapshot | null> {
	for (const path of [AGENT_DIR_SNAPSHOT, REPO_FALLBACK]) {
		try {
			const parsed = JSON.parse(await readFile(path, "utf8")) as Snapshot;
			if (Array.isArray(parsed.models) && parsed.models.length > 0) return parsed;
		} catch {
			// try the next source
		}
	}
	return null;
}

export default async function (pi: ExtensionAPI) {
	const snapshot = await loadSnapshot();
	if (!snapshot) {
		console.warn(
			"[pi-openrouter-top] no snapshot found (tried " +
				`${AGENT_DIR_SNAPSHOT} and ${REPO_FALLBACK}); ` +
				"leaving the built-in OpenRouter catalog in place. " +
				"Run `npm run sync` in pi-openrouter-top to generate one.",
		);
		return;
	}

	pi.registerProvider("openrouter", {
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		models: snapshot.models.map((model) => ({
			id: model.id,
			name: model.name,
			reasoning: model.reasoning ?? false,
			input: (model.input ?? ["text"]) as ("text" | "image")[],
			cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow ?? 128000,
			maxTokens: model.maxTokens ?? 16384,
			...(model.compat ? { compat: model.compat } : {}),
		})),
	});

	const checkedAt = snapshot.checkedAt ? new Date(snapshot.checkedAt).toISOString() : "unknown";
	console.log(
		`[pi-openrouter-top] registered openrouter override: ${snapshot.models.length} models ` +
			`(snapshot ${checkedAt}, ${snapshot.source ?? "source unknown"})`,
	);
}
