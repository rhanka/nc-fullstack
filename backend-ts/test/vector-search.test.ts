import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ExactVectorStore, type VectorCorpusConfig } from "../src/retrieval/vector-search.ts";

function writeFloat32File(filePath: string, values: readonly number[]): void {
  const buffer = Buffer.allocUnsafe(values.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index]!, index * Float32Array.BYTES_PER_ELEMENT);
  }
  writeFileSync(filePath, buffer);
}

function buildFixtureStore(): ExactVectorStore {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-vector-fixture-"));
  mkdirSync(root, { recursive: true });

  const manifestPath = path.join(root, "manifest.json");
  writeFloat32File(path.join(root, "vectors.f32"), [
    1, 0,
    0, 1,
    0.8, 0.2,
  ]);
  writeFloat32File(path.join(root, "squared_norms.f32"), [
    1,
    1,
    0.68,
  ]);
  writeFileSync(
    path.join(root, "items.jsonl"),
    [
      JSON.stringify({ doc: "A.md", chunk_id: "A", content: "alpha" }),
      JSON.stringify({ doc: "B.md", chunk_id: "B", content: "beta" }),
      JSON.stringify({ doc: "C.md", chunk_id: "C", content: "alpha beta" }),
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        version: "vector-export-v1",
        corpus: "tech_docs",
        embeddingModel: "text-embedding-3-large",
        metric: "l2",
        dimensions: 2,
        count: 3,
        vectorsPath: "vectors.f32",
        squaredNormsPath: "squared_norms.f32",
        itemsPath: "items.jsonl",
      },
      null,
      2,
    ),
    "utf8",
  );

  const config: VectorCorpusConfig = {
    corpus: "tech_docs",
    manifestPath,
  };
  return new ExactVectorStore(config);
}

test("ExactVectorStore returns nearest neighbors ordered by L2 distance", () => {
  const store = buildFixtureStore();

  const results = store.search(Float32Array.from([1, 0]), 2);

  assert.equal(results.length, 2);
  assert.equal(results[0]?.doc, "A.md");
  assert.equal(results[0]?.vector_rank, 1);
  assert.equal(results[1]?.doc, "C.md");
  assert.equal(results[1]?.vector_rank, 2);
  assert.ok((results[0]?.distance ?? 1) <= (results[1]?.distance ?? 0));
});

test("ExactVectorStore rejects dimension mismatches", () => {
  const store = buildFixtureStore();

  assert.throws(() => store.search(Float32Array.from([1, 0, 0]), 1), /dimensions mismatch/u);
});
