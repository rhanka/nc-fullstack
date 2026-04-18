<script lang="ts">
  import { marked } from "marked";
  import Icon from "@iconify/svelte";
  import { getApiBaseUrl } from "$lib/api-base";
  import type { ReferenceSourceItem } from "$lib/chat/contracts";
  import { activeTabValue, selectDoc, selectEntity } from "./store";

  type EntitySourceItem = ReferenceSourceItem & {
    readonly slug?: unknown;
    readonly title?: unknown;
    readonly path?: unknown;
    readonly ata_codes?: unknown;
    readonly zones?: unknown;
    readonly aliases?: unknown;
    readonly part_numbers?: unknown;
    readonly supporting_docs?: unknown;
    readonly primary_doc?: unknown;
  };

  type EntityArticle = {
    readonly path?: string;
    readonly markdown?: string;
    readonly detail?: string;
  };

  export let selectedEntity: ReferenceSourceItem | null = null;
  export let entitiesList: ReferenceSourceItem[] = [];

  const apiBaseUrl = getApiBaseUrl();

  let article: EntityArticle | null = null;
  let articlePath: string | null = null;
  let articleError: string | null = null;
  let articleLoading = false;

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

  function compact(values: string[], limit = 4): string {
    if (values.length <= limit) {
      return values.join(", ");
    }

    return values.slice(0, limit).join(", ") + " +" + String(values.length - limit);
  }

  function entityKey(item: ReferenceSourceItem | null): string | null {
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

  function titleFor(item: ReferenceSourceItem | null): string {
    if (!item) {
      return "No entity selected";
    }

    const entity = asEntity(item);
    return textValue(entity.title) ?? textValue(entity.doc) ?? textValue(entity.chunk_id) ?? "Untitled entity";
  }

  function pathFor(item: ReferenceSourceItem | null): string | null {
    if (!item) {
      return null;
    }

    const entity = asEntity(item);
    return textValue(entity.path) ?? textValue(entity.slug);
  }

  function primaryDocFor(item: ReferenceSourceItem | null): string | null {
    return item ? textValue(asEntity(item).primary_doc) : null;
  }

  function supportingDocsFor(item: ReferenceSourceItem | null): string[] {
    return item ? textArray(asEntity(item).supporting_docs) : [];
  }

  function metadataFor(item: ReferenceSourceItem | null): string {
    if (!item) {
      return "";
    }

    const entity = asEntity(item);
    const ataCodes = textArray(entity.ata_codes);
    const zones = textArray(entity.zones).map((zone) => "Zone " + zone);
    return [...ataCodes, ...zones].join(" / ");
  }

  function aliasFor(item: ReferenceSourceItem | null): string {
    return item ? compact(textArray(asEntity(item).aliases), 4) : "";
  }

  function partNumbersFor(item: ReferenceSourceItem | null): string {
    return item ? compact(textArray(asEntity(item).part_numbers), 5) : "";
  }

  function articleBody(markdown: string | undefined): string {
    if (!markdown) {
      return "";
    }

    return markdown
      .replace(/^# .*(\r?\n)+/u, "")
      .replace(/\r?\n## Technical documents[\s\S]*$/u, "")
      .trim();
  }

  function renderMarkdown(markdown: string | undefined): string {
    return marked.parse(articleBody(markdown)) as string;
  }

  function openDocument(doc: string | null): void {
    if (!doc) {
      return;
    }

    selectDoc.set({ doc });
    activeTabValue.set(2);
  }

  function openRelated(entity: ReferenceSourceItem): void {
    selectEntity.set(entity);
    activeTabValue.set(4);
  }

  async function loadArticle(nextPath: string): Promise<void> {
    articleLoading = true;
    articleError = null;
    article = null;
    articlePath = nextPath;

    try {
      const response = await fetch(apiBaseUrl + "/wiki/" + encodeURIComponent(nextPath));
      const payload = (await response.json()) as EntityArticle;

      if (!response.ok) {
        const detail = payload.detail?.replace(/Wiki page/gu, "Entity notes").replace(/wiki path/gu, "entity path");
        throw new Error(detail ?? "Entity article not found.");
      }

      article = payload;
    } catch (error) {
      articleError = error instanceof Error ? error.message : String(error);
    } finally {
      articleLoading = false;
    }
  }

  $: selectedPath = pathFor(selectedEntity);
  $: selectedPrimaryDoc = primaryDocFor(selectedEntity);
  $: selectedSupportingDocs = supportingDocsFor(selectedEntity);
  $: selectedEntityKey = entityKey(selectedEntity);
  $: relatedEntities = entitiesList.filter((entity) => entityKey(entity) !== selectedEntityKey).slice(0, 10);

  $: if (selectedPath && selectedPath !== articlePath) {
    void loadArticle(selectedPath);
  }

  $: if (!selectedPath) {
    article = null;
    articlePath = null;
    articleError = null;
    articleLoading = false;
  }
</script>

<section class="entity-detail">
  {#if !selectedEntity}
    <div class="entity-detail__empty">
      <Icon icon="mdi:vector-link" height="2rem" />
      <h2>Entities</h2>
      <p>Select an entity from the left drawer or from the chat sources.</p>
    </div>
  {:else}
    <header class="entity-detail__header">
      <p class="entity-detail__eyebrow">Entity</p>
      <h1>{titleFor(selectedEntity)}</h1>
      <span class="entity-detail__badge">Used in current answer</span>

      {#if metadataFor(selectedEntity)}
        <p class="entity-detail__meta">{metadataFor(selectedEntity)}</p>
      {/if}

      {#if aliasFor(selectedEntity)}
        <p class="entity-detail__line"><strong>Aliases:</strong> {aliasFor(selectedEntity)}</p>
      {/if}

      {#if partNumbersFor(selectedEntity)}
        <p class="entity-detail__line"><strong>Part numbers:</strong> {partNumbersFor(selectedEntity)}</p>
      {/if}

      {#if selectedPrimaryDoc}
        <button type="button" class="entity-detail__primary-action" on:click={() => openDocument(selectedPrimaryDoc)}>
          Open primary document
        </button>
      {/if}
    </header>

    <section class="entity-detail__card">
      <h2>Entity notes</h2>

      {#if articleLoading}
        <p class="entity-detail__muted">Loading entity notes...</p>
      {:else if articleError}
        <p class="entity-detail__error">{articleError}</p>
      {:else if article?.markdown}
        <div class="entity-detail__markdown">
          {@html renderMarkdown(article.markdown)}
        </div>
      {:else}
        <p class="entity-detail__muted">No article available for this entity.</p>
      {/if}
    </section>

    {#if selectedSupportingDocs.length > 0}
      <details class="entity-detail__card" open>
        <summary>Supporting documents ({selectedSupportingDocs.length})</summary>
        <div class="entity-detail__doc-list">
          {#each selectedSupportingDocs as doc}
            <button type="button" on:click={() => openDocument(doc)}>{doc}</button>
          {/each}
        </div>
      </details>
    {/if}

    {#if relatedEntities.length > 0}
      <details class="entity-detail__card">
        <summary>Related entities found in this answer ({relatedEntities.length})</summary>
        <div class="entity-detail__related-list">
          {#each relatedEntities as entity}
            <button type="button" on:click={() => openRelated(entity)}>{titleFor(entity)}</button>
          {/each}
        </div>
      </details>
    {/if}

  {/if}
</section>

<style>
  .entity-detail {
    box-sizing: border-box;
    min-height: calc(100vh - 5rem);
    padding: 1.4rem;
    background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
    color: #101828;
  }

  .entity-detail__empty {
    max-width: 34rem;
    margin: 7rem auto 0;
    padding: 2rem;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.9);
    text-align: center;
    color: #475467;
  }

  .entity-detail__empty h2,
  .entity-detail__header h1 {
    color: #101828;
  }

  .entity-detail__header,
  .entity-detail__card {
    max-width: 56rem;
    margin: 0 auto 1rem;
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 14px 36px rgba(15, 23, 42, 0.07);
  }

  .entity-detail__header {
    padding: 1.2rem 1.25rem;
  }

  .entity-detail__card {
    padding: 1rem 1.25rem;
  }

  .entity-detail__eyebrow {
    margin: 0 0 0.25rem;
    color: #667085;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 1.3rem;
    line-height: 1.25;
  }

  h2 {
    margin: 0 0 0.65rem;
    font-size: 0.95rem;
  }

  .entity-detail__badge {
    display: inline-flex;
    margin-top: 0.65rem;
    border-radius: 999px;
    background: #e0f2fe;
    color: #075985;
    padding: 0.22rem 0.55rem;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .entity-detail__meta,
  .entity-detail__line,
  .entity-detail__muted,
  .entity-detail__error {
    margin: 0.65rem 0 0;
    color: #475467;
    font-size: 0.9rem;
    line-height: 1.45;
  }

  .entity-detail__error {
    color: #b42318;
  }

  .entity-detail__primary-action,
  .entity-detail__doc-list button,
  .entity-detail__related-list button {
    border: 1px solid rgba(37, 99, 235, 0.18);
    border-radius: 999px;
    background: #eff6ff;
    color: #1d4ed8;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
  }

  .entity-detail__primary-action {
    margin-top: 0.85rem;
    padding: 0.48rem 0.75rem;
  }

  summary {
    cursor: pointer;
    font-weight: 700;
    font-size: 0.9rem;
  }

  .entity-detail__doc-list,
  .entity-detail__related-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.85rem;
  }

  .entity-detail__doc-list button,
  .entity-detail__related-list button {
    padding: 0.42rem 0.65rem;
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  .entity-detail__markdown {
    color: #344054;
    font-size: 0.92rem;
    line-height: 1.55;
  }

  .entity-detail__markdown :global(p:first-child) {
    margin-top: 0;
  }

  .entity-detail__markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  @media (max-width: 768px) {
    .entity-detail {
      padding: 1rem;
    }

    .entity-detail__empty {
      margin-top: 3rem;
    }
  }
</style>
