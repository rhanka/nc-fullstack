import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployApiWorkflow = readFileSync(new URL("../../.github/workflows/deploy-api.yml", import.meta.url), "utf8");
const deployUiWorkflow = readFileSync(new URL("../../.github/workflows/deploy-ui.yml", import.meta.url), "utf8");
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

test("UI deploy waits for successful API deploy workflow on master", () => {
  assert.match(deployApiWorkflow, /-\s+'ui\/\*\*'/u);
  assert.match(deployUiWorkflow, /workflow_run:/u);
  assert.match(deployUiWorkflow, /workflows:\s*\n\s*-\s*Deploy API to Scaleway/u);
  assert.match(deployUiWorkflow, /types:\s*\n\s*-\s*completed/u);
  assert.match(deployUiWorkflow, /if:\s+\$\{\{\s*github\.event\.workflow_run\.conclusion == 'success'\s*\}\}/u);
  assert.match(deployUiWorkflow, /ref:\s+\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/u);
  assert.doesNotMatch(deployUiWorkflow, /on:\s*\n\s*push:/u);
});

test("API deploy workflow uses the CI build target that reuses retrieval inputs", () => {
  assert.match(deployApiWorkflow, /- name: Download data and Build API[\s\S]*make api-build-ci/u);
  assert.doesNotMatch(deployApiWorkflow, /- name: Download data and Build API[\s\S]*make api-build\s*$/mu);
});

test("API deploy workflow checks image existence through the runtime bundle CI path", () => {
  assert.match(deployApiWorkflow, /- name: Check if API image is up to date[\s\S]*make api-image-check-ci/u);
  assert.doesNotMatch(deployApiWorkflow, /- name: Check if API image is up to date[\s\S]*make api-image-check\s*$/mu);
});

test("API deploy workflow captures previous image, smokes the deploy, and rolls back on failure", () => {
  assert.match(deployApiWorkflow, /- name: Capture current API deploy state[\s\S]*registry_image/u);
  assert.match(deployApiWorkflow, /- name: Smoke deployed API[\s\S]*make deploy-api-smoke/u);
  assert.match(deployApiWorkflow, /- name: Roll back API if deploy smoke failed[\s\S]*make rollback-api-container wait-for-container deploy-api-smoke/u);
  assert.match(deployApiWorkflow, /API_PUBLIC_URL:\s+https:\/\/nc-api\.sent-tech\.ca/u);
});
