import assert from "node:assert/strict";
import test from "node:test";

import {
  getExecutionProfile,
  listExecutionProfiles,
} from "../src/services/execution-profile-registry.ts";

test("registry lists the expected execution profiles", () => {
  const profiles = listExecutionProfiles();
  assert.equal(profiles.length, 5);
  assert.deepEqual(
    profiles.map((profile) => profile.id),
    [
      "search_rewrite",
      "draft_simple",
      "draft_standard_000",
      "analysis_standard_100",
      "analysis_deep",
    ],
  );
});

test("analysis_deep keeps gpt-5.4 as default model with xhigh reasoning", () => {
  const profile = getExecutionProfile("analysis_deep");
  assert.equal(profile.defaultModel, "gpt-5.4");
  assert.equal(profile.reasoningEffort, "xhigh");
  assert.equal(profile.maxOutputTokens, 3600);
});

test("draft_standard_000 keeps gpt-5.4-nano as default model", () => {
  const profile = getExecutionProfile("draft_standard_000");
  assert.equal(profile.defaultModel, "gpt-5.4-nano");
  assert.equal(profile.reasoningEffort, "low");
});
