<!-- src/routes/Menu.svelte -->
<script>
  import { createEventDispatcher } from "svelte";
  import Icon from "@iconify/svelte";
  import { accessToken } from "./store.js";

  const dispatch = createEventDispatcher();

  function openLogin() {
    dispatch("changeView", { view: "login" });
  }
</script>

<div class="menu">
  {#if $accessToken}
    <button
      on:click={() => {
        $accessToken = null;
      }}
    >
      <Icon icon="mdi:logout" height="1.5rem" />
    </button>
  {:else}
    <button on:click={openLogin}>
      <Icon icon="mdi:login" height="1.5rem" />
    </button>
  {/if}
</div>

<style>
  .menu {
    position: absolute;
    top: 1rem;
    right: 0.25rem;
    z-index: 100;
  }
  button {
    margin: 5px;
    border: none;
    background: none;
    cursor: pointer;
  }
</style>
