function getPageContent() {
    console.log("getPageContent called");
    return document.body.innerText;
  }
  
  browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Content script received message:", request);
    if (request.action === "getContent") {
      const content = getPageContent();
      console.log("Sending content (first 100 chars):", content.substring(0, 100));
      sendResponse({ content: content });
    }
    return true; // Indicate that we will send a response asynchronously
  });

  console.log("Content script loaded");