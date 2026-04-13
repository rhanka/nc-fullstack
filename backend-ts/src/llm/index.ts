import type {
  LlmCallOptions,
  LlmResponse,
  LlmStreamEvent,
  LlmTransport,
  NormalizedLlmCallOptions,
} from "./types.ts";

export type {
  LlmCallOptions,
  LlmMessage,
  LlmResponse,
  LlmStreamEvent,
  LlmTransport,
  NormalizedLlmCallOptions,
  ReasoningEffort,
} from "./types.ts";
export {
  buildOpenAIResponsesRequest,
  OpenAIResponsesTransport,
  type OpenAIResponsesApiClient,
  type OpenAIResponsesApiResponse,
  type OpenAIResponsesCreateRequest,
  type OpenAIResponsesStreamEvent,
} from "./openai-responses-transport.ts";

export interface LlmRuntimeSummary {
  readonly status: "responses-adapter-ready";
  readonly currentBridge: "typescript-foundation";
  readonly targetApi: "openai-responses";
  readonly targetModels: readonly ["gpt-5.4-nano", "gpt-5.4"];
  readonly supportedPerCallOptions: readonly [
    "reasoning.effort",
    "jsonMode",
    "stream",
    "maxOutputTokens",
  ];
}

export function getLlmRuntimeSummary(): LlmRuntimeSummary {
  return {
    status: "responses-adapter-ready",
    currentBridge: "typescript-foundation",
    targetApi: "openai-responses",
    targetModels: ["gpt-5.4-nano", "gpt-5.4"],
    supportedPerCallOptions: ["reasoning.effort", "jsonMode", "stream", "maxOutputTokens"],
  };
}

function assertNonEmptyString(name: string, value: string): void {
  if (!value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function normalizeMaxOutputTokens(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("maxOutputTokens must be a positive integer when provided");
  }
  return value;
}

export function normalizeLlmCallOptions(
  options: LlmCallOptions,
  overrides: Partial<Pick<NormalizedLlmCallOptions, "stream">> = {},
): NormalizedLlmCallOptions {
  assertNonEmptyString("providerId", options.providerId);
  assertNonEmptyString("model", options.model);
  if (options.messages.length === 0) {
    throw new Error("messages must contain at least one item");
  }

  return {
    providerId: options.providerId,
    model: options.model,
    messages: options.messages,
    reasoning: {
      effort: options.reasoning?.effort ?? null,
    },
    jsonMode: options.jsonMode ?? false,
    stream: overrides.stream ?? options.stream ?? false,
    maxOutputTokens: normalizeMaxOutputTokens(options.maxOutputTokens),
  };
}

export interface LlmRuntime {
  invoke(options: LlmCallOptions): Promise<LlmResponse>;
  stream(options: LlmCallOptions): AsyncIterable<LlmStreamEvent>;
}

export function createLlmRuntime(transport: LlmTransport): LlmRuntime {
  return {
    async invoke(options: LlmCallOptions): Promise<LlmResponse> {
      if (options.stream === true) {
        throw new Error("invoke does not accept stream=true; use runtime.stream instead");
      }
      const normalized = normalizeLlmCallOptions(options, { stream: false });
      return transport.invoke(normalized);
    },
    stream(options: LlmCallOptions): AsyncIterable<LlmStreamEvent> {
      const normalized = normalizeLlmCallOptions(options, { stream: true });
      return transport.stream(normalized);
    },
  };
}
