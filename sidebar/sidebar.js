document.addEventListener('DOMContentLoaded', () => {
    const summarizeButton = document.getElementById('summarize');
    const summaryDiv = document.getElementById('summary');
    const openOptionsButton = document.getElementById('open-options');
  
    summarizeButton.addEventListener('click', () => {
      summaryDiv.innerHTML = '<p>Summarizing...</p>';
      summarizeButton.disabled = true;
  
      browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        browser.tabs.sendMessage(tabs[0].id, { action: "getContent" }, (response) => {
          if (browser.runtime.lastError) {
            handleError('Error getting page content: ' + browser.runtime.lastError.message);
            return;
          }
  
          if (response && response.content) {
            browser.runtime.sendMessage(
              { action: "summarize", content: response.content },
              (response) => {
                if (browser.runtime.lastError) {
                  handleError('Error during summarization: ' + browser.runtime.lastError.message);
                  return;
                }
  
                if (response && response.summary) {
                  // Render the Markdown content
                  summaryDiv.innerHTML = marked.parse(response.summary);
                } else if (response && response.error) {
                  handleError(response.error, response.details);
                } else {
                  handleError("Unexpected response from summarization");
                }
                summarizeButton.disabled = false;
              }
            );
          } else {
            handleError('Error: Could not retrieve page content.');
          }
        });
      });
    });
  
    openOptionsButton.addEventListener('click', () => {
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