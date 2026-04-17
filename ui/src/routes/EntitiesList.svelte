<script lang="ts">
  import type { ReferenceSourceItem } from "$lib/chat/contracts";
  import { activeTabValue, selectEntity } from "./store";

  type EntitySourceItem = ReferenceSourceItem & {
    readonly title?: unknown;
    readonly ata_codes?: unknown;
    readonly zones?: unknown;
    readonly aliases?: unknown;
    readonly part_numbers?: unknown;
    readonly supporting_docs?: unknown;
    readonly primary_doc?: unknown;
  };

  export let entitiesList: ReferenceSourceItem[] = [];

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

  function entityKey(item: ReferenceSourceItem | null): string | null {
    if (!item) {
      return null;
    }

    const entity = asEntity(item) as EntitySourceItem & { readonly path?: unknown; readonly slug?: unknown };
    for (const value of [entity.path, entity.slug, entity.doc, entity.title, entity.chunk_id]) {
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return null;
  }

  function isSelected(item: ReferenceSourceItem): boolean {
    return entityKey($selectEntity) === entityKey(item);
  }

  function titleFor(item: ReferenceSourceItem): string {
    const entity = asEntity(item);
    return textValue(entity.title) ?? textValue(entity.doc) ?? textValue(entity.chunk_id) ?? "Untitled entity";
  }

  function metaFor(item: ReferenceSourceItem): string {
    const entity = asEntity(item);
    const ataCodes = textArray(entity.ata_codes);
    const zones = textArray(entity.zones).map((zone) => "Zone " + zone);
    return [...ataCodes, ...zones].slice(0, 3).join(" / ");
  }

  function aliasFor(item: ReferenceSourceItem): string {
    return compact(textArray(asEntity(item).aliases), 2);
  }

  function docsFor(item: ReferenceSourceItem): string {
    const entity = asEntity(item);
    const supportingDocs = textArray(entity.supporting_docs);
    const hasPrimary = Boolean(textValue(entity.primary_doc));
    const total = supportingDocs.length + (hasPrimary ? 1 : 0);

    if (total === 0) {
      return "";
    }

    return String(total) + " doc" + (total === 1 ? "" : "s");
  }

  function select(item: ReferenceSourceItem): void {
    selectEntity.set(item);
    activeTabValue.set(4);
  }
</script>

<div class="entities-list">
  {#if entitiesList.length === 0}
    <p class="entities-list__empty">No entities retrieved for the current answer.</p>
  {:else}
    <ul>
      {#each entitiesList as entity, index}
        <li class:selected={isSelected(entity)}>
          <button
            type="button"
            on:click={() => select(entity)}
            aria-label={"Open entity " + titleFor(entity)}
          >
            <span class="entities-list__header">
              <strong>{titleFor(entity)}</strong>
              <span>#{index + 1}</span>
            </span>

            {#if metaFor(entity)}
              <span class="entities-list__meta">{metaFor(entity)}</span>
            {/if}

            {#if aliasFor(entity)}
              <span class="entities-list__line">Alias: {aliasFor(entity)}</span>
            {/if}

            {#if docsFor(entity)}
              <span class="entities-list__docs">{docsFor(entity)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .entities-list {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: rgb(248, 248, 248);
  }

  .entities-list__empty {
    margin: 0;
    padding: 1rem;
    color: #667085;
    font-size: 0.85rem;
  }

  ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
  }

  li {
    border-left: 0.25rem solid transparent;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  }

  li:hover {
    background: rgb(230, 227, 243);
  }

  li.selected {
    border-left-color: rgb(19, 61, 94);
    background: rgb(230, 227, 243);
  }

  button {
    width: 100%;
    border: none;
    background: transparent;
    cursor: pointer;
    text-align: left;
    padding: 0.72rem 0.8rem;
    color: #101828;
  }

  .entities-list__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.82rem;
    line-height: 1.25;
  }

  .entities-list__header span {
    flex: 0 0 auto;
    color: #667085;
    font-size: 0.72rem;
  }

  .entities-list__meta,
  .entities-list__line,
  .entities-list__docs {
    display: block;
    margin-top: 0.25rem;
    color: #475467;
    font-size: 0.75rem;
    line-height: 1.3;
  }

  .entities-list__docs {
    color: #2563eb;
    font-weight: 600;
  }
</style>
