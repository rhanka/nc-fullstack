import {
  NC_VECTOR_CONFIG,
  TECH_DOCS_VECTOR_CONFIG,
  hasVectorExport,
  type VectorCorpusConfig,
} from "./vector-search.ts";
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

export interface RetrievalRuntimeSummary {
  readonly status: "hybrid-ts-runtime";
  readonly runtimeMode: "native-typescript";
  readonly targetMode: "rag-v2-light";
  readonly activeEngine: "export_exact";
  readonly vectorPath: "offline-export-exact-l2";
  readonly lexicalPath: "sqlite-fts5";
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
    vectorPath: "offline-export-exact-l2",
    lexicalPath: "sqlite-fts5",
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
