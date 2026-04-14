export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export interface LlmMessage {
  readonly role: "system" | "developer" | "user" | "assistant" | "tool";
  readonly content: string;
}

export interface LlmReasoningOptions {
  readonly effort: ReasoningEffort | null;
}

export interface LlmCallOptions {
  readonly providerId: string;
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly reasoning?: Partial<LlmReasoningOptions>;
  readonly jsonMode?: boolean;
  readonly stream?: boolean;
  readonly maxOutputTokens?: number | null;
}

export interface NormalizedLlmCallOptions {
  readonly providerId: string;
  readonly model: string;
  readonly messages: readonly LlmMessage[];
  readonly reasoning: LlmReasoningOptions;
  readonly jsonMode: boolean;
  readonly stream: boolean;
  readonly maxOutputTokens: number | null;
}

export interface LlmResponse {
  readonly providerId: string;
  readonly model: string;
  readonly text: string;
  readonly jsonMode: boolean;
  readonly responseId: string | null;
  readonly reasoningSummary: string | null;
}

export interface LlmStreamEvent {
  readonly type: "delta" | "completed";
  readonly delta?: string;
  readonly text?: string;
  readonly responseId?: string;
  readonly reasoningSummary?: string | null;
}

export interface LlmTransport {
  invoke(input: NormalizedLlmCallOptions): Promise<LlmResponse>;
  stream(input: NormalizedLlmCallOptions): AsyncIterable<LlmStreamEvent>;
}
