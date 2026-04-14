import { ExportExactRetrievalEngine } from "./export-exact-engine.ts";
import type { RetrievalEngine, RetrievalEngineName } from "./engine.ts";
import { LanceDbRetrievalEngine } from "./lancedb-engine.ts";
import type { EmbeddingVectorizer } from "./openai-embeddings.ts";

export function resolveRetrievalEngineName(): RetrievalEngineName {
  const raw = process.env.NC_RETRIEVAL_ENGINE?.trim();
  if (raw === "lancedb") {
    return "lancedb";
  }
  return "export_exact";
}

export function createRetrievalEngine(vectorizer: EmbeddingVectorizer): RetrievalEngine {
  const engine = resolveRetrievalEngineName();
  if (engine === "lancedb") {
    return new LanceDbRetrievalEngine(vectorizer);
  }
  return new ExportExactRetrievalEngine(vectorizer);
}
