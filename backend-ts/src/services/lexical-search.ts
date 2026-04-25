import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TOKEN_RE = /[a-z0-9]{2,}/g;

export interface LexicalCorpusConfig {
  readonly name: string;
  readonly sourceRoot: string;
  readonly fileGlobSuffix: string;
  readonly dbPath: string;
}

export const TECH_DOCS_LEXICAL_CONFIG: LexicalCorpusConfig = {
  name: "tech_docs",
  sourceRoot: path.join(API_ROOT, "data", "a220-tech-docs", "ocr"),
  fileGlobSuffix: ".md",
  dbPath: path.join(API_ROOT, "data", "a220-tech-docs", "lexical", "fts.sqlite3"),
};

export const NC_LEXICAL_CONFIG: LexicalCorpusConfig = {
  name: "non_conformities",
  sourceRoot: path.join(API_ROOT, "data", "a220-non-conformities", "md"),
  fileGlobSuffix: ".md",
  dbPath: path.join(API_ROOT, "data", "a220-non-conformities", "lexical", "fts.sqlite3"),
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase();
}

export function tokenizeQuery(value: string): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  const matches = normalizeText(value).match(TOKEN_RE) ?? [];
  for (const token of matches) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    deduped.push(token);
  }
  return deduped;
}

export function buildMatchQuery(value: string, operator: "AND" | "OR" = "AND"): string {
  const tokens = tokenizeQuery(value);
  if (tokens.length === 0) {
    return "";
  }
  return tokens.map((token) => `${token}*`).join(` ${operator} `);
}

function connectFts(dbPath: string): DatabaseSync {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  return new DatabaseSync(dbPath);
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lexical_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS lexical_documents
    USING fts5(
      doc,
      chunk_id,
      content,
      source_path UNINDEXED,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
}

function iterCorpusFiles(config: LexicalCorpusConfig): string[] {
  return readdirSync(config.sourceRoot)
    .filter((filename) => filename.endsWith(config.fileGlobSuffix))
    .sort()
    .map((filename) => path.join(config.sourceRoot, filename));
}

function computeCorpusFingerprint(paths: readonly string[]): {
  readonly documentCount: number;
  readonly fingerprint: string;
} {
  const parts: string[] = [];
  for (const filePath of paths) {
    const stats = statSync(filePath);
    parts.push(filePath, String(stats.size), String(stats.mtimeMs));
  }
  return {
    documentCount: paths.length,
    fingerprint: normalizeText(parts.join("|")),
  };
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare(`SELECT value FROM lexical_meta WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(`
    INSERT INTO lexical_meta(key, value)
    VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function rebuildLexicalIndex(
  config: LexicalCorpusConfig,
  options: { readonly force?: boolean } = {},
): {
  readonly corpus: string;
  readonly dbPath: string;
  readonly sourceRoot: string;
  readonly documentCount: number;
  readonly fingerprint: string;
  readonly rebuilt: boolean;
} {
  const paths = iterCorpusFiles(config);
  if (paths.length === 0) {
    throw new Error(`No source files found for lexical corpus '${config.name}' in ${config.sourceRoot}`);
  }

  const fingerprintInfo = computeCorpusFingerprint(paths);
  const db = connectFts(config.dbPath);
  ensureSchema(db);
  const existingFingerprint = readMeta(db, "fingerprint");
  const shouldRebuild = options.force === true || existingFingerprint !== fingerprintInfo.fingerprint;

  if (shouldRebuild) {
    db.exec(`DELETE FROM lexical_documents;`);
    const insert = db.prepare(`
      INSERT INTO lexical_documents(doc, chunk_id, content, source_path)
      VALUES(?, ?, ?, ?)
    `);
    for (const filePath of paths) {
      insert.run(
        path.basename(filePath),
        path.basename(filePath, path.extname(filePath)),
        readFileSync(filePath, "utf8"),
        filePath,
      );
    }
    writeMeta(db, "fingerprint", fingerprintInfo.fingerprint);
    writeMeta(db, "document_count", String(fingerprintInfo.documentCount));
  }

  const row = db.prepare(`SELECT COUNT(*) AS count FROM lexical_documents`).get() as { count: number };
  db.close();
  return {
    corpus: config.name,
    dbPath: config.dbPath,
    sourceRoot: config.sourceRoot,
    documentCount: row.count,
    fingerprint: fingerprintInfo.fingerprint,
    rebuilt: shouldRebuild,
  };
}

export function ensureLexicalIndexExists(config: LexicalCorpusConfig): {
  readonly corpus: string;
  readonly dbPath: string;
  readonly sourceRoot: string;
  readonly documentCount: number;
  readonly fingerprint: string | null;
  readonly rebuilt: boolean;
} {
  const db = connectFts(config.dbPath);
  ensureSchema(db);
  const row = db.prepare(`SELECT COUNT(*) AS count FROM lexical_documents`).get() as { count: number };
  const fingerprint = readMeta(db, "fingerprint");
  db.close();

  if (row.count === 0 && !existsSync(config.sourceRoot)) {
    return {
      corpus: config.name,
      dbPath: config.dbPath,
      sourceRoot: config.sourceRoot,
      documentCount: 0,
      fingerprint,
      rebuilt: false,
    };
  }

  if (row.count === 0) {
    return rebuildLexicalIndex(config);
  }

  return {
    corpus: config.name,
    dbPath: config.dbPath,
    sourceRoot: config.sourceRoot,
    documentCount: row.count,
    fingerprint,
    rebuilt: false,
  };
}

export interface LexicalSearchResult extends Record<string, unknown> {
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
  readonly source_path: string;
  readonly match_query: string;
  readonly bm25_score: number;
  readonly lexical_rank: number;
  readonly corpus: string;
  readonly index_document_count: number;
}

export function searchLexicalCorpus(
  config: LexicalCorpusConfig,
  query: string,
  options: { readonly limit?: number } = {},
): LexicalSearchResult[] {
  const summary = ensureLexicalIndexExists(config);
  let matchQuery = buildMatchQuery(query, "AND");
  if (!matchQuery) {
    return [];
  }

  const db = connectFts(config.dbPath);
  ensureSchema(db);
  const fetchRows = (currentMatchQuery: string): Array<Record<string, unknown>> =>
    db.prepare(`
      SELECT
        doc,
        chunk_id,
        content,
        source_path,
        bm25(lexical_documents, 8.0, 4.0, 1.0) AS bm25_score
      FROM lexical_documents
      WHERE lexical_documents MATCH ?
      ORDER BY bm25_score ASC, doc ASC
      LIMIT ?
    `).all(currentMatchQuery, options.limit ?? 10) as Array<Record<string, unknown>>;

  let rows = fetchRows(matchQuery);
  if (rows.length === 0 && tokenizeQuery(query).length > 1) {
    matchQuery = buildMatchQuery(query, "OR");
    rows = fetchRows(matchQuery);
  }
  db.close();

  return rows.map((row, index) => ({
    doc: String(row.doc),
    chunk_id: String(row.chunk_id),
    content: String(row.content),
    source_path: String(row.source_path),
    match_query: matchQuery,
    bm25_score: Number(row.bm25_score),
    lexical_rank: index + 1,
    corpus: config.name,
    index_document_count: summary.documentCount,
  }));
}

export function searchDocumentsLexical(query: string, limit = 10): LexicalSearchResult[] {
  return searchLexicalCorpus(TECH_DOCS_LEXICAL_CONFIG, query, { limit });
}

export function searchNonConformitiesLexical(query: string, limit = 10): LexicalSearchResult[] {
  return searchLexicalCorpus(NC_LEXICAL_CONFIG, query, { limit });
}
