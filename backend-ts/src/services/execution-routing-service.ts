import type { ReasoningEffort } from "../llm/index.ts";
import {
  type ComplexityAnalyzer,
  type ComplexitySelection,
  type ResponseComplexity,
} from "./complexity-analyzer.ts";
import {
  getExecutionProfile,
  type CostClass,
  type ExecutionProfileDefinition,
  type LatencyClass,
  type RetrievalConfidence,
  type RuntimeModel,
  type TaskStage,
} from "./execution-profile-registry.ts";

export type ModelSelection = "gpt-5.4-nano" | "gpt-5.4";

export interface ExecutionRoutingRequest {
  readonly stage: TaskStage;
  readonly userRole?: string | null;
  readonly userMessage: string;
  readonly description?: string | null;
  readonly historyExcerpt?: string | null;
  readonly retrievalConfidence?: RetrievalConfidence;
  readonly modelSelection?: ModelSelection;
  readonly complexitySelection?: ComplexitySelection;
}

export interface ExecutionRoutingDecision {
  readonly profile: ExecutionProfileDefinition;
  readonly resolvedModel: RuntimeModel;
  readonly resolvedReasoningEffort: ReasoningEffort;
  readonly resolvedComplexity: ResponseComplexity;
  readonly requestedModelSelection: ModelSelection;
  readonly modelSelectionSource: "default" | "manual";
  readonly requestedComplexitySelection: ComplexitySelection;
  readonly complexityAnalyzerModel: "gpt-5.4-nano" | null;
  readonly complexitySource: "auto_llm" | "manual" | "fixed";
  readonly reasons: readonly string[];
  readonly costClass: CostClass;
  readonly latencyClass: LatencyClass;
}

function selectProfileFromContext(input: {
  readonly stage: TaskStage;
  readonly userRole?: string | null;
  readonly resolvedComplexity: ResponseComplexity;
  readonly retrievalConfidence?: RetrievalConfidence;
  readonly reasons: string[];
}): ExecutionProfileDefinition {
  if (input.stage === "search_rewrite" || input.userRole === "query") {
    input.reasons.push("search rewrite stays on the dedicated nano profile");
    return getExecutionProfile("search_rewrite");
  }

  if (input.userRole === "000") {
    input.reasons.push("role 000 stays pinned to the 000 draft profile");
    return getExecutionProfile("draft_standard_000");
  }

  if (
    input.resolvedComplexity === "deep" ||
    (input.userRole !== "000" && input.retrievalConfidence === "low")
  ) {
    if (input.resolvedComplexity === "deep") {
      input.reasons.push("deep complexity promotes the deep analysis profile");
    }
    if (input.userRole !== "000" && input.retrievalConfidence === "low") {
      input.reasons.push("low retrieval confidence forces the deep analysis profile");
    }
    return getExecutionProfile("analysis_deep");
  }

  if (input.resolvedComplexity === "simple") {
    input.reasons.push("simple complexity keeps the lightweight draft profile");
    return getExecutionProfile("draft_simple");
  }

  input.reasons.push("standard complexity uses the standard analysis profile");
  return getExecutionProfile("analysis_standard_100");
}

function describeCostAndLatency(
  resolvedModel: RuntimeModel,
  resolvedComplexity: ResponseComplexity,
): { readonly costClass: CostClass; readonly latencyClass: LatencyClass } {
  if (resolvedModel === "gpt-5.4") {
    return resolvedComplexity === "deep"
      ? { costClass: "high", latencyClass: "slow" }
      : { costClass: "medium", latencyClass: "balanced" };
  }

  return resolvedComplexity === "deep"
    ? { costClass: "medium", latencyClass: "balanced" }
    : { costClass: "low", latencyClass: "fast" };
}

function resolveModel(
  stage: TaskStage,
  requestedModelSelection: ModelSelection | undefined,
  reasons: string[],
): {
  readonly resolvedModel: RuntimeModel;
  readonly requestedModelSelection: ModelSelection;
  readonly modelSelectionSource: ExecutionRoutingDecision["modelSelectionSource"];
} {
  if (stage === "search_rewrite") {
    reasons.push("search rewrite stays pinned to gpt-5.4-nano");
    return {
      resolvedModel: "gpt-5.4-nano",
      requestedModelSelection: "gpt-5.4-nano",
      modelSelectionSource: "default",
    };
  }

  if (requestedModelSelection === "gpt-5.4") {
    reasons.push("manual model selection uses gpt-5.4");
    return {
      resolvedModel: "gpt-5.4",
      requestedModelSelection: "gpt-5.4",
      modelSelectionSource: "manual",
    };
  }

  if (requestedModelSelection === "gpt-5.4-nano") {
    reasons.push("manual model selection uses gpt-5.4-nano");
    return {
      resolvedModel: "gpt-5.4-nano",
      requestedModelSelection: "gpt-5.4-nano",
      modelSelectionSource: "manual",
    };
  }

  reasons.push("default model selection uses gpt-5.4-nano");
  return {
    resolvedModel: "gpt-5.4-nano",
    requestedModelSelection: "gpt-5.4-nano",
    modelSelectionSource: "default",
  };
}

function resolveReasoningEffort(
  profile: ExecutionProfileDefinition,
  resolvedModel: RuntimeModel,
): ReasoningEffort {
  if (resolvedModel === "gpt-5.4-nano" && profile.reasoningEffort === "xhigh") {
    return "high";
  }
  return profile.reasoningEffort;
}

export async function resolveExecutionRouting(
  request: ExecutionRoutingRequest,
  analyzer: ComplexityAnalyzer,
): Promise<ExecutionRoutingDecision> {
  const requestedComplexitySelection = request.complexitySelection ?? "auto";
  const reasons: string[] = [];

  let resolvedComplexity: ResponseComplexity = "standard";
  let complexityAnalyzerModel: "gpt-5.4-nano" | null = null;
  let complexitySource: ExecutionRoutingDecision["complexitySource"] = "fixed";

  if (request.stage === "search_rewrite") {
    resolvedComplexity = "simple";
    complexitySource = "fixed";
    reasons.push("search rewrite bypasses complexity analysis");
  } else if (requestedComplexitySelection === "auto") {
    const analysis = await analyzer.analyze({
      userRole: request.userRole,
      message: request.userMessage,
      description: request.description,
      historyExcerpt: request.historyExcerpt,
    });
    resolvedComplexity = analysis.level;
    complexityAnalyzerModel = analysis.analyzerModel;
    complexitySource = "auto_llm";
    reasons.push(`complexity analyzed as ${analysis.level} by ${analysis.analyzerModel}`);
  } else {
    resolvedComplexity = requestedComplexitySelection;
    complexitySource = "manual";
    reasons.push(`complexity manually set to ${requestedComplexitySelection}`);
  }

  const profile = selectProfileFromContext({
    stage: request.stage,
    userRole: request.userRole,
    resolvedComplexity,
    retrievalConfidence: request.retrievalConfidence,
    reasons,
  });

  const {
    resolvedModel,
    requestedModelSelection,
    modelSelectionSource,
  } = resolveModel(request.stage, request.modelSelection, reasons);
  const resolvedReasoningEffort = resolveReasoningEffort(profile, resolvedModel);
  const { costClass, latencyClass } = describeCostAndLatency(resolvedModel, resolvedComplexity);
  reasons.push(`estimated cost=${costClass}`);
  reasons.push(`estimated latency=${latencyClass}`);

  return {
    profile,
    resolvedModel,
    resolvedReasoningEffort,
    resolvedComplexity,
    requestedModelSelection,
    modelSelectionSource,
    requestedComplexitySelection,
    complexityAnalyzerModel,
    complexitySource,
    reasons,
    costClass,
    latencyClass,
  };
}
