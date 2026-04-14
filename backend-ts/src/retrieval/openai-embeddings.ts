export interface OpenAIEmbeddingsCreateRequest {
  readonly model: string;
  readonly input: string;
}

export interface OpenAIEmbeddingsCreateResponse {
  readonly data: readonly Array<{
    readonly embedding: readonly number[];
  }>;
}

export interface OpenAIEmbeddingsApiClient {
  embeddings: {
    create(request: OpenAIEmbeddingsCreateRequest): Promise<OpenAIEmbeddingsCreateResponse>;
  };
}

export interface EmbeddingVectorizer {
  embedQuery(query: string): Promise<Float32Array>;
}

export class OpenAIEmbeddingVectorizer implements EmbeddingVectorizer {
  readonly #client: OpenAIEmbeddingsApiClient;
  readonly #model: string;

  constructor(
    client: OpenAIEmbeddingsApiClient,
    model: string = process.env.RETRIEVAL_EMBEDDING_MODEL?.trim() || "text-embedding-3-large",
  ) {
    this.#client = client;
    this.#model = model;
  }

  async embedQuery(query: string): Promise<Float32Array> {
    const response = await this.#client.embeddings.create({
      model: this.#model,
      input: query,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error("OpenAI embeddings API returned no embedding");
    }
    return Float32Array.from(embedding);
  }
}
