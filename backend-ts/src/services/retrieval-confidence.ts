export interface RetrievalConfidenceResult {
  readonly level: "low" | "medium" | "high";
  readonly signals: readonly number[];
  readonly reason: string;
}

export interface LowConfidencePayloadInput {
  readonly role: string;
  readonly userMessage: string;
  readonly description: unknown;
  readonly sources: Record<string, unknown>;
  readonly confidence: RetrievalConfidenceResult;
}

export const LOW_CONFIDENCE_MESSAGE =
  "Low-confidence retrieval. I kept the current input conservative and did not infer additional technical specifics. Provide ATA, zone, part number, measurements, or a validated similar case.";

export function sourceSignal(item: Record<string, unknown>): number {
  const hasExplicitSignal = [
    "retrieval_channels",
    "rrf_score",
    "vector_distance",
    "distance",
    "lexical_score",
  ].some((key) => key in item);

  if (!hasExplicitSignal) {
    return 2;
  }

  let score = 0;
  const channels = new Set(Array.isArray(item.retrieval_channels) ? item.retrieval_channels : []);
  if (channels.has("lexical")) {
    score += 2;
  }
  if (channels.has("vector")) {
    const vectorDistance = item.vector_distance ?? item.distance;
    if (typeof vectorDistance === "number" && vectorDistance <= 1.0) {
      score += 1;
    }
  }
  if (typeof item.rrf_score === "number" && item.rrf_score >= 0.03) {
    score += 1;
  }
  return score;
}

export function assessRetrievalConfidence(
  techDocsResults: readonly Record<string, unknown>[],
  nonConformityResults: readonly Record<string, unknown>[],
): RetrievalConfidenceResult {
  const sampledResults = [...techDocsResults.slice(0, 3), ...nonConformityResults.slice(0, 3)];
  if (sampledResults.length === 0) {
    return { level: "low", signals: [], reason: "no retrieval results" };
  }

  const signals = sampledResults.map((item) => sourceSignal(item));
  const bestSignal = Math.max(...signals);
  const mediumOrBetter = signals.filter((signal) => signal >= 2).length;

  if (bestSignal <= 1 && mediumOrBetter === 0) {
    return {
      level: "low",
      signals,
      reason: "results are sparse and weakly supported",
    };
  }
  if (bestSignal >= 3 && mediumOrBetter >= 2) {
    return {
      level: "high",
      signals,
      reason: "multiple results are cross-supported",
    };
  }
  return {
    level: "medium",
    signals,
    reason: "some support exists but remains partial",
  };
}

export function buildLowConfidencePayload(
  input: LowConfidencePayloadInput,
): Record<string, unknown> {
  const label =
    input.description && typeof input.description === "object" && "label" in input.description
      ? input.description.label
      : null;

  return {
    text: LOW_CONFIDENCE_MESSAGE,
    label,
    description: input.description,
    sources: input.sources,
    user_query: input.userMessage,
    input_description: input.description,
    role: "ai",
    user_role: input.role,
  };
}
