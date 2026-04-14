<svelte:options runes={false} />

<script lang="ts">
  import { run } from "svelte/legacy";
  import { onMount } from "svelte";

  import Header from "./Header.svelte";
  import NonConformityList from "./NonConformityList.svelte";
  import NonConformityCreationList from "./NonConformityCreationList.svelte";
  import DocumentsList from "./DocumentsList.svelte";
  import NonConformityDetail from "./NonConformityDetail.svelte";
  import ShowDocument from "./ShowDocument.svelte";
  import NonConformityCreation from "./NonConformityCreation.svelte";
  import Chatbot from "./Chatbot.svelte";
  import Rail from "./Rail.svelte";
  import RailItem from "./RailItem.svelte";
  import Drawer from "./Drawer.svelte";
  import Icon from "@iconify/svelte";
  import { getApiBaseUrl } from "$lib/api-base";
  import {
    askForHelp,
    referencesList,
    chatElementRef,
    clearReferenceSourceGroup,
    showChatbot,
  } from "$lib/chat/stores";
  import { chatLayoutMode } from "$lib/chat/layout";
  import type { ChatTaskRole, ReferenceSourceItem } from "$lib/chat/contracts";
  import {
    createdItem,
    selectItem,
    selectDoc,
    activeTabValue,
    resetCreatedItem
  } from "./store";

  if (typeof Promise.withResolvers !== "function") {
    (Promise as typeof Promise & {
      withResolvers: <T>() => {
        promise: Promise<T>;
        resolve: (value: T | PromiseLike<T>) => void;
        reject: (reason?: unknown) => void;
      };
    }).withResolvers = <T>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
      });
      return { promise, resolve, reject };
    };
  }

  type DocumentChunk = {
    chunk_id?: string;
    chunk?: string;
  };

  type DocumentListEntry = {
    doc: string;
    chunks: DocumentChunk[];
  };

  type Tab = {
    rail: {
      label: string;
      icon: string;
      value: number;
      selected: boolean;
      active: boolean;
      num: number | null;
    };
    drawer?: {
      component: any;
      selected?: unknown;
      cleanCallBack?: () => void;
      arguments?: Record<string, unknown>;
    };
    content: {
      component: any;
      arguments?: Record<string, unknown>;
    };
  };

  let isApiReady = false;
  let allowAppWhileApiWakes = false;
  let apiWakeMessage = "Server waking up...";
  const apiBaseUrl = getApiBaseUrl();

  onMount(() => {
    const pingUrl = `${apiBaseUrl}/ping`;
    const overlayReleaseTimer = window.setTimeout(() => {
      allowAppWhileApiWakes = true;
      apiWakeMessage = "API still waking up. Retrying in background...";
    }, 2500);

    const checkStatus = async () => {
      try {
        const response = await fetch(pingUrl);
        if (response.ok && (await response.json()).status === 'ok') {
          isApiReady = true;
          allowAppWhileApiWakes = true;
          window.clearTimeout(overlayReleaseTimer);
          console.log('API is ready.');
        } else {
          allowAppWhileApiWakes = true;
          apiWakeMessage = "API not ready yet. Retrying in background...";
          console.log('API not ready yet, retrying in 3 seconds...');
          setTimeout(checkStatus, 3000);
        }
      } catch (error) {
        allowAppWhileApiWakes = true;
        apiWakeMessage = "API unreachable. Retrying in background...";
        console.error('Failed to connect to API, retrying in 3 seconds...', error);
        setTimeout(checkStatus, 3000);
      }
    };

    checkStatus();

    return () => {
      window.clearTimeout(overlayReleaseTimer);
    };
  });

  let maxRows = 5000;
  let apiUrl = `${apiBaseUrl}/nc?max_rows=${maxRows}`;
  let nonConformitiesFilter: Array<{ doc?: string; [key: string]: unknown }> = [];
  let nc_num = 0;
  let doc_num = 0;
  let selectDocUrl: string | null = null;
  let documentsList: DocumentListEntry[] = [];
  let tabs: Tab[] = [];
  let expand = false;
  let chatWidth = "25rem";
  let chatHeight = "70vh";
  let isChatDocked = false;

  function clearRetrievedSources() {
    clearReferenceSourceGroup("non_conformities");
    clearReferenceSourceGroup("tech_docs");
  }

  $: isChatDocked = $showChatbot && $chatLayoutMode === "docked";
  $: chatWidth = isChatDocked ? "100%" : "25rem";
  $: chatHeight = isChatDocked ? "100%" : "70vh";

  $: if ($selectDoc?.doc) {
    selectDocUrl = `${apiBaseUrl}/doc/${encodeURIComponent($selectDoc.doc.replace(/\.md/, ".pdf"))}`;
  } else {
    selectDocUrl = null;
  }

  $: tabs = [
    {
      rail: {
        label: "Edit",
        icon: "mdi:clipboard-edit-outline",
        value: 1,
        selected: $activeTabValue === 1,
        active: true,
        num: null
      },
      drawer: {
        component: NonConformityCreationList,
        selected: $createdItem.currentTask,
        cleanCallBack: resetCreatedItem
      },
      content: {
        component: NonConformityCreation,
        arguments: {
          history: history
        }
      }
    },
	  {
      rail: {
        label: "Tech Docs",
        icon: "mdi:book-open-variant-outline",
        value: 2,
        selected: $activeTabValue === 2,
        active: doc_num > 0,
        num: doc_num
      },
      drawer: {
        component: DocumentsList,
        cleanCallBack: clearRetrievedSources,
        selected: $selectDoc,
        arguments: {
          documentsList: documentsList
        }
      },
      content: {
        component: ShowDocument,
        arguments: {
          url: selectDocUrl
        },
      }
    },
    {
      rail: {
        label: "History",
        icon: "mdi:clipboard-text-history-outline",
        value: 3,
        selected: $activeTabValue === 3,
        active: nc_num > 0,
        num: nc_num
      },
      drawer: {
        component: NonConformityList,
        cleanCallBack: clearRetrievedSources,
        selected: $selectItem,
        arguments: {
          nonConformitiesFilter: nonConformitiesFilter
        }
      },
      content: {
        component: NonConformityDetail,
        arguments: {
          selectedItem: $selectItem
        }
      }
    }
  ] satisfies Tab[];

  $: if ($askForHelp) {
    $showChatbot = true;
    expand = true;
    const role = $askForHelp as ChatTaskRole;
    $askForHelp = false;
    $createdItem.currentTask = role as typeof $createdItem.currentTask;
    setTimeout(() => {
      $chatElementRef?.clearMessages?.();
    }, 200);
  }

  $: if ($referencesList.non_conformities?.sources) {
    nonConformitiesFilter =
      $referencesList.non_conformities.sources as Array<{ doc?: string; [key: string]: unknown }>;
    nc_num = nonConformitiesFilter.length;
  } else {
    nonConformitiesFilter = [];
	  nc_num = 0;
  }

  $: if ($referencesList.tech_docs?.sources) {
    const groupedDocuments: Record<string, DocumentListEntry> = {};

    for (const item of $referencesList.tech_docs.sources as ReferenceSourceItem[]) {
      const docId = typeof item.doc === "string" ? item.doc : "unknown";

      if (!groupedDocuments[docId]) {
        groupedDocuments[docId] = {
          doc: docId,
          chunks: [],
        };
      }

      groupedDocuments[docId].chunks.push({
        chunk_id: item.chunk_id,
        chunk:
          typeof item.content === "string"
            ? item.content
            : typeof item.chunk === "string"
              ? item.chunk
              : undefined,
      });
    }

    documentsList = Object.values(groupedDocuments);
    doc_num = documentsList.length;
    console.log(`tech_docs ${doc_num}`, documentsList);
  } else {
    console.log("tech_docs clean");
    documentsList = [];
    doc_num = 0;
  }

  $: expand = tabs.some(tab => tab.drawer && tab.rail.selected && (expand || !tab.drawer.selected) );

  const switchTab = (tab: Tab) => {
    if (tab.rail.active) {
      $activeTabValue = tab.rail.value;
    }
  };
</script>

{#if isApiReady || allowAppWhileApiWakes}
<Header bind:expand></Header>
{#if !isApiReady}
  <div class="api-status-banner">
    {apiWakeMessage}
  </div>
{/if}
<Rail bind:expand>
	{#each tabs as tab}
		<RailItem
			{...tab.rail}
			onClick={() => switchTab(tab)}
		/>
	{/each}
</Rail>
<Drawer bind:expand={expand}>
	{#each tabs as tab}
    {#if tab.drawer && $activeTabValue === tab.rail.value}
      <svelte:component
        this={tab.drawer.component}
        {...tab.drawer.arguments}
      />
	  {/if}
	{/each}
</Drawer>

<main
  class={expand ? "container-expanded" : "container"}
  class:container--chat-docked={isChatDocked}
>
  <div class="pane">
    {#each tabs as tab}
      <div style="padding-top:0;display: {$activeTabValue === tab.rail.value ? 'block' : 'none'};">
        {#if tab.content.component === ShowDocument}
          {#key tab.content.arguments.url ?? "no-document-selected"}
            <svelte:component
              this={tab.content.component}
              {...tab.content.arguments}
            />
          {/key}
        {:else}
          <svelte:component
            this={tab.content.component}
            {...tab.content.arguments}
          />
        {/if}
      </div>
    {/each}
  </div>
</main>


<div
  class="chatbot-button-container"
	style="display: {$showChatbot ? 'none' : 'block'};"
>
	<button
		class="chatbot-button"
    aria-label="Open AI assistant"
		on:click={() => { $showChatbot = true; }}
	>
		<Icon icon="mdi:message-outline" height={26}/>
	</button>
</div>


<div
  class="chatbot-container"
  class:chatbot-container--floating={$chatLayoutMode === "floating"}
  class:chatbot-container--docked={$chatLayoutMode === "docked"}
	style="display: {$showChatbot ? 'block' : 'none'};"
>
	<Chatbot bind:expand width={chatWidth} height={chatHeight}></Chatbot>
</div>
{:else}
  <div class="loading-container">
    <Icon icon="mdi:loading" class="spin-icon" width="48" height="48" />
    <p>{apiWakeMessage}</p>
  </div>
{/if}

<style>
  main {
    padding: 0rem;
    height: calc(100vh - 75px);
  }

  .container {
    margin-top: 5rem;
    margin-left: 5rem;
  }
  .container-expanded {
    margin-top: 5rem;
    margin-left: 25rem;
  }
  @media (max-width: 768px) {
    .container {
      margin-top:10rem;
      margin-left: 0rem;
    }
    .container-expanded {
      margin-top:20rem;
      margin-left: 0rem;
    }
  }

  .container--chat-docked {
    margin-right: clamp(26rem, 33vw, 34rem);
  }

  .container-expanded.container--chat-docked {
    margin-right: clamp(26rem, 33vw, 34rem);
  }

  .pane {
    padding: 0rem;
    transition: width 0.3s;
    overflow-y: auto;
  }

.chatbot-button-container {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 450;
}

  @media (max-width: 768px) {
    .chatbot-button-container {
      bottom:1rem;
      right:1rem;
    }
  }


  .chatbot-button {
    border-radius: 50%;
    width: 3.5rem;
    height: 3.5rem;
    font-size: 1.25rem;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #0c82c8 0%, #006faf 100%);
    color: #fff;
    border: none;
    box-shadow:
      0 12px 28px rgba(0, 111, 175, 0.28),
      0 3px 8px rgba(15, 23, 42, 0.18);
    cursor: pointer;
  }

  .chatbot-container {
    z-index: 400;
  }

  .chatbot-container--floating {
    position: fixed;
    bottom:1rem;
    right:1rem;
  }

  .chatbot-container--docked {
    position: fixed;
    top: 5rem;
    right: 1rem;
    bottom: 1rem;
    width: clamp(26rem, 33vw, 34rem);
  }

  @media (max-width: 768px) {
    .container--chat-docked,
    .container-expanded.container--chat-docked {
      margin-right: 0;
    }

    .chatbot-container {
      bottom: 0;
      right: 0;
      left: 0;
      width: 100%;
      bottom:0;
      right:0;
      z-index: 100;
    }

    .chatbot-container--docked {
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      width: 100%;
    }
  }

  .loading-container {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		background-color: rgba(255, 255, 255, 0.8);
		z-index: 1000;
	}

  .api-status-banner {
    position: fixed;
    top: 5.5rem;
    right: 1rem;
    z-index: 900;
    padding: 0.6rem 0.8rem;
    border-radius: 0.75rem;
    background: rgba(19, 61, 94, 0.92);
    color: #fff;
    font-size: 0.9rem;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.16);
  }

	.spin-icon {
		animation: spin 2s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
</style>
