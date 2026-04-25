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

test("PR CI workflow passes OPENAI_API_KEY to the API build step", () => {
  assert.match(prCiWorkflow, /- name: Build API container[\s\S]*OPENAI_API_KEY:\s+\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/u);
});
