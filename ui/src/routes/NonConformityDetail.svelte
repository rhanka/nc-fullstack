<script>
  import NonConformityTask from "./NonConformityTask.svelte";

  export let selectedItem;
</script>

{#if selectedItem}
<div
  class="non-conformity-detail"
  style="padding-left: 16px;padding-right: 8px; background-color: #f9f9f9;"
>
  <button
    type="button"
    style="cursor: pointer; padding: 8px; width: 100%; text-align: left; border: none; background: none;"
  >
    <h2>
      <span style="margin-left:-16px; padding: 0 8px; color: #aaa" title="close"
        ></span
      >
      {selectedItem["ATA_category"]} - {selectedItem["nc_event_id"]} - {selectedItem["analysis_history"]["000"][0]["date"].replace(/:..\..*/, "")}
    </h2>
  </button>
  <p><strong>{selectedItem["analysis_history"]["000"][0]["label"]}</strong></p>
  <h3>Status History:</h3>
  {#each ["000", "100", "200", "300", "400", "500"] as task}
    <NonConformityTask
      expand={["000", "500"].includes(task)}
      {task}
      history={selectedItem["analysis_history"][task]}
      highlights={selectedItem.highlights}
    ></NonConformityTask>
  {/each}
</div>
{/if}

<style>
  li:hover {
    background-color: #f0f0f0;
  }
  mark {
    background-color: yellow;
    font-weight: bold;
  }
</style>
