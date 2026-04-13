import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ComplexityAnalyzer,
  ComplexitySelection,
  ResponseComplexity,
} from "../src/services/complexity-analyzer.ts";
import {
  resolveExecutionRouting,
  type ExecutionRoutingRequest,
} from "../src/services/execution-routing-service.ts";

interface ReviewInputCase extends ExecutionRoutingRequest {
  readonly case_id: string;
  readonly title: string;
  readonly excerpt: string;
  readonly simulatedAutoComplexity: ResponseComplexity;
}

interface ReviewInputDocument {
  readonly generated_at: string;
  readonly source: string;
  readonly cases: readonly ReviewInputCase[];
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVIEWS_DIR = path.join(ROOT, "reviews");
const INPUT_PATH = path.join(REVIEWS_DIR, "l1.6_routing_review_inputs.json");
const OUTPUT_JSON_PATH = path.join(REVIEWS_DIR, "l1.6_routing_review.json");
const OUTPUT_MD_PATH = path.join(REVIEWS_DIR, "l1.6_routing_review.md");

function toMarkdownTable(rows: readonly string[][]): string {
  const [header, ...body] = rows;
  const separator = header.map(() => "---");
  return [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

async function reviewCase(inputCase: ReviewInputCase) {
  const analyzer: ComplexityAnalyzer = {
    async analyze() {
      return {
        level: inputCase.simulatedAutoComplexity,
        analyzerModel: "gpt-5.4-nano",
        promptVersion: "complexity-eval-v1",
        rawOutput: inputCase.simulatedAutoComplexity,
      };
    },
  };

  const decision = await resolveExecutionRouting(
    {
      stage: inputCase.stage,
      userRole: inputCase.userRole,
      userMessage: inputCase.excerpt,
      description: inputCase.description,
      historyExcerpt: inputCase.historyExcerpt,
      retrievalConfidence: inputCase.retrievalConfidence,
      modelSelection: inputCase.modelSelection,
      complexitySelection: inputCase.complexitySelection as ComplexitySelection | undefined,
    },
    analyzer,
  );

  return {
    case_id: inputCase.case_id,
    title: inputCase.title,
    excerpt: inputCase.excerpt,
    selected_profile: decision.profile.id,
    model: decision.resolvedModel,
    model_selection_source: decision.modelSelectionSource,
    reasoning_effort: decision.resolvedReasoningEffort,
    resolved_complexity: decision.resolvedComplexity,
    requested_model_selection: decision.requestedModelSelection,
    requested_complexity_selection: decision.requestedComplexitySelection,
    complexity_analyzer_model: decision.complexityAnalyzerModel,
    max_output_tokens: decision.profile.maxOutputTokens,
    cost_class: decision.costClass,
    latency_class: decision.latencyClass,
    reasons: decision.reasons,
  };
}

const rawDocument = await readFile(INPUT_PATH, "utf-8");
const document = JSON.parse(rawDocument) as ReviewInputDocument;
const evaluatedCases = await Promise.all(document.cases.map((inputCase) => reviewCase(inputCase)));

const summary = {
  total_cases: evaluatedCases.length,
  by_profile: Object.fromEntries(
    Object.entries(
      evaluatedCases.reduce<Record<string, number>>((accumulator, reviewCase) => {
        accumulator[reviewCase.selected_profile] =
          (accumulator[reviewCase.selected_profile] ?? 0) + 1;
        return accumulator;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  ),
  by_model: Object.fromEntries(
    Object.entries(
      evaluatedCases.reduce<Record<string, number>>((accumulator, reviewCase) => {
        accumulator[reviewCase.model] = (accumulator[reviewCase.model] ?? 0) + 1;
        return accumulator;
      }, {}),
    ).sort(([left], [right]) => left.localeCompare(right)),
  ),
};

await mkdir(REVIEWS_DIR, { recursive: true });
await writeFile(
  OUTPUT_JSON_PATH,
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: document.source,
      summary,
      cases: evaluatedCases,
    },
    null,
    2,
  )}\n`,
  "utf-8",
);

const markdown = [
  "# L1.6 Routing Review",
  "",
  `Source: ${document.source}`,
  "",
  `Generated at: ${new Date().toISOString()}`,
  "",
  "## Summary",
  "",
  `- Total cases: ${summary.total_cases}`,
  `- By profile: ${JSON.stringify(summary.by_profile)}`,
  `- By model: ${JSON.stringify(summary.by_model)}`,
  "",
  "## Case Review",
  "",
  toMarkdownTable([
    ["Case", "Profile", "Model", "Model Source", "Complexity", "Reasoning", "Cost", "Latency", "Why"],
    ...evaluatedCases.map((reviewCase) => [
      reviewCase.case_id,
      reviewCase.selected_profile,
      reviewCase.model,
      reviewCase.model_selection_source,
      reviewCase.resolved_complexity,
      reviewCase.reasoning_effort,
      reviewCase.cost_class,
      reviewCase.latency_class,
      reviewCase.reasons.join("; "),
    ]),
  ]),
  "",
].join("\n");

await writeFile(OUTPUT_MD_PATH, markdown, "utf-8");

console.log(`Wrote ${OUTPUT_JSON_PATH}`);
console.log(`Wrote ${OUTPUT_MD_PATH}`);
