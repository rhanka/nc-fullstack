<script>
  import { marked } from "marked"; // Import the marked library
  import { DeepChat } from "deep-chat";
  import { filteredNonConformities, showChatbot } from "./store.js";
  import Icon from "@iconify/svelte";
  import { onMount } from 'svelte';

  let aiUrl = `${import.meta.env.VITE_API_URL}/ai`;
  export let expand = false;
  export let stream = false;
  export let height = "70vh";
  export let width = "25rem";
  let inputWidth = "23.5rem";
  let windowInnerWidth = undefined;
  let dynamicWidth = width;
  let dynamicHeight = height;

  let currentMsg = {};
  let nativeStream = true;

  import {
    createdItem,
    updateCreatedItem,
    isUpdating,
    referencesList,
    chatElementRef,
    defaultAction,
  } from "./store.js";

  $: console.log(
    `Chatbot stream mode: ${stream}; use nativeStream: ${stream && nativeStream}`,
  );

  onMount(() => {
      windowInnerWidth = window.innerWidth;
  });

  $: dynamicWidth = (windowInnerWidth !== undefined && windowInnerWidth <= 768) ? '100dvw' : width;
  $: dynamicHeight = (windowInnerWidth !== undefined && windowInnerWidth <= 768) ? `calc(100dvh - ${expand ? 21.5 : 11.5}rem)` : height;

  let dynamicInputWidth = inputWidth; // default value
  $: dynamicInputWidth = (windowInnerWidth !== undefined && windowInnerWidth <= 768) ? 'calc(100vw - 1.5rem)' : inputWidth;

  $: if ($chatElementRef && dynamicWidth) {
    $chatElementRef.style.width = dynamicWidth;
    $chatElementRef.style.height = dynamicHeight;
  }

  const history = [];

  const actionInit = (data) => {
    console.log("actionInit", data);
    currentMsg[data.metatada] = "";
    // $chatElementRef.updateMessage({ html: `<div class="tool">${data.text} ...</div>`}, 0);
    return { text: `*${data.text}...*\n` };
  };

  const actionStream = (data) => {
    currentMsg[data.metadata] += data.v;
  };

  const actionCanevasStream = (data) => {
    if (!currentMsg[data.metadata]) {
      currentMsg[data.metadata] = { v: "", jsonString: "" };
    }
    currentMsg[data.metadata].jsonString += data.v;
    const json = parsePartialJSON(currentMsg[data.metadata].jsonString);
    if (json) {
      $updateCreatedItem = {
        role: $createdItem.currentTask,
        label: json.label,
        description: json.description,
      };
      if (json.comment) {
        console.log(json.comment,currentMsg[data.metadata])
        const output = {
          text: json.comment.slice(currentMsg[data.metadata].v.length),
          metadata: data.metadata,
        };
        currentMsg[data.metadata].v = json.comment;
        return output;
      }
    }
  };

  const parsePartialJSON = (chunk) => {
    // On concatène le nouveau bout et on tente une fermeture
    if (chunk) {
      let buffer = completeJSON(chunk).replace(/\\n/g, "\n");
      buffer = buffer.replace(/"([^"]*)"/g, function(match) {
        return match.replace(/\n/g, "\\n");
      });
      const attempt = buffer;
      // console.log(attempt);
      try {
        const parsed = JSON.parse(attempt);
        // console.log("json parsed ok");
        return parsed;
      } catch {
        return null;
      }
    } else {
      return null;
    }
  };

  // Fonction naïve qui ferme guillemets, crochets et accolades restants
  const completeJSON = (str) => {
    let openCurly = 0,
      openSquare = 0;
    let inString = false,
      escaped = false;

    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (c === '"' && !escaped) inString = !inString;
      escaped = !escaped && c === "\\";
      if (!inString) {
        if (c === "{") openCurly++;
        else if (c === "}") openCurly--;
        else if (c === "[") openSquare++;
        else if (c === "]") openSquare--;
      }
    }

    let fixed = str;
    if (inString) fixed += '"';
    while (openSquare > 0) {
      fixed += "]";
      openSquare--;
    }
    while (openCurly > 0) {
      fixed += "}";
      openCurly--;
    }
    return fixed;
  };

  const updateReferencesList = (data) => {
    currentMsg[data.metadata] = "";
    console.log("updateReferencesList", data);
    const key =
      data.metadata == "nc_search" ? "non_conformities" : "tech_docs";
    const otherKey =
      data.metadata == "nc_search" ? "tech_docs" : "non_conformities";
    if ($referencesList) {
      $referencesList = {
        [key]: data.text,
        [otherKey]: $referencesList[otherKey],
      };
    } else {
      $referencesList = { [key]: data.text, [otherKey]: { sources: [] } };
    }
  };

  const updateTask = (data) => {
    let json;
    try {
      json = JSON.parse(data.text);
    } catch {
      json = data.text;
    }
    if (json) {
      $isUpdating = false;
      $updateCreatedItem = {
        role: $createdItem.currentTask,
        label: json.label,
        description: json.description,
      };
      // return { text: json.comment };
      return { };
    }
  };

  const agentHeadTemplate = {
    action: actionInit,
    stream: actionStream,
  };

  const canevasAgentTemplate = {
    action: actionInit,
    stream: actionCanevasStream,
    result: updateTask,
  };

  const agentHead = {
    query: {
      ...agentHeadTemplate,
      result: () => {},
    },
    nc_search: {
      ...agentHeadTemplate,
      result: updateReferencesList,
    },
    doc_search: {
      ...agentHeadTemplate,
      result: updateReferencesList,
    },
    "000": canevasAgentTemplate,
    "100": canevasAgentTemplate,
    "200": canevasAgentTemplate,
    "300": canevasAgentTemplate,
    "400": canevasAgentTemplate,
    final: {
      result: updateTask,
    },
  };

  const eventProcess = (data) => {
    if (data.v) {
      return agentHead[data.metadata].stream(data);
    } else if (data !== "v1" && Object.keys(data).length > 0) {
      try {
        return agentHead[data.metadata][data.type](data) || { v: "" };
      } catch(e) {
        console.log("Error in eventProcess", data, e);
        return { v: "" };
      }
    }
  };

  // $: console.log(hop);
  // hop.forEach((m) => console.log(eventProcess(m)));

  const sleep = (ms) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  const responseInterceptor = async (response) => {
    if (!stream) {
      // Lire le Blob comme texte
      const text = await response.text();
      // Tenter de parser le texte en JSON
      try {
        const json = JSON.parse(text);
        $referencesList = json.sources;
        // console.log('response',json);
        $isUpdating = false;
        $updateCreatedItem = {
          role: $createdItem.currentTask,
          label: json.label,
          description: json.description,
        };
        return { html: marked(json.text) }; // Retourner le JSON à DeepChat
      } catch (e) {
        console.error("Erreur lors du parsing du JSON:", e);
        return { error: "Invalid JSON format" }; // Retourner une erreur si le JSON est invalide
      }
    } else if (stream && nativeStream) {
      // await sleep(100);
      // response = hop.shift();
      // console.log(response);
      return eventProcess(response);
    } else {
      console.log("process response without custom Stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk
          .split("\n")
          .filter((line) => line.trim() !== "");

        const messages = lines.map((line) => {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
            } catch {
              return { v: "" };
            }
          }
        });
      }
    }
  };

  const requestInterceptor = (requestDetails) => {
    requestDetails.body.messages[0].role = $createdItem.currentTask;
    requestDetails.body.messages[0].history = [
      "000",
      "100",
      "200",
      "300",
      "400",
      "500",
    ]
      .filter((key) => key < $createdItem.currentTask)
      .map((key) => $createdItem["analysis_history"][key]);
    // user_message is implicitely set to inherited requestDetails.body.messages[0].text
    // console.log('ici', $createdItem, $createdItem.currentTask);
    requestDetails.body.messages[0].description =
      $createdItem["analysis_history"][$createdItem.currentTask][0];
    console.log('requestDetails', requestDetails);
    if ($referencesList) {
      requestDetails.body.messages[0].sources = $referencesList;
      requestDetails.body.messages[0].sources[
        "non_conformities"
      ].sources = $filteredNonConformities.map((item) => {
        return {
          doc: item["nc_event_id"],
          ATA_code: item["ATA_code"],
          ATA_category: item["ATA_category"],
          label: item["analysis_history"]["000"][0]["label"],
          content: item["analysis_history"][$createdItem.currentTask],
        };
      });
    }
    $isUpdating = $createdItem.currentTask;
    return requestDetails;
  };
</script>

<svelte:window bind:innerWidth={windowInnerWidth}/>

<main class="deep-chat-container">
<div
	style="display:flex;align-items:right;flex-direction: row-reverse;padding:0.1rem;height:1.25rem;background: rgb(248, 248, 248);border-bottom: 1px solid rgba(0,0,0,.1)"
>
	<button
		style="cursor:pointer;align:right;border:none;padding:0.1rem;background:none;"
		on:click={() => {$showChatbot=false;}}
	>
		<Icon icon="mdi:chevron-down" height="1.25rem"/>
	</button>
	<button
		style="cursor:pointer;align:right;border:none;padding:0.1rem;background:none;"
		on:click={() => {$chatElementRef.clearMessages()}}
	>
		<Icon icon="mdi:trash-can-outline" height="1rem"/>
	</button>
</div>
  <deep-chat
    bind:this={$chatElementRef}
    avatars={{
      ai: "https://upload.wikimedia.org/wikipedia/commons/e/ef/ChatGPT-Logo.svg",
    }}
    connect={{
      stream: stream && nativeStream,
      url: aiUrl,
      method: "POST",
      headers:
        nativeStream && stream
          ? {}
          : {
              "Accept": stream
                ? "text/event-stream"
                : "application/json",
            },
    }}
    textInput={{
      styles: {
		text: {
          color: "black",
          "font-family": "Source Sans Pro, sans-serif",
        },
        container: {
          width: dynamicInputWidth,
        },
        focus: { border: "1px solid #ccc" },
      },
      placeholder: { text: "Ask your question" },
    }}
    intropanel={{
      styles: {
        container: {
          backgroundColor: "rgba(247,247,248)",
          borderTop: "1px solid rgba(0,0,0,.1)",
          borderBottom: "1px solid rgba(0,0,0,.1)",
        },
        header: {
          color: "black",
        },
        body: {
          color: "black",
        },
        text: {
          "font-family": "Source Sans Pro, sans-serif",
        },
      },
      header: "Welcome to the Non-Conformity Chatbot",
      body: "I'm here to help you with your non-conformity tasks. Please provide me with the necessary information to help you.",
    }}
    messageStyles={{
      default: {
        shared: {
          bubble: {
            maxWidth: "100%",
            backgroundColor: "unset",
            marginTop: "10px",
            marginBottom: "10px",
            "font-family": "Source Sans Pro, sans-serif",
          },
        },
        user: {
          bubble: {
            color: "black",
          },
        },
        ai: {
          outerContainer: {
            backgroundColor: "rgba(247,247,248)",
            borderTop: "1px solid rgba(0,0,0,.1)",
            borderBottom: "1px solid rgba(0,0,0,.1)",
          },
        },
      },
    }}
    {responseInterceptor}
    {requestInterceptor}
    {history}
    chatStyle={{
      border: "0px",
      width: dynamicWidth,
      height: dynamicHeight,
    }}
    htmlClassUtilities={{
      "custom-button": {
        events: {
          click: (event) => {
            const text = event.target.children[0].innerText;
            $chatElementRef.submitUserMessage({ text: text });
          },
        },
        styles: {
          default: {
            backgroundColor: "#fff",
            display: "inline-block",
            transition: "all 0.2s ease",
            padding: "3px 15px",
            fontSize: "15px",
            borderRadius: "20px",
            color: "#151515",
            border: "1px solid #bbb",
            padding: "5px 10px 5px 10px",
            cursor: "pointer",
            textAlign: "center",
            fontFamily: "Source Sans Pro, sans-serif",
          },
          hover: {
            "background-color": "#5236ab",
            color: "#fff",
            "text-decoration": "none",
            "border-color": "#5236ab",
          },
          click: { backgroundColor: "#e4e4e4" },
        },
      },
      "custom-button-text": {
        styles: { default: { pointerEvents: "none" } },
      },
      tool: { styles: { color: "#ccc" } },
    }}
  >
    <div style="display: none">
      <div class="custom-button">
        <div class="custom-button-text">{$defaultAction}</div>
      </div>
      <div class="custom-button" style="margin-top: 15px">
        <div class="custom-button-text">Translate to french</div>
      </div>
    </div>
  </deep-chat>
</main>

<style>
  .deep-chat-container {
    text-align: center;
    justify-content: center;
    display: grid;
    margin:0px;
    border: 1px grey;
    filter: drop-shadow(rgba(104, 114, 116, 0.267) 0px 2px 5px);
  }
    @media (max-width: 768px) {
      .deep-chat-container {
      }
    }
</style>
