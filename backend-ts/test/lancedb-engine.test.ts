import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { connect, Index } from "@lancedb/lancedb";

import { LanceDbRetrievalEngine, type LanceDbCorpusConfig } from "../src/retrieval/lancedb-engine.ts";
import type { EmbeddingVectorizer } from "../src/retrieval/openai-embeddings.ts";

async function createCorpus(root: string, corpus: "tech_docs" | "non_conformities"): Promise<LanceDbCorpusConfig> {
  const uri = path.join(root, corpus);
  const db = await connect(uri);
  const table = await db.createTable(
    "chunks",
    [
      {
        doc: corpus === "tech_docs" ? "tech-fuel.md" : "ATA-28-demo",
        chunk_id: corpus === "tech_docs" ? "tech-fuel" : "ATA-28-demo",
        content: "fuel tank grounding electrostatic discharge right wing",
        vector: [1, 0],
        ata_code: "ATA-28",
      },
      {
        doc: corpus === "tech_docs" ? "tech-window.md" : "ATA-56-demo",
        chunk_id: corpus === "tech_docs" ? "tech-window" : "ATA-56-demo",
        content: "windshield frame rivet flushness structural repair",
        vector: [0, 1],
        ata_code: "ATA-56",
      },
    ],
    { mode: "overwrite" },
  );
  await table.createIndex("content", { config: Index.fts() });
  await table.waitForIndex(["content_idx"], 30);

  return {
    corpus,
    uri,
    tableName: "chunks",
    finalLimit: 5,
  };
}

test("LanceDbRetrievalEngine returns hybrid results from embedded local corpora", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-lancedb-engine-"));
  const techDocs = await createCorpus(root, "tech_docs");
  const nonConformities = await createCorpus(root, "non_conformities");
  const vectorizer: EmbeddingVectorizer = {
    async embedQuery(query: string): Promise<Float32Array> {
      return query.includes("fuel")
        ? Float32Array.from([1, 0])
        : Float32Array.from([0, 1]);
    },
  };

  const engine = new LanceDbRetrievalEngine(vectorizer, {
    tech_docs: techDocs,
    non_conformities: nonConformities,
  });

  const results = await engine.search("fuel tank grounding right wing");

  assert.equal(results.techDocs[0]?.doc, "tech-fuel.md");
  assert.equal(results.nonConformities[0]?.doc, "ATA-28-demo");
  assert.deepEqual(results.techDocs[0]?.retrieval_channels, ["lexical", "vector"]);
  assert.equal(results.debug.techDocs.vectorEnabled, true);
});
