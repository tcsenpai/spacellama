console.log("Background script loaded");

let isFirefox = typeof InstallTrigger !== "undefined"; // Firefox has `InstallTrigger`
let browser = isFirefox ? window.browser : chrome;

// Check if chrome.action or browser.action is available
if (isFirefox && browser.browserAction) {
  // Firefox specific: Use browserAction
  browser.browserAction.onClicked.addListener(() => {
    console.log("Firefox: Toggling sidebar");
    browser.sidebarAction.toggle();
  });
} else if (browser.action) {
  // Chrome specific: Use action and inject the sidebar iframe
  browser.action.onClicked.addListener((tab) => {
    console.log("Injecting sidebar iframe into the page");

    // Use the tab object properly here
    browser.scripting.executeScript(
      {
        target: { tabId: tab.id }, // Pass the tab ID correctly
        function: injectSidebar,
      },
      () => {
        if (browser.runtime.lastError) {
          console.error(
            "Error injecting sidebar:",
            browser.runtime.lastError.message
          );
        } else {
          console.log("Sidebar injected successfully.");
        }
      }
    );
  });
}

// Function to inject the sidebar as an iframe in browsers like Chrome
function injectSidebar() {
  // Check if the sidebar iframe is already injected
  if (document.getElementById("sidebar-frame")) {
    console.log("Sidebar is already injected.");
    return;
  }
  // Create an iframe for the sidebar
  const sidebarFrame = document.createElement("iframe");
  sidebarFrame.id = "sidebar-frame"; // Add an ID to prevent multiple injections
  sidebarFrame.src = chrome.runtime.getURL("sidebar/sidebar.html"); // Use the sidebar.html
  sidebarFrame.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 300px;
    height: 100%;
    border: none;
    z-index: 9999;
    background-color: white;
  `;

  // Append the sidebar iframe to the body of the active webpage
  document.body.appendChild(sidebarFrame);
}

// Background script listens for the 'summarize' action
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    console.log("Summarization request received in background script.");
    const tokenCount = estimateTokenCount(request.content);
    summarizeContent(request.content, request.systemPrompt)
      .then((summary) => {
        sendResponse({ summary, tokenCount });
      })
      .catch((error) => {
        console.error("Error in summarizeContent:", error);
        sendResponse({
          error: error.toString(),
          details: error.details,
          tokenCount,
        });
      });
    return true; // Indicates that we will send a response asynchronously
  }
});

async function summarizeContent(content, systemPrompt) {
  const settings = await browser.storage.local.get([
    "ollamaEndpoint",
    "ollamaModel",
    "tokenLimit",
  ]);
  const endpoint = `${
    settings.ollamaEndpoint || "http://localhost:11434"
  }/api/generate`;
  const model = settings.ollamaModel || "llama3.1:8b";
  const tokenLimit = settings.tokenLimit || 4096;

  console.log(`Starting summarization process. Token limit: ${tokenLimit}`);

  try {
    let { summary, chunkCount, recursionDepth } = await recursiveSummarize(
      content,
      systemPrompt,
      tokenLimit,
      endpoint,
      model
    );
    console.log("Final summary completed.");
    return {
      summary:
        typeof summary === "string" ? summary.trim() : JSON.stringify(summary),
      // NOTE Chunk count and recursion depth are disabled if not needed
      //chunkCount,
      //recursionDepth,
    };
  } catch (error) {
    console.error("Error in summarizeContent:", error);
    error.details = {
      endpoint: endpoint,
      model: model,
      message: error.message,
    };
    throw error;
  }
}

async function recursiveSummarize(
  content,
  systemPrompt,
  tokenLimit,
  endpoint,
  model,
  depth = 0
) {
  console.log(`Recursive summarization depth: ${depth}`);
  const chunks = splitContentIntoChunks(content, tokenLimit, systemPrompt);
  console.log(`Split content into ${chunks.length} chunks`);

  let summaries = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`Summarizing chunk ${i + 1} of ${chunks.length}`);
    const chunkSummary = await summarizeChunk(
      chunks[i],
      systemPrompt,
      endpoint,
      model,
      tokenLimit
    );
    summaries.push(chunkSummary);
  }
  const combinedSummaries = summaries.join("\n\n");

  if (chunks.length <= 1) {
    console.log("Single chunk, summarizing directly");
    return {
      summary: combinedSummaries,
      chunkCount: chunks.length,
      recursionDepth: depth,
    };
  } else {
    console.log("Multiple chunks, summarizing recursively");
    const result = await recursiveSummarize(
      combinedSummaries,
      systemPrompt,
      tokenLimit,
      endpoint,
      model,
      depth + 1
    );
    return {
      ...result,
      chunkCount: chunks.length + result.chunkCount,
    };
  }
}

async function summarizeChunk(
  chunk,
  systemPrompt,
  endpoint,
  model,
  tokenLimit
) {
  let response;
  let maxRetries = 3;
  let retryCount = 0;
  let retryDelay = 1000;
  // We will retry the request if it fails (three times)
  // Each time we will wait longer before retrying (1, 2, 4 seconds)
  // Each request will timeout after 25 * retryDelay
  while (retryCount < maxRetries) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\nFollow the above instructions and summarize the following text:\n\n${chunk}`,
          model: model,
          stream: false,
          num_ctx: tokenLimit,
        }),
        signal: AbortSignal.timeout(25 * retryDelay),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      break; // Success - exit the retry loop
    } catch (error) {
      console.error("Error in summarizeChunk:", error);
      retryCount++;

      if (retryCount >= maxRetries) {
        throw new Error(
          `Failed to summarize chunk after ${maxRetries} retries: ${error.message}`
        );
      }

      console.log(`Retry ${retryCount}/${maxRetries} after ${retryDelay}ms`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay *= 2;
    }
  }

  // TODO Add bespoke-minicheck validation here
  // LINK https://ollama.com/library/bespoke-minicheck
  let factCheck = false;
  if (factCheck) {
    let bespokeResponse = await bespokeMinicheck(chunk, summary);
    console.log(bespokeResponse);
  }

  const data = await response.json();
  return data.response;
}

function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

function splitContentIntoChunks(content, tokenLimit, systemPrompt) {
  const maxTokens = tokenLimit - estimateTokenCount(systemPrompt) - 100; // Reserve 100 tokens for safety
  const chunks = [];
  const words = content.split(/\s+/);
  let currentChunk = "";

  for (const word of words) {
    if (estimateTokenCount(currentChunk + " " + word) > maxTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = word;
    } else {
      currentChunk += (currentChunk ? " " : "") + word;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function bespokeMinicheck(chunk, summary) {
  let bespoke_prompt = `
    Document: ${chunk}
    Claim: This is a correct summary of the document:\n\n ${summary},
  `;

  let bespoke_body = {
    prompt: bespoke_prompt,
    model: "bespoke-minicheck:latest",
    stream: false,
    num_ctx: 30000, // Model is 32k but we want to leave some buffer
    options: {
      temperature: 0.0,
      num_predict: 2,
    },
  };

  let bespoke_response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bespoke_body),
  });
  // TODO Error handling
  let response_text = await bespoke_response.text();
  return response_text;
}

// Add this to your background.js
let extensionLogs = [];
const MAX_LOGS = 1000;

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "log") {
    // Store log
    extensionLogs.push({
      message: request.message,
      data: request.data,
      timestamp: request.timestamp,
      url: request.url,
      tabId: sender.tab ? sender.tab.id : "unknown",
    });

    // Also log to the console
    console.log("[Content.js log]", request.message, request.data);

    // Trim logs if they get too large
    if (extensionLogs.length > MAX_LOGS) {
      extensionLogs = extensionLogs.slice(-MAX_LOGS);
    }

    return true;
  }

  if (request.action === "getLogs") {
    sendResponse({ logs: extensionLogs });
    return true;
  }

  // Handle other messages...
});
