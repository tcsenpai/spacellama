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
  // Ensure the endpoint doesn't end with /api/generate
  const cleanEndpoint = endpoint.replace(/\/api\/generate\/?$/, "");
  status.textContent = "Validating endpoint...";
  const isValid = await validateEndpoint(cleanEndpoint);
  updateEndpointStatus(isValid);
  if (isValid) {
    browser.storage.local
      .set({
        ollamaEndpoint: cleanEndpoint,
        ollamaModel: model,
        systemPrompt: systemPrompt,
      })
      .then(() => {
        status.textContent = "Options saved and endpoint validated.";
        setTimeout(() => {
          status.textContent = "";
        }, 2000);
      });
  } else {
    status.textContent =
      "Invalid endpoint. Please check the URL and try again.";
  }
}

async function restoreOptions() {
  const result = await browser.storage.local.get([
    "ollamaEndpoint",
    "ollamaModel",
    "systemPrompt",
  ]);
  const endpoint = result.ollamaEndpoint || "http://localhost:11434";
  const defaultSystemPrompt = "You are a helpful AI assistant. Summarize the given text concisely.";
  document.getElementById("endpoint").value = endpoint;
  document.getElementById("model").value = result.ollamaModel || "llama2";
  document.getElementById("system-prompt").value = result.systemPrompt || defaultSystemPrompt;
  const isValid = await validateEndpoint(endpoint);
  updateEndpointStatus(isValid);
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document
  .getElementById("settings-form")
  .addEventListener("submit", saveOptions);
document.getElementById("endpoint").addEventListener("blur", async (e) => {
  const isValid = await validateEndpoint(e.target.value);
  updateEndpointStatus(isValid);
});
