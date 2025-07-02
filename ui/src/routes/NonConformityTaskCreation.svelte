<script>
  import Input from "./Input.svelte";
  import Dropzone from "svelte-file-dropzone";
  import { taskLabel, createdItem, isUpdating, askForHelp } from "./store.js";
  import Icon from "@iconify/svelte";

  export let aiHelp = false;

  export let task;
  export let expand;
  export let dropzone = false;

  const dict = {
    aircraft_id: "Aircraft Serial Number",
    part_id: "Part number",
    nc_event_date: "Date",
  };

  const smartLabel = (key) => {
    return dict[key]
      ? dict[key]
      : key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  };

  let image;

  const step_template = {
    "000": {
      label: "<Label for non-conformity report>",
      description:
        "Please provide a concise and precise description for this task",
      name: "Eric Roy",
      role: "Quality Controller",
      date: new Date().toISOString(),
      previous: null,
      next: null,
      validated: false,
    },
    "100": {
      label: "<Please provide a short label for non-conformity analysis>",
      description:
        "Please provide a concise and precise description for this task",
      name: "Christine Tremblay",
      role: "Design Office",
      date: new Date().toISOString(),
      previous: null,
      next: null,
      validated: false,
    },
  };

  $: if (expand && $createdItem.analysis_history[task].length === 0) {
    $createdItem.analysis_history[task][0] = { ...step_template[task] };
  }

  let files = {
    accepted: [],
    rejected: [],
  };

  function handleFilesSelect(e) {
    const { acceptedFiles, fileRejections } = e.detail;
    files.accepted = [...files.accepted, ...acceptedFiles];
    files.rejected = [...files.rejected, ...fileRejections];
    console.log(files.accepted);
  }

  function handleRemoveFile(e, index) {
    files.accepted.splice(index, 1);
    files.accepted = [...files.accepted];
  }
  function handleRemoveAll() {
    files.accepted = [];
  }

  function handleClick() {
    expand = !expand;
    if (expand) {
      $createdItem.currentTask = task;
    }
  }
</script>

<div
  class="MuiPaper-root MuiPaper-outlined MuiPaper-rounded MuiCard-root"
  style="margin-bottom: 1rem;"
>
  {#if task}
    <button
      type="button"
      on:click={handleClick}
      on:keypress={(e) => e.key === "Enter" && handleClick()}
      class="MuiCardActions-root"
      style="cursor: pointer; display: flex; padding: 0px; width: 100%; text-align: left; border: none; background: none;"
    >
      <h3 class="MuiTypography-root MuiTypography-h3 taskTitle">
        {taskLabel[task]}
        {#if aiHelp && expand}
          <a
            href="/"
            on:click|stopPropagation|preventDefault={() =>
              ($askForHelp = task)}
            on:keypress={(e) => {
              if (e.key === "Enter") {
                $askForHelp = task;
              }
            }}
            class="helper"
            style="margin-left:1rem;padding-bottom:.2rem;cursor: help; text-decoration:none;"
          >
            AI Assitant
          </a>
        {/if}
      </h3>
	  <Icon icon="mdi:chevron-{expand ? 'up' : 'down'}" height={24}/>
    </button>
  {/if}

  {#if expand}
    <div class="container">
      <div class="left-column {$isUpdating === task ? 'gradiant' : ''}">
        {#if $createdItem.analysis_history[task] && $createdItem.analysis_history[task].length}
          {#each $createdItem.analysis_history[task] as step}
            <h4>
              <Input bind:value={step.label} label="Label" />
			</h4>
			<Input
			bind:value={step.date}
			label="Date"
			/>

            <Input label="Role" bind:value={step["role"]} /> -
            <Input label="Author" bind:value={step["name"]} />

            <br /><br />
            <div>
              {#if typeof step.description === "string"}
                <Input
                  bind:value={step.description}
                  label="Description"
                  markdown={true}
                />
              {:else if typeof step.description === "object"}
                {#each Object.entries(step.description) as [key, value]}
                  {#if Array.isArray(value)}
                  <h4>{smartLabel(key)}</h4>
                  <Input
                      value={value.join("\n")}
                      markdown={true}
                    />
                  {:else if typeof step.description[key] === "string"}
                    <h4>{smartLabel(key)}</h4>
                    <Input
                      bind:value={step.description[key]}
                      markdown={true}
                    />
                  {:else if typeof step.description === "object"}
                    <h4>{smartLabel(key)}</h4>
                    <ul
                      style="margin-top:0;padding-top:0;padding-bottom:0"
                    >
                      {#each Object.entries(step.description[key]) as [key2, value2]}
                        <li style="padding:0">
                          <strong
                            >{smartLabel(key2)}:
                            &nbsp</strong
                          ><Input
                            bind:value={step
                              .description[key][
                              key2
                            ]}
                          />
                        </li>
                      {/each}
                    </ul>
                  {/if}
                {/each}
              {/if}
            </div>
          {/each}
        {/if}
      </div>
      <div class="right-column">
        {#if dropzone}
          {#if files.accepted.length > 0}
            <div class="image-preview">
              {#each files.accepted as file, index}
                <div class="img-container">
                  <img
                    src={URL.createObjectURL(file)}
                    alt={`Preview of ${file.name}`}
                    class="preview-img"
                  />
                  <button
                    on:click={() =>
                      handleRemoveFile(null, index)}
                    >Remove</button
                  >
                </div>
              {/each}
            </div>
          {:else}
            <Dropzone
              on:drop={handleFilesSelect}
              accept={["image/*"]}
            >
			 <div style="height:200px;align-items:center;display:flex;justify-content:center;">
				Drag 'n' drop some image here, or click to select
				files
			  </div>
            </Dropzone>
          {/if}
        {/if}
      </div>
      <div class="icon-bar-wrapper">
        <div class="icon-bar">
          <button
            on:click={() =>
              ($createdItem.analysis_history[task][0].validated =
                !$createdItem.analysis_history[task][0]
                  .validated)}
            aria-label="Validate"
          >
		  	<Icon class="Icon" icon="mdi:check" height={24} style="color: {$createdItem.analysis_history[task][0].validated ? 'green' : '#bbb'}"/>
          </button>
          <button
            on:click={() => {
              $createdItem.analysis_history[task][0].redo =
                $createdItem.analysis_history[task][0];
              $createdItem.analysis_history[task][0] =
                $createdItem.analysis_history[task][0].undo;
            }}
            aria-label="Undo"
          >
		  	<Icon
				class="Icon"
				icon="mdi:undo"
				height={24}
			/>
          </button>
          <button
            on:click={() => {
              if ($createdItem.analysis_history[task][0].redo) {
                $createdItem.analysis_history[task][0].undo =
                  $createdItem.analysis_history[task][0];
                $createdItem.analysis_history[task][0] =
                  $createdItem.analysis_history[task][0].redo;
              } else {
                $askForHelp = task;
              }
            }}
            aria-label={$createdItem.analysis_history[task][0].redo
              ? "Redo"
              : "Retry"}
          >
		  	<Icon
				class="Icon"
				icon="mdi:redo"
				height={24}
			/>
          </button>
          <button
            on:click={() => {
              if (
                $createdItem.analysis_history[task][0]
                  .feedback === "positive"
              ) {
                $createdItem.analysis_history[
                  task
                ][0].feedback = null;
              } else {
                $createdItem.analysis_history[
                  task
                ][0].feedback = "positive";
              }
            }}
            aria-label="Helpful"
          >
		  	<Icon class="Icon"
				icon="mdi:thumb-up{$createdItem.analysis_history[task][0].feedback === 'positive' ? '' : '-outline'}"
				height={24}
				style="color: {$createdItem.analysis_history[task][0].feedback === 'positive' ? 'black' : '#aaa'}"
			/>
          </button>
          <button
            on:click={() => {
              if (
                $createdItem.analysis_history[task][0]
                  .feedback === "negative"
              ) {
                $createdItem.analysis_history[
                  task
                ][0].feedback = null;
              } else {
                $createdItem.analysis_history[
                  task
                ][0].feedback = "negative";
              }
            }}
            aria-label="Not Helpful, Useless or Harmful"
          >
			<Icon class="Icon"
				icon="mdi:thumb-down{$createdItem.analysis_history[task][0].feedback === 'negative' ? '' : '-outline'}"
				height={24}
				style="color: {$createdItem.analysis_history[task][0].feedback === 'negative' ? 'black' : '#aaa'}"
			/>
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  li {
    padding: 1rem;
    transition: width 0.3s;
  }

  /* Conteneur global */
  .container {
    display: flex;
    flex-wrap: wrap; /* Permet aux colonnes de passer � la ligne si n�cessaire */
    gap: 1rem; /* Espacement entre les colonnes */
  }

  /* Colonne de gauche */
  .left-column {
    padding-right: 0.5rem;
    flex: 2; /* 2/3 de l'espace disponible */
    min-width: 200px; /* Largeur minimale pour �viter un �crasement trop important */
  }

  /* Colonne de droite */
  .right-column {
    flex: 1; /* 1/3 de l'espace disponible */
    min-width: 200px; /* Largeur minimale pour �viter un �crasement trop important */
  }

  .full {
    padding-right: 0.5rem;
    width: 100%; /* 2/3 de l'espace disponible */
    min-width: 200px; /* Largeur minimale pour �viter un �crasement trop important */
  }

  h4 {
    padding-top: 0.5rem;
    padding-bottom: 0;
    margin-top: 0;
    margin-bottom: 0;
  }
  ul,
  li {
    padding-top: 0;
    padding-bottom: 0;
    margin-top: 0;
    margin-bottom: 0;
  }

  .helper {
    display: inline-block;
	transition: background-color 250ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1), border-color 250ms cubic-bezier(0.4, 0, 0.2, 1), color 250ms cubic-bezier(0.4, 0, 0.2, 1);    padding: 3px 15px;
    font-size: 15px;
    border-radius: 20px;
	color: rgb(255, 255, 255);
    background-color: rgb(82, 54, 171);
	border-width: 0px;
    border-style: initial;
    border-color: initial;
    border-image: initial;
	box-shadow: rgba(0, 0, 0, 0.15) 0px 1px 3px 1px, rgba(0, 0, 0, 0.3) 0px 1px 2px 0px;
  }

  .helper:hover {
	background-color: rgb(203, 195, 230);
    color: rgb(32, 10, 88);
    box-shadow: rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px;
  }

  /* Gestion des colonnes en mode responsive */
  @media (max-width: 768px) {
    .container {
      flex-direction: column; /* Les colonnes passent en empilement vertical */
    }
    .left-column,
    .right-column {
      flex: 1; /* Les deux colonnes occupent 100% en mode stack */
    }
  }

  .image-preview {
    margin-top: 0rem;
  }

  .img-container {
    display: flex;
    flex-direction: column;
    align-items: center; /* Centre horizontalement */
    width: 100%;
  }
  .preview-img {
    max-width: 100%;
    max-height: 200px;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  button {
    margin-top: 0.5rem;
    border: none;
    background: #eee;
    cursor: pointer;
  }

  button:hover {
    background: #e9e9e9;
  }

  @keyframes gradient {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 100% 50%;
    }
  }

  .gradiant {
	color: grey!important;
  }

  .icon-bar-wrapper {
    display: flex;
    justify-content: center;
    padding: 1rem;
    border-top: 1px solid #eee;
    width: 100%;
  }

  .icon-bar {
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-top: 1rem;
    padding: 1rem;
    padding-bottom: 0;
  }

  .icon-bar button {
    cursor: pointer;
    border: none;
    background: #fff;
	padding-top: 0.3rem;
	padding-bottom: 0.1rem;
    margin: 0;
    color: #bbb;
    transition:
      color 0.2s ease,
      transform 0.2s ease;
  }
  .Icon {
    font-size: 1rem;
    cursor: pointer;
  }

  .icon-bar button:hover {
	border-radius: 50%;
	padding-top: 0.3rem;
	padding-bottom: 0.1rem;
    filter: drop-shadow(rgba(104, 114, 116, 0.267) 0px 2px 5px);
    color: black;
    transform: scale(1.1);
  }

  .taskTitle {
    margin: 0px;
    margin-bottom: 0.5rem;
    font-family:
      "Source Sans Pro",
      -apple-system,
      sans-serif,
      Arial;
    line-height: 1.167;
    font-size: 1.5rem;
    font-weight: 600;
    color: rgb(51, 51, 51);
    flex: 1 1 auto;
  }

  .MuiPaper-root {
    background-color: rgb(255, 255, 255);
    color: rgb(51, 51, 51);
    box-shadow: rgb(232, 232, 232) 0px 4px inset;
    transition: box-shadow 300ms cubic-bezier(0.4, 0, 0.2, 1);
    overflow: hidden;
    border-radius: 0px;
    border-width: 1px;
    border-style: solid;
    border-color: rgb(232, 232, 232);
    border-image: initial;
    padding: 2rem;
  }
  .MuiCardActions-root {
    display: flex;
    -webkit-box-align: center;
    align-items: center;
    padding: 0px;
  }
</style>
