import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

const RAW_TECH_DOCS_CSV = "a220_tech_docs_content_prepared.csv.gz";
export const CANONICAL_TECH_DOCS_CSV = "a220_tech_docs_content_canonical.csv.gz";
export const CANONICAL_TECH_DOCS_AUDIT = "a220_tech_docs_content_canonical.audit.json";

export interface RawDelimitedRecord {
  readonly row: readonly string[];
  readonly raw: string;
  readonly index: number;
}

export interface PrepareTechDocsCanonicalOptions {
  readonly sourceFile: string;
  readonly outputFile: string;
  readonly pagesDir: string;
  readonly auditFile?: string;
}

export interface PrepareTechDocsCanonicalResult {
  readonly sourceFile: string;
  readonly outputFile: string;
  readonly auditFile: string | null;
  readonly pagesDir: string;
  readonly sourceRows: number;
  readonly keptRows: number;
  readonly droppedRows: number;
  readonly droppedMalformedRows: number;
  readonly droppedMissingPageRows: number;
  readonly droppedDuplicateChunkRows: number;
  readonly missingPageRoots: readonly { readonly docRoot: string; readonly count: number }[];
  readonly duplicateChunkIds: readonly string[];
  readonly keptRowsCharExact: boolean;
  readonly sourceKeptRowsSha256: string;
  readonly canonicalRowsSha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ensureParentDir(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
}

function docRootFromRow(row: readonly string[]): string {
  const doc = row[0] ?? "";
  const docRoot = row[1] ?? "";
  return docRoot || doc.replace(/_page_\d+.*$/u, ".pdf") || "(unknown)";
}

function sortCounts(counts: ReadonlyMap<string, number>): { readonly docRoot: string; readonly count: number }[] {
  return [...counts.entries()]
    .map(([docRoot, count]) => ({ docRoot, count }))
    .sort((left, right) => right.count - left.count || left.docRoot.localeCompare(right.docRoot));
}

export function getDefaultTechDocsCanonicalPaths(): PrepareTechDocsCanonicalOptions {
  const root = path.join(API_ROOT, "data", TECH_DOCS_DIR);
  const managedDatasetRoot = path.join(root, "managed_dataset");
  return {
    sourceFile: path.join(managedDatasetRoot, RAW_TECH_DOCS_CSV),
    outputFile: path.join(managedDatasetRoot, CANONICAL_TECH_DOCS_CSV),
    auditFile: path.join(managedDatasetRoot, CANONICAL_TECH_DOCS_AUDIT),
    pagesDir: path.join(root, "pages"),
  };
}

export function resolveDefaultTechDocsSourceFile(): string {
  const paths = getDefaultTechDocsCanonicalPaths();
  return paths.outputFile;
}

export function parseDelimitedRecordsWithRaw(text: string, delimiter = "\t"): RawDelimitedRecord[] {
  const records: RawDelimitedRecord[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let escaped = false;
  let recordStart = 0;

  function emitRecord(endIndex: number): void {
    const raw = text.slice(recordStart, endIndex);
    row.push(field);
    if (!(raw === "" && row.length === 1 && row[0] === "")) {
      records.push({ row, raw, index: records.length });
    }
    row = [];
    field = "";
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;

    if (escaped) {
      field += char;
      escaped = false;
      continue;
    }

    if (inQuotes) {
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    if (char === "\n") {
      emitRecord(index);
      recordStart = index + 1;
      continue;
    }

    field += char;
  }

  if (escaped) {
    field += "\\";
  }
  if (inQuotes) {
    throw new Error("unterminated quoted field in delimited input");
  }
  if (field.length > 0 || row.length > 0 || recordStart < text.length) {
    emitRecord(text.length);
  }

  return records;
}

export function prepareTechDocsCanonicalDataset(
  options: PrepareTechDocsCanonicalOptions = getDefaultTechDocsCanonicalPaths(),
): PrepareTechDocsCanonicalResult {
  if (!existsSync(options.sourceFile)) {
    throw new Error(`Missing tech docs source CSV: ${options.sourceFile}`);
  }
  if (!existsSync(options.pagesDir)) {
    throw new Error(`Missing tech docs pages directory: ${options.pagesDir}`);
  }

  const sourceText = gunzipSync(readFileSync(options.sourceFile)).toString("utf8");
  const records = parseDelimitedRecordsWithRaw(sourceText, "\t");
  if (records.length === 0) {
    throw new Error(`Empty tech docs source CSV: ${options.sourceFile}`);
  }

  const header = records[0]!;
  const pages = new Set(readdirSync(options.pagesDir));
  const seenChunkIds = new Set<string>();
  const missingPageRoots = new Map<string, number>();
  const duplicateChunkIds = new Set<string>();
  const keptRecords: RawDelimitedRecord[] = [header];
  let droppedMalformedRows = 0;
  let droppedMissingPageRows = 0;
  let droppedDuplicateChunkRows = 0;

  for (const record of records.slice(1)) {
    const doc = record.row[0]?.trim() ?? "";
    const chunkId = record.row[5]?.trim() ?? "";

    if (record.row.length < 9 || !doc || !chunkId) {
      droppedMalformedRows += 1;
      continue;
    }

    if (!pages.has(doc)) {
      droppedMissingPageRows += 1;
      const docRoot = docRootFromRow(record.row);
      missingPageRoots.set(docRoot, (missingPageRoots.get(docRoot) ?? 0) + 1);
      continue;
    }

    if (seenChunkIds.has(chunkId)) {
      droppedDuplicateChunkRows += 1;
      duplicateChunkIds.add(chunkId);
      continue;
    }

    seenChunkIds.add(chunkId);
    keptRecords.push(record);
  }

  const canonicalText = `${keptRecords.map((record) => record.raw).join("\n")}\n`;
  ensureParentDir(options.outputFile);
  const tmpOutputFile = `${options.outputFile}.tmp-${process.pid}`;
  writeFileSync(tmpOutputFile, gzipSync(canonicalText));
  renameSync(tmpOutputFile, options.outputFile);

  const canonicalRoundTripText = gunzipSync(readFileSync(options.outputFile)).toString("utf8");
  const sourceKeptRowsSha256 = sha256(canonicalText);
  const canonicalRowsSha256 = sha256(canonicalRoundTripText);
  const result: PrepareTechDocsCanonicalResult = {
    sourceFile: options.sourceFile,
    outputFile: options.outputFile,
    auditFile: options.auditFile ?? null,
    pagesDir: options.pagesDir,
    sourceRows: records.length - 1,
    keptRows: keptRecords.length - 1,
    droppedRows: records.length - keptRecords.length,
    droppedMalformedRows,
    droppedMissingPageRows,
    droppedDuplicateChunkRows,
    missingPageRoots: sortCounts(missingPageRoots),
    duplicateChunkIds: [...duplicateChunkIds].sort().slice(0, 50),
    keptRowsCharExact: canonicalRoundTripText === canonicalText,
    sourceKeptRowsSha256,
    canonicalRowsSha256,
  };

  if (options.auditFile) {
    ensureParentDir(options.auditFile);
    const tmpAuditFile = `${options.auditFile}.tmp-${process.pid}`;
    writeFileSync(tmpAuditFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    renameSync(tmpAuditFile, options.auditFile);
  }

  return result;
}
