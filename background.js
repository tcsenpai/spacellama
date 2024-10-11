console.log("Background script loaded");

browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "summarize") {
    summarizeContent(request.content)
      .then(summary => {
        sendResponse({ summary });
      })
      .catch(error => {
        console.error('Error in summarizeContent:', error);
        sendResponse({ error: error.toString(), details: error.details });
      });
    return true; // Indicates that we will send a response asynchronously
  }
});

async function summarizeContent(content) {
  const settings = await browser.storage.local.get(['ollamaEndpoint', 'ollamaModel']);
  const endpoint = `${settings.ollamaEndpoint || 'http://localhost:11434'}/api/generate`;
  const model = settings.ollamaModel || 'llama2';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: `Summarize the following text:\n\n${content}`,
        model: model,
        stream: false
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    const data = await response.json();
    return data.response;
  } catch (error) {
    console.error('Error details:', error);
    error.details = {
      endpoint: endpoint,
      model: model,
      message: error.message
    };
    throw error;
  }
}