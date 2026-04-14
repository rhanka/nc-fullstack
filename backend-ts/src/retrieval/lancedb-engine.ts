import path from "node:path";
import { fileURLToPath } from "node:url";

import { connect, type Connection, type Table } from "@lancedb/lancedb";

import { collectQueryVariants } from "../services/query-rewrite.ts";
import { type EmbeddingVectorizer } from "./openai-embeddings.ts";
import { type RetrievalEngine } from "./engine.ts";
import {
  reciprocalRankFuse,
  reciprocalRankFuseBatches,
  type HybridSearchResult,
  type RankedRetrievalItem,
} from "./rrf.ts";
import type {
  CorpusSearchResponse,
  HybridCorpusName,
  HybridRetrievalResponse,
} from "./hybrid-retriever.ts";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const RRF_K = Number(process.env.RETRIEVAL_RRF_K ?? "60");
const VECTOR_CANDIDATE_LIMIT = Number(process.env.VECTOR_CANDIDATE_LIMIT ?? "15");
const LEXICAL_CANDIDATE_LIMIT = Number(process.env.LEXICAL_CANDIDATE_LIMIT ?? "15");
const MAX_TECH_DOCS_RESULTS = 10;
const MAX_NC_RESULTS = 10;

export interface LanceDbCorpusConfig {
  readonly corpus: "tech_docs" | "non_conformities";
  readonly uri: string;
  readonly tableName: string;
  readonly finalLimit: number;
}

const DEFAULT_LANCEDB_TABLE_NAME = process.env.LANCEDB_TABLE_NAME?.trim() || "chunks";

export const TECH_DOCS_LANCEDB_CONFIG: LanceDbCorpusConfig = {
  corpus: "tech_docs",
  uri: path.join(
    API_ROOT,
    "data",
    process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs",
    "lancedb",
  ),
  tableName: DEFAULT_LANCEDB_TABLE_NAME,
  finalLimit: MAX_TECH_DOCS_RESULTS,
};

export const NC_LANCEDB_CONFIG: LanceDbCorpusConfig = {
  corpus: "non_conformities",
  uri: path.join(
    API_ROOT,
    "data",
    process.env.NC_DIR?.trim() || "a220-non-conformities",
    "lancedb",
  ),
  tableName: DEFAULT_LANCEDB_TABLE_NAME,
  finalLimit: MAX_NC_RESULTS,
};

function normalizeVectorRows(rows: readonly Record<string, unknown>[]): RankedRetrievalItem[] {
  return rows.map((row, index) => ({
    ...row,
    doc: String(row.doc ?? row.chunk_id ?? ""),
    chunk_id: String(row.chunk_id ?? row.doc ?? ""),
    content: String(row.content ?? ""),
    distance:
      typeof row._distance === "number"
        ? row._distance
        : typeof row.distance === "number"
          ? row.distance
          : Number.POSITIVE_INFINITY,
    vector_rank: index + 1,
  }));
}

function normalizeLexicalRows(rows: readonly Record<string, unknown>[]): RankedRetrievalItem[] {
  return rows.map((row, index) => ({
    ...row,
    doc: String(row.doc ?? row.chunk_id ?? ""),
    chunk_id: String(row.chunk_id ?? row.doc ?? ""),
    content: String(row.content ?? ""),
    bm25_score:
      typeof row._score === "number"
        ? row._score
        : typeof row.score === "number"
          ? row.score
          : 0,
    lexical_rank: index + 1,
  }));
}

export class LanceDbRetrievalEngine implements RetrievalEngine {
  readonly name = "lancedb" as const;
  readonly #vectorizer: EmbeddingVectorizer;
  readonly #corpora: Readonly<Record<"tech_docs" | "non_conformities", LanceDbCorpusConfig>>;
  readonly #connections = new Map<string, Promise<Connection>>();
  readonly #tables = new Map<string, Promise<Table>>();

  constructor(
    vectorizer: EmbeddingVectorizer,
    corpora: Readonly<Record<"tech_docs" | "non_conformities", LanceDbCorpusConfig>> = {
      tech_docs: TECH_DOCS_LANCEDB_CONFIG,
      non_conformities: NC_LANCEDB_CONFIG,
    },
  ) {
    this.#vectorizer = vectorizer;
    this.#corpora = corpora;
  }

  async #getConnection(uri: string): Promise<Connection> {
    const existing = this.#connections.get(uri);
    if (existing) {
      return existing;
    }
    const created = connect(uri);
    this.#connections.set(uri, created);
    return created;
  }

  async #getTable(config: LanceDbCorpusConfig): Promise<Table> {
    const cacheKey = `${config.uri}::${config.tableName}`;
    const existing = this.#tables.get(cacheKey);
    if (existing) {
      return existing;
    }
    const created = this.#getConnection(config.uri).then((db) => db.openTable(config.tableName));
    this.#tables.set(cacheKey, created);
    return created;
  }

  async searchCorpus(
    corpus: HybridCorpusName,
    query: string,
  ): Promise<CorpusSearchResponse> {
    const config = this.#corpora[corpus];
    const table = await this.#getTable(config);
    const queryVariants = collectQueryVariants(query, {
      corpus,
      useQueryRewrite: true,
    });
    const candidateLimit = Math.max(
      config.finalLimit,
      VECTOR_CANDIDATE_LIMIT,
      LEXICAL_CANDIDATE_LIMIT,
    );

    const vectorBatches: RankedRetrievalItem[][] = [];
    const lexicalBatches: RankedRetrievalItem[][] = [];
    for (const variant of queryVariants) {
      const queryVector = await this.#vectorizer.embedQuery(variant);
      const [vectorRows, lexicalRows] = await Promise.all([
        table.search(queryVector).limit(candidateLimit).toArray(),
        table.search(variant, "fts", "content").limit(candidateLimit).toArray(),
      ]);
      vectorBatches.push(normalizeVectorRows(vectorRows as Record<string, unknown>[]));
      lexicalBatches.push(normalizeLexicalRows(lexicalRows as Record<string, unknown>[]));
    }

    const vectorResults = reciprocalRankFuseBatches(
      vectorBatches,
      "vector",
      candidateLimit,
      RRF_K,
    );
    const lexicalResults = reciprocalRankFuseBatches(
      lexicalBatches,
      "lexical",
      candidateLimit,
      RRF_K,
    );

    return {
      results: reciprocalRankFuse({
        vectorResults,
        lexicalResults,
        finalLimit: config.finalLimit,
        rrfK: RRF_K,
      }),
      debug: {
        corpus,
        vectorEnabled: true,
        queryVariants,
      },
    };
  }

  async search(query: string): Promise<HybridRetrievalResponse> {
    const [techDocs, nonConformities] = await Promise.all([
      this.searchCorpus("tech_docs", query),
      this.searchCorpus("non_conformities", query),
    ]);

    return {
      techDocs: techDocs.results,
      nonConformities: nonConformities.results,
      debug: {
        techDocs: techDocs.debug,
        nonConformities: nonConformities.debug,
      },
    };
  }
}
