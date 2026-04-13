export type AiSourceV1Message = {
  readonly role: string;
  readonly text: string;
  readonly description?: string | Record<string, unknown> | null;
  readonly history?: unknown[] | Record<string, unknown> | null;
  readonly sources?: AiSourceGroups | null;
};

export type AiSourceV1Request = {
  readonly provider?: string;
  readonly messages: readonly AiSourceV1Message[];
  readonly session_id?: string | null;
  readonly memory_event?: Record<string, unknown> | null;
  readonly modelSelection?: AiModelSelection;
  readonly complexitySelection?: AiComplexitySelection;
};

export type AiSourceItem = {
  readonly doc?: string;
  readonly chunk?: string;
  readonly chunk_id?: string;
  readonly content?: string;
  readonly [key: string]: unknown;
};

export type AiSourceGroup = {
  readonly sources?: readonly AiSourceItem[];
  readonly [key: string]: unknown;
};

export type AiSourceGroups = {
  readonly tech_docs?: AiSourceGroup;
  readonly non_conformities?: AiSourceGroup;
  readonly [key: string]: unknown;
};

export type AiSourceV1Response = {
  readonly text: string | null;
  readonly label: string | null;
  readonly description: Record<string, unknown> | string | null;
  readonly sources: AiSourceGroups;
  readonly user_query: string;
  readonly input_description: Record<string, unknown> | string | null;
  readonly role: "ai";
  readonly user_role: string;
};

export type AiModelSelection = "gpt-5.4-nano" | "gpt-5.4";
export type AiComplexitySelection = "auto" | "simple" | "standard" | "deep";
