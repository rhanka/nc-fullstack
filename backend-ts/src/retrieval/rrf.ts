import path from "node:path";

export type RankedRetrievalItem = Record<string, unknown> & {
  readonly doc?: string;
  readonly chunk_id?: string;
  readonly content?: string;
};

export interface HybridSearchResult extends Record<string, unknown> {
  readonly doc: string;
  readonly chunk_id: string;
  readonly content: string;
  readonly retrieval_channels: readonly string[];
  readonly retrieval_rank: number;
  readonly rrf_score: number;
}

export function normalizeResultIdentity(item: RankedRetrievalItem): string {
  const token = String(item.doc ?? item.chunk_id ?? "").split(" ")[0] ?? "";
  return path.parse(token).name.toLowerCase();
}

export function mergeResultPayload(
  existing: RankedRetrievalItem,
  incoming: RankedRetrievalItem,
  channel: "vector" | "lexical",
): RankedRetrievalItem {
  const merged: RankedRetrievalItem = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in merged) || merged[key] == null || merged[key] === "") {
      merged[key] = value;
    }
  }

  if (channel === "vector" && typeof incoming.distance === "number") {
    merged.vector_distance = incoming.distance;
  }
  if (channel === "lexical" && typeof incoming.bm25_score === "number") {
    merged.lexical_score = incoming.bm25_score;
  }

  if (String(incoming.content ?? "").length > String(merged.content ?? "").length) {
    merged.content = incoming.content;
  }

  return merged;
}

export function reciprocalRankFuse(
  input: {
    readonly vectorResults: readonly RankedRetrievalItem[];
    readonly lexicalResults: readonly RankedRetrievalItem[];
    readonly finalLimit: number;
    readonly rrfK: number;
  },
): HybridSearchResult[] {
  const fused = new Map<
    string,
    {
      item: RankedRetrievalItem;
      rrfScore: number;
      bestRank: number;
      channels: Set<string>;
    }
  >();

  for (const [channelName, results] of [
    ["vector", input.vectorResults],
    ["lexical", input.lexicalResults],
  ] as const) {
    for (let rank = 0; rank < results.length; rank += 1) {
      const item = results[rank]!;
      const identity = normalizeResultIdentity(item);
      if (!identity) {
        continue;
      }

      const existing = fused.get(identity) ?? {
        item: { ...item },
        rrfScore: 0,
        bestRank: rank + 1,
        channels: new Set<string>(),
      };

      existing.item = mergeResultPayload(existing.item, item, channelName);
      existing.rrfScore += 1 / (input.rrfK + rank + 1);
      existing.bestRank = Math.min(existing.bestRank, rank + 1);
      existing.channels.add(channelName);
      fused.set(identity, existing);
    }
  }

  return [...fused.values()]
    .sort((left, right) => {
      if (right.rrfScore !== left.rrfScore) {
        return right.rrfScore - left.rrfScore;
      }
      if (left.bestRank !== right.bestRank) {
        return left.bestRank - right.bestRank;
      }
      return String(left.item.doc ?? "").localeCompare(String(right.item.doc ?? ""));
    })
    .slice(0, input.finalLimit)
    .map((entry, index) => ({
      ...(entry.item as RankedRetrievalItem),
      doc: String(entry.item.doc ?? entry.item.chunk_id ?? ""),
      chunk_id: String(entry.item.chunk_id ?? entry.item.doc ?? ""),
      content: String(entry.item.content ?? ""),
      retrieval_channels: [...entry.channels].sort(),
      rrf_score: Number(entry.rrfScore.toFixed(8)),
      retrieval_rank: index + 1,
    }));
}

export function reciprocalRankFuseBatches(
  rankedBatches: readonly (readonly RankedRetrievalItem[])[],
  channel: "vector" | "lexical",
  finalLimit: number,
  rrfK: number,
): RankedRetrievalItem[] {
  const fused = new Map<
    string,
    {
      item: RankedRetrievalItem;
      rrfScore: number;
      bestRank: number;
      queryBatchIndexes: Set<number>;
    }
  >();

  for (let batchIndex = 0; batchIndex < rankedBatches.length; batchIndex += 1) {
    const batch = rankedBatches[batchIndex]!;
    for (let rank = 0; rank < batch.length; rank += 1) {
      const item = batch[rank]!;
      const identity = normalizeResultIdentity(item);
      if (!identity) {
        continue;
      }

      const existing = fused.get(identity) ?? {
        item: { ...item },
        rrfScore: 0,
        bestRank: rank + 1,
        queryBatchIndexes: new Set<number>(),
      };
      existing.item = mergeResultPayload(existing.item, item, channel);
      existing.rrfScore += 1 / (rrfK + rank + 1);
      existing.bestRank = Math.min(existing.bestRank, rank + 1);
      existing.queryBatchIndexes.add(batchIndex + 1);
      fused.set(identity, existing);
    }
  }

  return [...fused.values()]
    .sort((left, right) => {
      if (right.rrfScore !== left.rrfScore) {
        return right.rrfScore - left.rrfScore;
      }
      if (left.bestRank !== right.bestRank) {
        return left.bestRank - right.bestRank;
      }
      return String(left.item.doc ?? "").localeCompare(String(right.item.doc ?? ""));
    })
    .slice(0, finalLimit)
    .map((entry, index) => ({
      ...entry.item,
      [`${channel}_rrf_score`]: Number(entry.rrfScore.toFixed(8)),
      [`${channel}_variant_hits`]: entry.queryBatchIndexes.size,
      [`${channel}_rank`]: index + 1,
    }));
}
