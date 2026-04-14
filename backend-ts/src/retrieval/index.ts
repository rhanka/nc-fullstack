import {
  NC_VECTOR_CONFIG,
  TECH_DOCS_VECTOR_CONFIG,
  hasVectorExport,
  type VectorCorpusConfig,
} from "./vector-search.ts";
import {
  NC_LANCEDB_CONFIG,
  TECH_DOCS_LANCEDB_CONFIG,
} from "./lancedb-engine.ts";
import { resolveRetrievalEngineName } from "./factory.ts";

function summarizeCorpus(config: VectorCorpusConfig): {
  readonly corpus: string;
  readonly manifestPath: string;
  readonly exportReady: boolean;
} {
  return {
    corpus: config.corpus,
    manifestPath: config.manifestPath,
    exportReady: hasVectorExport(config),
  };
}

function summarizeLanceDbCorpus(config: { readonly corpus: string; readonly uri: string; readonly tableName: string }): {
  readonly corpus: string;
  readonly uri: string;
  readonly tableName: string;
} {
  return {
    corpus: config.corpus,
    uri: config.uri,
    tableName: config.tableName,
  };
}

export interface RetrievalRuntimeSummary {
  readonly status: "hybrid-ts-runtime";
  readonly runtimeMode: "native-typescript";
  readonly targetMode: "rag-v2-light";
  readonly activeEngine: "export_exact" | "lancedb";
  readonly fallbackEngine: "export_exact";
  readonly vectorPath: "offline-export-exact-l2" | "lancedb-local";
  readonly lexicalPath: "sqlite-fts5";
  readonly lancedb: readonly [
    ReturnType<typeof summarizeLanceDbCorpus>,
    ReturnType<typeof summarizeLanceDbCorpus>,
  ];
  readonly corpora: readonly [
    ReturnType<typeof summarizeCorpus>,
    ReturnType<typeof summarizeCorpus>,
  ];
}

export function getRetrievalRuntimeSummary(): RetrievalRuntimeSummary {
  return {
    status: "hybrid-ts-runtime",
    runtimeMode: "native-typescript",
    targetMode: "rag-v2-light",
    activeEngine: resolveRetrievalEngineName(),
    fallbackEngine: "export_exact",
    vectorPath: resolveRetrievalEngineName() === "lancedb" ? "lancedb-local" : "offline-export-exact-l2",
    lexicalPath: "sqlite-fts5",
    lancedb: [
      summarizeLanceDbCorpus(TECH_DOCS_LANCEDB_CONFIG),
      summarizeLanceDbCorpus(NC_LANCEDB_CONFIG),
    ],
    corpora: [
      summarizeCorpus(TECH_DOCS_VECTOR_CONFIG),
      summarizeCorpus(NC_VECTOR_CONFIG),
    ],
  };
}

export {
  createRetrievalEngine,
  resolveRetrievalEngineName,
} from "./factory.ts";

export {
  type RetrievalEngine,
  type RetrievalEngineName,
} from "./engine.ts";

export {
  ExactVectorStore,
  NC_VECTOR_CONFIG,
  TECH_DOCS_VECTOR_CONFIG,
  getExactVectorStore,
  hasVectorExport,
  searchDocumentsVector,
  searchNonConformitiesVector,
  searchVectorCorpus,
  type VectorCorpusConfig,
  type VectorCorpusName,
  type VectorExportManifest,
  type VectorSearchItem,
  type VectorSearchResult,
} from "./vector-search.ts";

export {
  HybridRetriever,
  type CorpusSearchDebug,
  type CorpusSearchOptions,
  type CorpusSearchResponse,
  type HybridRetrievalResponse,
  type HybridSearchResult,
  type HybridCorpusName,
} from "./hybrid-retriever.ts";

export {
  OpenAIEmbeddingVectorizer,
  type EmbeddingVectorizer,
  type OpenAIEmbeddingsApiClient,
  type OpenAIEmbeddingsCreateRequest,
  type OpenAIEmbeddingsCreateResponse,
} from "./openai-embeddings.ts";

export {
  LanceDbRetrievalEngine,
  NC_LANCEDB_CONFIG,
  TECH_DOCS_LANCEDB_CONFIG,
  type LanceDbCorpusConfig,
} from "./lancedb-engine.ts";
