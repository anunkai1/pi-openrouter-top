import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const snapshot = JSON.parse(readFileSync(new URL("../openrouter-top50.json", import.meta.url), "utf8"));

test("the pinned snapshot has usable model cards", () => {
  assert.ok(Array.isArray(snapshot.models) && snapshot.models.length >= 10);
  const ids = new Set();
  for (const model of snapshot.models) {
    assert.equal(typeof model.id, "string", "model id");
    assert.ok(model.id.includes("/"), `${model.id} is an OpenRouter vendor/model slug`);
    assert.ok(model.name, `${model.id} has a name`);
    assert.ok(!ids.has(model.id), `${model.id} appears twice`);
    ids.add(model.id);
    if (model.contextWindow !== undefined) assert.ok(model.contextWindow > 0, `${model.id} contextWindow`);
    if (model.maxTokens !== undefined) assert.ok(model.maxTokens > 0, `${model.id} maxTokens`);
  }
});

test("the extension reads the committed snapshot path", () => {
  const source = readFileSync(new URL("../extensions/index.ts", import.meta.url), "utf8");
  assert.match(source, /new URL\("\.\.\/openrouter-top50\.json", import\.meta\.url\)/);
});
