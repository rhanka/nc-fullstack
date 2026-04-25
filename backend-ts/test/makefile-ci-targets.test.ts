import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const makefile = readFileSync(new URL("../../Makefile", import.meta.url), "utf8");
const ensureRetrievalScript = readFileSync(
  new URL("../scripts/ensure_retrieval_artifacts.ts", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

function targetPrerequisites(target: string): string[] {
  const match = makefile.match(new RegExp(`^${target}:([^\\n]*)`, "m"));
  assert.ok(match, `missing Makefile target ${target}`);
  return match[1]!.trim().split(/\s+/).filter(Boolean);
}

test("API image check only prepares retrieval artifacts, not runtime PDF assets", () => {
  assert.deepEqual(targetPrerequisites("api-prepare-data-ci"), ["dataprep-retrieval-ci-local"]);
  assert.deepEqual(targetPrerequisites("dataprep-retrieval-ci-local"), ["api-install"]);
  assert.ok(targetPrerequisites("dataprep-retrieval-ci").includes("dataprep-download-retrieval-inputs"));
  assert.ok(!targetPrerequisites("dataprep-retrieval-ci").includes("dataprep-download-minimal"));
});

test("API image check does not install dependencies or regenerate retrieval artifacts", () => {
  assert.deepEqual(targetPrerequisites("api-image-check"), ["dataprep-download-retrieval-inputs", "docker-login"]);
});

test("API build downloads runtime assets after retrieval artifacts are ready", () => {
  assert.deepEqual(targetPrerequisites("api-build"), ["dataprep-retrieval-ci", "api-runtime-data-ci"]);
  assert.deepEqual(targetPrerequisites("api-build-ci"), ["api-prepare-data-ci", "api-runtime-data-ci"]);
  assert.deepEqual(targetPrerequisites("api-runtime-data-ci"), ["dataprep-download-runtime-assets"]);
});

test("CD workflow reuses the retrieval download done by image check", () => {
  assert.match(makefile, /^api-build-ci: api-prepare-data-ci api-runtime-data-ci$/m);
  assert.match(makefile, /^dataprep-retrieval-ci-local: api-install$/m);
});

test("runtime bundle packaging target builds a tar.zst bundle plus manifest", () => {
  assert.match(makefile, /^dataprep-package-runtime-bundle:/m);
  assert.match(makefile, /build_runtime_bundle_manifest\.ts/u);
  assert.match(makefile, /zstd -3/u);
  assert.match(makefile, /\.tar\.zst/u);
  assert.match(makefile, /\.manifest\.json/u);
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

test("retrieval cache upload publishes the canonical tech-doc dataset", () => {
  assert.match(makefile, /a220_tech_docs_content_canonical\.csv\.gz/);
  assert.match(makefile, /a220_tech_docs_content_canonical\.audit\.json/);
});

test("retrieval cache upload skips empty wiki parts directories", () => {
  assert.match(makefile, /find 'api\/data\/\$\{TECH_DOCS_DIR\}\/wiki\/parts' -type f -name '\*\.md' \| grep -q \./);
  assert.match(makefile, /find 'api\/data\/\$\{NC_DIR\}\/wiki\/parts' -type f -name '\*\.md' \| grep -q \./);
});

test("CI retrieval cache upload runs only after an actual rebuild", () => {
  assert.match(makefile, /DATAPREP_REBUILD_MARKER=\.\.\/\.dataprep-retrieval-rebuilt/);
  assert.match(makefile, /if \[ -f \.dataprep-retrieval-rebuilt \]; then \\\s*\$\(MAKE\) dataprep-upload-retrieval-cache;/);
  assert.match(makefile, /Retrieval artifacts fresh; retrieval cache upload skipped/);
});

test("retrieval ensure script emits a rebuild marker for CI upload gating", () => {
  assert.match(ensureRetrievalScript, /DATAPREP_REBUILD_MARKER/);
  assert.match(ensureRetrievalScript, /writeFileSync\(rebuildMarkerPath/);
  assert.match(ensureRetrievalScript, /rebuiltCorpora/);
});
