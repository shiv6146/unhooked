/**
 * Unhooked Content Script — Read-Only Scroll State Machine
 *
 * The agent is COMPLETELY read-only. It cannot like, save, follow, post,
 * comment, DM, or interact with ANY element on the page.
 * The ONLY thing it controls is scrolling.
 */

// ============================================================================
// SCROLL STATE MACHINE
// ============================================================================

const ScrollState = {
  NORMAL: "normal",
  SLOW: "slow",
  PAUSED: "paused",
  FAST: "fast",
};

const SCROLL_SPEEDS = {
  normal: { amount: 300, interval: 2000 },
  slow: { amount: 100, interval: 4000 },
  fast: { amount: 600, interval: 800 },
  paused: { amount: 0, interval: 0 },
};

const AUTO_RESUME_MS = {
  slow: 15000,
  paused: 8000,
  fast: 10000,
};

let scrollState = ScrollState.NORMAL;
let stateTimeout = null;
let scrollIntervalId = null;
let sessionActive = false;
let sessionStartTime = null;
let postsScanned = 0;
let sessionConfig = {};

// Audit log: records every state change with timestamp + observation
const scrollAuditLog = [];

// ============================================================================
// INITIALIZATION
// ============================================================================

let isReady = false;

(function init() {
  try {
    const site = detectSite();
    isReady = true;
    chrome.runtime.sendMessage({
      type: "CONTENT_SCRIPT_READY",
      url: window.location.href,
      site: site.name,
      timestamp: Date.now(),
    }).catch(() => {});
  } catch (error) {
    console.error("[Unhooked] Init failed:", error);
  }
})();

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action || message.type) {
    case "startScrolling":
      startScrolling(message.config)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "stopScrolling":
      stopScrolling()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case "SCROLL_COMMAND":
      handleScrollCommand(message);
      sendResponse({ success: true });
      return false;

    case "ping":
      sendResponse({ success: true, ready: isReady });
      return false;

    case "getStatus":
      sendResponse({
        success: true,
        isActive: sessionActive,
        scrollState: scrollState,
        postsScanned: postsScanned,
        elapsed: sessionActive ? Date.now() - sessionStartTime : 0,
      });
      return false;

    case "getScrollState":
      sendResponse({ success: true, scrollState: scrollState });
      return false;

    case "getSessionAuditLog":
      sendResponse({ success: true, auditLog: scrollAuditLog });
      return false;

    default:
      sendResponse({ success: false, error: "Unknown action" });
      return false;
  }
});

// ============================================================================
// SCROLL COMMAND HANDLER
// ============================================================================

function handleScrollCommand(message) {
  if (!sessionActive) return;

  const { scroll, observation } = message;
  const previousState = scrollState;

  switch (scroll) {
    case "SCROLL_PAUSE":
      setScrollState(ScrollState.PAUSED, observation);
      break;
    case "SCROLL_SLOW":
      setScrollState(ScrollState.SLOW, observation);
      break;
    case "SCROLL_FAST":
      setScrollState(ScrollState.FAST, observation);
      break;
    case "SCROLL_UP":
      window.scrollBy({ top: -window.innerHeight, behavior: "smooth" });
      setScrollState(ScrollState.PAUSED, observation);
      break;
    case "SCROLL_DOWN":
    default:
      setScrollState(ScrollState.NORMAL, observation);
      break;
  }

  // Extract post URLs when pausing or slowing
  if (scroll === "SCROLL_PAUSE" || scroll === "SCROLL_SLOW") {
    const urls = extractVisiblePostUrls();
    if (urls.length > 0) {
      chrome.runtime.sendMessage({
        type: "POST_URLS_EXTRACTED",
        urls: urls,
        scrollState: scrollState,
      }).catch(() => {});
    }
  }

  // Count posts scanned on every command
  postsScanned++;
  sendProgressUpdate();
}

function setScrollState(newState, observation) {
  const previousState = scrollState;
  scrollState = newState;

  // Clear existing auto-resume timeout
  if (stateTimeout !== null) {
    clearTimeout(stateTimeout);
    stateTimeout = null;
  }

  // Record audit log entry
  scrollAuditLog.push({
    t: Math.floor(Date.now() / 1000),
    from: previousState,
    to: newState,
    obs: (observation || "").slice(0, 200),
  });

  // Restart scroll interval with new timing
  startScrollInterval();

  // Set auto-resume timeout for non-normal states
  if (newState !== ScrollState.NORMAL && AUTO_RESUME_MS[newState]) {
    stateTimeout = setTimeout(() => {
      stateTimeout = null;
      setScrollState(ScrollState.NORMAL, "auto-resume timeout");
    }, AUTO_RESUME_MS[newState]);
  }
}

// ============================================================================
// SCROLLING ENGINE
// ============================================================================

function startScrollInterval() {
  if (scrollIntervalId !== null) {
    clearInterval(scrollIntervalId);
    scrollIntervalId = null;
  }

  const speed = SCROLL_SPEEDS[scrollState];
  if (!speed || speed.interval === 0) return; // paused = no interval

  scrollIntervalId = setInterval(() => {
    if (!sessionActive) return;

    // Add slight human-like variation (±20%)
    const variation = 1 + (Math.random() - 0.5) * 0.4;
    const amount = Math.round(speed.amount * variation);

    window.scrollBy({ top: amount, behavior: "smooth" });
  }, speed.interval);
}

async function startScrolling(config = {}) {
  if (!isReady) throw new Error("Content script not initialized");
  if (sessionActive) throw new Error("Session already active");

  sessionConfig = config;
  sessionActive = true;
  sessionStartTime = Date.now();
  postsScanned = 0;
  scrollState = ScrollState.NORMAL;
  scrollAuditLog.length = 0;

  // Set session duration timeout
  const duration = config.duration || 300000;
  setTimeout(() => {
    if (sessionActive) {
      stopScrolling();
    }
  }, duration);

  // Start scrolling at normal speed
  startScrollInterval();

  console.log("[Unhooked] Scrolling session started");
}

async function stopScrolling() {
  if (!sessionActive) return;

  sessionActive = false;

  if (scrollIntervalId !== null) {
    clearInterval(scrollIntervalId);
    scrollIntervalId = null;
  }
  if (stateTimeout !== null) {
    clearTimeout(stateTimeout);
    stateTimeout = null;
  }

  scrollState = ScrollState.NORMAL;

  const duration = Date.now() - sessionStartTime;
  console.log(`[Unhooked] Session complete: ${postsScanned} posts in ${Math.round(duration / 1000)}s`);

  try {
    if (chrome.runtime?.id) {
      await chrome.runtime.sendMessage({
        type: "SCROLL_COMPLETE",
        postsScanned: postsScanned,
        duration: duration,
        auditLog: scrollAuditLog,
      });
    }
  } catch (error) {
    if (!error.message?.includes("Extension context invalidated")) {
      console.error("[Unhooked] Failed to notify background:", error);
    }
  }
}

// ============================================================================
// POST URL EXTRACTION
// ============================================================================

function extractVisiblePostUrls() {
  const urls = [];
  const site = detectSite();

  try {
    switch (site.name) {
      case "twitter": {
        const tweets = document.querySelectorAll('article[data-testid="tweet"]');
        tweets.forEach((tweet) => {
          const rect = tweet.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const link = tweet.querySelector('a[href*="/status/"]');
            if (link) urls.push(link.href);
          }
        });
        break;
      }
      case "reddit": {
        const posts = document.querySelectorAll('[data-testid="post-container"], shreddit-post, .Post');
        posts.forEach((post) => {
          const rect = post.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const link = post.querySelector('a[href*="/comments/"]');
            if (link) urls.push(link.href);
          }
        });
        break;
      }
      case "linkedin": {
        const posts = document.querySelectorAll(".feed-shared-update-v2");
        posts.forEach((post) => {
          const rect = post.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const link = post.querySelector('a[href*="/feed/update/"]');
            if (link) urls.push(link.href);
          }
        });
        break;
      }
      case "hackernews": {
        const rows = document.querySelectorAll(".athing");
        rows.forEach((row) => {
          const rect = row.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const link = row.querySelector(".titleline a");
            if (link) urls.push(link.href);
          }
        });
        break;
      }
      case "news":
      default: {
        const articles = document.querySelectorAll('article, [role="article"], .post, .story-card, .card, h2 a, h3 a');
        articles.forEach((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            const link = el.tagName === "A" ? el : el.querySelector("a[href]");
            if (link && link.href.length > 30) urls.push(link.href);
          }
        });
        break;
      }
    }
  } catch (err) {
    console.error("[Unhooked] URL extraction error:", err);
  }

  return [...new Set(urls)];
}

// ============================================================================
// SITE DETECTION
// ============================================================================

function detectSite() {
  const hostname = window.location.hostname;
  if (hostname.includes("twitter.com") || hostname.includes("x.com")) return { name: "twitter" };
  if (hostname.includes("instagram.com")) return { name: "instagram" };
  if (hostname.includes("reddit.com")) return { name: "reddit" };
  if (hostname.includes("linkedin.com")) return { name: "linkedin" };
  if (hostname.includes("facebook.com")) return { name: "facebook" };
  if (hostname.includes("news.ycombinator.com")) return { name: "hackernews" };
  if (hostname.includes("bbc.com") || hostname.includes("bbc.co.uk")) return { name: "news" };
  if (hostname.includes("cnn.com")) return { name: "news" };
  if (hostname.includes("reuters.com")) return { name: "news" };
  if (hostname.includes("techcrunch.com")) return { name: "news" };
  if (hostname.includes("theverge.com")) return { name: "news" };
  if (hostname.includes("arstechnica.com")) return { name: "news" };
  return { name: "generic" };
}

// ============================================================================
// PROGRESS UPDATES
// ============================================================================

function sendProgressUpdate() {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage({
      type: "CAPTURE_UPDATE",
      scrollCount: postsScanned,
      postsExtracted: postsScanned,
      url: window.location.href,
      scrollPosition: window.scrollY,
      documentHeight: document.documentElement.scrollHeight,
      currentScrollState: scrollState,
    }).catch(() => {});
  } catch (_) {}
}

console.log("[Unhooked] Content script loaded on", window.location.hostname);
