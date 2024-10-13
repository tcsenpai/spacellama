document.addEventListener("DOMContentLoaded", () => {
  const summarizeButton = document.getElementById("summarize");
  const summaryDiv = document.getElementById("summary");
  const openOptionsButton = document.getElementById("open-options");
  const tokenCountDiv = document.createElement("div");
  tokenCountDiv.id = "token-count";
  tokenCountDiv.style.marginTop = "10px";
  tokenCountDiv.style.fontStyle = "italic";

  summarizeButton.parentNode.insertBefore(tokenCountDiv, summarizeButton.nextSibling);

  summarizeButton.addEventListener("click", () => {
    summaryDiv.innerHTML = "<p>Summarizing...</p>";
    tokenCountDiv.textContent = "";
    summarizeButton.disabled = true;

    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      browser.tabs.sendMessage(
        tabs[0].id,
        { action: "getContent" },
        (response) => {
          if (browser.runtime.lastError) {
            handleError(
              "Error getting page content: " + browser.runtime.lastError.message
            );
            return;
          }

          if (response && response.content) {
            const systemPrompt = systemPromptTextarea.value;
            browser.runtime.sendMessage(
              { action: "summarize", content: response.content, systemPrompt: systemPrompt },
              (response) => {
                if (browser.runtime.lastError) {
                  handleError(
                    "Error during summarization: " +
                      browser.runtime.lastError.message
                  );
                  return;
                }

                if (response && response.summary) {
                  let warningHtml = "";
                  if (response.chunkCount > 1) {
                    warningHtml = `
                      <div class="warning" style="background-color: #fff3cd; color: #856404; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                        <strong>Warning:</strong> The content was split into ${response.chunkCount} chunks for summarization.
                        Recursive summarization depth: ${response.recursionDepth}.
                        This may affect the quality and coherence of the summary, and might result in slower performance.
                      </div>
                    `;
                  }

                  let summaryText;
                  if (typeof response.summary === 'string') {
                    summaryText = response.summary;
                  } else if (typeof response.summary === 'object') {
                    // Convert JSON to Markdown
                    summaryText = Object.entries(response.summary)
                      .map(([key, value]) => `## ${key}\n\n${value}`)
                      .join('\n\n');
                  } else {
                    summaryText = JSON.stringify(response.summary);
                  }

                  // Render the Markdown content with warning if applicable
                  summaryDiv.innerHTML = warningHtml + marked.parse(summaryText);
                  tokenCountDiv.textContent = `Token count: ${response.tokenCount}`;
                } else if (response && response.error) {
                  handleError(response.error, response.details);
                  if (response.tokenCount) {
                    tokenCountDiv.textContent = `Token count: ${response.tokenCount}`;
                  }
                } else {
                  handleError("Unexpected response from summarization");
                }
                summarizeButton.disabled = false;
              }
            );
          } else {
            handleError("Error: Could not retrieve page content.");
          }
        }
      );
    });
  });

  openOptionsButton.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });

  function handleError(errorMessage, details = null) {
    console.error("Error:", errorMessage, details);
    summaryDiv.innerHTML = `<p>Error: ${errorMessage}</p>`;
    if (details) {
      summaryDiv.innerHTML += `<pre>${JSON.stringify(details, null, 2)}</pre>`;
    }
    summarizeButton.disabled = false;
  }
});

const systemPromptTextarea = document.getElementById("system-prompt");
const savePromptButton = document.getElementById("save-prompt");

// Load saved system prompt
browser.storage.local.get("systemPrompt").then((result) => {
  const defaultSystemPrompt = "You are a helpful AI assistant. Summarize the given text concisely.";
  systemPromptTextarea.value = result.systemPrompt || defaultSystemPrompt;
});

savePromptButton.addEventListener("click", () => {
  const systemPrompt = systemPromptTextarea.value;
  browser.storage.local.set({ systemPrompt }).then(() => {
    alert("System prompt saved successfully!");
  });
});
