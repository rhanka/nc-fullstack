<svelte:options runes={false} />

<script>
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
  import {
    askForHelp,
    referencesList,
    chatElementRef,
    defaultAction,
    createdItem,
    selectItem,
    selectDoc,
    activeTabValue,
    resetCreatedItem,
	  showChatbot
  } from "./store.js";

  let isApiReady = false;

  onMount(async () => {
    const pingUrl = `${import.meta.env.VITE_API_URL}/ping`;

    const checkStatus = async () => {
      try {
        const response = await fetch(pingUrl);
        if (response.ok && (await response.json()).status === 'ok') {
          isApiReady = true;
          console.log('API is ready.');
        } else {
          console.log('API not ready yet, retrying in 10 seconds...');
          setTimeout(checkStatus, 10000);
        }
      } catch (error) {
        console.error('Failed to connect to API, retrying in 10 seconds...', error);
        setTimeout(checkStatus, 10000);
      }
    };

    checkStatus();
  });

  let maxRows = 5000;
  let apiUrl = `${import.meta.env.VITE_API_URL}/nc?max_rows=${maxRows}`;
  let nonConformitiesFilter = [];
  let nc_num = 0;
  let doc_num = 0;
  let selectDocUrl = null;
  let documentsList = [];
  let tabs = [];
  let expand = false;

  $: if ($selectDoc !== null) {
    selectDocUrl = `${import.meta.env.VITE_API_URL}/doc/${encodeURIComponent($selectDoc.doc.replace(/\.md/, ".pdf"))}`;
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
        cleanCallBack: () => {
          $referencesList["non_conformities"] = undefined;
          $referencesList["tech_docs"] = undefined;
        },
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
        cleanCallBack: () => {
          $referencesList["non_conformities"] = undefined;
          $referencesList["tech_docs"] = undefined;
        },
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
  ];

  $: if ($askForHelp) {
    $showChatbot = true;
    expand = true;
    let role = $askForHelp;
    $askForHelp = false;
    $createdItem.currentTask = role;
    setTimeout(() => {
      $chatElementRef.submitUserMessage({
        text: $defaultAction,
        role: role,
      });
    }, 200);
  }

  $: if ($referencesList && $referencesList["non_conformities"]) {
    nonConformitiesFilter =
      ($referencesList["non_conformities"] &&
        $referencesList["non_conformities"]["sources"]) ||
      [];
    nc_num = nonConformitiesFilter.length;
  } else {
    nonConformitiesFilter = [];
	  nc_num = 0;
  }

  $: if ($referencesList && $referencesList["tech_docs"]) {
    documentsList = Object.values(
      Object.values(
        ($referencesList["tech_docs"] &&
          $referencesList["tech_docs"]["sources"]) ||
          [],
      ).reduce((group, item) => {
        // Si le groupe pour cet ID doc n'existe pas encore, on l'initialise
        if (!group[item.doc]) {
          group[item.doc] = {
            doc: item.doc,
            chunks: [], // Initialisation des chunks
          };
        }
        // Ajouter les propriétés chunk_id, chunk à ce groupe
        group[item.doc].chunks.push({
          chunk_id: item.chunk_id,
          chunk: item.content,
        });
        return group;
      }, {}),
    ); // Initialisation d'un objet vide pour regrouper les items
    doc_num = documentsList.length;
    console.log(`tech_docs ${doc_num}`, documentsList);
  } else {
    console.log("tech_docs clean");
    documentsList = [];
    doc_num = 0;
  }

  $: expand = tabs.some(tab => tab.drawer && tab.rail.selected && (expand || !tab.drawer.selected) );

  const switchTab = (tab) => {
    if (tab.rail.active) {
      $activeTabValue = tab.rail.value;
    }
  };
</script>

{#if isApiReady}
<Header bind:expand></Header>
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

<main class={expand ? "container-expanded" : "container"}>
  <div class="pane">
    {#each tabs as tab}
      <div style="padding-top:0;display: {$activeTabValue === tab.rail.value ? 'block' : 'none'};">
        <svelte:component
          this={tab.content.component}
          {...tab.content.arguments}
        />
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
		on:click={() => { $showChatbot = true; }}
	>
		<Icon icon="mdi:comment-processing-outline" height={30}/>
	</button>
</div>


<div
  class="chatbot-container"
	style="display: {$showChatbot ? 'block' : 'none'};"
>
	<Chatbot bind:expand stream={true}></Chatbot>
</div>
{:else}
  <div class="loading-container">
    <Icon icon="mdi:loading" class="spin-icon" width="48" height="48" />
    <p>Server waking up...</p>
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

  .pane {
    padding: 0rem;
    transition: width 0.3s;
    overflow-y: auto;
  }

.chatbot-button-container {
  position: fixed;
  bottom:1.5rem;
  right:2rem;
}

  @media (max-width: 768px) {
    .chatbot-button-container {
      bottom:1rem;
      right:1rem;
    }
  }


  .chatbot-button {
    border-radius: 50%;
    font-size: 1.5rem;
    padding: 0.5rem;
    padding-bottom:0;
    background: #fff;
    border: none;
    filter: drop-shadow(rgba(0, 0, 0, 0.267) 0px 2px 5px);
  }

  .chatbot-container {
    position: fixed;
    bottom:1rem;
    right:1rem;
    z-index: 400;
  }

  @media (max-width: 768px) {
    .chatbot-container {
      bottom: 0;
      right: 0;
      left: 0;
      width: 100%;
      bottom:0;
      right:0;
      z-index: 100;
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
