import type {
  LlmResponse,
  LlmStreamEvent,
  LlmTransport,
  NormalizedLlmCallOptions,
} from "./types.ts";

type OpenAIReasoningSummaryText = {
  readonly type: "summary_text";
  readonly text: string;
};

type OpenAIReasoningOutputItem = {
  readonly type: "reasoning";
  readonly summary?: readonly OpenAIReasoningSummaryText[];
};

type OpenAIMessageOutputItem = {
  readonly type: "message";
  readonly role: "assistant";
  readonly content: readonly Array<{
    readonly type: "output_text";
    readonly text: string;
  }>;
};

type OpenAIOutputItem = OpenAIReasoningOutputItem | OpenAIMessageOutputItem;

export interface OpenAIResponsesCreateRequest {
  readonly model: string;
  readonly input: readonly Array<{
    readonly role: string;
    readonly content: string;
  }>;
  readonly stream?: boolean;
  readonly reasoning?: {
    readonly effort: NonNullable<NormalizedLlmCallOptions["reasoning"]["effort"]>;
    readonly summary: "auto";
  };
  readonly text?: {
    readonly format: {
      readonly type: "text" | "json_object";
    };
  };
  readonly max_output_tokens?: number;
}

export interface OpenAIResponsesApiResponse {
  readonly id: string;
  readonly model: string;
  readonly output_text?: string;
  readonly output?: readonly OpenAIOutputItem[];
}

export interface OpenAIResponsesStreamEvent {
  readonly type:
    | "response.output_text.delta"
    | "response.output_text.done"
    | "response.completed"
    | "response.error";
  readonly delta?: string;
  readonly text?: string;
  readonly error?: { readonly message: string };
  readonly response?: OpenAIResponsesApiResponse;
}

export interface OpenAIResponsesApiClient {
  responses: {
    create(request: OpenAIResponsesCreateRequest): Promise<OpenAIResponsesApiResponse>;
    stream(request: OpenAIResponsesCreateRequest): AsyncIterable<OpenAIResponsesStreamEvent>;
  };
}

export function buildOpenAIResponsesRequest(
  options: NormalizedLlmCallOptions,
): OpenAIResponsesCreateRequest {
  return {
    model: options.model,
    input: options.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    reasoning: options.reasoning.effort
      ? {
          effort: options.reasoning.effort,
          summary: "auto",
        }
      : undefined,
    text: {
      format: {
        type: options.jsonMode ? "json_object" : "text",
      },
    },
    max_output_tokens: options.maxOutputTokens ?? undefined,
  };
}

function extractReasoningSummary(response: OpenAIResponsesApiResponse): string | null {
  const summaries =
    response.output
      ?.filter((item): item is OpenAIReasoningOutputItem => item.type === "reasoning")
      .flatMap((item) => item.summary ?? [])
      .map((item) => item.text.trim())
      .filter(Boolean) ?? [];

  return summaries.length > 0 ? summaries.join("\n\n") : null;
}

function extractOutputText(response: OpenAIResponsesApiResponse): string {
  if (response.output_text) {
    return response.output_text;
  }

  const assistantText =
    response.output
      ?.filter((item): item is OpenAIMessageOutputItem => item.type === "message")
      .flatMap((item) => item.content)
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("") ?? "";

  return assistantText;
}

export class OpenAIResponsesTransport implements LlmTransport {
  readonly #client: OpenAIResponsesApiClient;

  constructor(client: OpenAIResponsesApiClient) {
    this.#client = client;
  }

  async invoke(options: NormalizedLlmCallOptions): Promise<LlmResponse> {
    const request = buildOpenAIResponsesRequest(options);
    const response = await this.#client.responses.create(request);

    return {
      providerId: options.providerId,
      model: response.model,
      text: extractOutputText(response),
      jsonMode: options.jsonMode,
      responseId: response.id,
      reasoningSummary: extractReasoningSummary(response),
    };
  }

  async *stream(options: NormalizedLlmCallOptions): AsyncIterable<LlmStreamEvent> {
    const request = buildOpenAIResponsesRequest(options);
    let streamedText = "";

    for await (const event of this.#client.responses.stream(request)) {
      if (event.type === "response.error") {
        throw new Error(event.error?.message ?? "OpenAI Responses API stream failed");
      }

      if (event.type === "response.output_text.delta") {
        const delta = event.delta ?? "";
        streamedText += delta;
        yield {
          type: "delta",
          delta,
        };
        continue;
      }

      if (event.type === "response.output_text.done" && event.text) {
        streamedText = event.text;
        continue;
      }

      if (event.type === "response.completed" && event.response) {
        yield {
          type: "completed",
          text: event.response.output_text ?? streamedText,
          responseId: event.response.id,
          reasoningSummary: extractReasoningSummary(event.response),
        };
      }
    }
  }
}
