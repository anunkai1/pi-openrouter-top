# pi-openrouter-top

Replaces pi's OpenRouter model list with the **top 50 models by weekly token
usage** from [https://openrouter.ai/models?order=top-weekly](https://openrouter.ai/models?order=top-weekly).

## Why

pi ships a ~300-model OpenRouter snapshot baked into the pi-ai package at
release time, plus a remote pi.dev catalog refreshed every 4 h — machinery
ACB never triggers (every pi child spawns `--offline`). Opening the model
picker showed 300+ models. This extension shrinks the list to the 50 models
people actually use, ranked by OpenRouter weekly analytics.

`~/.pi/agent/models.json` cannot do this for a built-in provider: it only
merges (replace-by-id, append the rest). An extension-registered provider
with `models` **replaces** the whole list, which is what shrinking needs.

## How it works

1. `scripts/sync-top50.mjs` fetches
   `https://openrouter.ai/api/frontend/v1/models/find?active=true&fmt=cards&order=top-weekly`
   (the data behind the website's ranking) plus `/api/v1/models` for
   pricing/limits, maps the top 50 to pi model cards, and writes
   `~/.pi/agent/openrouter-top50.json`.
2. `extensions/index.ts` registers the override at pi startup:
   `pi.registerProvider("openrouter", { api, baseUrl, models: snapshot })`.
   The OpenRouter key keeps resolving from `~/.pi/agent/auth.json`.
3. Fallback order: agent-dir snapshot → repo `snapshots/` copy → skip
   registration (built-in catalog remains as a safety net).

## Sync

```bash
npm run sync   # write ~/.pi/agent/openrouter-top50.json
systemctl restart agentchatbox   # refresh the ACB picker cache
```

Commit the regenerated snapshot to `snapshots/` when it changes materially.
