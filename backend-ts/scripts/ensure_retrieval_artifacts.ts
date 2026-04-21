import { rmSync, writeFileSync } from "node:fs";
import {
  DEFAULT_EMBEDDING_MODEL,
  buildDataprepCodeFingerprint,
  buildDataprepCliOptions,
  buildDefaultCorpusConfigs,
  buildSourceFingerprint,
  inspectRetrievalArtifacts,
  readPreparedRecords,
  runDataprepForCorpus,
  type DataprepCorpusName,
  type RunDataprepOptions,
} from "../src/dataprep/pipeline.ts";

const requested = process.argv[2] ?? "all";
const corpusNames: readonly DataprepCorpusName[] =
  requested === "all" ? ["tech_docs", "non_conformities"] : [requested as DataprepCorpusName];
const configs = buildDefaultCorpusConfigs();
const codeFingerprint = buildDataprepCodeFingerprint();
const rebuildMarkerPath = process.env.DATAPREP_REBUILD_MARKER?.trim();
const rebuiltCorpora: DataprepCorpusName[] = [];
let options: RunDataprepOptions | null = null;

if (rebuildMarkerPath) {
  rmSync(rebuildMarkerPath, { force: true });
}

for (const corpus of corpusNames) {
  const config = configs[corpus];
  if (!config) {
    throw new Error(`Unknown dataprep corpus '${corpus}'`);
  }

  const records = readPreparedRecords(config);
  const fingerprint = buildSourceFingerprint(config, records);
  const status = inspectRetrievalArtifacts(config, {
    fingerprint,
    codeFingerprint,
    recordCount: records.length,
    embeddingModel: DEFAULT_EMBEDDING_MODEL,
  });

  if (status.fresh) {
    console.log(`retrieval artifacts fresh: ${corpus} (${records.length} records)`);
    continue;
  }

  console.log(`retrieval artifacts stale: ${corpus}`);
  for (const reason of status.reasons) {
    console.log(`- ${reason}`);
  }

  options ??= buildDataprepCliOptions();
  await runDataprepForCorpus(config, options);
  rebuiltCorpora.push(corpus);
  console.log(`retrieval artifacts rebuilt: ${corpus} (${records.length} records)`);
}

if (rebuildMarkerPath && rebuiltCorpora.length > 0) {
  writeFileSync(rebuildMarkerPath, `${rebuiltCorpora.join("\n")}\n`);
}
