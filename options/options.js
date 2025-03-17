let browser =
  typeof chrome !== "undefined"
    ? chrome
    : typeof browser !== "undefined"
    ? browser
    : null;

async function validateEndpoint(endpoint) {
  try {
    const response = await fetch(`${endpoint}/api/tags`);
    return response.ok;
  } catch (error) {
    console.error("Error validating endpoint:", error);
    return false;
  }
}

function updateEndpointStatus(isValid) {
  const statusElement = document.getElementById("endpoint-status");
  statusElement.textContent = isValid ? "✅" : "❌";
  statusElement.title = isValid ? "Endpoint is valid" : "Endpoint is invalid";
}

async function updateTokenLimit() {
  try {
    const modelTokens = await loadModelTokens();
    const model = document.getElementById("model").value;
    const tokenLimitInput = document.getElementById("token-limit");

    if (model in modelTokens) {
      tokenLimitInput.value = modelTokens[model];
    } else {
      tokenLimitInput.value = 16384; // Default value
    }
  } catch (error) {
    console.error("Error updating token limit:", error.message || error);
  }
}

async function loadModelTokens() {
  try {
    const response = await fetch(browser.runtime.getURL("model_tokens.json"));
    return await response.json();
  } catch (error) {
    console.error("Error loading model tokens:", error.message || error);
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
  status.textContent = "Validating endpoint...";
  try {
    const isValid = await validateEndpoint(cleanEndpoint);
    updateEndpointStatus(isValid);
    if (isValid) {
      await browser.storage.local.set({
        ollamaEndpoint: cleanEndpoint,
        ollamaModel: model,
        systemPrompt: systemPrompt,
        tokenLimit: parseInt(tokenLimit),
        youtubeApiKey: youtubeApiKey,
      });
      status.textContent = "Options saved and endpoint validated.";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    } else {
      status.textContent =
        "Invalid endpoint. Please check the URL and try again.";
    }
  } catch (error) {
    console.error("Error saving options:", error.message || error);
    status.textContent = "Error saving options.";
  }
}

function restoreOptions() {
  browser.storage.local.get(
    {
      ollamaEndpoint: "http://localhost:11434",
      ollamaModel: "llama3.1:latest",
      systemPrompt:
        "You are a helpful AI assistant. Summarize the given text concisely, without leaving out informations. You should aim to give a summary that is highly factual, useful and rich but still shorter than the original content, while not being too short.",
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
document.getElementById("endpoint").addEventListener("blur", async (e) => {
  const isValid = await validateEndpoint(e.target.value);
  updateEndpointStatus(isValid);

  document.getElementById("model").addEventListener("change", updateTokenLimit);
});
