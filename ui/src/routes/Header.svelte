<script>
    import Icon from "@iconify/svelte";
    export let expand = false;
</script>

<div class="MuiBox-root">
    <header
        class="MuiPaper-root MuiPaper-elevation MuiPaper-elevation4 MuiAppBar-root MuiAppBar-colorPrimary MuiAppBar-positionSticky header"
    >
        <div
            class="MuiToolbar-root MuiToolbar-gutters MuiToolbar-regular container"
        >
            <button
                class="MuiButtonBase-root MuiIconButton-root MuiIconButton-colorInherit MuiIconButton-edgeStart MuiIconButton-sizeMedium menu-button"
                on:click={() => {
                    expand = !expand;
                }}
            >
                <Icon icon="mdi:{expand ? 'close' : 'menu'}" height={18} />
            </button>

            <div class="MuiTypography-root MuiTypography-body1">
                <img
                    src="data:image/png;base64,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"
                    alt="XL Laptop and Desktops padding example"
                    height="31"
                />
            </div>

            <h4 class="MuiTypography-root MuiTypography-h4 title">
                NON-CONFORMITIES MANAGEMENT SYSTEM
            </h4>
        </div>
    </header>
</div>

<style>
    .header {
        display: flex;
        flex-direction: column;
        width: 100%;
        box-sizing: border-box;
        flex-shrink: 0;
        position: fixed;
        z-index: 300;
        top: 0px;
        left: auto;
        right: 0px;
        box-shadow: rgba(105, 108, 110, 0.27) 0px 2px 5px;
        height: 5rem;
        -webkit-box-pack: center;
        justify-content: center;
        background-color: white;
        color: black;
        transition: box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1);
        padding: 13px;
    }

    .container {
        position: relative;
        display: flex;
        -webkit-box-align: center;
        align-items: center;
        padding-right: 16px;
        min-height: 56px;
        padding-left: 50px;
        padding: 0;
    }

    .menu-button {
        -webkit-box-align: center;
        align-items: center;
        -webkit-box-pack: center;
        justify-content: center;
        position: relative;
        box-sizing: border-box;
        -webkit-tap-highlight-color: transparent;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
        appearance: none;
        text-align: center;
        color: rgb(60, 63, 64);
        font-family: "Source Sans Pro", sans-serif;
        font-style: normal;
        font-size: 16px;
        line-height: 20px;
        font-weight: 500;
        outline: 0px;
        border-width: 0px;
        border-style: initial;
        border-color: initial;
        border-image: initial;
        text-decoration: none;
        flex: 0 0 auto;
        overflow: visible;
        transition: background-color 150ms cubic-bezier(0.4, 0, 0.2, 1);
        background: rgb(246, 247, 247);
        border-radius: 0px;
        gap: 4px;
        padding: 0px;
        margin: 10px 20px 10px 12px;
        -webkit-box-align: center;
        align-items: center;
        -webkit-box-pack: center;
        justify-content: center;
        background: rgb(255, 255, 255);
        color: rgb(21, 21, 21);
    }

    .title {
        margin: 0px 0px 0px 14px;
        font-family:
            "Source Sans Pro",
            -apple-system,
            sans-serif,
            Arial;
        color: rgb(51, 51, 51);
        border-left: 0.05rem solid rgb(168, 168, 168);
        line-height: 1.25rem;
        padding-left: 14px;
        font-size: 1.25rem;
        font-weight: 400;
    }

    h4 {
        margin-block-start: 1.33em;
        margin-block-end: 1.33em;
        margin-inline-start: 0px;
        margin-inline-end: 0px;
        font-weight: bold;
        unicode-bidi: isolate;
    }
</style>
