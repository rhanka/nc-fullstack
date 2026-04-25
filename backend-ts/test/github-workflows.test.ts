import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployApiWorkflow = readFileSync(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
const prCiWorkflow = readFileSync(new URL("../../.github/workflows/pr-ci.yml", import.meta.url), "utf8");

test("API deploy workflow uses dedicated dataprep S3 secrets for cache upload", () => {
  assert.match(deployApiWorkflow, /S3_DATAPREP_ACCESS_KEY:\s+\$\{\{\s*secrets\.S3_DATAPREP_ACCESS_KEY\s*\}\}/u);
  assert.match(deployApiWorkflow, /S3_DATAPREP_SECRET_KEY:\s+\$\{\{\s*secrets\.S3_DATAPREP_SECRET_KEY\s*\}\}/u);
  assert.doesNotMatch(deployApiWorkflow, /S3_DATAPREP_ACCESS_KEY:\s+\$\{\{\s*secrets\.SCW_ACCESS_KEY\s*\}\}/u);
  assert.doesNotMatch(deployApiWorkflow, /S3_DATAPREP_SECRET_KEY:\s+\$\{\{\s*secrets\.SCW_SECRET_KEY\s*\}\}/u);
});

test("PR CI workflow keeps the gate on check plus API smoke without release image build", () => {
  assert.match(prCiWorkflow, /- name: Run build and tests[\s\S]*make check/u);
  assert.match(prCiWorkflow, /- name: Run backend smoke test[\s\S]*make api-smoke/u);
  assert.doesNotMatch(prCiWorkflow, /- name: Build API container/u);
});
