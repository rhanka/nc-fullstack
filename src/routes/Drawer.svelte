<script>
  export let expand = false;
</script>

<div
  class="MuiDrawer-root MuiDrawer-docked MuiDrawer-root-custom"
  style="display: {expand ? 'block' : 'none'}"
>
  <div
    class="MuiPaper-root MuiPaper-elevation MuiPaper-elevation0 MuiDrawer-paper MuiDrawer-paperAnchorLeft MuiDrawer-paperAnchorDockedLeft MuiDrawer-custom"
    style="transform: none; transition: transform 225ms cubic-bezier(0, 0, 0.2, 1);"
  >
    <nav
      class="MuiList-root MuiList-padding"
      aria-labelledby="nested-list-subheader"
    >
      <slot />
    </nav>
  </div>
</div>

<style>
  .MuiDrawer-root-custom .MuiDrawer-paper {
    box-sizing: border-box;
    position: fixed;
    top: 5rem;
    left: 5rem;
    width: 20rem;
    box-shadow: none;
    filter: drop-shadow(rgba(104, 114, 116, 0.267) 0px 2px 5px);
    border-left: 1px solid rgb(214, 217, 219)oxbackground: rgb(248, 248, 248);
    z-index: 150;
  }
  @media (max-width: 768px) {
    .MuiDrawer-root-custom .MuiDrawer-paper {
      left: 0rem;
      top: 10rem;
      width: 100%;
    }
  }

  .MuiDrawer-custom {
    background-color: rgb(255, 255, 255);
    color: rgba(0, 0, 0, 0.87);
    box-shadow: none;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    height: 100%;
    z-index: 150;
    position: fixed;
    top: 0px;
    left: 0px;
    transition: box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1);
    flex: 1 0 auto;
    outline: 0px;
    border-right: 1px solid rgba(0, 0, 0, 0.12);
  }

  @media (max-width: 768px) {
    .MuiDrawer-custom {
      height: 10rem;
      width: 100%;
    }
  }
</style>