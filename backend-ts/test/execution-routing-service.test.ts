import assert from "node:assert/strict";
import test from "node:test";

import type { ComplexityAnalyzer } from "../src/services/complexity-analyzer.ts";
import { resolveExecutionRouting } from "../src/services/execution-routing-service.ts";

function makeAnalyzer(level: "simple" | "standard" | "deep"): ComplexityAnalyzer {
  return {
    async analyze() {
      return {
        level,
        analyzerModel: "gpt-5.4-nano",
        promptVersion: "complexity-eval-v1",
        rawOutput: level,
      };
    },
  };
}

test("auto complexity keeps simple cases on nano", async () => {
  const decision = await resolveExecutionRouting(
    {
      stage: "assistant_response",
      userRole: "100",
      userMessage: "Reformule rapidement ce cas.",
      complexitySelection: "auto",
      retrievalConfidence: "high",
    },
    makeAnalyzer("simple"),
  );

  assert.equal(decision.profile.id, "draft_simple");
  assert.equal(decision.resolvedModel, "gpt-5.4-nano");
  assert.equal(decision.resolvedComplexity, "simple");
  assert.equal(decision.complexityAnalyzerModel, "gpt-5.4-nano");
  assert.equal(decision.modelSelectionSource, "default");
});

test("auto complexity promotes deep non-000 cases to the deep profile without changing the model", async () => {
  const decision = await resolveExecutionRouting(
    {
      stage: "assistant_response",
      userRole: "100",
      userMessage: "Analyse en profondeur ce cas hybride structure + carburant.",
      complexitySelection: "auto",
      retrievalConfidence: "medium",
    },
    makeAnalyzer("deep"),
  );

  assert.equal(decision.profile.id, "analysis_deep");
  assert.equal(decision.resolvedModel, "gpt-5.4-nano");
  assert.equal(decision.resolvedReasoningEffort, "high");
  assert.ok(decision.reasons.includes("complexity analyzed as deep by gpt-5.4-nano"));
});

test("role 000 remains pinned to the 000 profile even when complexity is deep", async () => {
  const decision = await resolveExecutionRouting(
    {
      stage: "assistant_response",
      userRole: "000",
      userMessage: "Réécris la NC avec prudence.",
      complexitySelection: "auto",
      retrievalConfidence: "low",
    },
    makeAnalyzer("deep"),
  );

  assert.equal(decision.profile.id, "draft_standard_000");
  assert.equal(decision.resolvedModel, "gpt-5.4-nano");
  assert.ok(decision.reasons.includes("role 000 stays pinned to the 000 draft profile"));
});

test("manual complexity bypasses the analyzer", async () => {
  let called = false;
  const analyzer: ComplexityAnalyzer = {
    async analyze() {
      called = true;
      throw new Error("should not be called");
    },
  };

  const decision = await resolveExecutionRouting(
    {
      stage: "assistant_response",
      userRole: "100",
      userMessage: "Analyse.",
      modelSelection: "auto",
      complexitySelection: "deep",
      retrievalConfidence: "high",
    },
    analyzer,
  );

  assert.equal(called, false);
  assert.equal(decision.resolvedComplexity, "deep");
  assert.equal(decision.complexitySource, "manual");
});

test("manual model selection overrides the promoted model", async () => {
  const decision = await resolveExecutionRouting(
    {
      stage: "assistant_response",
      userRole: "100",
      userMessage: "Analyse en profondeur.",
      modelSelection: "gpt-5.4",
      complexitySelection: "auto",
      retrievalConfidence: "medium",
    },
    makeAnalyzer("deep"),
  );

  assert.equal(decision.profile.id, "analysis_deep");
  assert.equal(decision.resolvedModel, "gpt-5.4");
  assert.equal(decision.modelSelectionSource, "manual");
  assert.equal(decision.resolvedReasoningEffort, "xhigh");
  assert.ok(decision.reasons.includes("manual model selection uses gpt-5.4"));
});

test("search rewrite ignores manual model selection and stays on nano", async () => {
  const decision = await resolveExecutionRouting(
    {
      stage: "search_rewrite",
      userRole: "query",
      userMessage: "Build retrieval query",
      modelSelection: "gpt-5.4",
      complexitySelection: "auto",
      retrievalConfidence: "high",
    },
    makeAnalyzer("deep"),
  );

  assert.equal(decision.profile.id, "search_rewrite");
  assert.equal(decision.resolvedModel, "gpt-5.4-nano");
  assert.equal(decision.modelSelectionSource, "default");
  assert.ok(decision.reasons.includes("search rewrite stays pinned to gpt-5.4-nano"));
});
