import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComplexityAnalysisPrompt,
  createComplexityAnalyzer,
  parseComplexityLevel,
} from "../src/services/complexity-analyzer.ts";
import type { LlmRuntime } from "../src/llm/index.ts";

test("buildComplexityAnalysisPrompt keeps the classifier minimal and token-constrained", () => {
  const prompt = buildComplexityAnalysisPrompt({
    userRole: "100",
    message: "Le cas semble ambigu entre structure et carburant.",
    description: "Besoin d'analyse prudente.",
    historyExcerpt: "USER: Peux-tu arbitrer ?",
  });

  assert.match(prompt, /EXACTEMENT UN SEUL TOKEN/);
  assert.match(prompt, /simple\|standard\|deep/);
  assert.match(prompt, /rôle demandé: 100/);
});

test("parseComplexityLevel accepts only the expected tokens", () => {
  assert.equal(parseComplexityLevel("simple"), "simple");
  assert.equal(parseComplexityLevel("standard\n"), "standard");
  assert.equal(parseComplexityLevel("deep extra words"), "deep");
  assert.throws(() => parseComplexityLevel("high"), /Invalid complexity token/);
});

test("createComplexityAnalyzer uses gpt-5.4-nano and parses the returned token", async () => {
  let capturedModel = "";
  let capturedPrompt = "";
  const runtime: LlmRuntime = {
    async invoke(options) {
      capturedModel = options.model;
      capturedPrompt = options.messages[0]?.content ?? "";
      return {
        providerId: options.providerId,
        model: options.model,
        text: "deep",
        jsonMode: false,
        responseId: "resp_complexity",
        reasoningSummary: null,
      };
    },
    async *stream() {
      throw new Error("not used");
    },
  };

  const analyzer = createComplexityAnalyzer(runtime);
  const result = await analyzer.analyze({
    userRole: "100",
    message: "Cas ambigu à fort enjeu réglementaire.",
  });

  assert.equal(capturedModel, "gpt-5.4-nano");
  assert.match(capturedPrompt, /classificateur minimal de complexité/);
  assert.equal(result.level, "deep");
  assert.equal(result.analyzerModel, "gpt-5.4-nano");
});
