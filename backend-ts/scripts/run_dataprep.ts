import {
  buildDataprepCliOptions,
  runDataprep,
  type DataprepCorpusName,
} from "../src/dataprep/pipeline.ts";

function parseTarget(): readonly DataprepCorpusName[] {
  const raw = (process.argv[2] ?? "all").trim();
  if (raw === "all") {
    return ["tech_docs", "non_conformities"];
  }
  if (raw === "tech_docs" || raw === "non_conformities") {
    return [raw];
  }
  throw new Error("usage: node scripts/run_dataprep.ts <tech_docs|non_conformities|all>");
}

const corpora = parseTarget();
const options = buildDataprepCliOptions();
const results = await runDataprep(corpora, options);
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
