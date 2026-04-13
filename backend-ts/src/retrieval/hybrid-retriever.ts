import {
  type LexicalCorpusConfig,
  NC_LEXICAL_CONFIG,
  TECH_DOCS_LEXICAL_CONFIG,
  searchLexicalCorpus,
} from "../services/lexical-search.ts";
import {
  collectQueryVariants,
} from "../services/query-rewrite.ts";
import type { EmbeddingVectorizer } from "./openai-embeddings.ts";
import {
  NC_VECTOR_CONFIG,
  TECH_DOCS_VECTOR_CONFIG,
  hasVectorExport,
  searchVectorCorpus,
  type VectorCorpusConfig,
} from "./vector-search.ts";
import {
  reciprocalRankFuse,
  reciprocalRankFuseBatches,
  type RankedRetrievalItem,
  type HybridSearchResult,
} from "./rrf.ts";

const RRF_K = Number(process.env.RETRIEVAL_RRF_K ?? "60");
const VECTOR_CANDIDATE_LIMIT = Number(process.env.VECTOR_CANDIDATE_LIMIT ?? "15");
const LEXICAL_CANDIDATE_LIMIT = Number(process.env.LEXICAL_CANDIDATE_LIMIT ?? "15");
const MAX_TECH_DOCS_RESULTS = 10;
const MAX_NC_RESULTS = 10;

export type HybridCorpusName = "tech_docs" | "non_conformities";

export interface CorpusSearchOptions {
  readonly finalLimit?: number;
  readonly candidateLimit?: number;
  readonly useQueryRewrite?: boolean;
}

export interface CorpusSearchDebug {
  readonly corpus: HybridCorpusName;
  readonly vectorEnabled: boolean;
  readonly queryVariants: readonly string[];
}

export interface CorpusSearchResponse {
  readonly results: readonly HybridSearchResult[];
  readonly debug: CorpusSearchDebug;
}

export interface HybridRetrievalResponse {
  readonly techDocs: readonly HybridSearchResult[];
  readonly nonConformities: readonly HybridSearchResult[];
  readonly debug: {
    readonly techDocs: CorpusSearchDebug;
    readonly nonConformities: CorpusSearchDebug;
  };
}

interface CorpusRuntimeConfig {
  readonly corpus: HybridCorpusName;
  readonly lexical: LexicalCorpusConfig;
  readonly vector: VectorCorpusConfig;
  readonly finalLimit: number;
}

export interface HybridRetrieverOptions {
  readonly corpora?: Partial<
    Record<
      HybridCorpusName,
      {
        readonly lexical: LexicalCorpusConfig;
        readonly vector: VectorCorpusConfig;
        readonly finalLimit?: number;
      }
    >
  >;
}


function getCorpusConfig(corpus: HybridCorpusName): CorpusRuntimeConfig {
  if (corpus === "tech_docs") {
    return {
      corpus,
      lexical: TECH_DOCS_LEXICAL_CONFIG,
      vector: TECH_DOCS_VECTOR_CONFIG,
      finalLimit: MAX_TECH_DOCS_RESULTS,
    };
  }

  return {
    corpus,
    lexical: NC_LEXICAL_CONFIG,
    vector: NC_VECTOR_CONFIG,
    finalLimit: MAX_NC_RESULTS,
  };
}

async function searchVectorBatches(
  config: CorpusRuntimeConfig,
  vectorizer: EmbeddingVectorizer,
  queryVariants: readonly string[],
  candidateLimit: number,
): Promise<readonly RankedRetrievalItem[]> {
  if (!hasVectorExport(config.vector)) {
    return [];
  }

  const batches: RankedRetrievalItem[][] = [];
  for (const variant of queryVariants) {
    const embedding = await vectorizer.embedQuery(variant);
    batches.push(searchVectorCorpus(config.vector, embedding, candidateLimit));
  }
  return reciprocalRankFuseBatches(batches, "vector", candidateLimit, RRF_K);
}

function searchLexicalBatches(
  config: CorpusRuntimeConfig,
  queryVariants: readonly string[],
  candidateLimit: number,
): readonly RankedRetrievalItem[] {
  return reciprocalRankFuseBatches(
    queryVariants.map((variant) => searchLexicalCorpus(config.lexical, variant, { limit: candidateLimit })),
    "lexical",
    candidateLimit,
    RRF_K,
  );
}

export class HybridRetriever {
  readonly #vectorizer: EmbeddingVectorizer;
  readonly #options: HybridRetrieverOptions;

  constructor(vectorizer: EmbeddingVectorizer, options: HybridRetrieverOptions = {}) {
    this.#vectorizer = vectorizer;
    this.#options = options;
  }

  async searchCorpus(
    corpus: HybridCorpusName,
    query: string,
    options: CorpusSearchOptions = {},
  ): Promise<CorpusSearchResponse> {
    const defaults = getCorpusConfig(corpus);
    const overrides = this.#options.corpora?.[corpus];
    const config: CorpusRuntimeConfig = overrides
      ? {
          corpus,
          lexical: overrides.lexical,
          vector: overrides.vector,
          finalLimit: overrides.finalLimit ?? defaults.finalLimit,
        }
      : defaults;
    const finalLimit = Math.min(
      Math.max(options.finalLimit ?? config.finalLimit, 1),
      config.finalLimit,
    );
    const candidateLimit = Math.max(
      finalLimit,
      options.candidateLimit ?? 0,
      VECTOR_CANDIDATE_LIMIT,
      LEXICAL_CANDIDATE_LIMIT,
    );
    const queryVariants = collectQueryVariants(query, {
      corpus,
      useQueryRewrite: options.useQueryRewrite !== false,
    });

    const [vectorResults, lexicalResults] = await Promise.all([
      searchVectorBatches(config, this.#vectorizer, queryVariants, candidateLimit),
      Promise.resolve(searchLexicalBatches(config, queryVariants, candidateLimit)),
    ]);

    return {
      results: reciprocalRankFuse({
        vectorResults,
        lexicalResults,
        finalLimit,
        rrfK: RRF_K,
      }),
      debug: {
        corpus,
        vectorEnabled: hasVectorExport(config.vector),
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
