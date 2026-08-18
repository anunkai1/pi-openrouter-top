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
 * The snapshot is STATIC: ~/.pi/agent/openrouter-top50.json was pinned on
 * 2026-08-18 (top-weekly ranks as of that date) and is only ever read, never
 * refreshed. To re-pin a newer list later, regenerate that file manually
 * (source data: GET https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=top-weekly)
 * and restart agentchatbox so the picker cache re-probes.
 *
 * If the snapshot is missing, we skip registration and pi shows its
 * built-in catalog (safety net).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SNAPSHOT_PATH = join(homedir(), ".pi", "agent", "openrouter-top50.json");

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
	try {
		const parsed = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8")) as Snapshot;
		return Array.isArray(parsed.models) && parsed.models.length > 0 ? parsed : null;
	} catch {
		return null;
	}
}

export default async function (pi: ExtensionAPI) {
	const snapshot = await loadSnapshot();
	if (!snapshot) {
		console.warn(
			`[pi-openrouter-top] no snapshot at ${SNAPSHOT_PATH}; ` +
				"leaving the built-in OpenRouter catalog in place.",
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
