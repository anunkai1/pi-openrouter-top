/**
 * pi-openrouter-top — OpenRouter "Top 50 weekly" provider override.
 *
 * Replaces pi's built-in OpenRouter model catalog with the top 50 models by
 * weekly token usage, as ranked on https://openrouter.ai/models?order=top-weekly.
 *
 * Preserves per-model `api` (e.g. "anthropic-messages" for Anthropic models),
 * `baseUrl`, `thinkingLevelMap`, `compat`, and `inputLimits` so routing,
 * prompt caching, and thinking-level clamping match pi's built-in definitions.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SNAPSHOT_PATH = fileURLToPath(new URL("../openrouter-top50.json", import.meta.url));
const DEFAULT_API = "openai-completions";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

interface SnapshotModel {
	id: string;
	name: string;
	api?: "openai-completions" | "anthropic-messages" | "openai-responses";
	baseUrl?: string;
	reasoning?: boolean;
	thinkingLevelMap?: Record<string, string | null>;
	input?: string[];
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		tiers?: Array<{
			inputTokensAbove: number;
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
		}>;
	};
	contextWindow?: number;
	maxTokens?: number;
	compat?: Record<string, unknown>;
	inputLimits?: Record<string, unknown>;
}

interface Snapshot {
	checkedAt?: number;
	source?: string;
	models?: SnapshotModel[];
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
	if (!snapshot?.models) {
		console.warn(
			`[pi-openrouter-top] no snapshot at ${SNAPSHOT_PATH}; ` +
				"leaving the built-in OpenRouter catalog in place.",
		);
		return;
	}

	pi.registerProvider("openrouter", {
		api: DEFAULT_API,
		baseUrl: DEFAULT_BASE_URL,
		models: snapshot.models.map((model) => ({
			id: model.id,
			name: model.name,
			api: model.api ?? DEFAULT_API,
			baseUrl: model.baseUrl ?? (model.api === "anthropic-messages" ? "https://openrouter.ai/api" : DEFAULT_BASE_URL),
			reasoning: model.reasoning ?? false,
			...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
			input: (model.input ?? ["text"]).filter((m): m is "text" | "image" => m === "text" || m === "image"),
			cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: model.contextWindow ?? 128000,
			maxTokens: model.maxTokens ?? 16384,
			...(model.compat ? { compat: model.compat } : {}),
			...(model.inputLimits ? { inputLimits: model.inputLimits } : {}),
		})),
	});

	const checkedAt = snapshot.checkedAt ? new Date(snapshot.checkedAt).toISOString() : "unknown";
	console.log(
		`[pi-openrouter-top] registered openrouter override: ${snapshot.models.length} models ` +
			`(snapshot ${checkedAt}, ${snapshot.source ?? "source unknown"})`,
	);
}
