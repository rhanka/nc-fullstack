import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  parseDelimitedRecordsWithRaw,
  prepareTechDocsCanonicalDataset,
} from "../src/dataprep/tech-docs-canonical.ts";

function buildTestRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), "nc-backend-ts-tech-docs-canonical-"));
}

test("parseDelimitedRecordsWithRaw preserves raw multiline TSV records", () => {
  const header = "doc\tdoc_root\tjson_data\tchunk\tlength\tchunk_id\tata\tparts\tdoc_type";
  const row = "doc.pdf\troot.pdf\tdoc.json\t\"line 1\nline 2 with \\\"quote\\\"\"\t31\tdoc.pdf 0\tATA 52\tDoor\tprocedure";
  const records = parseDelimitedRecordsWithRaw(`${header}\n${row}\n`);

  assert.equal(records.length, 2);
  assert.deepEqual(records[1]?.row, [
    "doc.pdf",
    "root.pdf",
    "doc.json",
    "line 1\nline 2 with \"quote\"",
    "31",
    "doc.pdf 0",
    "ATA 52",
    "Door",
    "procedure",
  ]);
  assert.equal(records[1]?.raw, row);
});

test("prepareTechDocsCanonicalDataset drops non-servable pages and preserves kept row bytes", () => {
  const root = buildTestRoot();
  const pagesDir = path.join(root, "pages");
  const managedDatasetDir = path.join(root, "managed_dataset");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(managedDatasetDir, { recursive: true });
  writeFileSync(path.join(pagesDir, "servable-page_0001.pdf"), "");

  const header = "doc\tdoc_root\tjson_data\tchunk\tlength\tchunk_id\tata\tparts\tdoc_type";
  const keptRow =
    "servable-page_0001.pdf\tservable.pdf\tservable-page_0001.json\t\"Door frame\nkept text with \\\"quoted\\\" value\"\t42\tservable-page_0001.pdf 0\tATA 52\tDoor Frame\tprocedure";
  const missingRow =
    "missing-page_0002.pdf\tmissing.pdf\tmissing-page_0002.json\tMissing page text\t17\tmissing-page_0002.pdf 0\tATA 52\tMissing Frame\tprocedure";
  const duplicateRow =
    "servable-page_0001.pdf\tservable.pdf\tservable-page_0001-copy.json\tDuplicate text\t14\tservable-page_0001.pdf 0\tATA 52\tDoor Frame\tprocedure";
  const sourceText = `${header}\n${keptRow}\n${missingRow}\n${duplicateRow}\n`;
  const sourceFile = path.join(managedDatasetDir, "a220_tech_docs_content_prepared.csv.gz");
  const outputFile = path.join(managedDatasetDir, "a220_tech_docs_content_canonical.csv.gz");
  const auditFile = path.join(managedDatasetDir, "a220_tech_docs_content_canonical.audit.json");
  writeFileSync(sourceFile, gzipSync(sourceText));

  const result = prepareTechDocsCanonicalDataset({
    sourceFile,
    outputFile,
    auditFile,
    pagesDir,
  });

  const canonicalText = gunzipSync(readFileSync(outputFile)).toString("utf8");
  assert.equal(canonicalText, `${header}\n${keptRow}\n`);
  assert.equal(result.sourceRows, 3);
  assert.equal(result.keptRows, 1);
  assert.equal(result.droppedRows, 2);
  assert.equal(result.droppedMissingPageRows, 1);
  assert.equal(result.droppedDuplicateChunkRows, 1);
  assert.equal(result.keptRowsCharExact, true);
  assert.equal(result.sourceKeptRowsSha256, result.canonicalRowsSha256);
  assert.deepEqual(result.missingPageRoots, [{ docRoot: "missing.pdf", count: 1 }]);

  const audit = JSON.parse(readFileSync(auditFile, "utf8")) as typeof result;
  assert.equal(audit.keptRowsCharExact, true);
  assert.equal(audit.sourceKeptRowsSha256, result.sourceKeptRowsSha256);
});
