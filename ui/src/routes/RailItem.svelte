<script>
  import { ripple } from "svelte-ripple-action";
  import Icon from '@iconify/svelte';
  export let label;
  export let num;
  export let selected = false
  export let active = false;
  export let icon;
  export let onClick = () => {};

  $: console.log("selected", selected);
  $: console.log("active", active);

</script>

<button
  class:selected={selected}
  class:desactivated={!active}
  use:ripple={{ color: "rgba(82, 54, 171, 0.2)", duration: 0.6 }}
  tabindex="0"
  on:click|preventDefault={onClick}
  role="button"
>
  <div class="button-wrapper">
	  {#if icon}
	    <Icon {icon} height={30}/>
	  {/if}
    <span
      class="label"
    >
      {label}
      {#if num !== null && num !== undefined && num !== 0}
        ({num})
      {/if}
    </span>
  </div>
</button>

<style>
  i {
    font-size: 2rem;
    margin-bottom: 0.5rem;
  }

  button {
    border: none;
    background: none;
  	border-left: 0.25rem solid rgb(0,0,0,0);
    width: 100%;
    height: 100%;
 }

  .button-wrapper {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding-top:1rem;
    padding-bottom:0.5rem;

  }


/* --- Base Styles --- */
.selected {
  position: relative; /* Needed for absolute positioning of pseudo-element */
  background: rgb(230, 227, 243);
  border: none;       /* Remove standard borders if not needed */
}

/* Create the gradient line using ::after */
.selected::after {
  content: '';
  position: absolute;
  /* Default gradient direction: top-to-bottom */
  background: linear-gradient(rgb(19, 61, 94), rgb(113, 139, 158));
}

/* --- Desktop Styles (Line on Left) --- */
.selected::after {
  left: 0;
  top: 0;
  bottom: 0;
  width: 0.25rem; /* Thickness */
  height: auto;   /* Reset height */
}

/* --- Mobile Styles (Line on Bottom) --- */
@media (max-width: 768px) {
  .selected::after {
    /* Positioning for bottom line (correct) */
    left: 0;
    right: 0;
    bottom: 0;
    height: 0.25rem; /* Thickness */
    top: auto;
    width: auto;

    /* --- Override background for HORIZONTAL gradient --- */
    background: linear-gradient(to right, rgb(19, 61, 94), rgb(113, 139, 158));
    /* You could also use 'to left' or '90deg' depending on desired direction */
  }
}

/* --- Other styles --- */
i {
  font-size: 2rem;
  margin-bottom: 0.5rem;
}

.desactivated {
  opacity: 0.5;
}

.label {
  font-size: 0.7rem;
}
</style>
