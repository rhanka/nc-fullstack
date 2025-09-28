<script>
    import Icon from "@iconify/svelte";
    export let expand = false;
</script>

<div class="">
    <header
        class="header"
    >
        <div
            class="container"
        >
            <button
                class="menu-button"
                on:click={() => {
                    expand = !expand;
                }}
            >
                <Icon icon="mdi:{expand ? 'close' : 'menu'}" height={18} />
            </button>

            <img
                src="data:image/png;base64,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"
                alt="XL Laptop and Desktops padding example"
                height="32"
            />

            <h4 class="title">
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
        margin: 10px 20px 6px 12px;
        -webkit-box-align: center;
        align-items: center;
        -webkit-box-pack: center;
        justify-content: center;
        background: rgb(255, 255, 255);
        color: rgb(21, 21, 21);
    }

    .title {
        margin: 0px 0px 0px 20px;
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
