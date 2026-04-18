import type { HybridRetrievalResponse } from "./hybrid-retriever.ts";

export type RetrievalEngineName = "export_exact";

export interface RetrievalEngine {
  readonly name: RetrievalEngineName;
  search(query: string): Promise<HybridRetrievalResponse>;
}
