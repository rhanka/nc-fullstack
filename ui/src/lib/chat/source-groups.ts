import type { ReferenceSourceGroup, ReferenceSourceItem, ReferenceSources } from "./contracts.ts";

export type ChatSourceGroupKey = "tech_docs" | "non_conformities" | "entities_wiki";

export type ChatSourceGroup = {
  readonly key: ChatSourceGroupKey;
  readonly label: string;
  readonly items: ReferenceSourceItem[];
};

function asItems(group: ReferenceSourceGroup | undefined): ReferenceSourceItem[] {
  return Array.isArray(group?.sources) ? [...group.sources] as ReferenceSourceItem[] : [];
}

export function buildChatSourceGroups(sources: ReferenceSources | null | undefined): ChatSourceGroup[] {
  return [
    {
      key: "tech_docs",
      label: "Technical documents",
      items: asItems(sources?.tech_docs),
    },
    {
      key: "non_conformities",
      label: "Similar non-conformities",
      items: asItems(sources?.non_conformities),
    },
    {
      key: "entities_wiki",
      label: "Entities",
      items: asItems(sources?.entities_wiki),
    },
  ].filter((group) => group.items.length > 0);
}

export function getChatSourceCount(sources: ReferenceSources | null | undefined): number {
  return buildChatSourceGroups(sources).reduce((total, group) => total + group.items.length, 0);
}
