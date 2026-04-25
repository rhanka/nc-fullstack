<script lang="ts">
  import type { ReferenceSourceItem } from "$lib/chat/contracts";
  import { buildEntityListEntry, entitySelectionKey } from "$lib/entities/entity-ui";
  import { activeTabValue, selectEntity } from "./store";

  export let entitiesList: ReferenceSourceItem[] = [];

  function isSelected(item: ReferenceSourceItem): boolean {
    return entitySelectionKey($selectEntity) === entitySelectionKey(item);
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
        {@const entry = buildEntityListEntry(entity, index)}
        <li class:selected={isSelected(entity)}>
          <button
            type="button"
            on:click={() => select(entity)}
            aria-label={entry.ariaLabel}
          >
            <span class="entities-list__header">
              <strong>{entry.title}</strong>
              <span>{entry.rankLabel}</span>
            </span>

            {#if entry.meta}
              <span class="entities-list__meta">{entry.meta}</span>
            {/if}

            {#if entry.alias}
              <span class="entities-list__line">Alias: {entry.alias}</span>
            {/if}

            {#if entry.docsLabel}
              <span class="entities-list__docs">{entry.docsLabel}</span>
            {/if}

            {#if entry.imagesLabel}
              <span class="entities-list__images">{entry.imagesLabel}</span>
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
  .entities-list__docs,
  .entities-list__images {
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

  .entities-list__images {
    color: #0f766e;
    font-weight: 600;
  }
</style>
