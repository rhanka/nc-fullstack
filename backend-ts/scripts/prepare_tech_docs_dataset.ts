import { prepareTechDocsCanonicalDataset } from "../src/dataprep/tech-docs-canonical.ts";

const result = prepareTechDocsCanonicalDataset();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
