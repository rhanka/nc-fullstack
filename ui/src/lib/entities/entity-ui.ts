import type { ReferenceSourceItem } from "../chat/contracts.ts";

export type EntityLinkedImageRecord = {
  readonly id?: unknown;
  readonly doc?: unknown;
  readonly asset_path?: unknown;
  readonly [key: string]: unknown;
};

type EntitySourceItem = ReferenceSourceItem & {
  readonly path?: unknown;
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly ata_codes?: unknown;
  readonly zones?: unknown;
  readonly aliases?: unknown;
  readonly part_numbers?: unknown;
  readonly supporting_docs?: unknown;
  readonly primary_doc?: unknown;
  readonly linked_images?: unknown;
};

function asEntity(item: ReferenceSourceItem): EntitySourceItem {
  return item as EntitySourceItem;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => textValue(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const single = textValue(value);
  return single ? [single] : [];
}

function compact(values: string[], limit = 2): string {
  if (values.length <= limit) {
    return values.join(", ");
  }

  return values.slice(0, limit).join(", ") + " +" + String(values.length - limit);
}

export function entitySelectionKey(item: ReferenceSourceItem | null | undefined): string | null {
  if (!item) {
    return null;
  }

  const entity = asEntity(item);
  for (const value of [entity.path, entity.slug, entity.doc, entity.title, entity.chunk_id]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function entityHasLinkedImages(item: ReferenceSourceItem | null | undefined): boolean {
  if (!item) {
    return false;
  }

  const linkedImages = asEntity(item).linked_images;
  return Array.isArray(linkedImages) && linkedImages.some((image) => Boolean(image && typeof image === "object"));
}

export function chooseSelectedEntity(
  entities: readonly ReferenceSourceItem[],
  current: ReferenceSourceItem | null | undefined,
): ReferenceSourceItem | null {
  if (entities.length === 0) {
    return null;
  }

  const currentKey = entitySelectionKey(current);
  if (currentKey) {
    const selected = entities.find((entity) => entitySelectionKey(entity) === currentKey);
    if (selected) {
      return selected;
    }
  }

  return entities.find((entity) => entityHasLinkedImages(entity)) ?? entities[0] ?? null;
}

export function getEntityTitle(item: ReferenceSourceItem | null | undefined): string {
  if (!item) {
    return "Untitled entity";
  }

  const entity = asEntity(item);
  return textValue(entity.title) ?? textValue(entity.doc) ?? textValue(entity.chunk_id) ?? "Untitled entity";
}

export function getEntityMetadata(item: ReferenceSourceItem | null | undefined, limit = 3): string {
  if (!item) {
    return "";
  }

  const entity = asEntity(item);
  const ataCodes = textArray(entity.ata_codes);
  const zones = textArray(entity.zones).map((zone) => "Zone " + zone);
  return [...ataCodes, ...zones].slice(0, limit).join(" / ");
}

export function getEntityAliasLine(item: ReferenceSourceItem | null | undefined, limit = 2): string {
  if (!item) {
    return "";
  }

  return compact(textArray(asEntity(item).aliases), limit);
}

export function getEntityPartNumberLine(item: ReferenceSourceItem | null | undefined, limit = 4): string {
  if (!item) {
    return "";
  }

  return compact(textArray(asEntity(item).part_numbers), limit);
}

export function getEntityPrimaryDoc(item: ReferenceSourceItem | null | undefined): string | null {
  return item ? textValue(asEntity(item).primary_doc) : null;
}

export function getEntitySupportingDocs(item: ReferenceSourceItem | null | undefined): string[] {
  return item ? textArray(asEntity(item).supporting_docs) : [];
}

export function getEntityDocsLabel(item: ReferenceSourceItem | null | undefined): string {
  const docs = new Set(getEntitySupportingDocs(item));
  const primaryDoc = getEntityPrimaryDoc(item);
  if (primaryDoc) {
    docs.add(primaryDoc);
  }

  const total = docs.size;
  if (total === 0) {
    return "";
  }

  return String(total) + " doc" + (total === 1 ? "" : "s");
}

export function getLinkedImages(item: ReferenceSourceItem | null | undefined): EntityLinkedImageRecord[] {
  const linkedImages = item ? asEntity(item).linked_images : null;
  if (!Array.isArray(linkedImages)) {
    return [];
  }

  const seenKeys = new Set<string>();
  return linkedImages
    .filter((image): image is EntityLinkedImageRecord => Boolean(image && typeof image === "object"))
    .filter((image) => Boolean(textValue(image.asset_path) || textValue(image.doc)))
    .filter((image) => {
      const key =
        textValue(image.asset_path) ??
        [textValue(image.doc), textValue(image.id)].filter(Boolean).join(":");
      if (!key || seenKeys.has(key)) {
        return false;
      }
      seenKeys.add(key);
      return true;
    });
}

export function getEntityImagesLabel(item: ReferenceSourceItem | null | undefined): string {
  const total = getLinkedImages(item).length;
  if (total === 0) {
    return "";
  }

  return String(total) + " image" + (total === 1 ? "" : "s");
}

export function buildEntityListEntry(item: ReferenceSourceItem, index: number) {
  const title = getEntityTitle(item);
  return {
    title,
    rankLabel: "#" + String(index + 1),
    meta: getEntityMetadata(item),
    alias: getEntityAliasLine(item),
    docsLabel: getEntityDocsLabel(item),
    imagesLabel: getEntityImagesLabel(item),
    ariaLabel: "Open entity " + title,
  };
}
