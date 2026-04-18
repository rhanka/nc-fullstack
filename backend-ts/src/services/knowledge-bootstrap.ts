import { existsSync } from "node:fs";
import path from "node:path";

import {
  buildDefaultCorpusConfigs,
  runKnowledgeDataprepForCorpus,
  type DataprepCorpusName,
} from "../dataprep/pipeline.ts";

export interface KnowledgeBootstrapStatus {
  readonly corpus: DataprepCorpusName;
  readonly ontologyReady: boolean;
  readonly wikiReady: boolean;
  readonly generated: boolean;
}

function resolveKnowledgePaths(outputRoot: string): {
  readonly ontologyIndexPath: string;
  readonly wikiIndexPath: string;
} {
  return {
    ontologyIndexPath: path.join(outputRoot, "ontology", "index.json"),
    wikiIndexPath: path.join(outputRoot, "wiki", "index.json"),
  };
}

export async function ensureKnowledgeArtifacts(
  corpus: DataprepCorpusName = "tech_docs",
): Promise<KnowledgeBootstrapStatus> {
  const config = buildDefaultCorpusConfigs()[corpus];
  const paths = resolveKnowledgePaths(config.outputRoot);
  const ontologyReady = existsSync(paths.ontologyIndexPath);
  const wikiReady = existsSync(paths.wikiIndexPath);

  if (ontologyReady && wikiReady) {
    return {
      corpus,
      ontologyReady,
      wikiReady,
      generated: false,
    };
  }

  if (!existsSync(config.sourceFile)) {
    return {
      corpus,
      ontologyReady,
      wikiReady,
      generated: false,
    };
  }

  await runKnowledgeDataprepForCorpus(config);
  const refreshedPaths = resolveKnowledgePaths(config.outputRoot);
  return {
    corpus,
    ontologyReady: existsSync(refreshedPaths.ontologyIndexPath),
    wikiReady: existsSync(refreshedPaths.wikiIndexPath),
    generated: true,
  };
}
