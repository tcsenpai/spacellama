let browser = (typeof chrome !== 'undefined') ? chrome : (typeof browser !== 'undefined') ? browser : null;
 
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

async function saveOptions(e) {
  e.preventDefault();
  const endpoint = document.getElementById("endpoint").value;
  const model = document.getElementById("model").value;
  const systemPrompt = document.getElementById("system-prompt").value;
  const status = document.getElementById("status");
  const tokenLimit = document.getElementById("token-limit").value || 4096;
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
  browser.storage.local.get({
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "llama2",
    systemPrompt: "You are a helpful AI assistant. Summarize the given text concisely.",
    tokenLimit: 4096
  }, function(result) {
    document.getElementById("endpoint").value = result.ollamaEndpoint || "http://localhost:11434";
    document.getElementById("model").value = result.ollamaModel || "llama2";
    document.getElementById("system-prompt").value = result.systemPrompt || "You are a helpful AI assistant. Summarize the given text concisely.";
    document.getElementById("token-limit").value = result.tokenLimit || 4096;
  });
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