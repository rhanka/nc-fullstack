import type { ExecutionProfile } from "../contracts/ai.ts";
import type { ReasoningEffort } from "../llm/types.ts";

export type TaskStage = "search_rewrite" | "assistant_response";
export type RuntimeModel = "gpt-5.4-nano" | "gpt-5.4";
export type RetrievalConfidence = "low" | "medium" | "high";
export type CostClass = "low" | "medium" | "high";
export type LatencyClass = "fast" | "balanced" | "slow";

export interface ExecutionProfileDefinition {
  readonly id: ExecutionProfile;
  readonly stage: TaskStage;
  readonly defaultModel: RuntimeModel;
  readonly reasoningEffort: ReasoningEffort;
  readonly maxOutputTokens: number;
}

const EXECUTION_PROFILE_REGISTRY: Record<ExecutionProfile, ExecutionProfileDefinition> = {
  search_rewrite: {
    id: "search_rewrite",
    stage: "search_rewrite",
    defaultModel: "gpt-5.4-nano",
    reasoningEffort: "none",
    maxOutputTokens: 400,
  },
  draft_simple: {
    id: "draft_simple",
    stage: "assistant_response",
    defaultModel: "gpt-5.4-nano",
    reasoningEffort: "low",
    maxOutputTokens: 1200,
  },
  draft_standard_000: {
    id: "draft_standard_000",
    stage: "assistant_response",
    defaultModel: "gpt-5.4-nano",
    reasoningEffort: "low",
    maxOutputTokens: 1800,
  },
  analysis_standard_100: {
    id: "analysis_standard_100",
    stage: "assistant_response",
    defaultModel: "gpt-5.4",
    reasoningEffort: "high",
    maxOutputTokens: 2800,
  },
  analysis_deep: {
    id: "analysis_deep",
    stage: "assistant_response",
    defaultModel: "gpt-5.4",
    reasoningEffort: "xhigh",
    maxOutputTokens: 3600,
  },
};

export function listExecutionProfiles(): ExecutionProfileDefinition[] {
  return Object.values(EXECUTION_PROFILE_REGISTRY);
}

export function getExecutionProfile(id: ExecutionProfile): ExecutionProfileDefinition {
  return EXECUTION_PROFILE_REGISTRY[id];
}
