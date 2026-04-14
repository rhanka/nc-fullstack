import test from "node:test";
import assert from "node:assert/strict";

import {
  assessRetrievalConfidence,
  buildLowConfidencePayload,
  LOW_CONFIDENCE_MESSAGE,
} from "../src/services/retrieval-confidence.ts";

test("assessRetrievalConfidence detects high-confidence cross-supported retrieval", () => {
  const result = assessRetrievalConfidence(
    [
      { retrieval_channels: ["lexical", "vector"], vector_distance: 0.82, rrf_score: 0.04 },
      { retrieval_channels: ["lexical"], rrf_score: 0.031 },
    ],
    [{ retrieval_channels: ["lexical", "vector"], distance: 0.91, rrf_score: 0.033 }],
  );

  assert.equal(result.level, "high");
});

test("buildLowConfidencePayload preserves the conservative output shape", () => {
  const payload = buildLowConfidencePayload({
    role: "000",
    userMessage: "rewrite this",
    description: { label: "demo" },
    sources: { tech_docs: { sources: [] } },
    confidence: {
      level: "low",
      signals: [],
      reason: "no retrieval results",
    },
  });

  assert.equal(payload.text, LOW_CONFIDENCE_MESSAGE);
  assert.equal(payload.user_role, "000");
  assert.equal(payload.user_query, "rewrite this");
});
