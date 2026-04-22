export type EntityRelationshipGroupKey =
  | "same_answer"
  | "image_linked"
  | "same_document"
  | "same_ata"
  | "same_zone";

export type EntityRelationshipSource = {
  readonly slug?: unknown;
  readonly title?: unknown;
  readonly doc?: unknown;
  readonly chunk_id?: unknown;
  readonly path?: unknown;
  readonly ata_codes?: unknown;
  readonly zones?: unknown;
  readonly supporting_docs?: unknown;
  readonly linked_images?: unknown;
};

export type EntityRelationshipGroupItem = {
  readonly key: string;
  readonly title: string;
  readonly source: EntityRelationshipSource;
};

export type EntityRelationshipGroup = {
  readonly key: EntityRelationshipGroupKey;
  readonly label: string;
  readonly items: readonly EntityRelationshipGroupItem[];
};

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => textValue(entry)).filter((entry): entry is string => Boolean(entry));
  }

  const single = textValue(value);
  return single ? [single] : [];
}

function entityKey(item: EntityRelationshipSource): string {
  return (
    textValue(item.path) ??
    textValue(item.slug) ??
    textValue(item.doc) ??
    textValue(item.title) ??
    textValue(item.chunk_id) ??
    ""
  );
}

function titleFor(item: EntityRelationshipSource): string {
  return textValue(item.title) ?? textValue(item.doc) ?? textValue(item.chunk_id) ?? "Untitled entity";
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.toLowerCase().trim()).filter(Boolean));
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function linkedImageKeys(item: EntityRelationshipSource): string[] {
  if (!Array.isArray(item.linked_images)) {
    return [];
  }

  return item.linked_images
    .filter((image): image is Record<string, unknown> => Boolean(image && typeof image === "object"))
    .map((image) => textValue(image.id) ?? textValue(image.asset_path) ?? textValue(image.doc))
    .filter((value): value is string => Boolean(value));
}

function toGroupItem(source: EntityRelationshipSource): EntityRelationshipGroupItem {
  return {
    key: entityKey(source),
    title: titleFor(source),
    source,
  };
}

function takeItems(
  candidates: readonly EntityRelationshipSource[],
  predicate: (candidate: EntityRelationshipSource) => boolean,
  limit: number,
): EntityRelationshipGroupItem[] {
  return candidates.filter(predicate).slice(0, limit).map(toGroupItem);
}

export function buildEntityRelationshipGroups(
  selected: EntityRelationshipSource | null,
  entities: readonly EntityRelationshipSource[],
  limitPerGroup = 10,
): EntityRelationshipGroup[] {
  if (!selected) {
    return [];
  }

  const selectedKey = entityKey(selected);
  const candidates = entities.filter((entity) => entityKey(entity) && entityKey(entity) !== selectedKey);
  const selectedImages = normalizedSet(linkedImageKeys(selected));
  const selectedDocs = normalizedSet(textArray(selected.supporting_docs));
  const selectedAtaCodes = normalizedSet(textArray(selected.ata_codes));
  const selectedZones = normalizedSet(textArray(selected.zones));

  const groups: EntityRelationshipGroup[] = [
    {
      key: "same_answer",
      label: "Same answer",
      items: candidates.slice(0, limitPerGroup).map(toGroupItem),
    },
    {
      key: "image_linked",
      label: "Image-linked",
      items: takeItems(
        candidates,
        (candidate) => selectedImages.size > 0 && intersects(selectedImages, normalizedSet(linkedImageKeys(candidate))),
        limitPerGroup,
      ),
    },
    {
      key: "same_document",
      label: "Same document",
      items: takeItems(
        candidates,
        (candidate) => selectedDocs.size > 0 && intersects(selectedDocs, normalizedSet(textArray(candidate.supporting_docs))),
        limitPerGroup,
      ),
    },
    {
      key: "same_ata",
      label: "Same ATA",
      items: takeItems(
        candidates,
        (candidate) => selectedAtaCodes.size > 0 && intersects(selectedAtaCodes, normalizedSet(textArray(candidate.ata_codes))),
        limitPerGroup,
      ),
    },
    {
      key: "same_zone",
      label: "Same zone",
      items: takeItems(
        candidates,
        (candidate) => selectedZones.size > 0 && intersects(selectedZones, normalizedSet(textArray(candidate.zones))),
        limitPerGroup,
      ),
    },
  ];

  return groups.filter((group) => group.items.length > 0);
}
