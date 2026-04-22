import { validateKnowledgePublicArtifacts } from "../src/dataprep/knowledge-public-artifacts.ts";
import { buildDefaultCorpusConfigs } from "../src/dataprep/pipeline.ts";

const configs = buildDefaultCorpusConfigs();
const requireTechDocImages = process.env.KNOWLEDGE_PUBLIC_CHECK_REQUIRE_TECH_DOC_IMAGES === "1";
const report = validateKnowledgePublicArtifacts({
  corpora: [
    { corpus: "tech_docs", outputRoot: configs.tech_docs.outputRoot },
    { corpus: "non_conformities", outputRoot: configs.non_conformities.outputRoot },
  ],
  minimumImageCounts: requireTechDocImages ? { tech_docs: 1 } : {},
  minimumImageRelationCounts: requireTechDocImages ? { tech_docs: 1 } : {},
  minimumLinkedImageCounts: requireTechDocImages ? { tech_docs: 1 } : {},
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) {
  process.exitCode = 1;
}
