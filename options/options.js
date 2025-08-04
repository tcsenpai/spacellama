// Enhanced browser detection
const browserAPI = (() => {
  if (typeof browser !== 'undefined' && browser.runtime) return browser;
  if (typeof chrome !== 'undefined' && chrome.runtime) return chrome;
  return null;
})();

if (!browserAPI) {
  console.error('[SpaceLlama] Browser API not available');
}

async function validateEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') {
    return false;
  }
  
  try {
    // Validate URL format
    new URL(endpoint);
    
    // Test connection with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(`${endpoint}/api/tags`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error("Endpoint validation timeout:", endpoint);
    } else {
      console.error("Error validating endpoint:", error);
    }
    return false;
  }
}

function updateEndpointStatus(isValid, message = '') {
  const statusElement = document.getElementById("endpoint-status");
  if (isValid) {
    statusElement.textContent = "✅";
    statusElement.title = "Endpoint is valid and responding";
    statusElement.style.color = "#10b981";
  } else {
    statusElement.textContent = "❌";
    statusElement.title = message || "Endpoint is invalid or unreachable";
    statusElement.style.color = "#ef4444";
  }
}

async function updateTokenLimit() {
  try {
    const modelTokens = await loadModelTokens();
    const model = document.getElementById("model").value.trim();
    const tokenLimitInput = document.getElementById("token-limit");

    if (!model) {
      tokenLimitInput.value = 16384;
      return;
    }

    // Try exact match first
    if (model in modelTokens) {
      tokenLimitInput.value = modelTokens[model];
    } else {
      // Try to find partial match
      const modelKey = Object.keys(modelTokens).find(key => 
        key.toLowerCase().includes(model.toLowerCase()) || 
        model.toLowerCase().includes(key.toLowerCase())
      );
      
      if (modelKey) {
        tokenLimitInput.value = modelTokens[modelKey];
      } else {
        // Default based on common model patterns
        if (model.includes('llama3') || model.includes('llama-3')) {
          tokenLimitInput.value = 128000;
        } else if (model.includes('mixtral')) {
          tokenLimitInput.value = 32768;
        } else if (model.includes('qwen')) {
          tokenLimitInput.value = 32768;
        } else {
          tokenLimitInput.value = 16384; // Safe default
        }
      }
    }
    
    // Add visual feedback
    tokenLimitInput.style.borderColor = '#10b981';
    setTimeout(() => {
      tokenLimitInput.style.borderColor = '';
    }, 1000);
    
  } catch (error) {
    console.error("Error updating token limit:", error.message || error);
    document.getElementById("token-limit").value = 16384;
  }
}

async function loadModelTokens() {
  try {
    const response = await fetch(browserAPI.runtime.getURL("model_tokens.json"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error loading model tokens:", error.message || error);
    // Return default tokens if loading fails
    return {
      "llama3.1:8b": 128000,
      "llama3.1:70b": 128000,
      "llama3.2:1b": 128000,
      "llama3.2:3b": 128000,
      "mistral": 8192,
      "mixtral": 32768,
      "qwen2.5:7b": 32768,
      "qwen2.5:14b": 32768,
      "default": 16384
    };
  }
}

async function saveOptions(e) {
  e.preventDefault();
  const endpoint = document.getElementById("endpoint").value;
  const model = document.getElementById("model").value;
  const systemPrompt = document.getElementById("system-prompt").value;
  const status = document.getElementById("status");
  const tokenLimit = document.getElementById("token-limit").value || 16384;
  const youtubeApiKey = document.getElementById("youtube-api-key").value;
  // Ensure the endpoint doesn't end with /api/generate
  const cleanEndpoint = endpoint.replace(/\/api\/generate\/?$/, "");
  showStatus("Validating endpoint...", "info");
  try {
    const isValid = await validateEndpoint(cleanEndpoint);
    updateEndpointStatus(isValid);
    if (isValid) {
      await browserAPI.storage.local.set({
        ollamaEndpoint: cleanEndpoint,
        ollamaModel: model,
        systemPrompt: systemPrompt,
        tokenLimit: parseInt(tokenLimit),
        youtubeApiKey: youtubeApiKey.trim(),
      });
      showStatus("Options saved and endpoint validated.", "success");
    } else {
      showStatus("Invalid endpoint. Please check the URL and try again.", "error");
    }
  } catch (error) {
    console.error("Error saving options:", error.message || error);
    showStatus("Error saving options.", "error");
  }
}

function restoreOptions() {
  browserAPI.storage.local.get(
    {
      ollamaEndpoint: "http://localhost:11434",
      ollamaModel: "llama3.1:8b",
      systemPrompt:
        "You are a helpful AI assistant. Summarize the given text concisely, without leaving out important information. You should aim to give a summary that is highly factual, useful and rich but still shorter than the original content, while not being too short.",
      tokenLimit: 16384,
      youtubeApiKey: "",
    },
    function (result) {
      document.getElementById("endpoint").value =
        result.ollamaEndpoint || "http://localhost:11434";
      document.getElementById("model").value =
        result.ollamaModel || "llama3.1:latest";
      document.getElementById("system-prompt").value =
        result.systemPrompt ||
        "You are a helpful AI assistant. Summarize the given text concisely.";
      document.getElementById("youtube-api-key").value = result.youtubeApiKey;

      // Call to updateTokenLimit remains async
      updateTokenLimit().then(() => {
        validateEndpoint(result.ollamaEndpoint).then((isValid) => {
          updateEndpointStatus(isValid);
        });
      });
    }
  );
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document
  .getElementById("settings-form")
  .addEventListener("submit", saveOptions);
// Fix the event listener bug and improve validation
document.getElementById("endpoint").addEventListener("blur", async (e) => {
  const endpoint = e.target.value.trim();
  if (!endpoint) {
    updateEndpointStatus(false, "Endpoint cannot be empty");
    return;
  }
  
  const statusElement = document.getElementById("endpoint-status");
  statusElement.textContent = "⏳";
  statusElement.title = "Validating endpoint...";
  statusElement.style.color = "#f59e0b";
  
  const isValid = await validateEndpoint(endpoint);
  updateEndpointStatus(isValid);
});

// Properly register model change listener
document.getElementById("model").addEventListener("change", updateTokenLimit);
document.getElementById("model").addEventListener("input", showModelSuggestions);

// Add model refresh functionality
document.getElementById("refresh-models").addEventListener("click", loadAvailableModels);

// Load available models from Ollama API
async function loadAvailableModels() {
  const refreshButton = document.getElementById("refresh-models");
  const modelList = document.getElementById("model-list");
  const endpoint = document.getElementById("endpoint").value.trim() || "http://localhost:11434";
  
  if (!endpoint) {
    showStatus("Please enter an endpoint first", "error");
    return;
  }
  
  // Show loading state
  refreshButton.disabled = true;
  refreshButton.textContent = "⏳ Loading...";
  
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Available models:', data);
    
    if (!data.models || !Array.isArray(data.models)) {
      throw new Error('Invalid response format from Ollama API');
    }
    
    displayAvailableModels(data.models);
    showStatus(`Loaded ${data.models.length} available models`, "success");
    
  } catch (error) {
    console.error('Error loading models:', error);
    let errorMessage = 'Failed to load models from Ollama';
    
    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout - check if Ollama is running';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Cannot connect to Ollama - check endpoint and CORS settings';
    }
    
    showStatus(errorMessage, "error");
    modelList.style.display = 'none';
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "🔄 Load Available Models";
  }
}

// Display available models in a dropdown
function displayAvailableModels(models) {
  const modelList = document.getElementById("model-list");
  const modelInput = document.getElementById("model");
  
  if (models.length === 0) {
    modelList.innerHTML = '<div class="model-item">No models found</div>';
    modelList.style.display = 'block';
    return;
  }
  
  modelList.innerHTML = '';
  
  models.forEach(model => {
    const modelItem = document.createElement('div');
    modelItem.className = 'model-item';
    modelItem.style.cssText = `
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f0f0f0;
      transition: background-color 0.2s ease;
      font-family: monospace;
    `;
    
    // Format model information
    const modelName = model.name;
    const modelSize = model.size ? formatBytes(model.size) : 'Unknown size';
    const modifiedDate = model.modified_at ? new Date(model.modified_at).toLocaleDateString() : '';
    
    modelItem.innerHTML = `
      <div style="font-weight: 600; color: #374151; margin-bottom: 4px;">${modelName}</div>
      <div style="font-size: 12px; color: #6b7280;">
        Size: ${modelSize}
        ${modifiedDate ? `• Modified: ${modifiedDate}` : ''}
      </div>
    `;
    
    modelItem.addEventListener('mouseover', () => {
      modelItem.style.backgroundColor = '#f8fafc';
    });
    
    modelItem.addEventListener('mouseout', () => {
      modelItem.style.backgroundColor = '';
    });
    
    modelItem.addEventListener('click', () => {
      modelInput.value = modelName;
      modelList.style.display = 'none';
      updateTokenLimit(); // Update token limit for selected model
    });
    
    modelList.appendChild(modelItem);
  });
  
  modelList.style.display = 'block';
}

// Format bytes to human readable format
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Show model suggestions as user types
function showModelSuggestions() {
  const modelInput = document.getElementById("model");
  const modelList = document.getElementById("model-list");
  const inputValue = modelInput.value.toLowerCase().trim();
  
  if (inputValue.length < 2) {
    modelList.style.display = 'none';
    return;
  }
  
  // Filter available models based on input
  const allItems = modelList.querySelectorAll('.model-item');
  let visibleItems = 0;
  
  allItems.forEach(item => {
    const modelName = item.querySelector('div').textContent.toLowerCase();
    if (modelName.includes(inputValue)) {
      item.style.display = 'block';
      visibleItems++;
    } else {
      item.style.display = 'none';
    }
  });
  
  if (visibleItems > 0) {
    modelList.style.display = 'block';
  } else {
    modelList.style.display = 'none';
  }
}

// Enhanced status display
function showStatus(message, type = 'info') {
  const status = document.getElementById("status");
  status.textContent = message;
  status.className = `status-message ${type} show`;
  
  setTimeout(() => {
    status.classList.remove('show');
  }, 5000);
}

// Hide model list when clicking outside
document.addEventListener('click', (event) => {
  const modelList = document.getElementById("model-list");
  const modelContainer = document.querySelector('.model-input-container');
  
  if (!modelContainer.contains(event.target)) {
    modelList.style.display = 'none';
  }
});

// Developer section functionality
document.getElementById('toggle-developer').addEventListener('click', () => {
  const devSection = document.getElementById('developer-section');
  const toggleBtn = document.getElementById('toggle-developer');
  
  if (devSection.style.display === 'none') {
    devSection.style.display = 'block';
    toggleBtn.textContent = 'Hide Developer Tools';
  } else {
    devSection.style.display = 'none';
    toggleBtn.textContent = 'Show Developer Tools';
  }
});

// Test Connection
document.getElementById('test-connection').addEventListener('click', async () => {
  const testBtn = document.getElementById('test-connection');
  const resultDiv = document.getElementById('connection-result');
  const endpoint = document.getElementById('endpoint').value.trim() || 'http://localhost:11434';
  
  testBtn.disabled = true;
  testBtn.textContent = '⏳ Testing Connection...';
  
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    
    if (response.ok) {
      const data = await response.json();
      resultDiv.className = 'test-result success';
      resultDiv.textContent = `✅ Connection successful!\nEndpoint: ${endpoint}\nModels available: ${data.models?.length || 0}\nStatus: ${response.status} ${response.statusText}`;
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `❌ Connection failed!\nEndpoint: ${endpoint}\nError: ${error.message}\n\nTroubleshooting:\n- Check if Ollama is running\n- Verify endpoint URL\n- Check firewall settings`;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '🔗 Test Ollama Connection';
  }
});

// Test Summarization
document.getElementById('test-summarization').addEventListener('click', async () => {
  const testBtn = document.getElementById('test-summarization');
  const resultDiv = document.getElementById('summarization-result');
  const endpoint = document.getElementById('endpoint').value.trim() || 'http://localhost:11434';
  const model = document.getElementById('model').value.trim() || 'llama3.1:8b';
  
  testBtn.disabled = true;
  testBtn.textContent = '⏳ Testing API...';
  
  const testContent = "This is a test document for the SpaceLlama extension. It contains sample text to verify that the Ollama API integration is working correctly.";
  const testPrompt = "Summarize this test document in one sentence.";
  
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${testPrompt}\n\nFollow the above instructions and summarize the following text:\n\n${testContent}`,
        model: model,
        stream: false,
        num_ctx: 2048,
      }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data.response) {
        resultDiv.className = 'test-result success';
        resultDiv.textContent = `✅ Summarization successful!\nModel: ${model}\nResponse: "${data.response.trim()}"\n\nAPI working correctly!`;
      } else {
        throw new Error('Empty response from API');
      }
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `❌ Summarization failed!\nModel: ${model}\nError: ${error.message}\n\nTroubleshooting:\n- Check if model exists: ollama list\n- Pull model: ollama pull ${model}\n- Check API endpoint: ${endpoint}/api/generate`;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '🤖 Test Summarization';
  }
});

// Test Extension Messaging
document.getElementById('test-messaging').addEventListener('click', async () => {
  const testBtn = document.getElementById('test-messaging');
  const resultDiv = document.getElementById('messaging-result');
  
  testBtn.disabled = true;
  testBtn.textContent = '⏳ Testing Messages...';
  
  try {
    // Test background script communication
    const response = await new Promise((resolve, reject) => {
      browserAPI.runtime.sendMessage({ action: 'getLogs' }, (response) => {
        if (browserAPI.runtime.lastError) {
          reject(new Error(browserAPI.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    
    if (response && response.logs !== undefined) {
      resultDiv.className = 'test-result success';
      resultDiv.textContent = `✅ Extension messaging working!\nBackground script: Connected\nLogs available: ${response.logs.length} entries\nLast log: ${response.logs[response.logs.length - 1]?.timestamp || 'None'}\n\nMessage flow is functional!`;
    } else {
      throw new Error('Invalid response from background script');
    }
  } catch (error) {
    resultDiv.className = 'test-result error';
    resultDiv.textContent = `❌ Extension messaging failed!\nError: ${error.message}\n\nTroubleshooting:\n- Reload extension\n- Check browser console\n- Verify extension permissions`;
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = '📨 Test Message Flow';
  }
});
