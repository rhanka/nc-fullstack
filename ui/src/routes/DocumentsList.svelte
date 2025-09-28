<script>
  import { createEventDispatcher } from "svelte";
  import { marked } from "marked"; // Import the marked library
  import {
    referencesList,
    selectDoc,
    activeTabValue,
  } from "./store";
  import { ripple } from "svelte-ripple-action";
  import Icon from '@iconify/svelte';

  export let documentsList = [];
  const dispatch = createEventDispatcher();
  let searchQuery = "";
</script>

<div class="scrollable">
  <ul style="list-style-type: none; padding: 0;">
    {#each documentsList as doc, index}
      <li class:selected={$selectDoc === doc && $activeTabValue === 2}>
        <button
          type="button"
          use:ripple={{ color: "rgba(82, 54, 171, 0.2)", duration: 0.6 }}
          on:click={() => {
            $selectDoc = doc;
          }}
          on:keypress={(e) => {
            if (e.key === "Enter") {
              $selectDoc = doc;
            }
          }}
          style="cursor: pointer; padding: 8px; width: 100%; text-align: left; border: none; background: none;border-bottom: 1px solid rgba(0,0,0,.1)"
        >
          <strong
            >{doc.doc}
          </strong>
          <p style="margin-top:0.2rem;margin-bottom:0rem;">
            {doc.chunks[0].chunk.slice(0, 100)}...
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
    border-image: linear-gradient(rgb(19, 61, 94), rgb(113, 139, 158)) 0 100% / 1 /
      0 stretch;
  }
  li {
    padding: 0;
    border: none;
    list-style-type: none;
  	border-left: 0.25rem solid rgb(0,0,0,0);
    background: rgb(248, 248, 248);
  }
  li:hover {
    background-color: rgb(230, 227, 243);
  }
  input {
    padding: 0.35rem !important;
    margin-left: -8px !important;
    font-size: 0.9rem;
  }

  .scrollable {
    overflow-y: auto;
    overflow-x: hidden;
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
