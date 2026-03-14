/**
 * Unhooked Content Script
 * Runs in the context of web pages to perform scrolling and data extraction
 *
 * @fileoverview Content script for automated scrolling and post extraction
 */

// ============================================================================
// INITIALIZATION
// ============================================================================

// Track if content script is ready
let isReady = false;
let initTimestamp = Date.now();

// Initialize on load
(function init() {
  try {
    log(`Content script loaded on ${window.location.hostname}`);
    log(`Page ready state: ${document.readyState}`);

    // Detect site
    const site = detectSite();
    log(`Detected site: ${site.name}`);

    // Mark as ready
    isReady = true;

    // Notify background that we're ready
    chrome.runtime
      .sendMessage({
        type: "CONTENT_SCRIPT_READY",
        url: window.location.href,
        site: site.name,
        timestamp: initTimestamp,
      })
      .catch(() => {
        // Background might not be ready yet, that's okay
      });

    log("Content script initialized and ready");
  } catch (error) {
    logError("Failed to initialize content script", error);
  }
})();

// ============================================================================
// STATE
// ============================================================================

let scrollState = {
  isActive: false,
  intervalId: null,
  timeoutId: null,
  config: null,
  startTime: null,
  scrollCount: 0,
  postsExtracted: 0,
  lastScrollPosition: 0,
  stuckCount: 0,
  isPaused: false,
  pauseTimeout: null,
  nextScrollDelay: 1000,
};

let captureState = {
  mediaRecorder: null,
  mediaStream: null,
  videoChunks: null, // Array to store video chunks for file saving
  totalBytes: 0,
  chunksRecorded: 0,
};

// Set of extracted post IDs to avoid duplicates
const extractedPostIds = new Set();

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  switch (action) {
    case "startScrolling":
      startScrolling(message.config)
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          logError("Failed to start scrolling", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open

    case "stopScrolling":
      stopScrolling()
        .then(() => sendResponse({ success: true }))
        .catch((error) => {
          logError("Failed to stop scrolling", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case "ping":
      // Respond to readiness check from background
      if (isReady) {
        sendResponse({ success: true, ready: true });
      } else {
        sendResponse({
          success: false,
          ready: false,
          message: "Still initializing...",
        });
      }
      return false;

    case "getStatus":
      sendResponse({
        success: true,
        isActive: scrollState.isActive,
        scrollCount: scrollState.scrollCount,
        postsExtracted: scrollState.postsExtracted,
        totalBytes: captureState.totalBytes,
      });
      return false;

    case "EXECUTE_ACTION":
      handleAIAction(message.command, message.params);
      sendResponse({ success: true });
      return false;

    default:
      sendResponse({ success: false, error: "Unknown action" });
      return false;
  }
});

// ============================================================================
// SEMANTIC ACTION EXECUTOR (Active Post Pattern)
// ============================================================================

class ActivePostTracker {
  constructor() {
    this.activePost = null;
    this.observer = null;
    this.site = detectSite().name;
  }

  start() {
    if (this.observer) this.stop();

    const options = {
      root: null,
      rootMargin: "-40% 0px -40% 0px", // Focus on center 20% of screen
      threshold: 0.1,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          this.setActivePost(entry.target);
        }
      });
    }, options);

    this.refreshObservers();

    // Re-scan for new posts periodically (infinite scroll)
    this.scanInterval = setInterval(() => this.refreshObservers(), 2000);
    log("Active Post Tracker started");
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.clearHighlight();
    this.activePost = null;
  }

  refreshObservers() {
    if (!this.observer) return;

    const selectors = detectSite().selectors;
    const posts = document.querySelectorAll(selectors.post);
    posts.forEach((post) => this.observer.observe(post));
  }

  setActivePost(element) {
    if (this.activePost === element) return;

    this.clearHighlight();
    this.activePost = element;
    this.highlightPost(element);
    log("Active Post updated", generatePostId(element));
  }

  highlightPost(element) {
    element.style.outline = "2px solid #22c55e"; // Green border
    element.style.transition = "outline 0.3s";
  }

  clearHighlight() {
    if (this.activePost) {
      this.activePost.style.outline = "";
    }
  }

  getActivePost() {
    if (!this.activePost) {
      // Fallback: try to find post in center of screen
      const elements = document.elementsFromPoint(
        window.innerWidth / 2,
        window.innerHeight / 2,
      );
      const selectors = detectSite().selectors;
      for (const el of elements) {
        const post = el.closest(selectors.post);
        if (post) {
          this.setActivePost(post);
          break;
        }
      }
    }
    return this.activePost;
  }
}

class ActionExecutor {
  constructor(tracker) {
    this.tracker = tracker;
  }

  async execute(command, params) {
    const post = this.tracker.getActivePost();
    const site = detectSite();

    if (!post && command !== "SCROLL_DOWN") {
      log("No active post to execute action on");
      // Fallback to generic scroll
      window.scrollBy({ top: 300, behavior: "smooth" });
      return;
    }

    log(`Executing ${command} on active post`);

    switch (command) {
      case "LIKE_POST":
        await this.clickButton(post, site, "like");
        break;

      case "SAVE_POST":
        await this.clickButton(post, site, "save");
        break;

      case "SCROLL_DOWN":
        this.scrollToNextPost();
        break;

      case "WAIT":
        // Passive wait
        break;
    }
  }

  async clickButton(post, site, type) {
    const selectors = this.getButtonSelectors(site.name);
    const selector = selectors[type];

    if (!selector) {
      logError(`No ${type} selector for ${site.name}`);
      return;
    }

    const button = post.querySelector(selector);
    if (button) {
      log(`Clicking ${type} button`);
      button.scrollIntoView({ block: "center", behavior: "smooth" });
      await new Promise((r) => setTimeout(r, 500)); // Wait for scroll
      button.click();
      this.showFeedback(button, "✅");
    } else {
      logError(`Could not find ${type} button in active post`);
    }
  }

  scrollToNextPost() {
    const post = this.tracker.getActivePost();
    if (!post) {
      window.scrollBy({ top: 500, behavior: "smooth" });
      return;
    }

    // Try to find next sibling post
    let next = post.nextElementSibling;
    const selectors = detectSite().selectors;

    // Search siblings until we find a post
    while (next && !next.matches(selectors.post)) {
      next = next.nextElementSibling;
    }

    if (next) {
      next.scrollIntoView({ block: "center", behavior: "smooth" });
    } else {
      // Fallback if no sibling found (dynamic loading)
      window.scrollBy({ top: post.offsetHeight || 500, behavior: "smooth" });
    }
  }

  getButtonSelectors(siteName) {
    switch (siteName) {
      case "twitter":
        return {
          like: 'button[data-testid="like"]',
          save: 'button[data-testid="bookmark"]',
        };
      case "instagram":
        return {
          like: 'svg[aria-label="Like"], svg[aria-label="Me gusta"]', // Also try parent button
          save: 'svg[aria-label="Save"], svg[aria-label="Guardar"]',
        };
      case "linkedin":
        return {
          like: 'button[aria-label^="React"], button.react-button__trigger',
          save: ".save-action", // Varies
        };
      default:
        return {};
    }
  }

  showFeedback(element, text) {
    const feedback = document.createElement("div");
    feedback.textContent = text;
    feedback.style.position = "absolute";
    feedback.style.zIndex = "9999";
    feedback.style.fontSize = "40px";
    feedback.style.pointerEvents = "none";
    feedback.style.animation = "float-up 1s ease-out forwards";

    const rect = element.getBoundingClientRect();
    feedback.style.left = rect.left + "px";
    feedback.style.top = rect.top + "px";

    // Add animation styles
    if (!document.getElementById("unhooked-styles")) {
      const style = document.createElement("style");
      style.id = "unhooked-styles";
      style.textContent = `
        @keyframes float-up {
          0% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-50px); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(feedback);
    setTimeout(() => feedback.remove(), 1000);
  }
}

// Global instances
const activePostTracker = new ActivePostTracker();
const actionExecutor = new ActionExecutor(activePostTracker);

/**
 * Handle AI-driven actions
 */
function handleAIAction(command, params) {
  log(`Executing AI Action: ${command}`, params);
  actionExecutor.execute(command, params).catch((err) => {
    logError("Action execution failed", err);
  });
}

// ============================================================================
// SCROLLING LOGIC
// ============================================================================

/**
 * Start automated scrolling session
 */
async function startScrolling(config = {}) {
  if (!isReady) {
    logError("Content script not ready yet");
    throw new Error("Content script not initialized");
  }

  if (scrollState.isActive) {
    log("Already scrolling");
    throw new Error("Scrolling session already active");
  }

  log("Starting scrolling session", config);
  log(`Current URL: ${window.location.href}`);
  log(`Document height: ${document.documentElement.scrollHeight}px`);

  // Reset state with human-like defaults
  scrollState = {
    isActive: true,
    intervalId: null,
    timeoutId: null,
    config: {
      scrollAmount: config.scrollAmount || 500,
      scrollInterval: config.scrollInterval || 1000,
      duration: config.duration || 300000, // 5 minutes default
      captureVideo: config.captureVideo || false,
      humanLike: true, // Enable human-like scrolling
      minScrollDelay: 800, // Minimum delay between scrolls (ms)
      maxScrollDelay: 3000, // Maximum delay between scrolls (ms)
      pauseChance: 0.15, // 15% chance to pause and "read"
      pauseMinDuration: 2000, // Minimum pause duration (ms)
      pauseMaxDuration: 8000, // Maximum pause duration (ms)
      backScrollChance: 0.08, // 8% chance to scroll back up
      scrollVariation: 0.4, // 40% variation in scroll amount
    },
    startTime: Date.now(),
    scrollCount: 0,
    postsExtracted: 0,
    lastScrollPosition: window.scrollY,
    stuckCount: 0,
    isPaused: false,
    pauseTimeout: null,
    nextScrollDelay: config.scrollInterval || 1000,
  };

  extractedPostIds.clear();

  // Start video capture if enabled
  if (scrollState.config.captureVideo) {
    try {
      await startVideoCapture();
    } catch (error) {
      logError("Video capture failed, continuing without it", error);
    }
  }

  // Start first scroll with human-like delay
  scheduleNextScroll();

  // Set timeout to auto-stop
  scrollState.timeoutId = setTimeout(() => {
    log("Duration reached, stopping session");
    stopScrolling();
  }, scrollState.config.duration);

  // Start active post tracker
  activePostTracker.start();

  log("Scrolling session started with human-like behavior");
}

/**
 * Schedule the next scroll with human-like timing
 */
function scheduleNextScroll() {
  if (!scrollState.isActive) {
    return;
  }

  const config = scrollState.config;

  // Calculate next scroll delay with variation
  if (config.humanLike) {
    scrollState.nextScrollDelay =
      config.minScrollDelay +
      Math.random() * (config.maxScrollDelay - config.minScrollDelay);
  } else {
    scrollState.nextScrollDelay = config.scrollInterval;
  }

  // Schedule the scroll
  scrollState.intervalId = setTimeout(
    performScroll,
    scrollState.nextScrollDelay,
  );
}

/**
 * Perform a single scroll action with human-like behavior
 */
function performScroll() {
  if (!scrollState.isActive || scrollState.isPaused) {
    return;
  }

  try {
    const currentPosition = window.scrollY;
    const maxScroll =
      document.documentElement.scrollHeight - window.innerHeight;
    const config = scrollState.config;

    // Check if we're stuck at the same position
    if (currentPosition === scrollState.lastScrollPosition) {
      scrollState.stuckCount++;

      if (scrollState.stuckCount > 5) {
        log("Scroll stuck, might be at bottom");

        // Try to load more content by scrolling to bottom
        window.scrollTo({ top: maxScroll, behavior: "smooth" });

        // If still stuck after many attempts, stop
        if (scrollState.stuckCount > 10) {
          log("Cannot scroll further, stopping session");
          stopScrolling();
          return;
        }
      }
    } else {
      scrollState.stuckCount = 0;
    }

    // Human-like behavior: occasionally pause to "read"
    if (config.humanLike && Math.random() < config.pauseChance) {
      const pauseDuration =
        config.pauseMinDuration +
        Math.random() * (config.pauseMaxDuration - config.pauseMinDuration);

      scrollState.isPaused = true;
      log(`Pausing to read for ${Math.round(pauseDuration)}ms`);

      scrollState.pauseTimeout = setTimeout(() => {
        scrollState.isPaused = false;
        scheduleNextScroll();
      }, pauseDuration);

      return;
    }

    // Human-like behavior: occasionally scroll back up
    let scrollAmount = config.scrollAmount;
    if (config.humanLike && Math.random() < config.backScrollChance) {
      // Scroll back up a bit (like re-reading)
      scrollAmount = -scrollAmount * (0.3 + Math.random() * 0.4); // 30-70% back
      log("Scrolling back up to re-read");
    } else if (config.humanLike) {
      // Add variation to scroll amount (more human-like)
      const variation = 1 + (Math.random() - 0.5) * config.scrollVariation;
      scrollAmount = Math.round(scrollAmount * variation);
    }

    // Perform scroll with smooth behavior
    window.scrollBy({
      top: scrollAmount,
      behavior: "smooth",
    });

    scrollState.scrollCount++;
    scrollState.lastScrollPosition = window.scrollY;

    // Extract posts after scroll (with slight delay for content to load)
    setTimeout(() => {
      extractPosts();
      sendProgressUpdate();
    }, 300);

    log(
      `Scroll ${scrollState.scrollCount} | Position: ${window.scrollY}/${maxScroll} | Posts: ${scrollState.postsExtracted} | Next: ${Math.round(scrollState.nextScrollDelay)}ms`,
    );

    // Schedule next scroll
    scheduleNextScroll();
  } catch (error) {
    logError("Error during scroll", error);
    // Try to continue
    scheduleNextScroll();
  }
}

/**
 * Stop scrolling session
 */
async function stopScrolling() {
  if (!scrollState.isActive) {
    log("Not currently scrolling");
    return;
  }

  log("Stopping scrolling session");

  scrollState.isActive = false;
  scrollState.isPaused = false;

  // Stop active post tracker
  activePostTracker.stop();

  // Clear timers
  if (scrollState.intervalId) {
    clearTimeout(scrollState.intervalId); // Changed from clearInterval to clearTimeout
    scrollState.intervalId = null;
  }

  if (scrollState.pauseTimeout) {
    clearTimeout(scrollState.pauseTimeout);
    scrollState.pauseTimeout = null;
  }

  if (scrollState.timeoutId) {
    clearTimeout(scrollState.timeoutId);
    scrollState.timeoutId = null;
  }

  // Stop video capture
  if (captureState.mediaRecorder) {
    await stopVideoCapture();
  }

  // Final stats
  const duration = Date.now() - scrollState.startTime;
  log(
    `Session complete: ${scrollState.scrollCount} scrolls, ${scrollState.postsExtracted} posts in ${formatDuration(duration)}`,
  );

  // Notify background
  try {
    await chrome.runtime.sendMessage({ type: "SCROLL_COMPLETE" });
  } catch (error) {
    logError("Failed to notify background", error);
  }
}

/**
 * Send progress update to background
 */
function sendProgressUpdate() {
  try {
    chrome.runtime
      .sendMessage({
        type: "CAPTURE_UPDATE",
        bytes: 0, // Video bytes are sent separately
        frames: 1,
        scrollCount: scrollState.scrollCount,
        postsExtracted: scrollState.postsExtracted,
        url: window.location.href,
        scrollPosition: window.scrollY,
        documentHeight: document.documentElement.scrollHeight,
      })
      .catch((error) => {
        // Silently fail if background is not available
      });
  } catch (error) {
    logError("Failed to send progress update", error);
  }
}

// ============================================================================
// POST EXTRACTION
// ============================================================================

/**
 * Extract posts from current viewport
 */
function extractPosts() {
  try {
    const detector = detectSite();
    const posts = extractPostsForSite(detector);

    posts.forEach((post) => {
      // Deduplicate
      if (!extractedPostIds.has(post.id)) {
        extractedPostIds.add(post.id);
        scrollState.postsExtracted++;

        // Send to background
        sendPostToBackground(post);
      }
    });
  } catch (error) {
    logError("Error extracting posts", error);
  }
}

/**
 * Detect which site we're on
 */
function detectSite() {
  const hostname = window.location.hostname;

  if (hostname.includes("twitter.com") || hostname.includes("x.com")) {
    return { name: "twitter", selectors: getTwitterSelectors() };
  } else if (hostname.includes("instagram.com")) {
    return { name: "instagram", selectors: getInstagramSelectors() };
  } else if (hostname.includes("reddit.com")) {
    return { name: "reddit", selectors: getRedditSelectors() };
  } else if (hostname.includes("linkedin.com")) {
    return { name: "linkedin", selectors: getLinkedInSelectors() };
  } else if (hostname.includes("facebook.com")) {
    return { name: "facebook", selectors: getFacebookSelectors() };
  } else {
    return { name: "generic", selectors: getGenericSelectors() };
  }
}

/**
 * Extract posts based on site-specific selectors
 */
function extractPostsForSite(detector) {
  const posts = [];
  const { selectors } = detector;

  try {
    const postElements = document.querySelectorAll(selectors.post);

    postElements.forEach((element) => {
      // Only extract posts in viewport or slightly below
      const rect = element.getBoundingClientRect();
      const isInViewport =
        rect.top < window.innerHeight + 500 && rect.bottom > -500;

      if (!isInViewport) {
        return;
      }

      const post = extractPostData(element, selectors, detector.name);
      if (post) {
        posts.push(post);
      }
    });
  } catch (error) {
    logError("Error extracting posts for site", error);
  }

  return posts;
}

/**
 * Extract data from a single post element
 */
function extractPostData(element, selectors, siteName) {
  try {
    // Generate unique ID
    const id = generatePostId(element);

    // Extract text content
    const textElement = element.querySelector(selectors.text);
    const text = textElement ? cleanText(textElement.innerText) : "";

    // Extract author
    const authorElement = element.querySelector(selectors.author);
    const author = authorElement ? cleanText(authorElement.innerText) : "";

    // Extract links
    const links = Array.from(element.querySelectorAll(selectors.link || "a"))
      .map((a) => a.href)
      .filter((href) => href && !href.startsWith("javascript:"));

    // Extract images
    const images = Array.from(
      element.querySelectorAll(selectors.image || "img"),
    )
      .map((img) => img.src)
      .filter((src) => src && !src.startsWith("data:"));

    // Extract videos
    const videos = Array.from(
      element.querySelectorAll(selectors.video || "video"),
    )
      .map((video) => video.src || video.querySelector("source")?.src)
      .filter((src) => src);

    // Extract timestamp if available
    const timestampElement = element.querySelector(selectors.timestamp);
    const timestamp = timestampElement
      ? timestampElement.getAttribute("datetime") || timestampElement.innerText
      : null;

    return {
      id,
      site: siteName,
      author,
      text,
      links,
      images,
      videos,
      timestamp,
      hasLinks: links.length > 0,
      hasImages: images.length > 0,
      hasVideos: videos.length > 0,
      extractedAt: Date.now(),
    };
  } catch (error) {
    logError("Error extracting post data", error);
    return null;
  }
}

/**
 * Generate unique ID for a post
 */
function generatePostId(element) {
  // Try to find a data-id or id attribute
  const dataId =
    element.getAttribute("data-id") ||
    element.getAttribute("data-post-id") ||
    element.id;

  if (dataId) {
    return dataId;
  }

  // Fallback: hash based on content
  const text = element.innerText.substring(0, 100);
  return hashString(text);
}

/**
 * Simple string hash
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Clean extracted text
 */
function cleanText(text) {
  return text.trim().replace(/\s+/g, " ").substring(0, 1000); // Limit length
}

/**
 * Send extracted post to background
 */
function sendPostToBackground(post) {
  try {
    chrome.runtime.sendMessage({
      type: "POST_EXTRACTED",
      post,
    });
  } catch (error) {
    logError("Failed to send post to background", error);
  }
}

// ============================================================================
// SITE-SPECIFIC SELECTORS
// ============================================================================

function getTwitterSelectors() {
  return {
    post: 'article[data-testid="tweet"]',
    text: '[data-testid="tweetText"]',
    author: '[data-testid="User-Name"]',
    timestamp: "time",
    link: "a",
    image: '[data-testid="tweetPhoto"] img',
    video: "video",
  };
}

function getInstagramSelectors() {
  return {
    post: "article",
    text: "span, h1",
    author: "a",
    timestamp: "time",
    link: "a",
    image: "img",
    video: "video",
  };
}

function getRedditSelectors() {
  return {
    post: '[data-testid="post-container"], .Post, shreddit-post',
    text: '[data-testid="post-content"], .Post__content, div[slot="text-body"]',
    author:
      '[data-testid="post_author_link"], .Post__author-name, a[slot="author-link"]',
    timestamp: 'time, [data-testid="post_timestamp"]',
    link: "a",
    image: "img",
    video: "video",
  };
}

function getLinkedInSelectors() {
  return {
    post: ".feed-shared-update-v2",
    text: ".feed-shared-text",
    author: ".feed-shared-actor__name",
    timestamp: ".feed-shared-actor__sub-description",
    link: "a",
    image: "img",
    video: "video",
  };
}

function getFacebookSelectors() {
  return {
    post: '[role="article"]',
    text: '[data-ad-preview="message"]',
    author: "h4",
    timestamp: "abbr",
    link: "a",
    image: "img",
    video: "video",
  };
}

function getGenericSelectors() {
  return {
    post: 'article, .post, .tweet, .card, [role="article"]',
    text: "p, span, div",
    author: ".author, .username, .name",
    timestamp: "time, .timestamp, .date",
    link: "a",
    image: "img",
    video: "video",
  };
}

// ============================================================================
// VIDEO CAPTURE
// ============================================================================

/**
 * Start video capture of the tab
 */
async function startVideoCapture() {
  try {
    log("Starting video capture...");

    // Request screen capture
    captureState.mediaStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false,
      preferCurrentTab: true,
    });

    // Determine best MIME type
    const mimeTypes = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];

    const mimeType =
      mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ||
      "video/webm";

    // Create MediaRecorder
    captureState.mediaRecorder = new MediaRecorder(captureState.mediaStream, {
      mimeType,
      videoBitsPerSecond: 2500000, // 2.5 Mbps
    });

    // Initialize chunks array for video data
    captureState.videoChunks = [];

    // Handle data available
    captureState.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        captureState.totalBytes += event.data.size;
        captureState.chunksRecorded++;
        captureState.videoChunks.push(event.data);

        // Send update to background
        try {
          chrome.runtime.sendMessage({
            type: "CAPTURE_UPDATE",
            bytes: event.data.size,
            frames: 0,
          });
        } catch (error) {
          logError("Failed to send capture update", error);
        }

        log(
          `Video chunk: ${formatBytes(event.data.size)} | Total: ${formatBytes(captureState.totalBytes)}`,
        );
      }
    };

    // Handle stop
    captureState.mediaRecorder.onstop = async () => {
      log(
        `Video capture stopped. Total: ${formatBytes(captureState.totalBytes)}`,
      );

      // Save video to file
      try {
        await saveVideoFile();
      } catch (error) {
        logError("Failed to save video file", error);
      }
    };

    // Handle errors
    captureState.mediaRecorder.onerror = (event) => {
      logError("MediaRecorder error", event.error);
    };

    // Handle stream end (user stopped sharing)
    captureState.mediaStream.getVideoTracks()[0].onended = () => {
      log("User stopped screen sharing");
      stopScrolling();
    };

    // Start recording (emit data every 1 second)
    captureState.mediaRecorder.start(1000);

    log("Video capture started");
  } catch (error) {
    logError("Failed to start video capture", error);
    throw error;
  }
}

/**
 * Save video file to downloads
 */
async function saveVideoFile() {
  try {
    if (!captureState.videoChunks || captureState.videoChunks.length === 0) {
      log("No video chunks to save");
      return;
    }

    // Create blob from chunks
    const blob = new Blob(captureState.videoChunks, {
      type: captureState.mediaRecorder.mimeType || "video/webm",
    });

    // Generate filename with timestamp
    const timestamp = Date.now();
    const filename = `unhooked_video_${timestamp}.webm`;

    // Create download URL
    const url = URL.createObjectURL(blob);

    // Create download link
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(url);

    log(`Video saved: ${filename} (${formatBytes(blob.size)})`);
  } catch (error) {
    logError("Failed to save video file", error);
  }
}

/**
 * Stop video capture
 */
async function stopVideoCapture() {
  try {
    log("Stopping video capture...");

    if (
      captureState.mediaRecorder &&
      captureState.mediaRecorder.state !== "inactive"
    ) {
      captureState.mediaRecorder.stop();
    }

    if (captureState.mediaStream) {
      captureState.mediaStream.getTracks().forEach((track) => track.stop());
      captureState.mediaStream = null;
    }

    log(
      `Video capture stopped. Total captured: ${formatBytes(captureState.totalBytes)}`,
    );
  } catch (error) {
    logError("Error stopping video capture", error);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(2);
  return `${value} ${sizes[i]}`;
}

/**
 * Format duration in ms to readable string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Log helper
 */
function log(...args) {
  console.log(`[Unhooked Content] [${window.location.hostname}]`, ...args);
}

/**
 * Error log helper
 */
function logError(...args) {
  console.error(
    `[Unhooked Content ERROR] [${window.location.hostname}]`,
    ...args,
  );
}

// Log unhandled errors
window.addEventListener("error", (event) => {
  logError("Unhandled error in content script:", event.error);
});

// Log unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  logError("Unhandled promise rejection in content script:", event.reason);
});

// ============================================================================
// INITIALIZATION
// ============================================================================

log("Content script loaded on", window.location.hostname);
