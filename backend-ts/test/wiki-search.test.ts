import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { searchWikiIndex, type WikiIndexEntry } from "../src/services/wiki-search.ts";

function writeWikiIndex(entries: readonly WikiIndexEntry[]) {
  const root = mkdtempSync(path.join(os.tmpdir(), "nc-wiki-search-"));
  mkdirSync(path.join(root, "wiki"), { recursive: true });
  const indexPath = path.join(root, "wiki", "index.json");
  writeFileSync(indexPath, JSON.stringify(entries, null, 2));
  return indexPath;
}

test("searchWikiIndex ranks matching part pages and exposes primary supporting doc", () => {
  const indexPath = writeWikiIndex([
    {
      slug: "windshield-frame",
      title: "Windshield frame",
      path: "wiki/windshield-frame.md",
      ata_codes: ["ATA 56"],
      zones: ["RH windshield frame"],
      aliases: ["cockpit window frame"],
      part_numbers: ["D5312345600000"],
      supporting_docs: ["tech-window.md"],
      supporting_chunks: ["tech-window 0"],
      short_description: "Canonical windshield frame entity used for fastener flushness analysis.",
      entity_type: "part",
    },
    {
      slug: "cargo-door",
      title: "Cargo door",
      path: "wiki/cargo-door.md",
      ata_codes: ["ATA 52"],
      zones: ["FWD cargo bay"],
      aliases: ["freight door"],
      supporting_docs: ["tech-cargo.md"],
    },
  ]);

  const result = searchWikiIndex("ATA 56 windshield frame flushness fastener", {
    config: { indexPath },
  });

  assert.equal(result.debug.indexReady, true);
  assert.equal(result.results[0]?.title, "Windshield frame");
  assert.equal(result.results[0]?.primary_doc, "tech-window.md");
  assert.equal(result.results[0]?.entity_type, "part");
  assert.match(result.results[0]?.content ?? "", /Canonical windshield frame entity/u);
  assert.match(result.results[0]?.content ?? "", /ATA: ATA 56/u);
  assert.match(result.results[0]?.content ?? "", /Supporting doc: tech-window.md/u);
});

test("searchWikiIndex returns empty results when the index does not exist", () => {
  const result = searchWikiIndex("ATA 56 windshield frame", {
    config: { indexPath: path.join(os.tmpdir(), "missing-wiki-index.json") },
  });

  assert.equal(result.debug.indexReady, false);
  assert.deepEqual(result.results, []);
});
