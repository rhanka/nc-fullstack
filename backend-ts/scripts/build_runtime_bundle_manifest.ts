import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

type CliOptions = {
  readonly repoRoot: string;
  readonly techDocsDir: string;
  readonly ncDir: string;
  readonly fileList: string;
  readonly bundle: string;
  readonly bundleSha: string;
  readonly output: string;
};

type ManifestEntry = {
  readonly path: string;
  readonly bytes: number;
};

type RuntimeBundleManifest = {
  readonly bundle_name: string;
  readonly bundle_path: string;
  readonly bundle_sha256: string | null;
  readonly bundle_bytes: number | null;
  readonly tech_docs_dir: string;
  readonly nc_dir: string;
  readonly source_file_count: number;
  readonly source_bytes: number;
  readonly entries: readonly ManifestEntry[];
};

const REQUIRED_RELATIVE_PATHS = (techDocsDir: string, ncDir: string): readonly string[] => [
  `api/data/${techDocsDir}/managed_dataset`,
  `api/data/${techDocsDir}/vector-export`,
  `api/data/${techDocsDir}/lexical`,
  `api/data/${techDocsDir}/ontology`,
  `api/data/${techDocsDir}/wiki`,
  `api/data/${techDocsDir}/pages`,
  `api/data/${techDocsDir}/knowledge-manifest.json`,
  `api/data/${ncDir}/managed_dataset`,
  `api/data/${ncDir}/vector-export`,
  `api/data/${ncDir}/lexical`,
  `api/data/${ncDir}/ontology`,
  `api/data/${ncDir}/wiki`,
  `api/data/${ncDir}/json`,
  `api/data/${ncDir}/knowledge-manifest.json`,
] as const;

export function parseCli(args: readonly string[] = process.argv.slice(2)): CliOptions {
  const { values } = parseArgs({
    args,
    options: {
      "repo-root": { type: "string" },
      "tech-docs-dir": { type: "string", default: "a220-tech-docs" },
      "nc-dir": { type: "string", default: "a220-non-conformities" },
      "file-list": { type: "string" },
      bundle: { type: "string" },
      "bundle-sha": { type: "string" },
      output: { type: "string" },
    },
    strict: true,
  });

  const repoRoot = values["repo-root"];
  const fileList = values["file-list"];
  const bundle = values.bundle;
  const bundleSha = values["bundle-sha"];
  const output = values.output;

  if (!repoRoot || !fileList || !bundle || !bundleSha || !output) {
    throw new Error("Missing required args: --repo-root --file-list --bundle --bundle-sha --output");
  }

  return {
    repoRoot: path.resolve(repoRoot),
    techDocsDir: values["tech-docs-dir"] ?? "a220-tech-docs",
    ncDir: values["nc-dir"] ?? "a220-non-conformities",
    fileList: path.resolve(fileList),
    bundle: path.resolve(bundle),
    bundleSha: path.resolve(bundleSha),
    output: path.resolve(output),
  };
}

function walkFiles(rootPath: string, baseRoot: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = statSync(current, { throwIfNoEntry: false });
    if (!stat) {
      throw new Error(`Missing required runtime path: ${path.relative(baseRoot, current)}`);
    }

    if (stat.isDirectory()) {
      const children = readdirSync(current, { withFileTypes: true })
        .map((entry) => path.join(current, entry.name))
        .sort((left, right) => left.localeCompare(right));
      for (let index = children.length - 1; index >= 0; index -= 1) {
        stack.push(children[index]!);
      }
      continue;
    }

    entries.push({
      path: path.relative(baseRoot, current).split(path.sep).join("/"),
      bytes: stat.size,
    });
  }

  return entries;
}

function readBundleSha(bundleShaPath: string): string | null {
  const stat = statSync(bundleShaPath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) {
    return null;
  }

  const raw = readFileSync(bundleShaPath, "utf8").trim();
  if (!raw) {
    return null;
  }
  return raw.split(/\s+/u)[0] ?? null;
}

export function buildRuntimeBundleManifest(options: CliOptions): RuntimeBundleManifest {
  const runtimeEntries = REQUIRED_RELATIVE_PATHS(options.techDocsDir, options.ncDir)
    .flatMap((relativePath) => walkFiles(path.join(options.repoRoot, relativePath), options.repoRoot))
    .sort((left, right) => left.path.localeCompare(right.path));

  mkdirSync(path.dirname(options.fileList), { recursive: true });
  mkdirSync(path.dirname(options.output), { recursive: true });

  writeFileSync(options.fileList, `${runtimeEntries.map((entry) => entry.path).join("\n")}\n`);

  const bundleStat = statSync(options.bundle, { throwIfNoEntry: false });
  return {
    bundle_name: path.basename(options.bundle),
    bundle_path: path.relative(options.repoRoot, options.bundle).split(path.sep).join("/"),
    bundle_sha256: readBundleSha(options.bundleSha),
    bundle_bytes: bundleStat?.isFile() ? bundleStat.size : null,
    tech_docs_dir: options.techDocsDir,
    nc_dir: options.ncDir,
    source_file_count: runtimeEntries.length,
    source_bytes: runtimeEntries.reduce((sum, entry) => sum + entry.bytes, 0),
    entries: runtimeEntries,
  };
}

export function main(args: readonly string[] = process.argv.slice(2)): void {
  const options = parseCli(args);
  const manifest = buildRuntimeBundleManifest(options);
  writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
