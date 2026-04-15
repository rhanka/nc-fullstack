import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tokenizeQuery } from "./lexical-search.ts";

const API_ROOT = fileURLToPath(new URL("../../../api/", import.meta.url));
const TECH_DOCS_DIR = process.env.TECH_DOCS_DIR?.trim() || "a220-tech-docs";

export interface WikiSearchConfig {
  readonly indexPath: string;
}

export interface WikiIndexEntry {
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly ata_codes?: readonly string[];
  readonly zones?: readonly string[];
  readonly aliases?: readonly string[];
  readonly part_numbers?: readonly string[];
  readonly supporting_docs?: readonly string[];
}

export interface WikiSearchResult extends WikiIndexEntry {
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
  readonly wiki_rank: number;
  readonly wiki_score: number;
  readonly primary_doc: string | null;
}

export interface WikiSearchDebug {
  readonly indexReady: boolean;
  readonly queryTokens: readonly string[];
}

export const ENTITIES_WIKI_CONFIG: WikiSearchConfig = {
  indexPath: path.join(API_ROOT, "data", TECH_DOCS_DIR, "wiki", "index.json"),
};

function loadWikiIndex(config: WikiSearchConfig): readonly WikiIndexEntry[] {
  if (!existsSync(config.indexPath)) {
    return [];
  }
  return JSON.parse(readFileSync(config.indexPath, "utf8")) as WikiIndexEntry[];
}

function fieldTokens(values: readonly string[]): Set<string> {
  return new Set(values.flatMap((value) => tokenizeQuery(value)));
}

function buildEntrySearchText(entry: WikiIndexEntry): {
  readonly titleTokens: Set<string>;
  readonly metadataTokens: Set<string>;
} {
  return {
    titleTokens: fieldTokens([entry.title, ...(entry.aliases ?? [])]),
    metadataTokens: fieldTokens([
      ...(entry.ata_codes ?? []),
      ...(entry.zones ?? []),
      ...(entry.part_numbers ?? []),
      ...(entry.supporting_docs ?? []),
    ]),
  };
}

function scoreEntry(entry: WikiIndexEntry, queryTokens: readonly string[]): number {
  if (queryTokens.length === 0) {
    return 0;
  }
  const { titleTokens, metadataTokens } = buildEntrySearchText(entry);
  let score = 0;
  for (const token of queryTokens) {
    if (titleTokens.has(token)) {
      score += 3;
      continue;
    }
    if (metadataTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

export function searchWikiIndex(
  query: string,
  options: { readonly config?: WikiSearchConfig; readonly limit?: number } = {},
): {
  readonly results: readonly WikiSearchResult[];
  readonly debug: WikiSearchDebug;
} {
  const config = options.config ?? ENTITIES_WIKI_CONFIG;
  const index = loadWikiIndex(config);
  const queryTokens = tokenizeQuery(query);
  const ranked = index
    .map((entry) => ({
      entry,
      score: scoreEntry(entry, queryTokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
    .slice(0, options.limit ?? 8)
    .map((candidate, indexPosition) => ({
      ...candidate.entry,
      doc: candidate.entry.title,
      chunk_id: candidate.entry.slug,
      content: [
        ...(candidate.entry.ata_codes ?? []),
        ...(candidate.entry.zones ?? []),
        ...(candidate.entry.aliases ?? []),
      ].join(" · "),
      wiki_rank: indexPosition + 1,
      wiki_score: candidate.score,
      primary_doc: candidate.entry.supporting_docs?.[0] ?? null,
    }));

  return {
    results: ranked,
    debug: {
      indexReady: index.length > 0,
      queryTokens,
    },
  };
}
