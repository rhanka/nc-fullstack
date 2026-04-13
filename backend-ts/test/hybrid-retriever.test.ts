import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { rebuildLexicalIndex, type LexicalCorpusConfig } from "../src/services/lexical-search.ts";
import { HybridRetriever } from "../src/retrieval/hybrid-retriever.ts";
import type { EmbeddingVectorizer } from "../src/retrieval/openai-embeddings.ts";
import type { VectorCorpusConfig } from "../src/retrieval/vector-search.ts";

function writeFloat32File(filePath: string, values: readonly number[]): void {
  const buffer = Buffer.allocUnsafe(values.length * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < values.length; index += 1) {
    buffer.writeFloatLE(values[index]!, index * Float32Array.BYTES_PER_ELEMENT);
  }
  writeFileSync(filePath, buffer);
}

function buildLexicalCorpus(root: string, corpus: "tech_docs" | "non_conformities"): LexicalCorpusConfig {
  const sourceRoot = path.join(root, `${corpus}-source`);
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    path.join(sourceRoot, corpus === "tech_docs" ? "tech-fuel.md" : "ATA-28-demo.md"),
    "fuel tank grounding electrostatic discharge right wing",
    "utf8",
  );
  writeFileSync(
    path.join(sourceRoot, corpus === "tech_docs" ? "tech-window.md" : "ATA-56-demo.md"),
    "windshield frame rivet flushness structural repair",
    "utf8",
  );
  const config: LexicalCorpusConfig = {
    name: corpus,
    sourceRoot,
    fileGlobSuffix: ".md",
    dbPath: path.join(root, `${corpus}.sqlite3`),
  };
  rebuildLexicalIndex(config, { force: true });
  return config;
}

function buildVectorCorpus(root: string, corpus: "tech_docs" | "non_conformities"): VectorCorpusConfig {
  const exportRoot = path.join(root, `${corpus}-vector-export`);
  mkdirSync(exportRoot, { recursive: true });
  writeFloat32File(path.join(exportRoot, "vectors.f32"), [
    1, 0,
    0, 1,
  ]);
  writeFloat32File(path.join(exportRoot, "squared_norms.f32"), [1, 1]);
  writeFileSync(
    path.join(exportRoot, "items.jsonl"),
    [
      JSON.stringify({
        doc: corpus === "tech_docs" ? "tech-fuel.md" : "ATA-28-demo",
        chunk_id: corpus === "tech_docs" ? "tech-fuel" : "ATA-28-demo",
        content: "fuel tank grounding electrostatic discharge right wing",
      }),
      JSON.stringify({
        doc: corpus === "tech_docs" ? "tech-window.md" : "ATA-56-demo",
        chunk_id: corpus === "tech_docs" ? "tech-window" : "ATA-56-demo",
        content: "windshield frame rivet flushness structural repair",
      }),
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    path.join(exportRoot, "manifest.json"),
    JSON.stringify(
      {
        version: "vector-export-v1",
        corpus,
        embeddingModel: "text-embedding-3-large",
        metric: "l2",
        dimensions: 2,
        count: 2,
        vectorsPath: "vectors.f32",
        squaredNormsPath: "squared_norms.f32",
        itemsPath: "items.jsonl",
      },
      null,
      2,
    ),
    "utf8",
  );
  return {
    corpus,
    manifestPath: path.join(exportRoot, "manifest.json"),
  };
}

test("HybridRetriever fuses vector and lexical evidence into ranked results", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-hybrid-retriever-"));
  const techLexical = buildLexicalCorpus(root, "tech_docs");
  const ncLexical = buildLexicalCorpus(root, "non_conformities");
  const techVector = buildVectorCorpus(root, "tech_docs");
  const ncVector = buildVectorCorpus(root, "non_conformities");

  const vectorizer: EmbeddingVectorizer = {
    async embedQuery(query: string): Promise<Float32Array> {
      return query.includes("fuel")
        ? Float32Array.from([1, 0])
        : Float32Array.from([0, 1]);
    },
  };

  const retriever = new HybridRetriever(vectorizer, {
    corpora: {
      tech_docs: {
        lexical: techLexical,
        vector: techVector,
        finalLimit: 3,
      },
      non_conformities: {
        lexical: ncLexical,
        vector: ncVector,
        finalLimit: 3,
      },
    },
  });

  const results = await retriever.search("fuel tank grounding right wing");

  assert.equal(results.techDocs[0]?.doc, "tech-fuel.md");
  assert.deepEqual(results.techDocs[0]?.retrieval_channels, ["lexical", "vector"]);
  assert.equal(results.nonConformities[0]?.doc, "ATA-28-demo");
  assert.equal(results.debug.techDocs.vectorEnabled, true);
  assert.ok((results.techDocs[0]?.rrf_score ?? 0) > 0);
});
