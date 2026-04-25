import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main as buildRuntimeBundleManifestCli } from "../scripts/build_runtime_bundle_manifest.ts";

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

test("runtime bundle manifest script writes a deterministic file list and manifest", () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "nc-runtime-bundle-"));

  write(repoRoot, "api/data/docs/managed_dataset/chunks.jsonl", "docs chunks");
  write(repoRoot, "api/data/docs/vector-export/manifest.json", '{"vectors":1}');
  write(repoRoot, "api/data/docs/lexical/fts.sqlite3", "lexical");
  write(repoRoot, "api/data/docs/ontology/index.json", '{"parts":1}');
  write(repoRoot, "api/data/docs/wiki/index.json", '{"pages":1}');
  write(repoRoot, "api/data/docs/pages/doc-1.pdf", "pdf");
  write(repoRoot, "api/data/docs/knowledge-manifest.json", '{"corpus":"docs"}');

  write(repoRoot, "api/data/nc/managed_dataset/chunks.jsonl", "nc chunks");
  write(repoRoot, "api/data/nc/vector-export/manifest.json", '{"vectors":1}');
  write(repoRoot, "api/data/nc/lexical/fts.sqlite3", "lexical");
  write(repoRoot, "api/data/nc/ontology/index.json", '{"parts":1}');
  write(repoRoot, "api/data/nc/wiki/index.json", '{"pages":1}');
  write(repoRoot, "api/data/nc/json/ATA-1.json", '{"id":"ATA-1"}');
  write(repoRoot, "api/data/nc/knowledge-manifest.json", '{"corpus":"nc"}');

  const bundleRoot = path.join(repoRoot, "api/data/runtime-bundles");
  mkdirSync(bundleRoot, { recursive: true });
  const fileListPath = path.join(bundleRoot, "api-runtime-data.filelist");
  const manifestPath = path.join(bundleRoot, "api-runtime-data.manifest.json");
  const bundlePath = path.join(bundleRoot, "api-runtime-data.tar.zst");
  const bundleShaPath = path.join(bundleRoot, "api-runtime-data.tar.zst.sha256");

  writeFileSync(bundlePath, "compressed-bundle-placeholder");
  writeFileSync(bundleShaPath, "abcd1234  api-runtime-data.tar.zst\n");

  buildRuntimeBundleManifestCli([
    "--repo-root",
    repoRoot,
    "--tech-docs-dir",
    "docs",
    "--nc-dir",
    "nc",
    "--file-list",
    fileListPath,
    "--bundle",
    bundlePath,
    "--bundle-sha",
    bundleShaPath,
    "--output",
    manifestPath,
  ]);

  const fileList = readFileSync(fileListPath, "utf8").trim().split("\n");
  assert.deepEqual(fileList, [
    "api/data/docs/knowledge-manifest.json",
    "api/data/docs/lexical/fts.sqlite3",
    "api/data/docs/managed_dataset/chunks.jsonl",
    "api/data/docs/ontology/index.json",
    "api/data/docs/pages/doc-1.pdf",
    "api/data/docs/vector-export/manifest.json",
    "api/data/docs/wiki/index.json",
    "api/data/nc/json/ATA-1.json",
    "api/data/nc/knowledge-manifest.json",
    "api/data/nc/lexical/fts.sqlite3",
    "api/data/nc/managed_dataset/chunks.jsonl",
    "api/data/nc/ontology/index.json",
    "api/data/nc/vector-export/manifest.json",
    "api/data/nc/wiki/index.json",
  ]);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    readonly bundle_name: string;
    readonly tech_docs_dir: string;
    readonly nc_dir: string;
    readonly source_file_count: number;
    readonly bundle_sha256: string;
    readonly entries: readonly { readonly path: string }[];
  };

  assert.equal(manifest.bundle_name, "api-runtime-data.tar.zst");
  assert.equal(manifest.tech_docs_dir, "docs");
  assert.equal(manifest.nc_dir, "nc");
  assert.equal(manifest.source_file_count, 14);
  assert.equal(manifest.bundle_sha256, "abcd1234");
  assert.equal(manifest.entries[0]?.path, "api/data/docs/knowledge-manifest.json");
  assert.equal(manifest.entries.at(-1)?.path, "api/data/nc/wiki/index.json");
});
