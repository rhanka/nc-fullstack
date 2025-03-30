<script>
  import Icon from "@iconify/svelte";
  export let expand = false;
</script>

<div
  class="Rail"
>
  <nav
    class="RailNav"
  >
    <div
      class="expand"
    >
      <button
        style="cursor:pointer;align:right;border:none;padding:0.1rem;background:none;"
        on:click={() => {expand=!expand;}}
      >
        <Icon icon="mdi:chevron-{expand ? "left" : "right"}" height="1.25rem"/>
      </button>
    </div>
    <div
      class="expand-mobile"
    >
      <button
        style="cursor:pointer;align:right;border:none;padding:0.1rem;background:none;"
        on:click={() => {expand=!expand;}}
      >
        <Icon icon="mdi:chevron-{expand ? "up" : "down"}" height="1.25rem"/>
      </button>
    </div>
    <slot />
  </nav>
</div>

<style>
  .expand {
    position: relative;
    top: -1.25rem;
    display:flex;
    align-items:right;
    flex-direction: row-reverse;
    height: 0;
  }
  @media (max-width: 768px) {
    .expand {
      display: none!important;
    }
  }

  @media (min-width: 768px) {
    .expand-mobile {
      display: none!important;
   }
  }
  .expand-mobile {
    position: relative;
    left: -0.5rem;
    display:flex;
    align-items:end;
    flex-direction: column-reverse;
    height: 100%;
  }
  /* Default (Desktop) Styles - Vertical Rail */
  .Rail {
    display: flex;
    position: fixed;
    top: 5rem;
    flex-direction: column;
    justify-content: space-between;
    height: 100%;
    background: var(--mio-theme-color-surface-2);
    overflow-y: auto;
    background: #fff;
    filter: drop-shadow(rgba(104, 114, 116, 0.267) 0px 2px 5px);
    z-index: 200;
  }

  .RailNav {
    display: flex;
    flex-direction: column;
    width: 5rem;
    margin-top: 20px;
  }


  /* -------------------------- */
  /* Mobile Styles (<= 768px)   */
  /* -------------------------- */
  @media (max-width: 768px) {
    /* Adjust the container to be a top bar */
    .Rail {
      margin-top: 0;
      flex-direction: row; /* Layout horizontally */
      height: auto; /* Height based on content */
      min-height: 5rem; /* Minimum height for the bar */
      width: 100%; /* Full screen width */
      bottom: auto; /* Ensure not fixed at bottom */
      left: 0; /* Stick to left */
      right: 0; /* Stick to right */
      overflow-y: hidden; /* No vertical scrolling */
      overflow-x: hidden; /* No horizontal scrolling for the bar itself */
      border-bottom: 1px solid #e0e0e0; /* Bottom border as separator */
      filter: drop-shadow(rgba(104, 114, 116, 0.15) 0px 2px 3px); /* Adjusted shadow */
      z-index: 200; /* Ensure it's above other content */
    } /* End of .Rail in media query */

    /* Adjust the navigation list for horizontal layout */
    .RailNav {
      flex-direction: row; /* Items laid out horizontally */
      width: 100%; /* Nav takes full width of the bar */
      margin-top: 0; /* Remove the top margin */
      justify-content: space-around; /* Space out nav items */
      align-items: center; /* Vertically center items */
      padding: 0 1rem; /* Add horizontal padding */
      overflow-x: auto; /* Allow horizontal scrolling *for items* if needed */
      overflow-y: hidden; /* No vertical scrolling for items */
    } /* End of .RailNav in media query */

    /* Optional: Style slotted items specifically for mobile */
    /* Example: Add some space between horizontal items */
    /* .RailNav ::slotted(*) {
         margin: 0 0.5rem;
       } */

  } /* End of @media query */
</style>