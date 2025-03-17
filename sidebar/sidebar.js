let isFirefox = typeof InstallTrigger !== "undefined"; // Firefox has `InstallTrigger`
let browser = isFirefox ? window.browser : chrome;

document.addEventListener("DOMContentLoaded", () => {
  const summarizeButton = document.getElementById("summarize");
  const summaryDiv = document.getElementById("summary");
  const openOptionsButton = document.getElementById("open-options");
  const tokenCountDiv = document.createElement("div");
  tokenCountDiv.id = "token-count";
  tokenCountDiv.style.marginTop = "10px";
  tokenCountDiv.style.fontStyle = "italic";

  summarizeButton.parentNode.insertBefore(
    tokenCountDiv,
    summarizeButton.nextSibling
  );
  // Correctly define systemPromptTextarea
  const systemPromptTextarea = document.getElementById("system-prompt");

  summarizeButton.addEventListener("click", () => {
    summaryDiv.innerHTML = "<p>Summarizing...</p>";
    console.log("Summarizing...");
    tokenCountDiv.textContent = "";
    summarizeButton.disabled = true;

    // Get the current tab content
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      // First check if the current URL is a YouTube video
      const currentUrl = tabs[0].url;
      console.log("Current URL:", currentUrl);
      const isYouTubeUrl =
        currentUrl.includes("youtube.com/watch") ||
        currentUrl.includes("youtu.be/") ||
        currentUrl.includes("/watch?v=");
      console.log("Is YouTube URL:", isYouTubeUrl);

      if (isYouTubeUrl) {
        // Show a notification that we're processing a YouTube video
        summaryDiv.innerHTML = `
          <div style="background-color: #1a73e8; color: white; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
            <strong>YouTube Video Detected!</strong><br>
            Fetching and processing video transcript...
          </div>
          <p>Summarizing video content...</p>
        `;
      }

      browser.tabs.sendMessage(
        tabs[0].id,
        { action: "getContent" },
        (response) => {
          console.log("Response:", response);
          if (browser.runtime.lastError) {
            handleError(
              "Error getting page content: " + browser.runtime.lastError.message
            );
            return;
          }

          if (response && response.content) {
            const systemPrompt = systemPromptTextarea.value;
            var failedToFetchSubtitles = false;
            // Check if the content appears to be from YouTube
            var isYouTubeContent =
              response.content.includes("Title:") &&
              response.content.includes("Transcript:") &&
              (tabs[0].url.includes("youtube.com") ||
                tabs[0].url.includes("youtu.be") ||
                tabs[0].url.includes("/watch?v="));
            console.log("Is YouTube Content:", isYouTubeContent);
            if (response.content.includes("NO TRANSCRIPT AVAILABLE")) {
              console.log(
                "Warning: No subtitles available for this video: setting isYouTubeContent to false"
              );
              failedToFetchSubtitles = true;
              isYouTubeContent = false;
            }
            // Customize the prompt for YouTube videos
            const customizedPrompt = isYouTubeContent
              ? `${systemPrompt}\n\nThis is a YouTube video transcript. Please summarize the key points discussed in the video.`
              : systemPrompt;
            console.log("System prompt:", customizedPrompt);

            // Send message to background script for summarization
            browser.runtime.sendMessage(
              {
                action: "summarize",
                content: response.content,
                systemPrompt: customizedPrompt,
              },
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

                  if (failedToFetchSubtitles) {
                    warningHtml =
                      `
                      <div class="warning" style="background-color: #fff3cd; color: #856404; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                        <strong>Warning:</strong> Failed to fetch subtitles for this video: using video description and metadata instead.
                      </div>
                    ` + warningHtml;
                  }

                  // Add YouTube notification if it's a YouTube video
                  if (isYouTubeContent) {
                    warningHtml =
                      `
                      <div style="background-color: #1a73e8; color: white; padding: 10px; margin-bottom: 10px; border-radius: 4px;">
                        <strong>YouTube Video Summary</strong><br>
                        This summary was generated from the video transcript.
                      </div>
                    ` + warningHtml;
                  }

                  let summaryText;
                  if (typeof response.summary === "string") {
                    summaryText = response.summary;
                  } else if (typeof response.summary === "object") {
                    // Convert JSON to Markdown
                    summaryText = Object.entries(response.summary)
                      .map(([key, value]) => `## ${key}\n\n${value}`)
                      .join("\n\n");
                  } else {
                    summaryText = JSON.stringify(response.summary);
                  }

                  // Render the Markdown content with warning if applicable
                  summaryDiv.innerHTML =
                    warningHtml + marked.parse(summaryText);
                  // NOTE Token count is disabled if not needed
                  //tokenCountDiv.textContent = `Token count: ${response.tokenCount}`;
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

  const viewLogsButton = document.getElementById("view-logs");

  // Only add the event listener if the button exists
  if (viewLogsButton) {
    // Add the same CSS class as other buttons
    viewLogsButton.className = "button";

    let logsVisible = false;

    viewLogsButton.addEventListener("click", () => {
      const logsDiv = document.getElementById("logs-container");

      // Toggle logs visibility
      if (logsVisible && logsDiv) {
        // Hide logs if they're currently visible
        logsDiv.remove();
        logsVisible = false;
        viewLogsButton.textContent = "View Debug Logs";
        return;
      }

      // Show logs
      browser.runtime.sendMessage({ action: "getLogs" }, (response) => {
        if (response && response.logs) {
          // Remove existing logs container if it exists
          if (logsDiv) {
            logsDiv.remove();
          }

          // Create new logs container
          const newLogsDiv = document.createElement("div");
          newLogsDiv.id = "logs-container";
          newLogsDiv.style.marginTop = "20px";
          newLogsDiv.style.borderTop = "1px solid #ccc";
          newLogsDiv.innerHTML = "<h3>Extension Logs</h3>";

          const logList = document.createElement("pre");
          logList.style.maxHeight = "400px";
          logList.style.overflow = "auto";
          logList.style.whiteSpace = "pre-wrap";
          logList.style.fontSize = "12px";
          logList.style.backgroundColor = "#f5f5f5";
          logList.style.padding = "10px";
          logList.style.borderRadius = "4px";

          // Add logs in reverse chronological order (newest first)
          response.logs
            .slice()
            .reverse()
            .forEach((log) => {
              const logEntry = document.createElement("div");
              logEntry.style.marginBottom = "5px";
              logEntry.style.borderBottom = "1px dotted #ddd";
              logEntry.style.paddingBottom = "5px";

              // Highlight important logs
              if (
                log.message.includes("No subtitles") ||
                log.message.includes("Using alternative text") ||
                log.message.includes("Error")
              ) {
                logEntry.style.color = log.message.includes("Error")
                  ? "#d32f2f"
                  : "#ff9800";
                logEntry.style.fontWeight = "bold";
              }

              logEntry.textContent = `[${log.timestamp}] ${log.message}`;
              if (log.data) {
                logEntry.textContent += ` ${JSON.stringify(log.data)}`;
              }
              logList.appendChild(logEntry);
            });

          newLogsDiv.appendChild(logList);
          document.getElementById("summary").appendChild(newLogsDiv);
          logsVisible = true;
          viewLogsButton.textContent = "Hide Debug Logs";
        }
      });
    });
  } else {
    console.warn("View logs button not found in the sidebar");
  }
});

const systemPromptTextarea = document.getElementById("system-prompt");
const savePromptButton = document.getElementById("save-prompt");

// Load saved system prompt
browser.storage.local.get("systemPrompt").then((result) => {
  const defaultSystemPrompt =
    "You are a helpful AI assistant. Summarize the given text concisely.";
  systemPromptTextarea.value = result.systemPrompt || defaultSystemPrompt;
});

savePromptButton.addEventListener("click", () => {
  const systemPrompt = systemPromptTextarea.value;
  browser.storage.local.set({ systemPrompt }).then(() => {
    alert("System prompt saved successfully!");
  });
});
