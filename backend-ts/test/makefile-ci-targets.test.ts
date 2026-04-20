import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

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

test("CI retrieval ensure uses the prepared dataset without requiring PDF pages", () => {
  assert.match(makefile, /npm run dataprep:ensure-retrieval:ci/);
  assert.equal(
    packageJson.scripts["dataprep:ensure-retrieval:ci"],
    "node --experimental-strip-types scripts/ensure_retrieval_artifacts.ts all",
  );
  assert.match(makefile, /npm run dataprep:knowledge:ci/);
  assert.equal(
    packageJson.scripts["dataprep:knowledge:ci"],
    "node --experimental-strip-types scripts/run_knowledge_dataprep.ts all",
  );
});
