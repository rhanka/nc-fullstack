import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildMatchQuery,
  rebuildLexicalIndex,
  searchLexicalCorpus,
  type LexicalCorpusConfig,
} from "../src/services/lexical-search.ts";

function createCorpus(): LexicalCorpusConfig {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-lexical-"));
  const sourceRoot = path.join(root, "source");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    path.join(sourceRoot, "ATA-56-demo.md"),
    "Right windshield rivet flushness out of tolerance.",
    "utf8",
  );
  writeFileSync(
    path.join(sourceRoot, "ATA-28-demo.md"),
    "Fuel tank grounding electrostatic discharge investigation.",
    "utf8",
  );
  return {
    name: "test",
    sourceRoot,
    fileGlobSuffix: ".md",
    dbPath: path.join(root, "fts.sqlite3"),
  };
}

test("buildMatchQuery tokenizes to prefix FTS terms", () => {
  assert.equal(buildMatchQuery("Right windshield rivet", "AND"), "right* AND windshield* AND rivet*");
});

test("searchLexicalCorpus rebuilds and returns ranked matches", () => {
  const corpus = createCorpus();
  const summary = rebuildLexicalIndex(corpus);
  assert.equal(summary.documentCount, 2);

  const results = searchLexicalCorpus(corpus, "windshield rivet", { limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.doc, "ATA-56-demo.md");
  assert.equal(results[0]?.lexical_rank, 1);
});

test("searchLexicalCorpus returns empty results when source root is absent and index is empty", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-lexical-missing-source-"));
  const corpus: LexicalCorpusConfig = {
    name: "missing_source",
    sourceRoot: path.join(root, "missing-source"),
    fileGlobSuffix: ".md",
    dbPath: path.join(root, "fts.sqlite3"),
  };

  const results = searchLexicalCorpus(corpus, "windshield rivet", { limit: 5 });

  assert.deepEqual(results, []);
});
