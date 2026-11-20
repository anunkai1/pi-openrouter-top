# pi-openrouter-top

Replaces pi's OpenRouter model list with a **top-50 snapshot** — the
top 50 models by weekly token usage as ranked on
[https://openrouter.ai/models?order=top-weekly](https://openrouter.ai/models?order=top-weekly).

## Why

pi ships a ~300-model OpenRouter snapshot baked into the pi-ai package at
release time, plus a remote pi.dev catalog refreshed every 4 h — machinery
ACB never triggers (every pi child spawns `--offline`). Opening the model
picker showed 300+ models. This extension shrinks the list to the 50 models
people actually use.

`~/.pi/agent/models.json` cannot do this for a built-in provider: it only
merges (replace-by-id, append the rest). An extension-registered provider
with `models` **replaces** the whole list, which is what shrinking needs.

## How it works

1. The snapshot is `openrouter-top50.json` in this repo — pi-format model
   cards, refreshed from OpenRouter's live top-weekly ranking (currently
   2026-11-20).
2. At every pi startup the extension reads that file and registers
   `pi.registerProvider("openrouter", { api, baseUrl, models })` while
   preserving per-model `api` (e.g. `anthropic-messages`), `baseUrl`,
   `thinkingLevelMap`, `compat`, and `inputLimits`. The OpenRouter key
   keeps resolving from `~/.pi/agent/auth.json`.
3. No runtime network calls at startup. If the snapshot is missing,
   registration is skipped and the built-in catalog remains as a safety net.

## Refreshing the list (manual, when you want)

Run `npm run refresh` (executes `scripts/refresh-top50.mjs`) to regenerate
`openrouter-top50.json` from
`https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=top-weekly`
merged with `https://openrouter.ai/api/v1/models` and `pi-ai` metadata,
run `npm test`, commit it, then restart agentchatbox so the picker cache
re-probes.
