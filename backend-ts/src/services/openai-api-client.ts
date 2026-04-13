import type {
  OpenAIEmbeddingsApiClient,
  OpenAIEmbeddingsCreateRequest,
  OpenAIEmbeddingsCreateResponse,
} from "../retrieval/openai-embeddings.ts";
import type {
  OpenAIResponsesApiClient,
  OpenAIResponsesApiResponse,
  OpenAIResponsesCreateRequest,
  OpenAIResponsesStreamEvent,
} from "../llm/openai-responses-transport.ts";

type FetchLike = typeof fetch;

export interface OpenAIApiClient
  extends OpenAIResponsesApiClient,
    OpenAIEmbeddingsApiClient {}

function resolveApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }
  return apiKey;
}

function resolveBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/u, "");
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload?.error?.message) {
      return payload.error.message;
    }
  } catch {
    // Fall through to plain text handling.
  }

  try {
    return (await response.text()).trim() || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function postJson<TResponse>(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
): Promise<TResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolveApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TResponse;
}

function parseSseBlock(block: string): OpenAIResponsesStreamEvent | null {
  let eventName = "";
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const payload = dataLines.join("\n").trim();
  if (!payload || payload === "[DONE]") {
    return null;
  }

  const parsed = JSON.parse(payload) as Record<string, unknown>;
  return {
    ...(parsed as unknown as OpenAIResponsesStreamEvent),
    type:
      typeof parsed.type === "string"
        ? (parsed.type as OpenAIResponsesStreamEvent["type"])
        : (eventName as OpenAIResponsesStreamEvent["type"]),
  };
}

async function* streamSseJson(
  fetchImpl: FetchLike,
  url: string,
  body: unknown,
): AsyncIterable<OpenAIResponsesStreamEvent> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolveApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (!response.body) {
    throw new Error("OpenAI Responses API stream returned no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      while (buffer.includes("\n\n")) {
        const boundaryIndex = buffer.indexOf("\n\n");
        const block = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        const event = parseSseBlock(block);
        if (event) {
          yield event;
        }
      }
    }

    buffer += decoder.decode();
    const finalBlock = buffer.trim();
    if (finalBlock) {
      const event = parseSseBlock(finalBlock);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createOpenAIApiClient(fetchImpl: FetchLike = fetch): OpenAIApiClient {
  const baseUrl = resolveBaseUrl();

  return {
    responses: {
      create(
        request: OpenAIResponsesCreateRequest,
      ): Promise<OpenAIResponsesApiResponse> {
        return postJson(fetchImpl, `${baseUrl}/responses`, request);
      },
      stream(
        request: OpenAIResponsesCreateRequest,
      ): AsyncIterable<OpenAIResponsesStreamEvent> {
        return streamSseJson(fetchImpl, `${baseUrl}/responses`, {
          ...request,
          stream: true,
        });
      },
    },
    embeddings: {
      create(
        request: OpenAIEmbeddingsCreateRequest,
      ): Promise<OpenAIEmbeddingsCreateResponse> {
        return postJson(fetchImpl, `${baseUrl}/embeddings`, request);
      },
    },
  };
}
