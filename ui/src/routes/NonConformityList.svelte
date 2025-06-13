<script>
  import { createEventDispatcher } from "svelte";
  import {
    referencesList,
    filteredNonConformities,
    activeTabValue,
    selectItem,
  } from "./store.js";
  import { ripple } from "svelte-ripple-action";
  import Icon from '@iconify/svelte';

  export let nonConformities = [];
  export let num = 0;
  export let nonConformitiesFilter = [];

  const dispatch = createEventDispatcher();
  let searchQuery = "";

  const orderMap = nonConformitiesFilter.reduce((acc, item, index) => {
    acc[item.doc] = index;
    return acc;
  }, {});

  $: $filteredNonConformities = nonConformities
    .filter((item) =>
      nonConformitiesFilter.some((n) => n.doc === item["nc_event_id"]),
    )
    .map((item) => {
      item.highlights = nonConformitiesFilter
        .filter((n) => n.doc === item["nc_event_id"])
        .map((n) => n.content);
      return item;
    })
    .sort(
      (a, b) => orderMap[a["nc_event_id"]] - orderMap[b["nc_event_id"]],
    );
  // }

  $: num = $filteredNonConformities.length;

  $: console.log(nonConformitiesFilter);
</script>

<div class="scrollable">
  <ul style="list-style-type: none; padding: 0;">
    {#each $filteredNonConformities as item, index}
      <li class:selected={$selectItem === item && $activeTabValue === 3}>
        <button
          type="button"
          use:ripple={{
            color: "rgba(82, 54, 171, 0.2)",
            duration: 0.6,
          }}
          on:click={() => {
            $selectItem = item;
          }}
          on:keypress={(e) => {
            if (e.key === "Enter") {
              $selectItem = item;
            }
          }}
          style="cursor: pointer; padding: 8px; width: 100%; text-align: left; border: none; background: none;border-bottom: 1px solid rgba(0,0,0,.1)"
        >
          <strong
            >{item["ATA_code"]} - {item["ATA_category"]} - {item[
              "nc_event_date"
            ].slice(0, 10)}
          </strong>
          <p style="margin-top:0.2rem;margin-bottom:0;">
            {item["analysis_history"]["000"][0]["label"]}
          </p>
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .selected {
    border-left: 0.25rem solid;
    background: rgb(230, 227, 243);
    border-image: linear-gradient(rgb(227, 25, 55), rgb(82, 54, 171)) 0 100% /
      1 / 0 stretch;
  }
  li {
    padding: 0;
    border: none;
    list-style-type: none;
	border-left: 0.25rem solid rgb(0,0,0,0);
  }
  li:hover {
    background-color: rgb(230, 227, 243);
  }
  input {
    padding: 0.35rem !important;
    margin-bottom: 1rem;
    width: 22vw;
    font-size: 0.9rem;
  }
  .scrollable {
    overflow-y: auto;
    width: 100%;
	background: rgb(248, 248, 248);
  }

  .scrollable::-webkit-scrollbar {
    width: 12px; /* Width of the scrollbar */
  }

  .scrollable::-webkit-scrollbar-track {
    background: #f1f1f1; /* Background of the scrollbar track */
  }

  .scrollable::-webkit-scrollbar-thumb {
    background: #888; /* Color of the scrollbar thumb */
    border-radius: 10px; /* Rounded corners for the scrollbar thumb */
  }
</style>
