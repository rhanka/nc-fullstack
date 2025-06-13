<script>
  import {
    createdItem,
    resetCreatedItem,
    taskLabel
  } from "./store.js";
  import { ripple } from "svelte-ripple-action";
  import Icon from '@iconify/svelte';

  let taskMask = null;

  $: if ($createdItem && $createdItem.analysis_history) {
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
</script>

<div class="scrollable">
  <ul style="list-style-type: none; padding: 0;">
    {#each ["000", "100", "200", "300", "400", "500"].filter((t) => t <= taskMask) as task}
      <li class:selected={task === $createdItem.currentTask}>
        <button
          type="button"
          use:ripple={{
            color: "rgba(82, 54, 171, 0.2)",
            duration: 0.6,
          }}
          on:click={() => {
            $createdItem.currentTask = task;
          }}
          on:keypress={(e) => {
            if (e.key === "Enter") {
              $createdItem.currentTask = task;
            }
          }}
          style="cursor: pointer; padding: 8px; width: 100%; text-align: left; border: none; background: none;border-bottom: 1px solid rgba(0,0,0,.1)"
        >
          <strong
            >{taskLabel[task]}
          </strong>
          <p style="margin-top:0.2rem;margin-bottom:0;">
            {$createdItem.analysis_history[task][0] && $createdItem.analysis_history[task][0].label || ''}
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
