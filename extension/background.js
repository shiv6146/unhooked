/**
 * Unhooked Background Service Worker
 * Manifest V3 compliant - orchestrates scrolling sessions, digest generation, and scheduling
 *
 * @fileoverview Main orchestration layer for the Unhooked extension
 */

import * as GeminiLive from "./lib/gemini-live.js";

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

/**
 * In-memory state (volatile, resets when service worker restarts)
 */
const volatile = {
  activeSessions: new Map(), // tabId -> session info
  agentTabId: null, // The dedicated background agent tab
  lastAlarmTime: null,
  connectionStatus: "ready",
  // Video streaming state
  streamingTabId: null, // Tab being captured
  offscreenCreated: false, // Whether offscreen doc exists
  geminiConnected: false, // Whether Gemini Live session is active
  frameCount: 0, // Frames sent this session
  scrollActionCount: 0, // Actions received this session
};

/**
 * Persistent state keys (stored in chrome.storage.local)
 */
const STORAGE_KEYS = {
  SETTINGS: "unhooked_settings",
  STATS: "unhooked_stats",
  DIGESTS: "unhooked_digests",
  SCHEDULE: "unhooked_schedule",
};

/**
 * Default settings
 */
const DEFAULT_SETTINGS = {
  scrollSpeed: 2000, // ms between scrolls (human-like timing)
  scrollAmount: 400, // pixels per scroll (smaller, more realistic)
  sessionDuration: 300000, // 5 minutes default
  captureVideo: false, // disabled by default for privacy
  enableScheduling: false,
  scheduleInterval: 120, // minutes (2 hours)
  autoDigest: true,
  digestBatchSize: 50,
  targetUrl: "https://twitter.com", // Default site to scroll
  googleApiKey: "", // Google API key for direct Gemini streaming
};

/**
 * Default stats
 */
const DEFAULT_STATS = {
  totalBytes: 0,
  totalScrolls: 0,
  totalSessions: 0,
  totalDigests: 0,
  lastSessionTime: null,
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Backend API Configuration
 */
const BACKEND_URL = "http://localhost:8080"; // Local for dev, replace with Cloud Run URL

/**
 * Initialize on service worker startup
 */
async function initialize() {
  log("Service worker starting...");

  try {
    // Ensure settings exist
    const settings = await getSettings();
    if (!settings) {
      await saveSettings(DEFAULT_SETTINGS);
      log("Initialized default settings");
    }

    // Ensure stats exist
    const stats = await getStats();
    if (!stats) {
      await saveStats(DEFAULT_STATS);
      log("Initialized default stats");
    }

    // Setup alarms if scheduling is enabled
    if (settings?.enableScheduling) {
      await setupScheduledAlarms(settings.scheduleInterval);
    }

    // Clean up any orphaned sessions
    await cleanupOrphanedSessions();

    log("Service worker initialized successfully");
  } catch (error) {
    logError("Failed to initialize service worker", error);
  }
}

/**
 * Cleanup orphaned sessions on startup
 */
async function cleanupOrphanedSessions() {
  try {
    const tabs = await chrome.tabs.query({});
    const existingTabIds = new Set(tabs.map((t) => t.id));

    // Remove sessions for tabs that no longer exist
    for (const [tabId] of volatile.activeSessions) {
      if (!existingTabIds.has(tabId)) {
        volatile.activeSessions.delete(tabId);
        log(`Cleaned up orphaned session for tab ${tabId}`);
      }
    }
  } catch (error) {
    logError("Failed to cleanup orphaned sessions", error);
  }
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

/**
 * Get settings from storage
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return result[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;
  } catch (error) {
    logError("Failed to get settings", error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Save settings to storage
 */
async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    log("Settings saved", settings);
  } catch (error) {
    logError("Failed to save settings", error);
  }
}

/**
 * Get stats from storage
 */
async function getStats() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    return result[STORAGE_KEYS.STATS] || DEFAULT_STATS;
  } catch (error) {
    logError("Failed to get stats", error);
    return DEFAULT_STATS;
  }
}

/**
 * Save stats to storage
 */
async function saveStats(stats) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
  } catch (error) {
    logError("Failed to save stats", error);
  }
}

/**
 * Get digests from storage
 */
async function getDigests() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DIGESTS);
    return result[STORAGE_KEYS.DIGESTS] || [];
  } catch (error) {
    logError("Failed to get digests", error);
    return [];
  }
}

/**
 * Save digest to storage
 */
async function saveDigest(digest) {
  try {
    const digests = await getDigests();
    digests.unshift(digest); // Add to beginning

    // Keep only last 100 digests
    const trimmed = digests.slice(0, 100);

    await chrome.storage.local.set({ [STORAGE_KEYS.DIGESTS]: trimmed });

    // Update stats
    const stats = await getStats();
    stats.totalDigests = trimmed.length;
    await saveStats(stats);

    log("Digest saved", digest);
  } catch (error) {
    logError("Failed to save digest", error);
  }
}

// ============================================================================
// SCHEDULING WITH CHROME.ALARMS
// ============================================================================

const ALARM_NAME = "unhooked_scheduled_session";

/**
 * Setup scheduled alarms
 */
async function setupScheduledAlarms(intervalMinutes) {
  try {
    // Clear existing alarm
    await chrome.alarms.clear(ALARM_NAME);

    // Create new alarm
    await chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: intervalMinutes,
    });

    log(`Scheduled alarm created: every ${intervalMinutes} minutes`);
  } catch (error) {
    logError("Failed to setup scheduled alarms", error);
  }
}

/**
 * Clear scheduled alarms
 */
async function clearScheduledAlarms() {
  try {
    await chrome.alarms.clear(ALARM_NAME);
    log("Scheduled alarms cleared");
  } catch (error) {
    logError("Failed to clear scheduled alarms", error);
  }
}

/**
 * Handle alarm triggers
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    log("Scheduled alarm triggered");
    volatile.lastAlarmTime = Date.now();

    try {
      await startScheduledSession();
    } catch (error) {
      logError("Failed to handle scheduled alarm", error);
    }
  }
});

/**
 * Start a scheduled session
 */
async function startScheduledSession() {
  try {
    const settings = await getSettings();

    // Create or get agent tab for the target URL
    const targetUrl = settings.targetUrl || "https://twitter.com";
    const agentTab = await getOrCreateAgentTab(targetUrl);

    if (!agentTab) {
      logError("Failed to create agent tab for scheduled session");
      return;
    }

    // Start scrolling session
    await startScrollSession(agentTab.id, {
      ...settings,
      isScheduled: true,
    });

    log(`Scheduled session started on tab ${agentTab.id} for ${targetUrl}`);
  } catch (error) {
    logError("Failed to start scheduled session", error);
  }
}

// ============================================================================
// AGENT TAB MANAGEMENT
// ============================================================================

/**
 * Get or create the dedicated agent tab for a specific URL
 */
async function getOrCreateAgentTab(targetUrl) {
  try {
    // Check if we have a tracked agent tab
    if (volatile.agentTabId) {
      try {
        const tab = await chrome.tabs.get(volatile.agentTabId);
        if (tab && tab.url && matchesTargetUrl(tab.url, targetUrl)) {
          log(`Using existing tracked agent tab: ${tab.id} for ${targetUrl}`);
          // Wait a bit to ensure content script is ready
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return tab;
        }
      } catch (error) {
        // Tab doesn't exist anymore, clear the tracked ID
        volatile.agentTabId = null;
      }
    }

    // Check if agent tab already exists for this URL
    const tabs = await chrome.tabs.query({});
    const agentTab = tabs.find(
      (tab) => tab.url && matchesTargetUrl(tab.url, targetUrl),
    );

    if (agentTab) {
      log(`Found existing agent tab: ${agentTab.id} for ${targetUrl}`);
      volatile.agentTabId = agentTab.id;
      // Wait a bit to ensure content script is ready
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return agentTab;
    }

    // Create new agent tab in background
    log(`Creating new agent tab for ${targetUrl}`);
    const newTab = await chrome.tabs.create({
      url: targetUrl,
      active: false, // KEY: Creates tab in BACKGROUND
      pinned: true, // Pin it so user doesn't accidentally close
    });

    // Track the agent tab
    volatile.agentTabId = newTab.id;

    // Wait for tab to load
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 30 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });

    // Wait for Twitter/SPA to fully load (heavy page, needs more time)
    log(`Waiting for page to fully initialize on tab ${newTab.id}...`);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    log(`Created agent tab: ${newTab.id} for ${targetUrl}`);
    return newTab;
  } catch (error) {
    logError("Failed to get or create agent tab", error);
    return null;
  }
}

/**
 * Check if a URL matches the target URL (handles redirects like x.com -> twitter.com)
 */
function matchesTargetUrl(url, targetUrl) {
  if (url.startsWith(targetUrl)) return true;

  // Handle twitter.com <-> x.com
  if (
    (url.includes("twitter.com") && targetUrl.includes("twitter.com")) ||
    (url.includes("x.com") && targetUrl.includes("x.com")) ||
    (url.includes("twitter.com") && targetUrl.includes("x.com")) ||
    (url.includes("x.com") && targetUrl.includes("twitter.com"))
  ) {
    return true;
  }

  // Handle instagram
  if (url.includes("instagram.com") && targetUrl.includes("instagram.com")) {
    return true;
  }

  // Handle reddit
  if (url.includes("reddit.com") && targetUrl.includes("reddit.com")) {
    return true;
  }

  return false;
}

/**
 * Get or create the agent UI tab (for ambient display)
 */
async function getOrCreateAgentUITab() {
  try {
    // Check if agent UI tab already exists
    const tabs = await chrome.tabs.query({});
    const agentUITab = tabs.find(
      (tab) =>
        tab.url &&
        tab.url.includes("chrome-extension://") &&
        tab.url.includes("agent.html"),
    );

    if (agentUITab) {
      return agentUITab;
    }

    // Create new agent UI tab
    const newTab = await chrome.tabs.create({
      url: chrome.runtime.getURL("agent/agent.html"),
      active: false,
    });

    // Wait for tab to load
    await new Promise((resolve) => {
      const listener = (tabId, changeInfo) => {
        if (tabId === newTab.id && changeInfo.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Timeout after 10 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });

    log(`Created agent UI tab: ${newTab.id}`);
    return newTab;
  } catch (error) {
    logError("Failed to get or create agent UI tab", error);
    return null;
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Start a scrolling session
 */
async function startScrollSession(tabId, config = {}) {
  try {
    // Check if already scrolling
    if (volatile.activeSessions.has(tabId)) {
      log(`Tab ${tabId} already has an active session`);
      return { success: false, error: "Session already active" };
    }

    const settings = await getSettings();
    const sessionConfig = {
      scrollAmount: config.scrollAmount ?? settings.scrollAmount,
      scrollInterval: config.scrollSpeed ?? settings.scrollSpeed,
      duration: config.sessionDuration ?? settings.sessionDuration,
      captureVideo: config.captureVideo ?? settings.captureVideo,
      isScheduled: config.isScheduled ?? false,
    };

    // Wait for content script to be ready
    log(`Waiting for content script to be ready on tab ${tabId}...`);
    const isReady = await waitForContentScript(tabId);

    if (!isReady) {
      return {
        success: false,
        error: "Content script not ready. Please wait and try again.",
      };
    }

    // Send message to content script
    const success = await sendMessageToTab(tabId, {
      action: "startScrolling",
      config: sessionConfig,
    });

    if (!success) {
      return {
        success: false,
        error: "Failed to communicate with content script",
      };
    }

    // Track session
    volatile.activeSessions.set(tabId, {
      startTime: Date.now(),
      config: sessionConfig,
      posts: [],
      bytesProcessed: 0,
      scrollCount: 0,
      contentScriptReady: false,
      site: "unknown",
      lastUpdate: Date.now(),
    });

    // Update badge
    await updateBadge(volatile.activeSessions.size);

    log(`Session started on tab ${tabId}`, sessionConfig);
    return { success: true, tabId };
  } catch (error) {
    logError(`Failed to start session on tab ${tabId}`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Stop a scrolling session
 */
async function stopScrollSession(tabId) {
  try {
    const session = volatile.activeSessions.get(tabId);

    if (!session) {
      log(`No active session on tab ${tabId}`);
      return { success: false, error: "No active session" };
    }

    // Stop video streaming if active
    await stopVideoStreaming();

    // Send message to content script
    await sendMessageToTab(tabId, { action: "stopScrolling" });

    // Generate digest if auto-digest is enabled
    const settings = await getSettings();
    if (settings.autoDigest && session.posts.length > 0) {
      await generateDigest(session);
    }

    // Update stats
    await updateSessionStats(session);

    // Clean up session
    volatile.activeSessions.delete(tabId);

    // Update badge
    await updateBadge(volatile.activeSessions.size);

    log(`Session stopped on tab ${tabId}`);
    return { success: true };
  } catch (error) {
    logError(`Failed to stop session on tab ${tabId}`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Update session stats
 */
async function updateSessionStats(session) {
  try {
    const stats = await getStats();

    stats.totalBytes += session.bytesProcessed;
    stats.totalScrolls += session.scrollCount;
    stats.totalSessions += 1;
    stats.lastSessionTime = Date.now();

    await saveStats(stats);
  } catch (error) {
    logError("Failed to update session stats", error);
  }
}

// ============================================================================
// DIGEST GENERATION
// ============================================================================

/**
 * Generate digest from session data
 */
async function generateDigest(session) {
  try {
    log("Generating digest...", { postCount: session.posts.length });

    // AI-native digest generation
    let aiDigest = null;
    try {
      const response = await sendToBackend("/digest", {
        posts: session.posts.slice(0, 100) // Send max 100 posts to avoid payload limits
      });
      aiDigest = response;
    } catch (err) {
      logError("Remote digest generation failed, falling back to local", err);
    }

    const digest = {
      id: generateId(),
      timestamp: Date.now(),
      duration: Date.now() - session.startTime,
      postCount: session.posts.length,
      scrollCount: session.scrollCount,
      bytesProcessed: session.bytesProcessed,
      summary: aiDigest?.summary || generateSimpleSummary(session.posts), // AI or Fallback
      topics: aiDigest?.topics || [],
      sentiment: aiDigest?.sentiment || "Unknown",
      posts: session.posts.slice(0, 50),
      isScheduled: session.config.isScheduled,
    };

    await saveDigest(digest);

    // Show notification
    await showNotification(
      "Digest Ready",
      digest.summary.slice(0, 100) + "..."
    );

    return digest;
  } catch (error) {
    logError("Failed to generate digest", error);
    return null;
  }
}

/**
 * Generate simple summary (placeholder for LLM integration)
 */
function generateSimpleSummary(posts) {
  if (posts.length === 0) {
    return "No posts captured";
  }

  // Basic categorization
  const categories = {
    links: posts.filter((p) => p.hasLinks).length,
    images: posts.filter((p) => p.hasImages).length,
    videos: posts.filter((p) => p.hasVideos).length,
    text: posts.filter((p) => !p.hasLinks && !p.hasImages && !p.hasVideos)
      .length,
  };

  return `Captured ${posts.length} posts: ${categories.text} text, ${categories.links} with links, ${categories.images} with images, ${categories.videos} with videos`;
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

/**
 * Wait for content script to be ready on a tab
 */
async function waitForContentScript(tabId, maxAttempts = 20, delayMs = 1000) {
  let injected = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Check if tab still exists
      await chrome.tabs.get(tabId);

      // Try to ping the content script
      const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
      if (response && response.ready) {
        log(`Content script ready on tab ${tabId} after ${attempt} attempt(s)`);
        return true;
      }
    } catch (error) {
      // After a few failed pings, try re-injecting the content script
      if (attempt === 3 && !injected) {
        log(`Attempting to inject content script into tab ${tabId}...`);
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
          injected = true;
          log(`Content script injected into tab ${tabId}`);
        } catch (injectErr) {
          log(`Content script injection failed: ${injectErr.message}`);
        }
      }

      if (attempt < maxAttempts) {
        log(
          `Waiting for content script on tab ${tabId} (attempt ${attempt}/${maxAttempts})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  logError(
    `Content script not ready on tab ${tabId} after ${maxAttempts} attempts`,
  );
  return false;
}

/**
 * Send message to tab safely with retry logic
 */
async function sendMessageToTab(tabId, message, maxRetries = 3) {
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (error) {
      if (retry < maxRetries - 1) {
        log(
          `Retry ${retry + 1}/${maxRetries} sending message to tab ${tabId}...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        logError(`Failed to send message to tab ${tabId}`, error);
        return false;
      }
    }
  }
  return false;
}

/**
 * Handle messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      logError("Message handler error", error);
      sendResponse({ success: false, error: error.message });
    });

  return true; // Keep channel open for async response
});

/**
 * Main message handler
 */
async function handleMessage(message, sender) {
  const { type } = message;

  switch (type) {
    case "START_SCROLL_REQUEST": {
      const settings = await getSettings();

      // If popup provides a tabId directly (streaming mode), use that tab
      // Otherwise create/get a dedicated agent tab (scroll-only mode)
      let tabId;
      if (message.config?.tabId) {
        tabId = message.config.tabId;
        log(`Using provided tab ${tabId} (streaming mode)`);
      } else {
        const targetUrl =
          message.config?.targetUrl ||
          settings.targetUrl ||
          "https://twitter.com";

        const agentTab = await getOrCreateAgentTab(targetUrl);
        if (!agentTab) {
          return { success: false, error: "Failed to create agent tab" };
        }
        tabId = agentTab.id;
        log(`Starting session on agent tab ${tabId} for ${targetUrl}`);
      }

      return await startScrollSession(tabId, message.config);
    }

    case "START_VIDEO_STREAM": {
      log("Received START_VIDEO_STREAM request", message);
      const { tabId, streamId } = message;

      if (!streamId) {
        logError("No streamId provided");
        return { success: false, error: "No streamId provided" };
      }

      const settings = await getSettings();
      log("Got settings for video stream", { hasApiKey: !!settings.googleApiKey });

      const apiKey = settings.googleApiKey;
      const curatorGoal = settings.curatorGoal || "";
      if (!apiKey) {
        return { success: false, error: "No API key configured" };
      }

      try {
        log("Calling startVideoStreaming...", { tabId, streamId });
        await startVideoStreaming(tabId, apiKey, streamId, curatorGoal);
        return { success: true };
      } catch (err) {
        logError("Video streaming failed", err);
        return { success: false, error: err.message };
      }
    }

    case "STOP_SCROLL_REQUEST": {
      // Stop all active sessions, not just the active tab
      const activeSessions = Array.from(volatile.activeSessions.keys());

      if (activeSessions.length === 0) {
        return { success: false, error: "No active sessions" };
      }

      // Stop the first active session (or all of them)
      const results = [];
      for (const tabId of activeSessions) {
        const result = await stopScrollSession(tabId);
        results.push(result);
      }

      return { success: true, stopped: results.length };
    }

    case "GET_STATS": {
      const stats = await getStats();
      const activeSessions = Array.from(volatile.activeSessions.keys());
      return {
        success: true,
        stats: {
          ...stats,
          activeTabs: activeSessions,
          activeCount: activeSessions.length,
        },
      };
    }

    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { success: true, settings };
    }

    case "UPDATE_SETTINGS": {
      const newSettings = { ...(await getSettings()), ...message.settings };
      await saveSettings(newSettings);

      // Update alarms if scheduling changed
      if (message.settings.enableScheduling !== undefined) {
        if (newSettings.enableScheduling) {
          await setupScheduledAlarms(newSettings.scheduleInterval);
        } else {
          await clearScheduledAlarms();
        }
      }

      return { success: true, settings: newSettings };
    }

    case "GET_DIGESTS": {
      const digests = await getDigests();
      return { success: true, digests };
    }

    case "CONTENT_SCRIPT_READY": {
      // Content script has loaded and is ready
      if (sender.tab?.id) {
        log(
          `Content script ready on tab ${sender.tab.id}: ${message.site} at ${message.url}`,
        );

        // Update session if one exists
        const session = volatile.activeSessions.get(sender.tab.id);
        if (session) {
          session.contentScriptReady = true;
          session.site = message.site;
          log(`Session ${sender.tab.id} marked as ready`);
        }
      }
      return { success: true };
    }

    case "OPEN_AGENT_TAB": {
      // Open the agent UI visualization tab
      const agentUITab = await getOrCreateAgentUITab();

      if (!agentUITab) {
        return { success: false, error: "Failed to create agent UI tab" };
      }

      // Focus the agent UI tab
      await chrome.tabs.update(agentUITab.id, { active: true });
      await chrome.windows.update(agentUITab.windowId, { focused: true });

      return { success: true, tabId: agentUITab.id };
    }

    case "CAPTURE_UPDATE": {
      if (sender.tab?.id) {
        const session = volatile.activeSessions.get(sender.tab.id);
        if (session) {
          session.bytesProcessed += message.bytes || 0;
          session.scrollCount = message.scrollCount || session.scrollCount;
          session.postsExtracted = message.postsExtracted || session.postsExtracted;
          session.lastUpdate = Date.now();

          // Update scroll position and document height if provided
          if (message.scrollPosition !== undefined) {
            session.scrollPosition = message.scrollPosition;
          }
          if (message.documentHeight !== undefined) {
            session.documentHeight = message.documentHeight;
          }
          if (message.url) {
            session.url = message.url;
          }

          // AI analysis is now handled by the Gemini Live streaming pipeline
          // (VIDEO_FRAME messages from offscreen → sendFrame → action callback)
        }
      }
      return { success: true };
    }

    case "LOG": {
      log(message.message, message.data || "");
      return { success: true };
    }

    case "VIDEO_FRAME": {
      // Frame from offscreen document → forward to Gemini Live
      if (GeminiLive.isConnected() && message.data) {
        GeminiLive.sendFrame(message.data);
        volatile.frameCount++;

        if (volatile.frameCount % 10 === 0) {
          log(`Sent ${volatile.frameCount} frames to Gemini`);
        }
      }
      return { success: true };
    }

    case "FRAME_EXTRACTION_ERROR": {
      logError("Frame extraction error from offscreen", message.error);
      return { success: true };
    }

    case "POST_EXTRACTED": {
      if (sender.tab?.id) {
        const session = volatile.activeSessions.get(sender.tab.id);
        if (session && message.post) {
          session.posts.push(message.post);
          session.lastUpdate = Date.now();

          // Log progress every 10 posts
          if (session.posts.length % 10 === 0) {
            log(
              `Session ${sender.tab.id}: Extracted ${session.posts.length} posts`,
            );
          }
        }
      }
      return { success: true };
    }

    case "SCROLL_COMPLETE": {
      if (sender.tab?.id) {
        await stopScrollSession(sender.tab.id);
      }
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown message type" };
  }
}

// ============================================================================
// VIDEO STREAMING PIPELINE (Gemini Live API)
// ============================================================================

/**
 * Start the video streaming pipeline:
 * offscreen doc (frame extraction) → Gemini Live API → action callback
 * streamId is obtained from popup via chrome.tabCapture.getMediaStreamId (user gesture)
 */
async function startVideoStreaming(tabId, apiKey, streamId, curatorGoal = "") {
  log(`Starting video streaming pipeline for tab ${tabId}`);

  // 1. Connect to Gemini Live API
  await GeminiLive.connect(apiKey, curatorGoal, (action) => {
    handleGeminiAction(tabId, action);
  });
  volatile.geminiConnected = true;
  volatile.frameCount = 0;
  volatile.scrollActionCount = 0;
  volatile.streamingTabId = tabId;

  log(`Using tab capture stream ID from popup`);

  // 2. Create offscreen document (if not already created)
  if (!volatile.offscreenCreated) {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Extract video frames from tab capture for AI analysis",
      });
      volatile.offscreenCreated = true;
      log("Offscreen document created");
    } catch (err) {
      // Document might already exist
      if (!err.message.includes("Only a single offscreen")) {
        throw err;
      }
      volatile.offscreenCreated = true;
    }
  }

  // 3. Tell offscreen document to start frame extraction
  await chrome.runtime.sendMessage({
    type: "START_FRAME_EXTRACTION",
    streamId: streamId,
  });

  log("Video streaming pipeline started successfully");
}

/**
 * Stop the video streaming pipeline and clean up
 */
async function stopVideoStreaming() {
  log("Stopping video streaming pipeline");

  // 1. Stop frame extraction in offscreen
  try {
    await chrome.runtime.sendMessage({ type: "STOP_FRAME_EXTRACTION" });
  } catch (_) {
    // Offscreen might not exist
  }

  // 2. Disconnect from Gemini Live
  GeminiLive.disconnect();
  volatile.geminiConnected = false;

  // 3. Close offscreen document
  if (volatile.offscreenCreated) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) {
      // Already closed
    }
    volatile.offscreenCreated = false;
  }

  volatile.streamingTabId = null;
  log(
    `Video streaming stopped. Frames sent: ${volatile.frameCount}, Actions received: ${volatile.scrollActionCount}`,
  );
}

/**
 * Handle action from Gemini Live API
 */
function handleGeminiAction(tabId, action) {
  volatile.scrollActionCount++;
  log(`Gemini action #${volatile.scrollActionCount}: ${action.action} — ${action.reason || ""}`);

  // Forward action to content script
  sendMessageToTab(tabId, {
    action: "EXECUTE_ACTION",
    command: action.action,
    params: action.params,
  }).catch((err) => logError("Failed to forward Gemini action", err));

  // Auto-stop after too many scroll actions
  if (action.action === "STOP" || volatile.scrollActionCount > 100) {
    log("Gemini requested STOP or max actions reached");
    stopScrollSession(tabId).catch((err) =>
      logError("Failed to stop session after Gemini STOP", err),
    );
  }
}

// ============================================================================
// AI ANALYSIS (GEMINI VISION) — Legacy, kept for server-mode fallback
// ============================================================================

/**
 * Capture screenshot and send to backend for analysis
 */
async function analyzeTabContent(tabId, session) {
  try {
    log(`Analyzing content on tab ${tabId}...`);

    // 1. Capture screenshot of the tab's window
    //    captureVisibleTab captures the active tab in a given window.
    //    We need to briefly make the agent tab active, capture, then restore.
    let screenshotUrl;
    try {
      const tab = await chrome.tabs.get(tabId);
      // Ensure the tab is the active one in its window before capture
      await chrome.tabs.update(tabId, { active: true });
      // Small delay for the tab to render
      await new Promise((r) => setTimeout(r, 200));
      screenshotUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "jpeg",
        quality: 50,
      });
    } catch (captureErr) {
      log(`Screenshot capture failed: ${captureErr.message}`);
      return; // Skip this analysis cycle
    }

    if (!screenshotUrl) {
      log("Empty screenshot, skipping analysis");
      return;
    }

    // 2. Send to Backend
    const response = await sendToBackend("/analyze", {
      screenshot: screenshotUrl,
      url: session.url || "unknown",
      instruction:
        session.config.instruction || "Scroll and find interesting content",
    });

    if (!response || !response.action) {
      log("No action from backend");
      return;
    }

    log(`AI action: ${response.action} — ${response.reason || ""}`);

    // 3. Execute Action
    await sendMessageToTab(tabId, {
      action: "EXECUTE_ACTION",
      command: response.action,
      params: response.params,
    });
  } catch (error) {
    logError("Error during AI analysis", error);
  }
}

/**
 * Helper to send data to backend
 */
async function sendToBackend(endpoint, data) {
  try {
    const settings = await getSettings();
    const headers = {
      "Content-Type": "application/json",
    };

    // Add API key if we have one in settings (optional for now)
    if (settings.apiKey) {
      headers["X-API-Key"] = settings.apiKey;
    }

    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    // If backend is down, log but don't crash
    if (error.message.includes("Failed to fetch")) {
      log("Backend unreachable - allow local fallback");
    } else {
      logError(`API Call failed: ${endpoint}`, error);
    }
    return null;
  }
}

// ============================================================================
// UI HELPERS
// ============================================================================

/**
 * Update extension badge
 */
async function updateBadge(count) {
  try {
    if (count > 0) {
      await chrome.action.setBadgeText({ text: String(count) });
      await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    } else {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch (error) {
    logError("Failed to update badge", error);
  }
}

/**
 * Show notification
 */
async function showNotification(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title,
      message,
      priority: 1,
    });
  } catch (error) {
    // Notifications permission might not be granted
    log("Could not show notification", error);
  }
}

// ============================================================================
// TAB LIFECYCLE
// ============================================================================

/**
 * Clean up when tabs are closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  // Clean up active sessions
  if (volatile.activeSessions.has(tabId)) {
    log(`Tab ${tabId} closed, cleaning up session`);
    stopScrollSession(tabId);
  }

  // Clear agent tab tracking if it was closed
  if (volatile.agentTabId === tabId) {
    log(`Agent tab ${tabId} was closed, clearing tracking`);
    volatile.agentTabId = null;
  }
});

/**
 * Handle tab updates
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If URL changed and session is active, check if it's still valid
  if (changeInfo.url && volatile.activeSessions.has(tabId)) {
    const session = volatile.activeSessions.get(tabId);
    const settings = getSettings();

    // If navigated away from target site, stop the session
    settings.then((s) => {
      const targetUrl = s.targetUrl || "https://twitter.com";
      if (!matchesTargetUrl(changeInfo.url, targetUrl)) {
        log(`Tab ${tabId} navigated away from target, stopping session`);
        stopScrollSession(tabId);
      }
    });
  }
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate unique ID
 */
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
  console.log("[Unhooked Background]", ...args);
}

/**
 * Error log helper
 */
function logError(...args) {
  console.error("[Unhooked Background ERROR]", ...args);
}

// ============================================================================
// SERVICE WORKER LIFECYCLE
// ============================================================================

// Initialize on install
chrome.runtime.onInstalled.addListener((details) => {
  log("Extension installed/updated", details);
  initialize();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  log("Browser started");
  initialize();
});

// Self-initialization (in case service worker was woken up)
initialize();

log("Background service worker loaded");
