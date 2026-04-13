import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { buildMatchQuery } from "./lexical-search.ts";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const DEFAULT_MEMORY_DB_PATH = path.join(API_ROOT, "data", "memory", "lightweight_memory.sqlite3");

function utcNowIso(): string {
  return new Date().toISOString();
}

function jsonDumps(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function jsonLoads<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface WorkingMemoryResult {
  readonly session_id: string;
  readonly retained_sources: Record<string, unknown>;
  readonly recent_history: unknown[];
  readonly updated_at: string | null;
}

export interface EpisodicMemoryResult {
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
  readonly label: string | null;
  readonly role: string | null;
  readonly case_ref: string | null;
  readonly memory_type: "episodic";
  readonly bm25_score: number;
  readonly lexical_rank: number;
  readonly sources: Record<string, unknown>;
}

export class LightweightMemoryStore {
  readonly dbPath: string;

  constructor(dbPath: string = process.env.LIGHTWEIGHT_MEMORY_DB_PATH?.trim() || DEFAULT_MEMORY_DB_PATH) {
    this.dbPath = dbPath;
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.ensureSchema();
  }

  private connect(): DatabaseSync {
    return new DatabaseSync(this.dbPath);
  }

  ensureSchema(): void {
    const db = this.connect();
    db.exec(`
      CREATE TABLE IF NOT EXISTS working_memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        user_message TEXT NOT NULL,
        search_query TEXT,
        label TEXT,
        description_json TEXT NOT NULL,
        response_text TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        history_entry_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_working_memory_session_created
      ON working_memory_entries(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS episodic_memories (
        episode_id TEXT PRIMARY KEY,
        case_ref TEXT,
        role TEXT,
        label TEXT,
        summary TEXT NOT NULL,
        corrections_json TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        superseded_by TEXT,
        validated INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_memories_fts
      USING fts5(
        episode_id UNINDEXED,
        case_ref,
        label,
        summary,
        corrections,
        tokenize='unicode61 remove_diacritics 2'
      );
    `);
    db.close();
  }

  rememberWorkingMemory(input: {
    readonly sessionId: string;
    readonly role: string;
    readonly userMessage: string;
    readonly searchQuery: string | null;
    readonly label: string | null;
    readonly description: unknown;
    readonly responseText: string | null;
    readonly sources: Record<string, unknown> | null;
  }): void {
    const historyEntry = [
      {
        role: input.role,
        label: input.label,
        description: input.description,
        response_text: input.responseText,
      },
    ];
    const db = this.connect();
    db.prepare(`
      INSERT INTO working_memory_entries(
        session_id, role, user_message, search_query, label,
        description_json, response_text, sources_json, history_entry_json, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.sessionId,
      input.role,
      input.userMessage,
      input.searchQuery,
      input.label,
      jsonDumps(input.description),
      input.responseText ?? "",
      jsonDumps(input.sources),
      jsonDumps(historyEntry),
      utcNowIso(),
    );
    db.close();
  }

  readWorkingMemory(sessionId: string, limit = 4): WorkingMemoryResult {
    const db = this.connect();
    const rows = db.prepare(`
      SELECT *
      FROM working_memory_entries
      WHERE session_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(sessionId, limit) as Array<Record<string, unknown>>;
    db.close();

    if (rows.length === 0) {
      return {
        session_id: sessionId,
        retained_sources: {},
        recent_history: [],
        updated_at: null,
      };
    }

    const newest = rows[0]!;
    return {
      session_id: sessionId,
      retained_sources: jsonLoads(newest.sources_json as string, {}),
      recent_history: rows
        .slice()
        .reverse()
        .map((row) => jsonLoads(row.history_entry_json as string, [])),
      updated_at: (newest.created_at as string) ?? null,
    };
  }

  writeValidatedEpisode(input: {
    readonly episodeId: string;
    readonly caseRef: string | null;
    readonly role: string | null;
    readonly label: string | null;
    readonly summary: string;
    readonly corrections: unknown;
    readonly sources: Record<string, unknown> | null;
    readonly validated: boolean;
    readonly supersedes?: string | null;
  }): boolean {
    if (!input.validated) {
      return false;
    }

    const timestamp = utcNowIso();
    const correctionsPayload = jsonDumps(input.corrections ?? []);
    const sourcesPayload = jsonDumps(input.sources);
    const db = this.connect();

    db.prepare(`
      INSERT INTO episodic_memories(
        episode_id, case_ref, role, label, summary,
        corrections_json, sources_json, superseded_by, validated, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)
      ON CONFLICT(episode_id) DO UPDATE SET
        case_ref = excluded.case_ref,
        role = excluded.role,
        label = excluded.label,
        summary = excluded.summary,
        corrections_json = excluded.corrections_json,
        sources_json = excluded.sources_json,
        updated_at = excluded.updated_at,
        validated = 1
    `).run(
      input.episodeId,
      input.caseRef,
      input.role,
      input.label,
      input.summary,
      correctionsPayload,
      sourcesPayload,
      timestamp,
      timestamp,
    );

    db.prepare(`DELETE FROM episodic_memories_fts WHERE episode_id = ?`).run(input.episodeId);
    db.prepare(`
      INSERT INTO episodic_memories_fts(
        episode_id, case_ref, label, summary, corrections
      ) VALUES(?, ?, ?, ?, ?)
    `).run(
      input.episodeId,
      input.caseRef ?? "",
      input.label ?? "",
      input.summary,
      correctionsPayload,
    );

    if (input.supersedes) {
      db.prepare(`
        UPDATE episodic_memories
        SET superseded_by = ?, updated_at = ?
        WHERE episode_id = ?
      `).run(input.episodeId, timestamp, input.supersedes);
    }
    db.close();
    return true;
  }

  searchEpisodicMemory(query: string, limit = 5): EpisodicMemoryResult[] {
    let matchQuery = buildMatchQuery(query, "AND");
    if (!matchQuery) {
      return [];
    }

    const db = this.connect();
    const fetchRows = (currentMatchQuery: string): Array<Record<string, unknown>> =>
      db.prepare(`
        SELECT
          m.episode_id,
          m.case_ref,
          m.role,
          m.label,
          m.summary,
          m.sources_json,
          bm25(episodic_memories_fts, 6.0, 4.0, 2.0, 1.0) AS bm25_score
        FROM episodic_memories_fts
        JOIN episodic_memories AS m
          ON m.episode_id = episodic_memories_fts.episode_id
        WHERE episodic_memories_fts MATCH ?
          AND m.validated = 1
          AND m.superseded_by IS NULL
        ORDER BY bm25_score ASC, m.updated_at DESC
        LIMIT ?
      `).all(currentMatchQuery, limit) as Array<Record<string, unknown>>;

    let rows = fetchRows(matchQuery);
    if (rows.length === 0 && matchQuery.includes(" AND ")) {
      matchQuery = buildMatchQuery(query, "OR");
      rows = fetchRows(matchQuery);
    }
    db.close();

    return rows.map((row, index) => ({
      doc: `EPISODIC-${String(row.episode_id)}`,
      chunk_id: String(row.episode_id),
      content: String(row.summary),
      label: (row.label as string | null) ?? null,
      role: (row.role as string | null) ?? null,
      case_ref: (row.case_ref as string | null) ?? null,
      memory_type: "episodic",
      bm25_score: Number(row.bm25_score),
      lexical_rank: index + 1,
      sources: jsonLoads(row.sources_json as string, {}),
    }));
  }
}
