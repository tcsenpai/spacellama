console.log("[SpaceLlama] Background script loaded successfully");

// Browser detection with more robust check
const isFirefox = typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL;
const browserAPI = isFirefox ? browser : (typeof chrome !== 'undefined' ? chrome : null);

if (!browserAPI) {
  console.error('Browser API not detected. Extension may not work correctly.');
}

console.log('[SpaceLlama] Browser detected:', isFirefox ? 'Firefox' : 'Chrome/Chromium');

// Check if chrome.action or browser.action is available
if (isFirefox && browserAPI.browserAction) {
  // Firefox specific: Use browserAction
  browserAPI.browserAction.onClicked.addListener(() => {
    console.log("Firefox: Toggling sidebar");
    browserAPI.sidebarAction.toggle();
  });
} else if (browserAPI.action) {
  // Chrome specific: Use action and inject the sidebar iframe
  browserAPI.action.onClicked.addListener((tab) => {
    console.log("Injecting sidebar iframe into the page");

    // Use the tab object properly here
    browserAPI.scripting.executeScript(
      {
        target: { tabId: tab.id }, // Pass the tab ID correctly
        function: injectSidebar,
      },
      () => {
        if (browserAPI.runtime.lastError) {
          console.error(
            "Error injecting sidebar:",
            browserAPI.runtime.lastError.message
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

// Consolidated message handler for all extension communications

async function summarizeContent(content, systemPrompt) {
  // Input validation
  if (!content || typeof content !== 'string') {
    throw new Error('Invalid content: Content must be a non-empty string');
  }
  
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    throw new Error('Invalid system prompt: System prompt must be a non-empty string');
  }
  
  // Sanitize content length
  const MAX_CONTENT_LENGTH = 1000000; // 1MB limit
  if (content.length > MAX_CONTENT_LENGTH) {
    console.warn(`Content too large (${content.length} chars), truncating to ${MAX_CONTENT_LENGTH}`);
    content = content.substring(0, MAX_CONTENT_LENGTH);
  }
  
  const settings = await browserAPI.storage.local.get([
    "ollamaEndpoint",
    "ollamaModel",
    "tokenLimit",
  ]);
  
  // Validate and sanitize settings
  const endpoint = validateEndpoint(settings.ollamaEndpoint) || "http://localhost:11434";
  const model = settings.ollamaModel || "llama3.1:8b";
  const tokenLimit = Math.min(Math.max(settings.tokenLimit || 4096, 1024), 128000); // Clamp between 1k and 128k

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
    console.error("[SpaceLLama] Error in summarizeContent:", error);
    error.details = {
      endpoint: endpoint,
      model: model,
      message: error.message,
      stack: error.stack,
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
  const MAX_RECURSION_DEPTH = 5; // Prevent infinite recursion
  
  if (depth > MAX_RECURSION_DEPTH) {
    console.warn(`Maximum recursion depth (${MAX_RECURSION_DEPTH}) reached`);
    return {
      summary: "Content too complex to summarize. Please try with a smaller document.",
      chunkCount: 0,
      recursionDepth: depth,
    };
  }
  
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
  // Configuration constants
  const CONFIG = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 8000,
    timeoutMultiplier: 25,
    backoffMultiplier: 2
  };
  
  let response;
  let retryCount = 0;
  let retryDelay = CONFIG.initialDelay;
  
  while (retryCount < CONFIG.maxRetries) {
    try {
      response = await fetch(`${endpoint}/api/generate`, {
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
        signal: AbortSignal.timeout(Math.min(CONFIG.timeoutMultiplier * retryDelay, 60000)), // Max 60s timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      break; // Success - exit the retry loop
    } catch (error) {
      console.error("Error in summarizeChunk:", error);
      retryCount++;

      if (retryCount >= CONFIG.maxRetries) {
        throw new Error(
          `Failed to summarize chunk after ${CONFIG.maxRetries} retries: ${error.message}`
        );
      }

      console.log(`Retry ${retryCount}/${CONFIG.maxRetries} after ${retryDelay}ms`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * CONFIG.backoffMultiplier, CONFIG.maxDelay);
    }
  }

  let data;
  try {
    data = await response.json();
  } catch (jsonError) {
    throw new Error(`Failed to parse response JSON: ${jsonError.message}`);
  }
  
  if (!data || !data.response) {
    throw new Error('Invalid response format from Ollama API');
  }
  
  // Optional fact-checking (disabled by default)
  const factCheckEnabled = false; // Can be made configurable
  if (factCheckEnabled) {
    try {
      const factCheckResult = await bespokeMinicheck(chunk, data.response, endpoint);
      console.log('Fact check result:', factCheckResult);
    } catch (factCheckError) {
      console.warn('Fact checking failed:', factCheckError);
      // Continue without fact checking
    }
  }
  
  return data.response;
}

function estimateTokenCount(text) {
  // More accurate token estimation based on common patterns
  if (!text || typeof text !== 'string') return 0;
  
  // Account for whitespace and punctuation which typically result in more tokens
  const words = text.match(/\b\w+\b/g) || [];
  const punctuation = text.match(/[.,;:!?]/g) || [];
  
  // Rough estimate: 1 token per word + 0.3 tokens per punctuation
  // Plus additional tokens for special characters and formatting
  return Math.ceil(words.length * 1.2 + punctuation.length * 0.3);
}

// Helper function to validate endpoint URLs
function validateEndpoint(endpoint) {
  if (!endpoint) return null;
  
  try {
    const url = new URL(endpoint);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      console.error('Invalid protocol in endpoint URL');
      return null;
    }
    return endpoint;
  } catch (e) {
    console.error('Invalid endpoint URL:', e);
    return null;
  }
}

function splitContentIntoChunks(content, tokenLimit, systemPrompt) {
  const SAFETY_BUFFER = 150; // Increased safety buffer
  const maxTokens = tokenLimit - estimateTokenCount(systemPrompt) - SAFETY_BUFFER;
  
  if (maxTokens <= 0) {
    console.error('Token limit too small for content chunking');
    return [content]; // Return as single chunk and let API handle truncation
  }
  
  const chunks = [];
  
  // Try to split on paragraph boundaries first for better context preservation
  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = "";
  let currentTokens = 0;
  
  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokenCount(paragraph);
    
    // If a single paragraph exceeds limit, split it by sentences
    if (paragraphTokens > maxTokens) {
      // Flush current chunk if any
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
        currentTokens = 0;
      }
      
      // Split large paragraph by sentences
      const sentences = paragraph.match(/[^.!?]+[.!?]+/g) || [paragraph];
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokenCount(sentence);
        
        if (currentTokens + sentenceTokens > maxTokens) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
            currentTokens = sentenceTokens;
          } else {
            // Single sentence exceeds limit, split by words as last resort
            const words = sentence.split(/\s+/);
            let wordChunk = "";
            let wordTokens = 0;
            
            for (const word of words) {
              const wordTokenCount = estimateTokenCount(word);
              if (wordTokens + wordTokenCount > maxTokens) {
                if (wordChunk) {
                  chunks.push(wordChunk.trim());
                  wordChunk = word;
                  wordTokens = wordTokenCount;
                } else {
                  // Single word exceeds limit - this shouldn't happen in practice
                  chunks.push(word);
                }
              } else {
                wordChunk += (wordChunk ? " " : "") + word;
                wordTokens += wordTokenCount;
              }
            }
            
            currentChunk = wordChunk;
            currentTokens = wordTokens;
          }
        } else {
          currentChunk += (currentChunk ? " " : "") + sentence;
          currentTokens += sentenceTokens;
        }
      }
    } else if (currentTokens + paragraphTokens > maxTokens) {
      // Start new chunk
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
      currentTokens = paragraphTokens;
    } else {
      // Add to current chunk
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
      currentTokens += paragraphTokens;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  console.log(`Content split into ${chunks.length} chunks, average size: ${Math.round(content.length / chunks.length)} chars`);
  return chunks;
}

async function bespokeMinicheck(chunk, summary, endpoint) {
  const bespoke_prompt = `
    Document: ${chunk}
    Claim: This is a correct summary of the document:\n\n ${summary}
  `.trim();

  const bespoke_body = {
    prompt: bespoke_prompt,
    model: "bespoke-minicheck:latest",
    stream: false,
    num_ctx: 30000, // Model is 32k but we want to leave some buffer
    options: {
      temperature: 0.0,
      num_predict: 2,
    },
  };

  try {
    const bespoke_response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bespoke_body),
      signal: AbortSignal.timeout(30000), // 30s timeout
    });
    
    if (!bespoke_response.ok) {
      throw new Error(`Fact check failed with status: ${bespoke_response.status}`);
    }
    
    const response_data = await bespoke_response.json();
    return response_data.response || 'No response';
  } catch (error) {
    console.error('Bespoke minicheck error:', error);
    throw error;
  }
}

// Logging system with circular buffer for memory efficiency
class ExtensionLogger {
  constructor(maxLogs = 1000) {
    this.logs = [];
    this.maxLogs = maxLogs;
  }
  
  add(message, data, url, tabId) {
    this.logs.push({
      message,
      data,
      timestamp: new Date().toISOString(),
      url,
      tabId: tabId || 'unknown',
    });
    
    // Efficient circular buffer implementation
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }
  }
  
  getLogs() {
    return [...this.logs]; // Return copy to prevent external modification
  }
  
  clear() {
    this.logs = [];
  }
}

const extensionLogger = new ExtensionLogger(1000);

// Consolidated message handler for all extension communications
browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[SpaceLlama] Message received:', request.action, 'from sender:', sender.tab?.id || 'popup');
  
  switch (request.action) {
    case "summarize":
      console.log("[SpaceLLama] Summarization request received in background script.");
      const tokenCount = estimateTokenCount(request.content);
      summarizeContent(request.content, request.systemPrompt)
        .then((summary) => {
          console.log('[SpaceLLama] Summarization completed successfully');
          sendResponse({ summary, tokenCount });
        })
        .catch((error) => {
          console.error("[SpaceLLama] Error in summarizeContent:", error);
          sendResponse({
            error: error.toString(),
            details: error.details || { message: error.message, stack: error.stack },
            tokenCount,
          });
        });
      return true; // Indicates that we will send a response asynchronously
      
    case "log":
      extensionLogger.add(
        request.message,
        request.data,
        request.url,
        sender.tab?.id
      );
      console.log("[SpaceLLama Content.js]", request.message, request.data);
      sendResponse({ success: true });
      return true;
      
    case "getLogs":
      sendResponse({ logs: extensionLogger.getLogs() });
      return true;
      
    case "clearLogs":
      extensionLogger.clear();
      sendResponse({ success: true });
      return true;
      
    default:
      console.warn('[SpaceLLama] Unknown message action:', request.action);
      return false;
  }
});

console.log('[SpaceLlama] Background script message listener setup complete');
