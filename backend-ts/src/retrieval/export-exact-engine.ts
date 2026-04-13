import { HybridRetriever, type HybridRetrievalResponse } from "./hybrid-retriever.ts";
import type { RetrievalEngine } from "./engine.ts";
import type { EmbeddingVectorizer } from "./openai-embeddings.ts";

export class ExportExactRetrievalEngine implements RetrievalEngine {
  readonly name = "export_exact" as const;
  readonly #retriever: HybridRetriever;

  constructor(vectorizer: EmbeddingVectorizer) {
    this.#retriever = new HybridRetriever(vectorizer);
  }

  search(query: string): Promise<HybridRetrievalResponse> {
    return this.#retriever.search(query);
  }
}
