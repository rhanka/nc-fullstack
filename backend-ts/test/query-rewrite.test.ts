import test from "node:test";
import assert from "node:assert/strict";

import {
  collectQueryVariants,
  rewriteRetrievalQuery,
  tokenizeQuery,
} from "../src/services/query-rewrite.ts";

test("rewriteRetrievalQuery infers ATA 28 fuel grounding variants", () => {
  const result = rewriteRetrievalQuery(
    "electrostatic discharge reservoir tank right wing grounding electrical esd",
    "tech_docs",
  );

  assert.equal(result.llmUsed, false);
  assert.ok(result.variants.some((item) => item.includes("ATA 28")));
  assert.ok(result.reasons.includes("fuel / tank context inferred"));
  assert.ok(result.reasons.includes("electrical / grounding context inferred"));
});

test("collectQueryVariants returns original query when rewrite is disabled", () => {
  assert.deepEqual(
    collectQueryVariants("Right windshield rivet flushness", {
      corpus: "non_conformities",
      useQueryRewrite: false,
    }),
    ["Right windshield rivet flushness"],
  );
});

test("tokenizeQuery normalizes and deduplicates", () => {
  assert.deepEqual(tokenizeQuery("Rivet rivet pare-brise"), ["rivet", "pare", "brise"]);
});
