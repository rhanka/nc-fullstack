import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LightweightMemoryStore } from "../src/services/lightweight-memory-store.ts";

function createStore(): LightweightMemoryStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-memory-"));
  return new LightweightMemoryStore(path.join(root, "memory.sqlite3"));
}

test("LightweightMemoryStore persists working memory", () => {
  const store = createStore();
  store.rememberWorkingMemory({
    sessionId: "session-a",
    role: "000",
    userMessage: "rewrite this draft",
    searchQuery: "ATA 56 windshield rivet",
    label: "demo",
    description: { observation: "demo" },
    responseText: "draft output",
    sources: { tech_docs: { sources: [{ doc: "a.md" }] } },
  });

  const memory = store.readWorkingMemory("session-a");
  assert.equal(memory.session_id, "session-a");
  assert.equal(memory.recent_history.length, 1);
});

test("LightweightMemoryStore writes and searches episodic memory", () => {
  const store = createStore();
  const written = store.writeValidatedEpisode({
    episodeId: "episode-1",
    caseRef: "ATA-56-1",
    role: "100",
    label: "Rivet flushness",
    summary: "Right windshield rivet flushness corrected after review",
    corrections: ["updated wording"],
    sources: { tech_docs: { sources: [{ doc: "manual.md" }] } },
    validated: true,
  });

  assert.equal(written, true);
  const results = store.searchEpisodicMemory("right windshield rivet");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.chunk_id, "episode-1");
});
