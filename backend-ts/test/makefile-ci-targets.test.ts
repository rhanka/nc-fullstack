import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");

function targetPrerequisites(target: string): string[] {
  const match = makefile.match(new RegExp(`^${target}:([^\\n]*)`, "m"));
  assert.ok(match, `missing Makefile target ${target}`);
  return match[1]!.trim().split(/\s+/).filter(Boolean);
}

test("API image check only prepares retrieval artifacts, not runtime PDF assets", () => {
  assert.deepEqual(targetPrerequisites("api-prepare-data-ci"), ["dataprep-retrieval-ci"]);
  assert.ok(targetPrerequisites("dataprep-retrieval-ci").includes("dataprep-download-retrieval-inputs"));
  assert.ok(!targetPrerequisites("dataprep-retrieval-ci").includes("dataprep-download-minimal"));
});

test("API build downloads runtime assets after retrieval artifacts are ready", () => {
  assert.deepEqual(targetPrerequisites("api-build"), ["api-prepare-data-ci", "api-runtime-data-ci"]);
  assert.deepEqual(targetPrerequisites("api-runtime-data-ci"), ["dataprep-download-runtime-assets"]);
});
