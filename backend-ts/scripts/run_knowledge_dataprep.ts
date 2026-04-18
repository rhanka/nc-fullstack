import {
  buildDefaultCorpusConfigs,
  runKnowledgeDataprepForCorpus,
  type DataprepCorpusName,
} from "../src/dataprep/pipeline.ts";

function parseTarget(): readonly DataprepCorpusName[] {
  const raw = (process.argv[2] ?? "tech_docs").trim();
  if (raw === "all") {
    return ["tech_docs", "non_conformities"];
  }
  if (raw === "tech_docs" || raw === "non_conformities") {
    return [raw];
  }
  throw new Error("usage: node scripts/run_knowledge_dataprep.ts <tech_docs|non_conformities|all>");
}

const corpora = parseTarget();
const configs = buildDefaultCorpusConfigs();
const results = [];
for (const corpus of corpora) {
  results.push(await runKnowledgeDataprepForCorpus(configs[corpus]));
}
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
