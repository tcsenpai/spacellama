// SpaceLlama Content Script - Enhanced Version
(function() {
  'use strict';

  // Browser API detection
  const browserAPI = typeof chrome !== "undefined" ? chrome : 
                     typeof browser !== "undefined" ? browser : null;

  if (!browserAPI) {
    console.error('[SpaceLlama] Browser API not detected');
    return;
  }

  // Configuration constants
  const CONFIG = {
    LOG_PREFIX: '[SpaceLlama]',
    MAX_CONTENT_LENGTH: 1000000, // 1MB
    MIN_DESCRIPTION_LENGTH: 200,
    YOUTUBE_PATTERNS: [
      'youtube.com/watch',
      'youtu.be/',
      '/watch?v='
    ]
  };

  // Enhanced logging system
  class Logger {
    constructor(prefix = CONFIG.LOG_PREFIX) {
      this.prefix = prefix;
    }

    log(message, data = null) {
      const formattedMessage = `${this.prefix} ${message}`;
      
      if (data) {
        console.log(formattedMessage, data);
      } else {
        console.log(formattedMessage);
      }

      // Send to background script for centralized logging
      this.sendToBackground(message, data);
    }

    error(message, error) {
      console.error(`${this.prefix} ERROR: ${message}`, error);
      this.sendToBackground(`ERROR: ${message}`, { error: error.message || error });
    }

    warn(message, data = null) {
      console.warn(`${this.prefix} WARNING: ${message}`, data);
      this.sendToBackground(`WARNING: ${message}`, data);
    }

    async sendToBackground(message, data) {
      // TEMPORARILY DISABLED: Focus on core functionality first
      // Background logging is causing connection conflicts
      // Just log locally for now
      return;
    }
  }

  const logger = new Logger();

  // YouTube-specific functionality
  class YouTubeHandler {
    constructor() {
      this.logger = logger;
    }

    isYouTubeVideo(url) {
      return CONFIG.YOUTUBE_PATTERNS.some(pattern => url.includes(pattern));
    }

    extractVideoId(url) {
      try {
        const urlObj = new URL(url);
        
        if (url.includes('youtube.com/watch')) {
          return urlObj.searchParams.get('v');
        } else if (url.includes('youtu.be/')) {
          return urlObj.pathname.slice(1).split('?')[0];
        } else if (url.includes('/watch?v=')) {
          // Handle Invidious and similar platforms
          const vParam = url.split('/watch?v=')[1];
          return vParam ? vParam.split('&')[0] : null;
        }
      } catch (e) {
        this.logger.error('Failed to extract video ID', e);
      }
      return null;
    }

    async getMetadata() {
      const selectors = {
        title: [
          'meta[property="og:title"]',
          'h1.ytd-video-primary-info-renderer',
          'title'
        ],
        description: [
          'meta[property="og:description"]',
          'meta[name="description"]',
          '#description-inline-expander',
          '#description-text'
        ],
        author: [
          'link[itemprop="name"]',
          '.ytd-channel-name a',
          '#owner #channel-name'
        ],
        duration: [
          '.ytp-time-duration',
          'span[itemprop="duration"]'
        ],
        views: [
          '.view-count',
          'span[itemprop="interactionCount"]',
          '#count .ytd-video-view-count-renderer'
        ],
        uploadDate: [
          '#info-strings yt-formatted-string',
          'span[itemprop="datePublished"]'
        ]
      };

      const metadata = {};
      
      for (const [key, selectorList] of Object.entries(selectors)) {
        for (const selector of selectorList) {
          try {
            const element = document.querySelector(selector);
            if (element) {
              metadata[key] = element.content || element.textContent?.trim() || '';
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
        metadata[key] = metadata[key] || 'Unknown';
      }

      return metadata;
    }

    async getTranscript() {
      // Try multiple methods to get transcript
      const methods = [
        () => this.getTranscriptFromAPI(),
        () => this.getVisibleTranscript(),
        () => this.getTranscriptFromPage(),
        () => this.getTranscriptFromPlayerResponse()
      ];

      for (const method of methods) {
        try {
          const result = await method();
          if (result) {
            this.logger.log('Successfully retrieved transcript');
            return result;
          }
        } catch (e) {
          this.logger.warn('Transcript method failed', e.message);
        }
      }

      return null;
    }

    async getTranscriptFromAPI() {
      const result = await browserAPI.storage.sync.get({ youtubeApiKey: '' });
      const apiKey = result.youtubeApiKey;

      if (!apiKey) {
        return null;
      }

      const videoId = this.extractVideoId(window.location.href);
      if (!videoId) return null;

      try {
        // Get available captions
        const captionListUrl = `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}&key=${apiKey}`;
        const response = await fetch(captionListUrl);
        
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.items || data.items.length === 0) {
          return null;
        }

        // Prefer English captions
        const caption = data.items.find(item => 
          ['en', 'en-US'].includes(item.snippet.language) ||
          item.snippet.name?.toLowerCase().includes('english')
        ) || data.items[0];

        this.logger.log('Found caption track via API', caption.snippet.language);
        
        // Note: Downloading actual caption content requires OAuth
        return null; // For now, we can't get the actual content
      } catch (e) {
        this.logger.error('YouTube API error', e);
        return null;
      }
    }

    getVisibleTranscript() {
      const transcriptItems = document.querySelectorAll('ytd-transcript-segment-renderer');
      
      if (transcriptItems.length === 0) {
        return null;
      }

      const transcript = Array.from(transcriptItems)
        .map(item => item.querySelector('#text')?.textContent?.trim())
        .filter(text => text)
        .join(' ');

      return transcript || null;
    }

    getTranscriptFromPage() {
      try {
        // Look for transcript data in script tags
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        
        for (const script of scripts) {
          const content = script.textContent;
          
          if (content.includes('"captionTracks"')) {
            const match = content.match(/"captionTracks":(\[.*?\])/);
            if (match && match[1]) {
              const tracks = JSON.parse(match[1]);
              const englishTrack = this.findEnglishTrack(tracks);
              
              if (englishTrack?.baseUrl) {
                // Note: Direct fetch usually fails due to CORS
                this.logger.log('Found caption track URL');
                return null; // Can't fetch due to CORS
              }
            }
          }
        }
      } catch (e) {
        this.logger.error('Error parsing transcript from page', e);
      }
      
      return null;
    }

    getTranscriptFromPlayerResponse() {
      try {
        // Try to access ytInitialPlayerResponse
        let playerResponse = null;
        
        if (window.ytInitialPlayerResponse) {
          playerResponse = window.ytInitialPlayerResponse;
        } else {
          // Look in script tags
          const scripts = document.querySelectorAll('script:not([src])');
          for (const script of scripts) {
            if (script.textContent.includes('ytInitialPlayerResponse')) {
              const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
              if (match && match[1]) {
                playerResponse = JSON.parse(match[1]);
                break;
              }
            }
          }
        }

        if (!playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
          return null;
        }

        const tracks = playerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        const englishTrack = this.findEnglishTrack(tracks);
        
        if (englishTrack?.baseUrl) {
          this.logger.log('Found caption track in player response');
          return null; // Can't fetch due to CORS
        }
      } catch (e) {
        this.logger.error('Error getting transcript from player response', e);
      }
      
      return null;
    }

    findEnglishTrack(tracks) {
      if (!Array.isArray(tracks)) return null;
      
      return tracks.find(track => 
        track.languageCode === 'en' ||
        track.name?.simpleText?.toLowerCase().includes('english')
      ) || tracks[0];
    }

    async getContent() {
      const url = window.location.href;
      const videoId = this.extractVideoId(url);
      
      if (!videoId) {
        this.logger.error('No video ID found');
        return null;
      }

      const metadata = await this.getMetadata();
      const transcript = await this.getTranscript();

      if (!transcript) {
        // Return metadata-only content
        return {
          isYouTube: true,
          hasSubtitles: false,
          content: this.formatContent(metadata, null)
        };
      }

      return {
        isYouTube: true,
        hasSubtitles: true,
        content: this.formatContent(metadata, transcript)
      };
    }

    formatContent(metadata, transcript) {
      let content = `Title: ${metadata.title}\n\n`;
      
      if (metadata.author !== 'Unknown') {
        content += `Author: ${metadata.author}\n`;
      }
      
      if (metadata.duration !== 'Unknown') {
        content += `Duration: ${metadata.duration}\n`;
      }
      
      if (metadata.views !== 'Unknown') {
        content += `Views: ${metadata.views}\n`;
      }
      
      if (metadata.uploadDate !== 'Unknown') {
        content += `Upload Date: ${metadata.uploadDate}\n`;
      }
      
      content += `\nDescription: ${metadata.description}\n\n`;
      
      if (transcript) {
        content += `Transcript:\n${transcript}`;
      } else {
        content += `⚠️ NO TRANSCRIPT AVAILABLE: This summary is based only on the video metadata and description.`;
        
        // If description is too short, add a more detailed warning
        if (metadata.description.length < CONFIG.MIN_DESCRIPTION_LENGTH) {
          content += `\n\nNote: The video description is very short (${metadata.description.length} characters), so the summary may lack detail.`;
        }
      }
      
      return content;
    }
  }

  // Main content handler
  class ContentHandler {
    constructor() {
      this.logger = logger;
      this.youtubeHandler = new YouTubeHandler();
    }

    async getPageContent() {
      const url = window.location.href;
      
      // Check if this is a YouTube video
      if (this.youtubeHandler.isYouTubeVideo(url)) {
        this.logger.log('YouTube video detected');
        
        try {
          const youtubeContent = await this.youtubeHandler.getContent();
          if (youtubeContent) {
            return youtubeContent.content;
          }
        } catch (e) {
          this.logger.error('YouTube handler failed', e);
        }
      }

      // Default to regular page content
      this.logger.log('Using regular page content extraction');
      return this.extractRegularContent();
    }

    extractRegularContent() {
      try {
        // Try to get the main content area first
        const contentSelectors = [
          'main',
          'article',
          '[role="main"]',
          '#content',
          '.content',
          'body'
        ];

        for (const selector of contentSelectors) {
          const element = document.querySelector(selector);
          if (element && element.innerText.length > 100) {
            const content = element.innerText;
            
            // Truncate if too long
            if (content.length > CONFIG.MAX_CONTENT_LENGTH) {
              this.logger.warn(`Content truncated from ${content.length} to ${CONFIG.MAX_CONTENT_LENGTH} characters`);
              return content.substring(0, CONFIG.MAX_CONTENT_LENGTH);
            }
            
            return content;
          }
        }

        // Fallback to body
        return document.body.innerText || 'No content found';
      } catch (e) {
        this.logger.error('Error extracting page content', e);
        return 'Error extracting page content';
      }
    }
  }

  // Initialize content handler
  const contentHandler = new ContentHandler();

  // Message listener - simplified without background logging conflicts
  browserAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[SpaceLlama] Received message:', request.action);

    if (request.action === 'getContent') {
      contentHandler.getPageContent()
        .then(content => {
          console.log(`[SpaceLlama] Sending content (${content.length} characters)`);
          sendResponse({ content: content });
        })
        .catch(error => {
          console.error('[SpaceLlama] Failed to get content:', error);
          sendResponse({ 
            content: `Error retrieving content: ${error.message}`,
            error: true 
          });
        });
      
      return true; // Indicates async response
    }

    return false;
  });

  console.log('[SpaceLlama] Content script initialized');
})();