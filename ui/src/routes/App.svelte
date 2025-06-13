<svelte:options runes={false} />

<script>
  import { run } from "svelte/legacy";

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
  import { nonConformities } from "./non_conformities.js";
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

  let maxRows = 5000;
  let apiUrl = `https://dataiku.genai-cgi.com/web-apps-backends/NONCONFORMITIES/3DGvs3v/nc?max_rows=${maxRows}`;
  let nonConformitiesList = sortNC(nonConformities);
  let nonConformitiesFilter = [];
  let nc_num = 0;
  let doc_num = 0;
  let selectDocUrl = null;
  let documentsList = [];
  let tabs = [];
  let expand = false;

  function sortNC(list) {
    return list.sort(
      (a, b) =>
        new Date(b["nc_event_date"]) - new Date(a["nc_event_date"]),
    );
  }


  $: if ($selectDoc !== null) {
    selectDocUrl = `https://dataiku.genai-cgi.com/web-apps-backends/NONCONFORMITIES/3DGvs3v/doc/${encodeURIComponent($selectDoc.doc.replace(/\.md/, ".pdf"))}`;
  }

  async function getData() {
    try {
      let response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
      if (response.ok) {
        nonConformitiesList = sortNC(await response.json());
        console.log(
          `fetched ${nonConformitiesList.length} non conformities`,
        ); // Affiche les donn�es JSON
      } else {
        console.error("HTTP error", response.status);
      }
    } catch (error) {
      console.log(error);
    }
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
          nonConformities: nonConformitiesList,
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

  getData();

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
</style>
