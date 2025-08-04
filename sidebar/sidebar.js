// SpaceLlama Sidebar - Enhanced Version
(function() {
  'use strict';

  // Enhanced browser detection
  const browserAPI = (() => {
    if (typeof browser !== 'undefined' && browser.runtime) return browser;
    if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
    return null;
  })();

  if (!browserAPI) {
    console.error('[SpaceLlama] Browser API not available');
    return;
  }

  console.log('[SpaceLlama] Sidebar script loaded with browser API:', browserAPI.runtime.id);

  // Process think tags from AI responses
  function processThinkTags(content) {
    if (!content || typeof content !== 'string') {
      return marked.parse(content || '');
    }

    // Regular expression to match <think>...</think> tags (case insensitive, multiline)
    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
    const thinkMatches = [];
    let match;
    
    // Extract all think tag contents
    while ((match = thinkRegex.exec(content)) !== null) {
      thinkMatches.push(match[1].trim());
    }
    
    // Remove think tags from main content
    const cleanContent = content.replace(thinkRegex, '').trim();
    
    // If no think tags found, return normal processed content
    if (thinkMatches.length === 0) {
      return marked.parse(cleanContent);
    }
    
    // Create collapsible thought process section
    const thoughtProcess = thinkMatches.join('\n\n---\n\n');
    const thoughtProcessHtml = `
      <div class="thought-process-container" style="margin-top: 20px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
        <details class="thought-process-details">
          <summary class="thought-process-summary" style="cursor: pointer; font-weight: 600; color: #6b7280; font-size: 14px; margin-bottom: 12px; user-select: none;">
            🧠 Thought Process (${thinkMatches.length} step${thinkMatches.length > 1 ? 's' : ''})
          </summary>
          <div class="thought-process-content" style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-top: 8px; font-size: 13px; color: #4b5563; font-family: monospace; white-space: pre-wrap; line-height: 1.4; border-left: 4px solid #e5e7eb;">
            ${thoughtProcess}
          </div>
        </details>
      </div>
    `;
    
    // Return main content + thought process section
    return marked.parse(cleanContent) + thoughtProcessHtml;
  }

  // Create summary actions (copy button, word count, etc.)
  function createSummaryActions(summaryText) {
    if (!summaryText || typeof summaryText !== 'string') {
      return '';
    }

    // Clean text for word count (remove HTML, think tags, etc.)
    const cleanText = summaryText
      .replace(/<think>[\s\S]*?<\/think>/gi, '') // Remove think tags
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .trim();
    
    const wordCount = cleanText.split(/\s+/).filter(word => word.length > 0).length;
    const readingTime = Math.max(1, Math.ceil(wordCount / 200)); // ~200 words per minute
    
    return `
      <div class="summary-actions" style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div class="summary-stats" style="font-size: 12px; color: #6b7280;">
          📊 ${wordCount} words • ⏱️ ${readingTime} min read
        </div>
        <div class="summary-buttons" style="display: flex; gap: 8px;">
          <button class="copy-summary-btn" style="
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
          " onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)'" onmouseout="this.style.transform=''; this.style.boxShadow=''">
            📋 Copy Summary
          </button>
        </div>
      </div>
    `;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const summarizeButton = document.getElementById("summarize");
    const summaryDiv = document.getElementById("summary");
    const openOptionsButton = document.getElementById("open-options");
    const systemPromptTextarea = document.getElementById("system-prompt");
    const savePromptButton = document.getElementById("save-prompt");
    const viewLogsButton = document.getElementById("view-logs");
    
    // Initialize empty summary state
    summaryDiv.classList.add('empty');
    
    // Create status div for better user feedback
    const statusDiv = document.createElement("div");
    statusDiv.id = "status-container";
    statusDiv.style.marginTop = "12px";
    summarizeButton.parentNode.insertBefore(statusDiv, summarizeButton.nextSibling);

    // Enhanced summarize function
    summarizeButton.addEventListener("click", async () => {
      try {
        console.log('[SpaceLlama] Summarize button clicked');
        
        // Enhanced loading state
        summaryDiv.classList.remove('empty');
        summaryDiv.classList.add('loading');
        summaryDiv.innerHTML = `
          <div class="loading-spinner"></div>
          <div class="loading-text">Analyzing page content...</div>
        `;
        
        summarizeButton.disabled = true;
        summarizeButton.classList.add('loading');
        summarizeButton.innerHTML = '⏳ Processing...';
        
        statusDiv.innerHTML = '';

        // Get current tab with better error handling
        const tabs = await new Promise((resolve, reject) => {
          browserAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (browserAPI.runtime.lastError) {
              reject(new Error(browserAPI.runtime.lastError.message));
            } else {
              resolve(tabs);
            }
          });
        });

        if (!tabs || tabs.length === 0) {
          throw new Error('Unable to access current tab');
        }

        const currentTab = tabs[0];
        const currentUrl = currentTab.url;
        console.log('[SpaceLlama] Current URL:', currentUrl);

        // Check if YouTube video
        const isYouTubeUrl = currentUrl.includes("youtube.com/watch") ||
                            currentUrl.includes("youtu.be/") ||
                            currentUrl.includes("/watch?v=");

        if (isYouTubeUrl) {
          statusDiv.innerHTML = `
            <div class="status-badge youtube">
              🎥 YouTube video detected - fetching transcript
            </div>
          `;
          summaryDiv.innerHTML = `
            <div class="loading-spinner"></div>
            <div class="loading-text">Processing video transcript...</div>
          `;
        }

        // Get page content
        const contentResponse = await new Promise((resolve, reject) => {
          browserAPI.tabs.sendMessage(currentTab.id, { action: "getContent" }, (response) => {
            if (browserAPI.runtime.lastError) {
              reject(new Error(browserAPI.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });

        console.log('[SpaceLlama] Content response:', contentResponse);

        if (!contentResponse || !contentResponse.content) {
          throw new Error('Could not retrieve page content');
        }

        const systemPrompt = systemPromptTextarea.value.trim();
        if (!systemPrompt) {
          throw new Error('System prompt is required');
        }

        // Detect YouTube content and customize prompt
        let isYouTubeContent = contentResponse.content.includes("Title:") &&
                              contentResponse.content.includes("Transcript:") &&
                              isYouTubeUrl;

        const failedToFetchSubtitles = contentResponse.content.includes("NO TRANSCRIPT AVAILABLE");
        
        if (failedToFetchSubtitles) {
          console.log('[SpaceLlama] No subtitles available for video');
          isYouTubeContent = false;
        }

        const customizedPrompt = isYouTubeContent
          ? `${systemPrompt}\n\nThis is a YouTube video transcript. Please summarize the key points discussed in the video.`
          : systemPrompt;

        // Update loading state for summarization
        summaryDiv.innerHTML = `
          <div class="loading-spinner"></div>
          <div class="loading-text">Generating summary with AI...</div>
        `;

        // Send to background for summarization
        const summaryResponse = await new Promise((resolve, reject) => {
          browserAPI.runtime.sendMessage({
            action: "summarize",
            content: contentResponse.content,
            systemPrompt: customizedPrompt,
          }, (response) => {
            if (browserAPI.runtime.lastError) {
              reject(new Error(browserAPI.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });

        console.log('[SpaceLlama] Summary response:', summaryResponse);

        if (summaryResponse && summaryResponse.summary) {
          summaryDiv.classList.remove('loading');
          
          let statusBadges = '';
          if (summaryResponse.chunkCount > 1) {
            statusBadges += `
              <div class="status-badge warning">
                ⚠️ Large content processed in ${summaryResponse.chunkCount} chunks
              </div>
            `;
          }

          if (failedToFetchSubtitles) {
            statusBadges = `
              <div class="status-badge warning">
                ⚠️ No transcript available - used video metadata instead
              </div>
            ` + statusBadges;
          }

          if (isYouTubeContent) {
            statusBadges = `
              <div class="status-badge success">
                ✅ YouTube video successfully summarized from transcript
              </div>
            ` + statusBadges;
          }

          let summaryText;
          if (typeof summaryResponse.summary === "string") {
            summaryText = summaryResponse.summary;
          } else if (typeof summaryResponse.summary === "object") {
            summaryText = Object.entries(summaryResponse.summary)
              .map(([key, value]) => `## ${key}\n\n${value}`)
              .join("\n\n");
          } else {
            summaryText = JSON.stringify(summaryResponse.summary);
          }

          // Process think tags and create collapsible thought process section
          const processedContent = processThinkTags(summaryText);
          
          // Add copy button and word count
          const summaryActions = createSummaryActions(summaryText);
          
          statusDiv.innerHTML = statusBadges;
          summaryDiv.innerHTML = processedContent + summaryActions;
        } else if (summaryResponse && summaryResponse.error) {
          throw new Error(summaryResponse.error);
        } else {
          throw new Error("Unexpected response from summarization service");
        }

      } catch (error) {
        console.error('[SpaceLlama] Error during summarization:', error);
        handleError(error.message, error);
      } finally {
        resetButtonState();
      }
    });

    // Options button
    openOptionsButton.addEventListener("click", () => {
      browserAPI.runtime.openOptionsPage();
    });

    // Error handler
    function handleError(errorMessage, error = null) {
      console.error("[SpaceLlama] Error:", errorMessage, error);
      
      summaryDiv.classList.remove('loading', 'empty');
      
      // Enhanced error display
      let errorDetails = '';
      if (error && error.stack) {
        errorDetails = `
          <details style="margin-top: 16px; text-align: left;">
            <summary style="cursor: pointer; font-weight: 600;">Technical Details</summary>
            <pre style="background: #f9fafb; padding: 12px; border-radius: 6px; font-size: 12px; margin-top: 8px; overflow: auto;">${error.stack}</pre>
          </details>
        `;
      }
      
      statusDiv.innerHTML = `
        <div class="status-badge error">
          ❌ ${errorMessage}
        </div>
      `;
      
      summaryDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #dc2626;">
          <h3>⚠️ Error occurred</h3>
          <p>${errorMessage}</p>
          ${errorDetails}
          <div style="margin-top: 16px; font-size: 14px; color: #6b7280;">
            <p><strong>Troubleshooting:</strong></p>
            <ul style="text-align: left; max-width: 300px; margin: 0 auto;">
              <li>Check if Ollama is running</li>
              <li>Verify endpoint in settings</li>
              <li>Ensure model is available</li>
              <li>Check browser console for details</li>
            </ul>
          </div>
        </div>
      `;
    }
    
    function resetButtonState() {
      summarizeButton.disabled = false;
      summarizeButton.classList.remove('loading');
      summarizeButton.innerHTML = '🚀 Summarize';
    }

    // System prompt management
    function loadSystemPrompt() {
      browserAPI.storage.local.get("systemPrompt").then((result) => {
        const defaultSystemPrompt = "You are a helpful AI assistant. Summarize the given text concisely, preserving key information and insights. Focus on the main points while maintaining clarity and readability.";
        systemPromptTextarea.value = result.systemPrompt || defaultSystemPrompt;
      }).catch(error => {
        console.error('[SpaceLlama] Failed to load system prompt:', error);
      });
    }

    savePromptButton.addEventListener("click", () => {
      const systemPrompt = systemPromptTextarea.value.trim();
      
      if (!systemPrompt) {
        alert('System prompt cannot be empty');
        return;
      }
      
      savePromptButton.disabled = true;
      savePromptButton.textContent = 'Saving...';
      
      browserAPI.storage.local.set({ systemPrompt }).then(() => {
        savePromptButton.textContent = '✅ Saved!';
        setTimeout(() => {
          savePromptButton.disabled = false;
          savePromptButton.textContent = 'Save Prompt';
        }, 2000);
      }).catch(error => {
        console.error('[SpaceLlama] Failed to save prompt:', error);
        alert('Failed to save system prompt. Please try again.');
        savePromptButton.disabled = false;
        savePromptButton.textContent = 'Save Prompt';
      });
    });

    // Debug logs functionality
    if (viewLogsButton) {
      let logsVisible = false;

      viewLogsButton.addEventListener("click", () => {
        const logsDiv = document.getElementById("logs-container");

        if (logsVisible && logsDiv) {
          logsDiv.remove();
          logsVisible = false;
          viewLogsButton.textContent = "View Debug Logs";
          return;
        }

        browserAPI.runtime.sendMessage({ action: "getLogs" }, (response) => {
          if (browserAPI.runtime.lastError) {
            console.error('[SpaceLlama] Failed to get logs:', browserAPI.runtime.lastError);
            return;
          }

          if (response && response.logs) {
            if (logsDiv) {
              logsDiv.remove();
            }

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

            response.logs.slice().reverse().forEach((log) => {
              const logEntry = document.createElement("div");
              logEntry.style.marginBottom = "5px";
              logEntry.style.borderBottom = "1px dotted #ddd";
              logEntry.style.paddingBottom = "5px";

              if (log.message.includes("Error") || log.message.includes("WARNING")) {
                logEntry.style.color = log.message.includes("Error") ? "#d32f2f" : "#ff9800";
                logEntry.style.fontWeight = "bold";
              }

              logEntry.textContent = `[${log.timestamp}] ${log.message}`;
              if (log.data) {
                logEntry.textContent += ` ${JSON.stringify(log.data)}`;
              }
              logList.appendChild(logEntry);
            });

            newLogsDiv.appendChild(logList);
            summaryDiv.appendChild(newLogsDiv);
            logsVisible = true;
            viewLogsButton.textContent = "Hide Debug Logs";
          }
        });
      });
    }

    // Event delegation for dynamically created copy button
    summaryDiv.addEventListener('click', async (event) => {
      if (event.target.classList.contains('copy-summary-btn')) {
        const button = event.target;
        const originalText = button.innerHTML;
        
        try {
          // Get the clean summary text (without HTML and think tags)
          const summaryContainer = summaryDiv.querySelector('p, div');
          let textToCopy = '';
          
          if (summaryContainer) {
            // Extract text content, preserving line breaks
            textToCopy = summaryContainer.innerText || summaryContainer.textContent || '';
          }
          
          if (!textToCopy) {
            // Fallback: get all text from summary div, excluding actions
            const tempDiv = summaryDiv.cloneNode(true);
            const actionsDiv = tempDiv.querySelector('.summary-actions');
            if (actionsDiv) actionsDiv.remove();
            const thoughtDiv = tempDiv.querySelector('.thought-process-container');
            if (thoughtDiv) thoughtDiv.remove();
            textToCopy = tempDiv.innerText || tempDiv.textContent || '';
          }
          
          // Copy to clipboard
          await navigator.clipboard.writeText(textToCopy.trim());
          
          // Show success feedback
          button.innerHTML = '✅ Copied!';
          button.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)';
          
          setTimeout(() => {
            button.innerHTML = originalText;
            button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
          }, 2000);
          
        } catch (error) {
          console.error('[SpaceLlama] Failed to copy to clipboard:', error);
          
          // Show error feedback
          button.innerHTML = '❌ Failed';
          button.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
          
          setTimeout(() => {
            button.innerHTML = originalText;
            button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
          }, 2000);
        }
      }
    });


    // Initialize
    loadSystemPrompt();
    
    console.log('[SpaceLlama] Sidebar fully initialized');
  });
})();