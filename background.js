console.log("Background script loaded");

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    const tokenCount = estimateTokenCount(request.content);
    summarizeContent(request.content, request.systemPrompt)
      .then((summary) => {
        sendResponse({ summary, tokenCount });
      })
      .catch((error) => {
        console.error("Error in summarizeContent:", error);
        sendResponse({ error: error.toString(), details: error.details, tokenCount });
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
  const model = settings.ollamaModel || "llama2";
  const tokenLimit = settings.tokenLimit || 4096;

  const maxContentTokens = tokenLimit - estimateTokenCount(systemPrompt) - 100; // Reserve 100 tokens for safety

  try {
    console.log(`Using system prompt: ${systemPrompt}`);
    let summary = "";
    let chunks = splitContentIntoChunks(content, maxContentTokens);

    for (let chunk of chunks) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\nFollow the above instructions and summarize the following text:\n\n${chunk}`,
          model: model,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `HTTP error! status: ${response.status}, message: ${errorText}`
        );
      }

      const data = await response.json();
      summary += data.response + "\n\n";
    }

    if (chunks.length > 1) {
      // If we had multiple chunks, summarize the summary
      const finalResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `${systemPrompt}\n\nFollow the above instructions and provide a final summary of the following summaries:\n\n${summary}`,
          model: model,
          stream: false,
        }),
      });

      if (!finalResponse.ok) {
        const errorText = await finalResponse.text();
        throw new Error(
          `HTTP error! status: ${finalResponse.status}, message: ${errorText}`
        );
      }

      const finalData = await finalResponse.json();
      summary = finalData.response;
    }

    return summary.trim();
  } catch (error) {
    console.error("Error details:", error);
    error.details = {
      endpoint: endpoint,
      model: model,
      message: error.message,
    };
    throw error;
  }
}

function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

function splitContentIntoChunks(content, maxTokens) {
  const chunks = [];
  let currentChunk = "";

  const sentences = content.split(/(?<=[.!?])\s+/);

  for (let sentence of sentences) {
    if (estimateTokenCount(currentChunk + sentence) > maxTokens) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      if (estimateTokenCount(sentence) > maxTokens) {
        // If a single sentence is too long, split it
        while (sentence) {
          const chunk = sentence.slice(0, maxTokens * 4); // Approximate characters
          chunks.push(chunk.trim());
          sentence = sentence.slice(maxTokens * 4);
        }
      } else {
        currentChunk = sentence;
      }
    } else {
      currentChunk += " " + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
