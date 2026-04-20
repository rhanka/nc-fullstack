import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { resolveDefaultTechDocsSourceFile } from "./tech-docs-canonical.ts";

export type DataprepCorpusName = "tech_docs" | "non_conformities";

export interface PreparedRecord {
  readonly corpus: DataprepCorpusName;
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
  readonly source_path: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface DataprepCorpusConfig {
  readonly corpus: DataprepCorpusName;
  readonly sourceFile: string;
  readonly outputRoot: string;
  readonly hasHeader: boolean;
  readonly normalizeRow: (row: readonly string[]) => PreparedRecord | null;
}

export interface EmbeddingProvider {
  readonly model: string;
  embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface PartCanonicalization {
  readonly canonicalName: string;
  readonly aliases: readonly string[];
  readonly shortDescription: string;
}

export interface PartCanonicalizerInput {
  readonly seedName: string;
  readonly aliases: readonly string[];
  readonly ataCodes: readonly string[];
  readonly zones: readonly string[];
  readonly supportingDocs: readonly string[];
  readonly sampleSnippets: readonly string[];
}

export interface PartCanonicalizer {
  readonly model: string;
  canonicalize(input: PartCanonicalizerInput): Promise<PartCanonicalization>;
}

export interface RunDataprepOptions {
  readonly embeddingProvider: EmbeddingProvider;
  readonly partCanonicalizer?: PartCanonicalizer;
  readonly llmAssistMode?: "off" | "part_canonicalization";
  readonly embeddingBatchSize?: number;
}

export interface RunDataprepResult {
  readonly corpus: DataprepCorpusName;
  readonly recordCount: number;
  readonly vectorExport: {
    readonly manifestPath: string;
    readonly count: number;
    readonly dimensions: number;
  };
  readonly lexical: {
    readonly dbPath: string;
    readonly documentCount: number;
  };
  readonly ontology: {
    readonly root: string;
    readonly ataCount: number;
    readonly partCount: number;
    readonly zoneCount: number;
    readonly occurrenceCount: number;
  };
  readonly wiki: {
    readonly root: string;
    readonly pageCount: number;
    readonly indexPath: string;
  };
  readonly knowledgeManifestPath: string;
}

export interface RunKnowledgeDataprepResult {
  readonly corpus: DataprepCorpusName;
  readonly recordCount: number;
  readonly ontology: RunDataprepResult["ontology"];
  readonly wiki: RunDataprepResult["wiki"];
  readonly knowledgeManifestPath: string;
}

type MutablePartCanonicalizerInput = {
  seedName: string;
  aliases: string[];
  ataCodes: string[];
  zones: string[];
  supportingDocs: string[];
  sampleSnippets: string[];
};

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
export const DEFAULT_EMBEDDING_MODEL = process.env.DATAPREP_EMBEDDING_MODEL?.trim() || "text-embedding-3-large";
export const RETRIEVAL_ARTIFACT_CACHE_VERSION = "retrieval-artifacts-v1";
const DEFAULT_PART_CANONICALIZATION_MODEL =
  process.env.DATAPREP_LLM_MODEL?.trim() || "gpt-5.4-nano";

const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";
const NC_DIR = process.env.NC_DIR?.trim() || "a220-non-conformities";
const DATAPREP_CODE_FINGERPRINT_FILES = [
  fileURLToPath(import.meta.url),
  fileURLToPath(new URL("./tech-docs-canonical.ts", import.meta.url)),
];

const ZONE_PATTERNS: readonly [RegExp, string][] = [
  [/\bRH\b/giu, "RH"],
  [/\bLH\b/giu, "LH"],
  [/\bright-hand\b/giu, "right-hand"],
  [/\bleft-hand\b/giu, "left-hand"],
  [/\bright\b/giu, "right"],
  [/\bleft\b/giu, "left"],
  [/\bforward\b/giu, "forward"],
  [/\baft\b/giu, "aft"],
  [/\bframe\s+\d+(?:\/\d+)?\b/giu, ""],
  [/\bstation\s+\d+\b/giu, ""],
];

const PART_NUMBER_RE = /\b[A-Z0-9]+(?:-[A-Z0-9]+){2,}\b/gu;
const ATA_RE = /\bATA[\s-]?(\d{2})\b/giu;
const HEADING_RE = /^#{1,3}\s+(.+)$/gmu;
const GENERIC_PART_CANDIDATE_RE =
  /\b(scope|reference|references|purpose|abbreviations|acronyms|requirements|manual|familiarization|policy|appendix|table of contents)\b/iu;
const SECTION_HEADING_RE = /^\(?\d+(?:\.\d+)*\)?[\s.:_-]+/u;
const PART_LIKE_TOKEN_RE =
  /\b(door|frame|panel|tank|wing|window|windshield|fuselage|rib|spar|valve|pump|seal|flap|gear|screen|orifice|drain|hinge|sensor|duct|pipe|skin|bracket|beam|bulkhead|fairing|actuator|reservoir|strut|spoiler|aileron|rudder|elevator|nacelle|cowl|latch|handle|seal)\b/iu;

function titleCase(value: string): string {
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function normalizeCandidateLabel(value: string): string {
  return value
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "")
    .replace(/-{2,}/gu, "-");
  if (base.length <= 96) {
    return base;
  }
  const hash = createHash("sha1").update(base).digest("hex").slice(0, 10);
  return `${base.slice(0, 85).replace(/-+$/u, "")}-${hash}`;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function isPartCandidate(value: string): boolean {
  const normalized = normalizeCandidateLabel(value);
  if (normalized.length < 4 || normalized.length > 400) {
    return false;
  }
  if (SECTION_HEADING_RE.test(normalized)) {
    return false;
  }
  if (GENERIC_PART_CANDIDATE_RE.test(normalized)) {
    return false;
  }
  if (!PART_LIKE_TOKEN_RE.test(normalized) && !/\bATA[\s-]?\d{2}\b/iu.test(normalized)) {
    return false;
  }
  return true;
}

function chunkText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength);
}

export function splitPartsField(value: string): string[] {
  if (!value.trim()) {
    return [];
  }
  return uniqueSorted(
    value
      .split(/[;,|]/u)
      .map((part) => normalizeCandidateLabel(part))
      .filter((part) => part.length >= 3)
      .filter((part) => isPartCandidate(part)),
  );
}

function extractHeadingCandidates(content: string): string[] {
  const candidates: string[] = [];
  for (const match of content.matchAll(HEADING_RE)) {
    const heading = normalizeCandidateLabel(match[1]?.trim() ?? "");
    if (
      heading.length >= 4 &&
      heading.length <= 120 &&
      isPartCandidate(heading) &&
      !/^airbus$/iu.test(heading) &&
      !/confidential|administrative office|appendix|table of contents/iu.test(heading)
    ) {
      candidates.push(heading);
    }
  }
  return uniqueSorted(candidates.slice(0, 3));
}

export function extractAtaCodes(...values: readonly string[]): string[] {
  const matches = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(ATA_RE)) {
      const code = match[1];
      if (code) {
        matches.add(`ATA-${code}`);
      }
    }
  }
  return Array.from(matches).sort();
}

export function extractZones(value: string): string[] {
  const zones = new Set<string>();
  for (const [pattern, replacement] of ZONE_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      const raw = match[0]?.trim();
      if (!raw) {
        continue;
      }
      const zone = replacement || raw.toLowerCase();
      zones.add(zone);
    }
  }
  return Array.from(zones).sort();
}

export function extractPartNumbers(value: string): string[] {
  return uniqueSorted(value.match(PART_NUMBER_RE) ?? []);
}

export function normalizeTechDocsPreparedRow(row: readonly string[]): PreparedRecord | null {
  if (row.length < 9) {
    return null;
  }

  const [doc, doc_root, json_data, chunk, length, chunk_id, ata, parts, doc_type] = row;
  const content = chunk?.trim() ?? "";
  if (!doc || !chunk_id || !content) {
    return null;
  }

  return {
    corpus: "tech_docs",
    doc,
    chunk_id,
    content,
    source_path: json_data || doc_root || doc,
    metadata: {
      doc,
      doc_root,
      json_data,
      length: Number.parseInt(length || "0", 10) || 0,
      chunk_id,
      ATA: ata || "",
      parts: parts || "",
      doc_type: doc_type || "",
    },
  };
}

function extractTaskKind(doc: string, chunkId: string, content: string): string {
  const match = chunkId.match(/-(\d{3})-/u) || content.match(/\b-\s*(\d{3})\s*:/u) || doc.match(/\b(\d{3})\b/u);
  return match?.[1] ?? "";
}

export function normalizeNcPreparedRow(row: readonly string[]): PreparedRecord | null {
  if (row.length !== 3) {
    return null;
  }

  const [doc, chunk_id, chunk] = row;
  const content = chunk?.trim() ?? "";
  if (!doc || !chunk_id || !content) {
    return null;
  }

  const ataCodes = extractAtaCodes(doc, chunk);
  return {
    corpus: "non_conformities",
    doc,
    chunk_id,
    content: chunkText(content, 30000),
    source_path: doc,
    metadata: {
      doc,
      chunk_id,
      task_kind: extractTaskKind(doc, chunk_id, content),
      ATA_code: ataCodes[0] ?? "",
    },
  };
}

export function buildDefaultCorpusConfigs(): Record<DataprepCorpusName, DataprepCorpusConfig> {
  return {
    tech_docs: {
      corpus: "tech_docs",
      sourceFile: resolveDefaultTechDocsSourceFile(),
      outputRoot: path.join(API_ROOT, "data", TECH_DOCS_DIR),
      hasHeader: true,
      normalizeRow: normalizeTechDocsPreparedRow,
    },
    non_conformities: {
      corpus: "non_conformities",
      sourceFile: path.join(API_ROOT, "data", NC_DIR, "managed_dataset", "NC_types_random_500_pre_embed.csv.gz"),
      outputRoot: path.join(API_ROOT, "data", NC_DIR),
      hasHeader: false,
      normalizeRow: normalizeNcPreparedRow,
    },
  };
}

export function parseDelimitedTable(text: string, delimiter = "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let escaped = false;

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
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
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
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => !(candidate.length === 1 && candidate[0] === ""));
}

export function readPreparedRecords(config: DataprepCorpusConfig): PreparedRecord[] {
  const compressed = readFileSync(config.sourceFile);
  const text = gunzipSync(compressed).toString("utf8");
  const rows = parseDelimitedTable(text, "\t");
  const startIndex = config.hasHeader ? 1 : 0;
  const normalized: PreparedRecord[] = [];
  for (let index = startIndex; index < rows.length; index += 1) {
    const record = config.normalizeRow(rows[index]!);
    if (record) {
      normalized.push(record);
    }
  }
  return normalized;
}

export function buildDataprepCodeFingerprint(): string {
  const hash = createHash("sha256");
  for (const filePath of DATAPREP_CODE_FINGERPRINT_FILES) {
    hash.update(path.basename(filePath));
    hash.update("\n");
    hash.update(readFileSync(filePath));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function stableMetadataString(metadata: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.fromEntries(Object.keys(metadata).sort().map((key) => [key, metadata[key]])),
  );
}

export function buildSourceFingerprint(config: DataprepCorpusConfig, records: readonly PreparedRecord[]): string {
  const hash = createHash("sha256");
  hash.update(config.corpus);
  hash.update("\n");
  for (const record of records) {
    hash.update(record.doc);
    hash.update("\n");
    hash.update(record.chunk_id);
    hash.update("\n");
    hash.update(record.source_path);
    hash.update("\n");
    hash.update(record.content);
    hash.update("\n");
    hash.update(stableMetadataString(record.metadata));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function replaceDirectory(target: string, tmpDir: string): void {
  rmSync(target, { recursive: true, force: true });
  renameSync(tmpDir, target);
}

function createTmpArtifactDir(outputRoot: string, artifactName: string): string {
  mkdirSync(outputRoot, { recursive: true });
  return mkdtempSync(path.join(outputRoot, `.tmp-${artifactName}-`));
}

async function buildVectorExport(
  config: DataprepCorpusConfig,
  records: readonly PreparedRecord[],
  embeddingProvider: EmbeddingProvider,
  batchSize: number,
): Promise<RunDataprepResult["vectorExport"]> {
  if (records.length === 0) {
    throw new Error(`No prepared records found for ${config.corpus}`);
  }

  const targetRoot = path.join(config.outputRoot, "vector-export");
  const tmpRoot = createTmpArtifactDir(config.outputRoot, "vector-export");
  const vectorsPath = path.join(tmpRoot, "vectors.f32");
  const squaredNormsPath = path.join(tmpRoot, "squared_norms.f32");
  const itemsPath = path.join(tmpRoot, "items.jsonl");

  const vectorsChunks: Buffer[] = [];
  const squaredNormChunks: Buffer[] = [];
  const itemLines: string[] = [];
  let dimensions: number | null = null;

  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = records.slice(offset, offset + batchSize);
    const embeddings = await embeddingProvider.embed(batch.map((record) => record.content));
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding batch size mismatch for ${config.corpus}: expected ${batch.length}, got ${embeddings.length}`,
      );
    }

    for (let index = 0; index < batch.length; index += 1) {
      const record = batch[index]!;
      const embedding = embeddings[index]!;
      if (dimensions === null) {
        dimensions = embedding.length;
      } else if (embedding.length !== dimensions) {
        throw new Error(
          `Embedding dimension mismatch for ${config.corpus}: expected ${dimensions}, got ${embedding.length}`,
        );
      }

      const vectorBuffer = Buffer.allocUnsafe(embedding.length * Float32Array.BYTES_PER_ELEMENT);
      let squaredNorm = 0;
      for (let position = 0; position < embedding.length; position += 1) {
        const value = Number(embedding[position] ?? 0);
        vectorBuffer.writeFloatLE(value, position * Float32Array.BYTES_PER_ELEMENT);
        squaredNorm += value * value;
      }
      vectorsChunks.push(vectorBuffer);
      const normBuffer = Buffer.allocUnsafe(Float32Array.BYTES_PER_ELEMENT);
      normBuffer.writeFloatLE(squaredNorm, 0);
      squaredNormChunks.push(normBuffer);
      itemLines.push(
        JSON.stringify(
          {
            ...record.metadata,
            doc: record.doc,
            chunk_id: record.chunk_id,
            content: record.content,
            embedding_id: record.chunk_id,
            source_path: record.source_path,
          },
          null,
          0,
        ),
      );
    }
  }

  if (dimensions === null) {
    throw new Error(`Could not infer embedding dimensions for ${config.corpus}`);
  }

  writeFileSync(vectorsPath, Buffer.concat(vectorsChunks));
  writeFileSync(squaredNormsPath, Buffer.concat(squaredNormChunks));
  writeFileSync(itemsPath, `${itemLines.join("\n")}\n`, "utf8");
  writeFileSync(
    path.join(tmpRoot, "manifest.json"),
    JSON.stringify(
      {
        version: "vector-export-v1",
        corpus: config.corpus,
        embeddingModel: embeddingProvider.model,
        metric: "l2",
        dimensions,
        count: records.length,
        vectorsPath: "vectors.f32",
        squaredNormsPath: "squared_norms.f32",
        itemsPath: "items.jsonl",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  replaceDirectory(targetRoot, tmpRoot);
  return {
    manifestPath: path.join(targetRoot, "manifest.json"),
    count: records.length,
    dimensions,
  };
}

function buildLexicalIndex(
  config: DataprepCorpusConfig,
  records: readonly PreparedRecord[],
  fingerprint: string,
): RunDataprepResult["lexical"] {
  const targetRoot = path.join(config.outputRoot, "lexical");
  const tmpRoot = createTmpArtifactDir(config.outputRoot, "lexical");
  const dbPath = path.join(tmpRoot, "fts.sqlite3");
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE lexical_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE lexical_documents
    USING fts5(
      doc,
      chunk_id,
      content,
      source_path UNINDEXED,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);

  const insert = db.prepare(`
    INSERT INTO lexical_documents(doc, chunk_id, content, source_path)
    VALUES(?, ?, ?, ?)
  `);
  for (const record of records) {
    insert.run(record.doc, record.chunk_id, record.content, record.source_path);
  }
  const writeMeta = db.prepare(`
    INSERT INTO lexical_meta(key, value)
    VALUES(?, ?)
  `);
  writeMeta.run("fingerprint", fingerprint);
  writeMeta.run("document_count", String(records.length));
  db.close();

  replaceDirectory(targetRoot, tmpRoot);
  return {
    dbPath: path.join(targetRoot, "fts.sqlite3"),
    documentCount: records.length,
  };
}

export interface RetrievalArtifactStatus {
  readonly corpus: DataprepCorpusName;
  readonly fresh: boolean;
  readonly reasons: readonly string[];
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fileExists(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readLexicalDocumentCount(dbPath: string): number | null {
  if (!fileExists(dbPath)) {
    return null;
  }
  try {
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT COUNT(*) AS count FROM lexical_documents").get() as
      | { count: number }
      | undefined;
    db.close();
    return typeof row?.count === "number" ? row.count : null;
  } catch {
    return null;
  }
}

export function inspectRetrievalArtifacts(
  config: DataprepCorpusConfig,
  expected: {
    readonly fingerprint: string;
    readonly codeFingerprint: string;
    readonly recordCount: number;
    readonly embeddingModel: string;
  },
): RetrievalArtifactStatus {
  const reasons: string[] = [];
  const manifestPath = path.join(config.outputRoot, "knowledge-manifest.json");
  const manifest = readJsonFile(manifestPath);
  if (!manifest) {
    reasons.push("knowledge-manifest.json missing or invalid");
  } else {
    if (manifest.corpus !== config.corpus) {
      reasons.push("knowledge manifest corpus mismatch");
    }
    if (manifest.mode === "knowledge-only") {
      reasons.push("knowledge manifest is knowledge-only");
    }
    if (manifest.retrievalArtifactCacheVersion !== RETRIEVAL_ARTIFACT_CACHE_VERSION) {
      reasons.push("retrieval artifact cache version mismatch");
    }
    if (manifest.fingerprint !== expected.fingerprint) {
      reasons.push("knowledge manifest fingerprint mismatch");
    }
    if (manifest.retrievalArtifactCodeFingerprint !== expected.codeFingerprint) {
      reasons.push("retrieval artifact code fingerprint mismatch");
    }
    if (manifest.embeddingModel !== expected.embeddingModel) {
      reasons.push("embedding model mismatch");
    }
    if (manifest.recordCount !== expected.recordCount) {
      reasons.push("knowledge manifest record count mismatch");
    }
    if (!manifest.vectorExport) {
      reasons.push("knowledge manifest missing vectorExport section");
    }
    if (!manifest.lexical) {
      reasons.push("knowledge manifest missing lexical section");
    }
  }

  const vectorRoot = path.join(config.outputRoot, "vector-export");
  const vectorManifest = readJsonFile(path.join(vectorRoot, "manifest.json"));
  for (const filename of ["items.jsonl", "vectors.f32", "squared_norms.f32"]) {
    if (!fileExists(path.join(vectorRoot, filename))) {
      reasons.push(`vector-export/${filename} missing`);
    }
  }
  if (!vectorManifest) {
    reasons.push("vector-export/manifest.json missing or invalid");
  } else {
    if (vectorManifest.corpus !== config.corpus) {
      reasons.push("vector manifest corpus mismatch");
    }
    if (vectorManifest.embeddingModel !== expected.embeddingModel) {
      reasons.push("vector manifest embedding model mismatch");
    }
    if (vectorManifest.count !== expected.recordCount) {
      reasons.push("vector manifest count mismatch");
    }
  }

  const lexicalDbPath = path.join(config.outputRoot, "lexical", "fts.sqlite3");
  const lexicalCount = readLexicalDocumentCount(lexicalDbPath);
  if (lexicalCount === null) {
    reasons.push("lexical/fts.sqlite3 missing or invalid");
  } else if (lexicalCount !== expected.recordCount) {
    reasons.push("lexical document count mismatch");
  }

  const ontologyRoot = path.join(config.outputRoot, "ontology");
  for (const filename of ["atas.json", "parts.json", "zones.json", "relations.json", "occurrences.json", "index.json"]) {
    if (!fileExists(path.join(ontologyRoot, filename))) {
      reasons.push(`ontology/${filename} missing`);
    }
  }

  const wikiRoot = path.join(config.outputRoot, "wiki");
  if (!fileExists(path.join(wikiRoot, "index.json"))) {
    reasons.push("wiki/index.json missing");
  }

  return {
    corpus: config.corpus,
    fresh: reasons.length === 0,
    reasons,
  };
}

type PartAggregate = {
  readonly seedName: string;
  readonly aliases: Set<string>;
  readonly partNumbers: Set<string>;
  readonly ataCodes: Set<string>;
  readonly zones: Set<string>;
  readonly supportingDocs: Set<string>;
  readonly supportingChunks: Set<string>;
  readonly sampleSnippets: string[];
};

function collectPartCandidates(record: PreparedRecord): string[] {
  const metadataParts = typeof record.metadata.parts === "string" ? record.metadata.parts : "";
  const parts = splitPartsField(metadataParts);
  if (parts.length > 0) {
    return parts;
  }
  return extractHeadingCandidates(record.content);
}

export function buildOntologyArtifacts(
  config: DataprepCorpusConfig,
  records: readonly PreparedRecord[],
  fingerprint: string,
  partCanonicalizations: ReadonlyMap<string, PartCanonicalization>,
): RunDataprepResult["ontology"] {
  const targetRoot = path.join(config.outputRoot, "ontology");
  const tmpRoot = createTmpArtifactDir(config.outputRoot, "ontology");

  const ataMap = new Map<string, { id: string; code: string; title: string; aliases: string[] }>();
  const zoneMap = new Map<string, { id: string; canonical_name: string; aliases: string[]; zone_codes: string[] }>();
  const partMap = new Map<
    string,
    {
      id: string;
      slug: string;
      canonical_name: string;
      aliases: string[];
      part_numbers: string[];
      ata_codes: string[];
      zones: string[];
      supporting_docs: string[];
      supporting_chunks: string[];
      short_description: string;
    }
  >();
  const relations: Array<{ from: string; relation: string; to: string }> = [];
  const occurrences: Array<Record<string, unknown>> = [];

  if (config.corpus === "tech_docs") {
    const aggregates = new Map<string, PartAggregate>();
    for (const record of records) {
      const ataCodes = extractAtaCodes(
        typeof record.metadata.ATA === "string" ? record.metadata.ATA : "",
        record.content,
        record.doc,
      );
      for (const ataCode of ataCodes) {
        ataMap.set(ataCode, {
          id: slugify(ataCode),
          code: ataCode,
          title: ataCode,
          aliases: [ataCode],
        });
      }

      const zones = extractZones(record.content);
      for (const zone of zones) {
        zoneMap.set(zone, {
          id: slugify(zone),
          canonical_name: zone,
          aliases: [zone],
          zone_codes: [zone],
        });
      }

      for (const rawPart of collectPartCandidates(record)) {
        const key = slugify(rawPart);
        if (!key) {
          continue;
        }
        const aggregate =
          aggregates.get(key) ??
          {
            seedName: rawPart,
            aliases: new Set<string>(),
            partNumbers: new Set<string>(),
            ataCodes: new Set<string>(),
            zones: new Set<string>(),
            supportingDocs: new Set<string>(),
            supportingChunks: new Set<string>(),
            sampleSnippets: [],
          };
        aggregate.aliases.add(rawPart);
        for (const partNumber of extractPartNumbers(record.content)) {
          aggregate.partNumbers.add(partNumber);
        }
        for (const ataCode of ataCodes) {
          aggregate.ataCodes.add(ataCode);
        }
        for (const zone of zones) {
          aggregate.zones.add(zone);
        }
        aggregate.supportingDocs.add(record.doc);
        aggregate.supportingChunks.add(record.chunk_id);
        if (aggregate.sampleSnippets.length < 3) {
          aggregate.sampleSnippets.push(chunkText(record.content.replace(/\s+/gu, " ").trim(), 220));
        }
        aggregates.set(key, aggregate);
      }
    }

    for (const [key, aggregate] of aggregates.entries()) {
      const llmCanonicalization = partCanonicalizations.get(key);
      const aliases = uniqueSorted([
        ...aggregate.aliases,
        ...(llmCanonicalization?.aliases ?? []),
      ]);
      const canonicalName = llmCanonicalization?.canonicalName || titleCase(aggregate.seedName);
      const part = {
        id: key,
        slug: key,
        canonical_name: canonicalName,
        aliases,
        part_numbers: uniqueSorted(aggregate.partNumbers),
        ata_codes: uniqueSorted(aggregate.ataCodes),
        zones: uniqueSorted(aggregate.zones),
        supporting_docs: uniqueSorted(aggregate.supportingDocs),
        supporting_chunks: uniqueSorted(aggregate.supportingChunks),
        short_description:
          llmCanonicalization?.shortDescription ||
          `Component linked to ${uniqueSorted(aggregate.ataCodes).join(", ") || "unknown ATA"} in zones ${uniqueSorted(aggregate.zones).join(", ") || "unspecified"}.`,
      };
      partMap.set(key, part);
      for (const ataCode of part.ata_codes) {
        relations.push({ from: `part:${key}`, relation: "belongs_to", to: `ata:${slugify(ataCode)}` });
      }
      for (const zone of part.zones) {
        relations.push({ from: `part:${key}`, relation: "located_in", to: `zone:${slugify(zone)}` });
      }
    }
  } else {
    for (const record of records) {
      occurrences.push({
        id: record.chunk_id,
        doc: record.doc,
        chunk_id: record.chunk_id,
        ata_codes: extractAtaCodes(record.doc, record.content),
        zones: extractZones(record.content),
        part_numbers: extractPartNumbers(record.content),
        source_path: record.source_path,
        task_kind: record.metadata.task_kind ?? "",
      });
    }
  }

  writeFileSync(path.join(tmpRoot, "atas.json"), JSON.stringify(Array.from(ataMap.values()), null, 2) + "\n", "utf8");
  writeFileSync(path.join(tmpRoot, "parts.json"), JSON.stringify(Array.from(partMap.values()), null, 2) + "\n", "utf8");
  writeFileSync(path.join(tmpRoot, "zones.json"), JSON.stringify(Array.from(zoneMap.values()), null, 2) + "\n", "utf8");
  writeFileSync(path.join(tmpRoot, "relations.json"), JSON.stringify(relations, null, 2) + "\n", "utf8");
  writeFileSync(path.join(tmpRoot, "occurrences.json"), JSON.stringify(occurrences, null, 2) + "\n", "utf8");
  writeFileSync(
    path.join(tmpRoot, "index.json"),
    JSON.stringify(
      {
        corpus: config.corpus,
        fingerprint,
        generatedAt: new Date().toISOString(),
        ataCount: ataMap.size,
        partCount: partMap.size,
        zoneCount: zoneMap.size,
        occurrenceCount: occurrences.length,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  replaceDirectory(targetRoot, tmpRoot);
  return {
    root: targetRoot,
    ataCount: ataMap.size,
    partCount: partMap.size,
    zoneCount: zoneMap.size,
    occurrenceCount: occurrences.length,
  };
}

export function buildWikiArtifacts(
  config: DataprepCorpusConfig,
  ontologyRoot: string,
): RunDataprepResult["wiki"] {
  const targetRoot = path.join(config.outputRoot, "wiki");
  const tmpRoot = createTmpArtifactDir(config.outputRoot, "wiki");
  const partsDir = path.join(tmpRoot, "parts");
  mkdirSync(partsDir, { recursive: true });

  const partsPath = path.join(ontologyRoot, "parts.json");
  const occurrencesPath = path.join(ontologyRoot, "occurrences.json");
  const parts = existsSync(partsPath)
    ? (JSON.parse(readFileSync(partsPath, "utf8")) as Array<Record<string, unknown>>)
    : [];
  const occurrences = existsSync(occurrencesPath)
    ? (JSON.parse(readFileSync(occurrencesPath, "utf8")) as Array<Record<string, unknown>>)
    : [];

  const indexEntries: Array<Record<string, unknown>> = [];
  let pageCount = 0;
  for (const part of parts) {
    const slug = String(part.slug ?? "");
    if (!slug) {
      continue;
    }
    const title = String(part.canonical_name ?? slug);
    const aliases = Array.isArray(part.aliases) ? part.aliases.map(String) : [];
    const docs = Array.isArray(part.supporting_docs) ? part.supporting_docs.map(String) : [];
    const zones = Array.isArray(part.zones) ? part.zones.map(String) : [];
    const ataCodes = Array.isArray(part.ata_codes) ? part.ata_codes.map(String) : [];
    const partNumbers = Array.isArray(part.part_numbers) ? part.part_numbers.map(String) : [];
    const shortDescription = String(part.short_description ?? "");

    const markdown = [
      `# ${title}`,
      "",
      shortDescription,
      "",
      "## Canonical identity",
      "",
      `- Slug: \`${slug}\``,
      ...(ataCodes.length > 0 ? [`- ATA: ${ataCodes.join(", ")}`] : []),
      ...(zones.length > 0 ? [`- Zones: ${zones.join(", ")}`] : []),
      ...(aliases.length > 0 ? [`- Aliases: ${aliases.join(", ")}`] : []),
      ...(partNumbers.length > 0 ? [`- Part numbers: ${partNumbers.join(", ")}`] : []),
      "",
      "## Technical documents",
      "",
      ...(docs.length > 0
        ? docs.map((doc) => `- [${doc}](../../pages/${doc})`)
        : ["- No linked technical document recorded."]),
      "",
      "## Linked occurrences",
      "",
      ...occurrences
        .filter((occurrence) => Array.isArray(occurrence.part_numbers) && partNumbers.some((candidate) => occurrence.part_numbers.includes(candidate)))
        .slice(0, 10)
        .map((occurrence) => `- ${String(occurrence.doc ?? occurrence.id ?? "")}`),
      "",
    ].join("\n");

    writeFileSync(path.join(partsDir, `${slug}.md`), markdown, "utf8");
    indexEntries.push({
      slug,
      title,
      path: `parts/${slug}.md`,
      entity_type: "part",
      short_description: shortDescription,
      ata_codes: ataCodes,
      zones,
      aliases,
      part_numbers: partNumbers,
      supporting_docs: docs,
      supporting_chunks: Array.isArray(part.supporting_chunks) ? part.supporting_chunks.map(String) : [],
    });
    pageCount += 1;
  }

  writeFileSync(path.join(tmpRoot, "index.json"), JSON.stringify(indexEntries, null, 2) + "\n", "utf8");
  replaceDirectory(targetRoot, tmpRoot);
  return {
    root: targetRoot,
    pageCount,
    indexPath: path.join(targetRoot, "index.json"),
  };
}

function buildKnowledgeManifest(
  config: DataprepCorpusConfig,
  fingerprint: string,
  result: Omit<RunDataprepResult, "knowledgeManifestPath" | "corpus">,
  options: RunDataprepOptions,
): string {
  const outputPath = path.join(config.outputRoot, "knowledge-manifest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        corpus: config.corpus,
        generatedAt: new Date().toISOString(),
        sourceFile: config.sourceFile,
        fingerprint,
        mode: "full",
        retrievalArtifactCacheVersion: RETRIEVAL_ARTIFACT_CACHE_VERSION,
        retrievalArtifactCodeFingerprint: buildDataprepCodeFingerprint(),
        llmAssistMode: options.llmAssistMode ?? "off",
        embeddingModel: options.embeddingProvider.model,
        partCanonicalizerModel: options.partCanonicalizer?.model ?? null,
        recordCount: result.recordCount,
        vectorExport: result.vectorExport,
        lexical: result.lexical,
        ontology: result.ontology,
        wiki: result.wiki,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return outputPath;
}

function buildKnowledgeOnlyManifest(
  config: DataprepCorpusConfig,
  fingerprint: string,
  result: Omit<RunKnowledgeDataprepResult, "knowledgeManifestPath" | "corpus">,
): string {
  const outputPath = path.join(config.outputRoot, "knowledge-manifest.json");
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        corpus: config.corpus,
        generatedAt: new Date().toISOString(),
        sourceFile: config.sourceFile,
        fingerprint,
        mode: "knowledge-only",
        recordCount: result.recordCount,
        ontology: result.ontology,
        wiki: result.wiki,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return outputPath;
}

function buildPartCanonicalizerPrompt(input: PartCanonicalizerInput): string {
  return [
    "Normalize the following aircraft part concept into one canonical part / subassembly entry.",
    "Return JSON only with keys: canonicalName, aliases, shortDescription.",
    "Do not invent ATA codes or zones not grounded in the input.",
    JSON.stringify(input, null, 2),
  ].join("\n\n");
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly apiKey: string;
  readonly endpoint: string;

  constructor(options: { readonly apiKey?: string; readonly model?: string; readonly endpoint?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/embeddings";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for offline dataprep embeddings");
    }
  }

  async embed(inputs: readonly string[]): Promise<readonly (readonly number[])[]> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: inputs,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return (payload.data ?? []).map((item) => item.embedding);
  }
}

export class OpenAIPartCanonicalizer implements PartCanonicalizer {
  readonly model: string;
  readonly apiKey: string;
  readonly endpoint: string;

  constructor(options: { readonly apiKey?: string; readonly model?: string; readonly endpoint?: string } = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options.model ?? DEFAULT_PART_CANONICALIZATION_MODEL;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/chat/completions";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for offline part canonicalization");
    }
  }

  async canonicalize(input: PartCanonicalizerInput): Promise<PartCanonicalization> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You normalize aircraft part mentions into a canonical part/subassembly entry. Output JSON only.",
          },
          {
            role: "user",
            content: buildPartCanonicalizerPrompt(input),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI part canonicalization failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const canonicalName = String(parsed.canonicalName ?? input.seedName).trim() || input.seedName;
    const aliases = uniqueSorted(
      Array.isArray(parsed.aliases) ? parsed.aliases.map((value) => String(value)) : [input.seedName],
    );
    const shortDescription =
      String(parsed.shortDescription ?? "").trim() ||
      `Aircraft part / subassembly linked to ${input.ataCodes.join(", ") || "unspecified ATA"}.`;
    return {
      canonicalName,
      aliases,
      shortDescription,
    };
  }
}

async function canonicalizeParts(
  records: readonly PreparedRecord[],
  options: RunDataprepOptions,
): Promise<ReadonlyMap<string, PartCanonicalization>> {
  if ((options.llmAssistMode ?? "off") !== "part_canonicalization" || !options.partCanonicalizer) {
    return new Map();
  }

  const candidates = new Map<string, MutablePartCanonicalizerInput>();
  for (const record of records) {
    if (record.corpus !== "tech_docs") {
      continue;
    }
    const ataCodes = extractAtaCodes(
      typeof record.metadata.ATA === "string" ? record.metadata.ATA : "",
      record.content,
      record.doc,
    );
    const zones = extractZones(record.content);
    for (const seedName of collectPartCandidates(record)) {
      const key = slugify(seedName);
      if (!key) {
        continue;
      }
      const existing: MutablePartCanonicalizerInput =
        candidates.get(key) ??
        {
          seedName,
          aliases: [],
          ataCodes: [],
          zones: [],
          supportingDocs: [],
          sampleSnippets: [],
        };
      existing.aliases = uniqueSorted([...existing.aliases, seedName]);
      existing.ataCodes = uniqueSorted([...existing.ataCodes, ...ataCodes]);
      existing.zones = uniqueSorted([...existing.zones, ...zones]);
      existing.supportingDocs = uniqueSorted([...existing.supportingDocs, record.doc]);
      if (existing.sampleSnippets.length < 3) {
        existing.sampleSnippets = [...existing.sampleSnippets, chunkText(record.content.replace(/\s+/gu, " ").trim(), 220)];
      }
      candidates.set(key, existing);
    }
  }

  const results = new Map<string, PartCanonicalization>();
  for (const [key, input] of candidates.entries()) {
    results.set(key, await options.partCanonicalizer.canonicalize(input));
  }
  return results;
}

export async function runDataprepForCorpus(
  config: DataprepCorpusConfig,
  options: RunDataprepOptions,
): Promise<RunDataprepResult> {
  const records = readPreparedRecords(config);
  const fingerprint = buildSourceFingerprint(config, records);
  const partCanonicalizations = await canonicalizeParts(records, options);
  const vectorExport = await buildVectorExport(
    config,
    records,
    options.embeddingProvider,
    options.embeddingBatchSize ?? 64,
  );
  const lexical = buildLexicalIndex(config, records, fingerprint);
  const ontology = buildOntologyArtifacts(config, records, fingerprint, partCanonicalizations);
  const wiki = buildWikiArtifacts(config, ontology.root);
  const partialResult = {
    recordCount: records.length,
    vectorExport,
    lexical,
    ontology,
    wiki,
  };
  const knowledgeManifestPath = buildKnowledgeManifest(config, fingerprint, partialResult, options);
  return {
    corpus: config.corpus,
    ...partialResult,
    knowledgeManifestPath,
  };
}

export async function runKnowledgeDataprepForCorpus(
  config: DataprepCorpusConfig,
  options: Pick<RunDataprepOptions, "partCanonicalizer" | "llmAssistMode"> = {},
): Promise<RunKnowledgeDataprepResult> {
  const records = readPreparedRecords(config);
  const fingerprint = buildSourceFingerprint(config, records);
  const partCanonicalizations = await canonicalizeParts(records, {
    embeddingProvider: {
      model: "knowledge-only",
      async embed() {
        throw new Error("embeddingProvider is not used in knowledge-only dataprep");
      },
    },
    partCanonicalizer: options.partCanonicalizer,
    llmAssistMode: options.llmAssistMode ?? "off",
  });
  const ontology = buildOntologyArtifacts(config, records, fingerprint, partCanonicalizations);
  const wiki = buildWikiArtifacts(config, ontology.root);
  const partialResult = {
    recordCount: records.length,
    ontology,
    wiki,
  };
  const knowledgeManifestPath = buildKnowledgeOnlyManifest(config, fingerprint, partialResult);
  return {
    corpus: config.corpus,
    ...partialResult,
    knowledgeManifestPath,
  };
}

export async function runDataprep(
  corpora: readonly DataprepCorpusName[],
  options: RunDataprepOptions,
): Promise<readonly RunDataprepResult[]> {
  const configs = buildDefaultCorpusConfigs();
  const results: RunDataprepResult[] = [];
  for (const corpus of corpora) {
    results.push(await runDataprepForCorpus(configs[corpus], options));
  }
  return results;
}

export function buildDataprepCliOptions(): RunDataprepOptions {
  const llmAssistMode =
    process.env.DATAPREP_LLM_ASSIST_MODE === "part_canonicalization" ? "part_canonicalization" : "off";
  const embeddingProvider = new OpenAIEmbeddingProvider();
  const partCanonicalizer =
    llmAssistMode === "part_canonicalization" ? new OpenAIPartCanonicalizer() : undefined;
  return {
    embeddingProvider,
    partCanonicalizer,
    llmAssistMode,
    embeddingBatchSize: Number.parseInt(process.env.DATAPREP_EMBED_BATCH_SIZE ?? "64", 10) || 64,
  };
}
