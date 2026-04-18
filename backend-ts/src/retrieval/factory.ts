import { ExportExactRetrievalEngine } from "./export-exact-engine.ts";
import type { RetrievalEngine, RetrievalEngineName } from "./engine.ts";
import type { EmbeddingVectorizer } from "./openai-embeddings.ts";

export function resolveRetrievalEngineName(): RetrievalEngineName {
  return "export_exact";
}

export function createRetrievalEngine(vectorizer: EmbeddingVectorizer): RetrievalEngine {
  return new ExportExactRetrievalEngine(vectorizer);
}
