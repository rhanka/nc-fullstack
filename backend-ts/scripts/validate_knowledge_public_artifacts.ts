import { validateKnowledgePublicArtifacts } from "../src/dataprep/knowledge-public-artifacts.ts";
import { buildDefaultCorpusConfigs } from "../src/dataprep/pipeline.ts";

const configs = buildDefaultCorpusConfigs();
const report = validateKnowledgePublicArtifacts({
  corpora: [
    { corpus: "tech_docs", outputRoot: configs.tech_docs.outputRoot },
    { corpus: "non_conformities", outputRoot: configs.non_conformities.outputRoot },
  ],
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.exitCode = 1;
}
