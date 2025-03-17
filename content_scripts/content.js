extensionLog("Content script loading...");

let browser =
  typeof chrome !== "undefined"
    ? chrome
    : typeof browser !== "undefined"
    ? browser
    : null;

// Function to log messages to both console and background script
function extensionLog(message, data = null) {
  // Log to console
  if (data) {
    console.log(`[SpaceLLama] ${message}`, data);
  } else {
    console.log(`[SpaceLLama] ${message}`);
  }

  // Send to background script
  try {
    browser.runtime
      .sendMessage({
        action: "log",
        message: message,
        data: data,
        timestamp: new Date().toISOString(),
        url: window.location.href,
      })
      .catch((err) => console.error("Error sending log:", err));
  } catch (e) {
    console.error("Error in extensionLog:", e);
  }
}

// YouTube subtitle handler for SpaceLLama
extensionLog("YouTube handler functionality initializing...");

// Function to check if the current page is a YouTube video
function isYouTubeVideo(url) {
  return (
    url.includes("youtube.com/watch") ||
    url.includes("youtu.be/") ||
    url.includes("/watch?v=")
  );
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  let videoId = "";

  if (url.includes("youtube.com/watch")) {
    const urlParams = new URLSearchParams(new URL(url).search);
    videoId = urlParams.get("v");
  } else if (url.includes("youtu.be/")) {
    videoId = url.split("youtu.be/")[1].split("?")[0];
  } else if (url.includes("/watch?v=")) {
    // Adding youtube.com to the URL if it's missing (e.g. invidious)
    url = "https://youtube.com/watch?v=" + url.split("/watch?v=")[1];
    const urlParams = new URLSearchParams(new URL(url).search);
    videoId = urlParams.get("v");
  }

  return videoId;
}

// Add this function to fetch subtitles using YouTube API
async function fetchSubtitlesWithApi(videoId) {
  try {
    // Get the API key from storage
    const result = await browser.storage.sync.get({ youtubeApiKey: "" });
    const apiKey = result.youtubeApiKey;

    if (!apiKey) {
      extensionLog("No YouTube API key provided in settings");
      return null;
    }

    extensionLog("Attempting to fetch captions with YouTube API");

    // First, get the caption tracks available for this video
    const captionListUrl = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${apiKey}`;

    const response = await fetch(captionListUrl);
    if (!response.ok) {
      extensionLog("YouTube API request failed:", response.status);
      return null;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      extensionLog("No caption tracks found via API");
      return null;
    }

    // Find Eglish captions or use the first available
    const englishCaption =
      data.items.find(
        (item) =>
          item.snippet.language === "en" ||
          item.snippet.language === "en-US" ||
          (item.snippet.name &&
            item.snippet.name.toLowerCase().includes("english"))
      ) || data.items[0];

    // Get the caption content
    const captionId = englishCaption.id;
    const captionUrl = `https://www.googleapis.com/youtube/v3/captions/${captionId}?key=${apiKey}`;

    // Note: This might require OAuth2 authentication which is beyond the scope of a simple extension
    // If this fails, we'll need to fall back to other methods
    const captionResponse = await fetch(captionUrl);
    if (!captionResponse.ok) {
      extensionLog("Failed to fetch caption content:", captionResponse.status);
      return null;
    }

    const captionData = await captionResponse.json();
    return captionData.text;
  } catch (error) {
    extensionLog("Error fetching subtitles with API:", error);
    return null;
  }
}

// Update the fetchYouTubeSubtitles function to try the API first
async function fetchYouTubeSubtitles(videoId) {
  extensionLog("Attempting to fetch subtitles for video ID:", videoId);
  try {
    // First try: Use YouTube API if key is provided
    const apiSubtitles = await fetchSubtitlesWithApi(videoId);
    if (apiSubtitles) {
      extensionLog("Successfully fetched subtitles using YouTube API");
      return apiSubtitles;
    }

    // Method 1: Try to get subtitles directly from the page
    const subtitlesFromPage = getSubtitlesFromPage();
    if (subtitlesFromPage) {
      extensionLog("Found subtitles in page");
      return subtitlesFromPage;
    }

    // If all methods fail, don't use fallbacks anymore
    extensionLog("No subtitles found, will use description only");
    return null;
  } catch (error) {
    extensionLog("Error fetching YouTube subtitles:", error);
    return null;
  }
}

// Extract player response data from page
function getPlayerResponseData() {
  try {
    // YouTube stores player data in a script tag or window variable
    for (const script of document.querySelectorAll("script")) {
      if (script.textContent.includes("ytInitialPlayerResponse")) {
        const match = script.textContent.match(
          /ytInitialPlayerResponse\s*=\s*({.+?});/
        );
        if (match && match[1]) {
          return JSON.parse(match[1]);
        }
      }
    }

    // Try window variable if available
    if (typeof window.ytInitialPlayerResponse !== "undefined") {
      return window.ytInitialPlayerResponse;
    }

    return null;
  } catch (error) {
    extensionLog("Error getting player response data:", error);
    return null;
  }
}

// Get initial player response from window variable
function getInitialPlayerResponse() {
  try {
    // Look for the data in various possible locations
    if (typeof window.ytInitialPlayerResponse !== "undefined") {
      return window.ytInitialPlayerResponse;
    }

    // Try to find it in script tags
    for (const script of document.querySelectorAll("script:not([src])")) {
      if (script.textContent.includes("ytInitialPlayerResponse")) {
        const match = script.textContent.match(
          /ytInitialPlayerResponse\s*=\s*({.+?});/
        );
        if (match && match[1]) {
          try {
            return JSON.parse(match[1]);
          } catch (e) {
            extensionLog("Error parsing ytInitialPlayerResponse:", e);
          }
        }
      }
    }

    return null;
  } catch (error) {
    extensionLog("Error getting initial player response:", error);
    return null;
  }
}

// Extract subtitles from player response data
function extractSubtitlesFromPlayerResponse(playerResponse) {
  try {
    if (!playerResponse || !playerResponse.captions) {
      return null;
    }

    const captionTracks =
      playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      return null;
    }

    // Find English subtitles or use the first available
    const englishTrack =
      captionTracks.find(
        (track) =>
          track.languageCode === "en" ||
          (track.name &&
            track.name.simpleText &&
            track.name.simpleText.includes("English"))
      ) || captionTracks[0];

    if (englishTrack && englishTrack.baseUrl) {
      // We found a subtitle track URL, but direct fetch might be restricted
      // For now, we'll extract what we can from the page
      return null;
    }

    return null;
  } catch (error) {
    extensionLog("Error extracting subtitles from player response:", error);
    return null;
  }
}

// Extract subtitles from initial player response
function extractSubtitlesFromInitialResponse(initialResponse) {
  try {
    if (!initialResponse) return null;

    // Navigate through the complex structure to find captions
    const captionTracks =
      initialResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!captionTracks || captionTracks.length === 0) {
      return null;
    }

    // Find English track or use first available
    const englishTrack =
      captionTracks.find(
        (track) =>
          track.languageCode === "en" ||
          (track.name?.simpleText && track.name.simpleText.includes("English"))
      ) || captionTracks[0];

    if (!englishTrack || !englishTrack.baseUrl) {
      return null;
    }

    // We have a URL but can't directly fetch it due to CORS
    // Instead, extract what we can from the visible transcript on the page
    return null;
  } catch (error) {
    extensionLog("Error extracting subtitles from initial response:", error);
    return null;
  }
}

// Get alternative text from video description or comments
function getAlternativeText() {
  try {
    // Try to get the video description
    const description =
      document.querySelector("#description-inline-expander, #description-text")
        ?.textContent || "";

    // Try to get the transcript panel content if it's open
    const transcriptPanel = document.querySelector(".ytd-transcript-renderer");
    if (transcriptPanel) {
      const transcriptItems = transcriptPanel.querySelectorAll(
        ".ytd-transcript-segment-renderer"
      );
      if (transcriptItems && transcriptItems.length > 0) {
        let transcript = "";
        transcriptItems.forEach((item) => {
          transcript += item.textContent + " ";
        });
        return transcript.trim();
      }
    }

    // If description is substantial, use it
    if (description.length > 200) {
      extensionLog(
        "FALLBACK: Using video description as alternative to transcript",
        { descriptionLength: description.length }
      );
      return (
        "[FALLBACK: Using video description as alternative to transcript]\n\n" +
        description
      );
    }

    return null;
  } catch (error) {
    extensionLog("Error getting alternative text:", error);
    return null;
  }
}

// Try to find auto-generated captions
function findAutoGeneratedCaptions() {
  try {
    // Check if the transcript button is available
    const transcriptButton = document.querySelector(
      'button[aria-label*="transcript"], button[aria-label*="Transcript"]'
    );
    if (transcriptButton) {
      // We can't click it programmatically due to security restrictions
      // But we can inform the user that transcripts are available
      return "Auto-generated captions may be available. Please click the transcript button in the YouTube player to view them.";
    }

    // Look for any visible caption elements
    const visibleCaptions = document.querySelector(".ytp-caption-segment");
    if (visibleCaptions) {
      return "Captions are enabled for this video. Please ensure captions are turned on in the YouTube player to see them.";
    }

    return null;
  } catch (error) {
    extensionLog("Error finding auto-generated captions:", error);
    return null;
  }
}

// Extract text from the visible transcript panel if it's open
function getVisibleTranscript() {
  try {
    // This targets the transcript panel that appears when you click "Show Transcript"
    const transcriptItems = document.querySelectorAll(
      "ytd-transcript-segment-renderer"
    );
    if (transcriptItems && transcriptItems.length > 0) {
      let transcript = "";
      transcriptItems.forEach((item) => {
        // Each segment has text and timestamp
        const text = item.querySelector("#text")?.textContent || "";
        transcript += text + " ";
      });
      return transcript.trim();
    }
    return null;
  } catch (error) {
    extensionLog("Error getting visible transcript:", error);
    return null;
  }
}

// Parse subtitles XML into plain text
function parseSubtitlesXml(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, "text/xml");
  const textElements = xmlDoc.getElementsByTagName("text");

  let subtitles = "";
  for (let i = 0; i < textElements.length; i++) {
    subtitles += textElements[i].textContent + " ";
  }

  return subtitles.trim();
}

// Try to get subtitles directly from the YouTube page
function getSubtitlesFromPage() {
  extensionLog("Attempting to get subtitles from page");

  // First try: Check for transcript panel if it's open
  const visibleTranscript = getVisibleTranscript();
  if (visibleTranscript) {
    extensionLog("Found visible transcript panel");
    return visibleTranscript;
  }

  // Second try: YouTube stores caption data in a script tag
  try {
    const scriptTags = document.querySelectorAll("script");
    let captionData = null;
    let captionTrackData = null;

    // Look for caption tracks in script tags
    for (const script of scriptTags) {
      const content = script.textContent;

      // Try different patterns to find caption data
      if (content.includes('"captionTracks"')) {
        const match = content.match(/"captionTracks":(\[.*?\])/);
        if (match && match[1]) {
          try {
            captionData = JSON.parse(match[1]);
            extensionLog("Found caption tracks in script tag");
            break;
          } catch (e) {
            extensionLog("Error parsing caption data:", e);
          }
        }
      }

      // Try another pattern
      if (content.includes('{"captionTracks":')) {
        const regex = /{"captionTracks":(\[.*?\])}/g;
        const match = regex.exec(content);
        if (match && match[1]) {
          try {
            captionTrackData = JSON.parse(match[1]);
            extensionLog("Found caption track data in script tag");
            break;
          } catch (e) {
            extensionLog("Error parsing caption track data:", e);
          }
        }
      }
    }

    // Process caption data if found
    const tracks = captionData || captionTrackData;
    if (tracks && tracks.length > 0) {
      // Find English subtitles or use the first available
      const englishTrack =
        tracks.find(
          (track) =>
            track.languageCode === "en" ||
            (track.name &&
              track.name.simpleText &&
              track.name.simpleText.includes("English"))
        ) || tracks[0];

      if (englishTrack && englishTrack.baseUrl) {
        extensionLog("Found subtitle track URL, attempting to fetch");

        // Try to fetch the subtitles directly (may fail due to CORS)
        try {
          return fetch(englishTrack.baseUrl)
            .then((response) => response.text())
            .then((xmlText) => {
              extensionLog("Successfully fetched subtitle XML");
              return parseSubtitlesXml(xmlText);
            })
            .catch((error) => {
              extensionLog("Error fetching subtitle XML:", error);
              return null;
            });
        } catch (error) {
          extensionLog("Error attempting to fetch subtitles:", error);
        }
      }
    }

    // Third try: Look for transcript in the page DOM
    const transcriptContent = document.querySelector("#transcript-scrollbox");
    if (transcriptContent) {
      extensionLog("Found transcript scrollbox");
      let transcript = "";
      const segments = transcriptContent.querySelectorAll(".segment");
      segments.forEach((segment) => {
        transcript += segment.textContent.trim() + " ";
      });

      if (transcript.length > 100) {
        return transcript;
      }
    }

    return null;
  } catch (error) {
    extensionLog("Error getting subtitles from page:", error);
    return null;
  }
}

// Get video metadata (title, description, etc.)
function getVideoMetadata() {
  const title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.querySelector("title")?.textContent ||
    "";

  const description =
    document.querySelector('meta[property="og:description"]')?.content ||
    document.querySelector('meta[name="description"]')?.content ||
    "";

  const author =
    document.querySelector('link[itemprop="name"]')?.content ||
    document.querySelector(".ytd-channel-name a")?.textContent ||
    "";

  return {
    title,
    description,
    author,
  };
}

// Update getYouTubeContent to clearly indicate when using description
async function getYouTubeContent() {
  extensionLog("getYouTubeContent called");
  const url = window.location.href;
  extensionLog("Current URL in getYouTubeContent:", url);

  const videoId = extractVideoId(url);
  extensionLog("Extracted video ID:", videoId);

  if (!videoId) {
    extensionLog("No video ID found");
    return null;
  }

  extensionLog("Getting metadata and subtitles");
  const metadata = getVideoMetadata();
  extensionLog("Metadata retrieved:", metadata.title);

  const subtitles = await fetchYouTubeSubtitles(videoId);
  extensionLog("Subtitles retrieved:", subtitles ? "yes" : "no");

  if (!subtitles) {
    extensionLog("No subtitles available");
    // Get as much context as possible
    const videoLength = getVideoLength();
    const viewCount = getViewCount();
    const uploadDate = getUploadDate();

    return {
      isYouTube: true,
      hasSubtitles: false,
      content:
        `Title: ${metadata.title}\n\n` +
        `Description: ${metadata.description}\n\n` +
        `Author: ${metadata.author}\n\n` +
        `Video Length: ${videoLength}\n` +
        `Views: ${viewCount}\n` +
        `Upload Date: ${uploadDate}\n\n` +
        `⚠️ NO TRANSCRIPT AVAILABLE: This summary is based only on the video metadata and description.`,
    };
  }

  extensionLog("Returning YouTube content with subtitles");
  return {
    isYouTube: true,
    hasSubtitles: true,
    content: `Title: ${metadata.title}\n\nDescription: ${metadata.description}\n\nAuthor: ${metadata.author}\n\nTranscript:\n${subtitles}`,
  };
}

// Helper functions to get additional metadata
function getVideoLength() {
  try {
    return (
      document.querySelector(".ytp-time-duration")?.textContent ||
      document.querySelector('span[itemprop="duration"]')?.textContent ||
      "Unknown"
    );
  } catch (e) {
    return "Unknown";
  }
}

function getViewCount() {
  try {
    return (
      document.querySelector(".view-count")?.textContent ||
      document.querySelector('span[itemprop="interactionCount"]')
        ?.textContent ||
      "Unknown"
    );
  } catch (e) {
    return "Unknown";
  }
}

function getUploadDate() {
  try {
    return (
      document.querySelector("#info-strings yt-formatted-string")
        ?.textContent ||
      document.querySelector('span[itemprop="datePublished"]')?.textContent ||
      "Unknown"
    );
  } catch (e) {
    return "Unknown";
  }
}

// Main content script functionality
function getPageContent() {
  extensionLog("getPageContent called");

  // Check if we're on a YouTube video page
  const url = window.location.href;
  extensionLog("Current URL in getPageContent:", url);

  if (isYouTubeVideo(url)) {
    extensionLog("YouTube video detected, fetching subtitles...");
    return getYouTubeContent()
      .then((youtubeContent) => {
        if (youtubeContent) {
          extensionLog(
            "YouTube content retrieved:",
            youtubeContent.hasSubtitles ? "with subtitles" : "without subtitles"
          );
          return youtubeContent.content;
        } else {
          // Fallback to regular page content if YouTube handler fails
          extensionLog(
            "YouTube handler failed, falling back to regular content"
          );
          return document.body.innerText;
        }
      })
      .catch((error) => {
        extensionLog("Error getting YouTube content:", error);
        return document.body.innerText;
      });
  }

  // Regular page content for non-YouTube pages
  extensionLog("Not a YouTube video, returning regular page content");
  return document.body.innerText;
}

// Set up message listener
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  extensionLog("Content script received message:", request);

  if (request.action === "getContent") {
    extensionLog("Getting page content...");

    // Handle the case where getPageContent might return a Promise
    const contentResult = getPageContent();

    if (contentResult instanceof Promise) {
      contentResult
        .then((content) => {
          extensionLog(
            "Sending content (first 100 chars):",
            content.substring(0, 100)
          );
          sendResponse({ content: content });
        })
        .catch((error) => {
          extensionLog("Error getting page content:", error);
          sendResponse({
            content: "Error retrieving content: " + error.message,
          });
        });
      return true; // Indicate that we will send a response asynchronously
    } else {
      // Handle synchronous result
      const content = contentResult;
      extensionLog(
        "Sending content (first 100 chars):",
        content.substring(0, 100)
      );
      sendResponse({ content: content });
      return true; // Still need to return true for Firefox compatibility
    }
  }

  return true; // Always return true to indicate we're handling the message
});

extensionLog("Content script fully loaded with YouTube handler functionality");
