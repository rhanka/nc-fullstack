<script>
  import NonConformityTaskCreation from "./NonConformityTaskCreation.svelte";
  import Input from "./Input.svelte";
  import {
    resetCreatedItem,
    createdItem,
    updateCreatedItem,
  } from "./store.js";
  import Icon from '@iconify/svelte';

  let taskMask = null;

  $: if ($updateCreatedItem) {
    $createdItem.analysis_history[$updateCreatedItem.role][0].label =
      $updateCreatedItem.label;
    $createdItem.analysis_history[$updateCreatedItem.role][0].description =
      $updateCreatedItem.description;
    $updateCreatedItem = null;
  }

  $: if ($createdItem && $createdItem.analysis_history) {
    $createdItem = $createdItem;
    taskMask = Object.keys($createdItem.analysis_history).sort(
      (a, b) => a - b,
    )[
      Object.keys($createdItem.analysis_history)
        .sort((a, b) => a - b)
        .filter(
          (task) =>
            $createdItem.analysis_history[task].length > 0 &&
            $createdItem.analysis_history[task][0].validated,
        ).length
    ];
  }

  // Directive to inject HTML
  function html(node, htmlContent) {
    node.innerHTML = htmlContent;

    return {
      update(newHtml) {
        node.innerHTML = newHtml;
      },
    };
  }
</script>

<div
  style="margin-top:-16px;padding-left: 16px;padding-right: 8px; background-color: #f9f9f9;"
>
  {#if $createdItem && $createdItem.analysis_history}

    <h2
      style="display: flex;justify-content: space-between;align-items:center"
    >
      <div>
        <Input
          label="Part Number"
          bind:value={$createdItem["part_num"]}
        /> -
        <Input
          label="Date"
          bind:value={$createdItem["nc_event_date"]}
        />
      </div>
      <div style="align:right;padding-right:0.5rem">
        <button
          style="cursor:pointer;align:right;border:none;background:none;"
          on:click={resetCreatedItem}
        >
		  <Icon icon="mdi:trash-can-outline" height={24}/>
        </button>
      </div>
    </h2>
    <Input label="Role" bind:value={$createdItem["role"]} /> -
    <Input label="Author" bind:value={$createdItem["name"]} />
    <h3>Tasks:</h3>
    {#each ["000", "100", "200", "300", "400", "500"].filter((t) => t <= taskMask) as task}
      <NonConformityTaskCreation
        dropzone={task === "000"}
        expand={task === "000"}
        aiHelp={["000", "100"].includes(task)}
        {task}
        bind:history={$createdItem.analysis_history[task]}
      ></NonConformityTaskCreation>
    {/each}
  {/if}
</div>

<style>
  li:hover {
    background-color: #f0f0f0;
  }
</style>
