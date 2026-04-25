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

test("prepareTechDocsCanonicalDataset keeps the short canonical FCOM page when long and short variants share the same content", () => {
  const root = buildTestRoot();
  const pagesDir = path.join(root, "pages");
  const managedDatasetDir = path.join(root, "managed_dataset");
  mkdirSync(pagesDir, { recursive: true });
  mkdirSync(managedDatasetDir, { recursive: true });

  const longDoc = "611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_1529.pdf";
  const shortDoc = "a220-300-FCOM-1-1-13_page_1529.pdf";
  writeFileSync(path.join(pagesDir, longDoc), "");
  writeFileSync(path.join(pagesDir, shortDoc), "");

  const header = "doc\tdoc_root\tjson_data\tchunk\tlength\tchunk_id\tata\tparts\tdoc_type";
  const longRow =
    `${longDoc}\t611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped.pdf\t611795195-a220-300-Cs300-Bd500-1a11-Flight-Crew-Operating-Manual-Volume-1-1-13nbsped_page_1529.json\tFuel Tank Inerting System (FTIS) diagram with ram air, nitrogen-enriched air and air separation module.\t118\t${longDoc} 0\tATA 28\tFuel Tank Inerting System\ttechnical_diagram`;
  const shortRow =
    `${shortDoc}\ta220-300-FCOM-1-1-13.pdf\ta220-300-FCOM-1-1-13_page_1529.json\tFuel Tank Inerting System (FTIS) diagram with ram air, nitrogen-enriched air and air separation module.\t118\t${shortDoc} 0\tATA 28\tFuel Tank Inerting System\ttechnical_diagram`;
  const sourceText = `${header}\n${longRow}\n${shortRow}\n`;
  const sourceFile = path.join(managedDatasetDir, "a220_tech_docs_content_prepared.csv.gz");
  const outputFile = path.join(managedDatasetDir, "a220_tech_docs_content_canonical.csv.gz");
  writeFileSync(sourceFile, gzipSync(sourceText));

  const result = prepareTechDocsCanonicalDataset({
    sourceFile,
    outputFile,
    pagesDir,
  });

  const canonicalText = gunzipSync(readFileSync(outputFile)).toString("utf8");
  assert.equal(canonicalText, `${header}\n${shortRow}\n`);
  assert.equal(result.sourceRows, 2);
  assert.equal(result.keptRows, 1);
  assert.equal(result.droppedRows, 1);
});
