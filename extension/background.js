/**
 * Unhooked Background Service Worker
 *
 * Orchestrates: tab capture → offscreen frames → Gemini Live → scroll commands
 * After session: observation log → digest generation → storage
 */

import * as GeminiLive from "./lib/gemini-live.js";
import { buildSessionPrompt } from "./lib/prompts.js";
import { generateDigest, computeTimeSaved, updateAnalytics } from "./lib/digest.js";

// ============================================================================
// STATE
// ============================================================================

const volatile = {
  streamingTabId: null,
  offscreenCreated: false,
  geminiConnected: false,
  frameCount: 0,
  scrollCommandCount: 0,
  sessionActive: false,
  sessionStartTime: null,
  sessionConfig: {},
  currentObservations: [],
  latestObservation: null,
  currentScrollState: "normal",
  postUrls: [],
};

const DEFAULT_SETTINGS = {
  googleApiKey: "",
  curatorGoal: "",
  sessionDuration: 300000,
  targetUrl: "https://twitter.com",
  onboardingComplete: false,
};

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
  log("Service worker starting...");
  try {
    const result = await chrome.storage.local.get("settings");
    if (!result.settings) {
      await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
    }
    const sessResult = await chrome.storage.local.get("sessions");
    if (!sessResult.sessions) {
      await chrome.storage.local.set({ sessions: [] });
    }

    // Auto-load API key from _env.json if present and not already set
    await tryLoadEnvApiKey();

    log("Initialized");
  } catch (error) {
    logError("Init failed", error);
  }
}

async function tryLoadEnvApiKey() {
  try {
    const settings = await getSettings();
    if (settings.googleApiKey) return; // already configured

    const resp = await fetch(chrome.runtime.getURL("_env.json"));
    if (!resp.ok) return;
    const env = await resp.json();
    if (env.GEMINI_API_KEY) {
      log("Auto-loading API key from _env.json");
      await saveSettings({
        ...settings,
        googleApiKey: env.GEMINI_API_KEY,
        curatorGoal: env.CURATOR_GOAL || settings.curatorGoal || "Interesting and relevant content",
        onboardingComplete: true,
      });
      log("API key loaded, onboarding auto-completed");
    }
  } catch (_) {
    // _env.json doesn't exist or isn't readable — that's fine
  }
}

// ============================================================================
// STORAGE HELPERS
// ============================================================================

async function getSettings() {
  const result = await chrome.storage.local.get("settings");
  return result.settings || DEFAULT_SETTINGS;
}

async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}

async function getSessions() {
  const result = await chrome.storage.local.get("sessions");
  return result.sessions || [];
}

async function getAnalytics() {
  const result = await chrome.storage.local.get("analytics");
  return result.analytics || { totalTimeSaved: 0, totalSessions: 0, totalPostsScanned: 0, avgNoiseRate: 0 };
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      logError("Message handler error", error);
      sendResponse({ success: false, error: error.message });
    });
  return true;
});

async function handleMessage(message, sender) {
  const { type } = message;

  switch (type) {
    // -- Session lifecycle --
    case "START_VIDEO_STREAM": {
      const { tabId, streamId } = message;
      if (!streamId) return { success: false, error: "No streamId" };

      const settings = await getSettings();
      if (!settings.googleApiKey) return { success: false, error: "No API key configured" };

      try {
        await startVideoStreaming(
          tabId,
          settings.googleApiKey,
          streamId,
          settings.curatorGoal,
          message.sessionInstructions || ""
        );
        return { success: true };
      } catch (err) {
        logError("Video streaming failed", err);
        return { success: false, error: err.message };
      }
    }

    case "START_SCROLL_REQUEST": {
      const settings = await getSettings();
      const tabId = message.config?.tabId;
      if (!tabId) return { success: false, error: "No tabId provided" };

      const duration = message.config?.duration || settings.sessionDuration || 300000;

      // Wait for content script
      const ready = await waitForContentScript(tabId);
      if (!ready) return { success: false, error: "Content script not ready" };

      const sent = await sendMessageToTab(tabId, {
        action: "startScrolling",
        config: { duration },
      });
      if (!sent) return { success: false, error: "Failed to communicate with tab" };

      volatile.sessionActive = true;
      volatile.sessionStartTime = Date.now();
      volatile.sessionConfig = message.config || {};
      volatile.currentObservations = [];
      volatile.postUrls = [];
      volatile.currentScrollState = "normal";

      await updateBadge("ON");
      return { success: true, tabId };
    }

    case "STOP_SCROLL_REQUEST": {
      await endSession();
      return { success: true };
    }

    // -- Video frame pipeline --
    case "VIDEO_FRAME": {
      if (GeminiLive.isConnected() && message.data) {
        GeminiLive.sendFrame(message.data);
        volatile.frameCount++;
      }
      return { success: true };
    }

    case "FRAME_EXTRACTION_ERROR": {
      logError("Frame extraction error", message.error);
      return { success: true };
    }

    // -- Content script messages --
    case "SCROLL_COMPLETE": {
      if (sender.tab?.id) {
        await endSession(message);
      }
      return { success: true };
    }

    case "CAPTURE_UPDATE": {
      if (message.currentScrollState) {
        volatile.currentScrollState = message.currentScrollState;
      }
      return { success: true };
    }

    case "POST_URLS_EXTRACTED": {
      if (message.urls) {
        volatile.postUrls.push(...message.urls);
      }
      return { success: true };
    }

    case "CONTENT_SCRIPT_READY": {
      log(`Content script ready: ${message.site} at ${message.url}`);
      return { success: true };
    }

    // -- Settings --
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { success: true, settings };
    }

    case "UPDATE_SETTINGS": {
      const current = await getSettings();
      const updated = { ...current, ...message.settings };
      await saveSettings(updated);
      return { success: true, settings: updated };
    }

    // -- Data queries --
    case "GET_DIGESTS": {
      const sessions = await getSessions();
      return { success: true, digests: sessions };
    }

    case "GET_ANALYTICS": {
      const analytics = await getAnalytics();
      return { success: true, analytics };
    }

    case "SESSION_STATUS": {
      return {
        success: true,
        active: volatile.sessionActive,
        scrollState: volatile.currentScrollState,
        observationCount: volatile.currentObservations.length,
        elapsed: volatile.sessionActive ? Date.now() - volatile.sessionStartTime : 0,
        latestObservation: volatile.latestObservation,
        frameCount: volatile.frameCount,
        scrollCommandCount: volatile.scrollCommandCount,
      };
    }

    case "VALIDATE_API_KEY": {
      try {
        const { GoogleGenAI: GenAI } = await import("./lib/genai.bundle.js");
        const testAi = new GenAI({ apiKey: message.apiKey });
        await testAi.models.generateContent({
          model: "gemini-2.0-flash",
          contents: "Say 'ok' in one word.",
        });
        return { success: true, valid: true };
      } catch (err) {
        return { success: true, valid: false, error: err.message };
      }
    }

    case "LOG": {
      log(message.message, message.data || "");
      return { success: true };
    }

    case "OFFSCREEN_READY": {
      log("Offscreen document ready");
      return { success: true };
    }

    default:
      return { success: false, error: "Unknown message type: " + type };
  }
}

// ============================================================================
// VIDEO STREAMING PIPELINE
// ============================================================================

async function startVideoStreaming(tabId, apiKey, streamId, curatorGoal, sessionInstructions) {
  log("Starting video streaming pipeline for tab", tabId);

  const systemPrompt = buildSessionPrompt(curatorGoal, sessionInstructions);

  await GeminiLive.connect(apiKey, systemPrompt, (command) => {
    handleScrollCommand(tabId, command);
  }, (status) => {
    log("Gemini status:", status);
  });

  volatile.geminiConnected = true;
  volatile.frameCount = 0;
  volatile.scrollCommandCount = 0;
  volatile.streamingTabId = tabId;

  // Create offscreen document
  if (!volatile.offscreenCreated) {
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["DOM_PARSER"],
        justification: "Extract video frames from tab capture for AI analysis",
      });
      volatile.offscreenCreated = true;
    } catch (err) {
      if (!err.message.includes("Only a single offscreen")) throw err;
      volatile.offscreenCreated = true;
    }
  }

  // Start frame extraction
  await chrome.runtime.sendMessage({
    type: "START_FRAME_EXTRACTION",
    streamId: streamId,
  });

  log("Video streaming pipeline started");
}

async function stopVideoStreaming() {
  log("Stopping video streaming");

  try {
    await chrome.runtime.sendMessage({ type: "STOP_FRAME_EXTRACTION" });
  } catch (_) {}

  GeminiLive.disconnect();
  volatile.geminiConnected = false;

  if (volatile.offscreenCreated) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (_) {}
    volatile.offscreenCreated = false;
  }

  volatile.streamingTabId = null;
  log(`Streaming stopped. Frames: ${volatile.frameCount}, Commands: ${volatile.scrollCommandCount}`);
}

// ============================================================================
// SCROLL COMMAND HANDLING
// ============================================================================

function handleScrollCommand(tabId, command) {
  volatile.scrollCommandCount++;
  const stateMap = { SCROLL_DOWN: "normal", SCROLL_SLOW: "slow", SCROLL_PAUSE: "paused", SCROLL_FAST: "fast", SCROLL_UP: "up" };
  volatile.currentScrollState = stateMap[command.scroll] || "normal";
  volatile.latestObservation = command.observation;

  // Append to in-memory observation log
  const entry = {
    timestamp: Date.now(),
    scroll: command.scroll,
    observation: command.observation,
    relevance: command.relevance,
  };

  // Attach most recent post URL if relevance is high/medium
  if ((command.relevance === "high" || command.relevance === "medium") && volatile.postUrls.length > 0) {
    entry.postUrl = volatile.postUrls[volatile.postUrls.length - 1];
  }

  volatile.currentObservations.push(entry);

  // Forward to content script
  sendMessageToTab(tabId, {
    type: "SCROLL_COMMAND",
    action: "SCROLL_COMMAND",
    scroll: command.scroll,
    observation: command.observation,
  }).catch((err) => logError("Failed to forward scroll command", err));

  if (volatile.scrollCommandCount % 5 === 0) {
    log(`Commands: ${volatile.scrollCommandCount}, Observations: ${volatile.currentObservations.length}`);
  }
}

// ============================================================================
// SESSION END + DIGEST GENERATION
// ============================================================================

async function endSession(scrollCompleteMsg) {
  if (!volatile.sessionActive) return;

  volatile.sessionActive = false;

  // Capture tab ID before stopVideoStreaming clears it
  const tabIdToStop = volatile.streamingTabId;

  // Always stop video streaming
  await stopVideoStreaming();

  // Stop scrolling in content script
  if (tabIdToStop) {
    await sendMessageToTab(tabIdToStop, { action: "stopScrolling" }).catch(() => {});
  }

  const settings = await getSettings();
  const duration = Date.now() - (volatile.sessionStartTime || Date.now());
  const postsScanned = scrollCompleteMsg?.postsScanned || volatile.scrollCommandCount;
  const auditLog = scrollCompleteMsg?.auditLog || [];

  // Get observation log from GeminiLive + in-memory
  const observationLog = GeminiLive.getObservationLog().length > 0
    ? GeminiLive.getObservationLog()
    : volatile.currentObservations;
  GeminiLive.clearObservationLog();

  const hostname = volatile.sessionConfig?.tabUrl
    ? new URL(volatile.sessionConfig.tabUrl).hostname
    : "unknown";

  const sessionMeta = {
    platform: hostname,
    curatorGoal: settings.curatorGoal || "",
    duration,
    postsScanned,
  };

  // Generate digest
  let digest;
  try {
    if (settings.googleApiKey && observationLog.length > 0) {
      digest = await generateDigest(settings.googleApiKey, observationLog, sessionMeta);
    }
  } catch (err) {
    logError("Digest generation failed", err);
  }

  if (!digest) {
    // Minimal fallback
    digest = {
      tldr: observationLog.length > 0
        ? `Scrolled through ${postsScanned} posts. Check the highlights.`
        : "Session ended with no observations.",
      mustRead: [],
      worthALook: [],
      skimmedPast: { total: postsScanned, categories: { Other: postsScanned } },
      feedMood: "N/A",
      matchRate: 0,
    };
  }

  const timeSaved = computeTimeSaved(postsScanned);

  const sessionRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: volatile.sessionStartTime || Date.now(),
    platform: hostname,
    curatorGoal: settings.curatorGoal || "",
    sessionInstructions: volatile.sessionConfig?.sessionInstructions || "",
    duration,
    postsScanned,
    digest,
    timeSaved,
    scrollAudit: auditLog.slice(0, 200),
  };

  // Persist session
  const sessions = await getSessions();
  sessions.unshift(sessionRecord);
  const trimmed = sessions.slice(0, 200);
  await chrome.storage.local.set({ sessions: trimmed });

  // Update analytics
  await updateAnalytics(trimmed);

  // Notify popup
  try {
    chrome.runtime.sendMessage({
      type: "DIGEST_READY",
      session: sessionRecord,
    }).catch(() => {});
  } catch (_) {}

  await updateBadge("");
  log("Session ended. Digest saved.", sessionRecord.id);
}

// ============================================================================
// HELPERS
// ============================================================================

async function waitForContentScript(tabId, maxAttempts = 15, delayMs = 800) {
  let injected = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await chrome.tabs.get(tabId);
      const response = await chrome.tabs.sendMessage(tabId, { action: "ping" });
      if (response?.ready) return true;
    } catch (_) {
      if (attempt === 3 && !injected) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
          injected = true;
        } catch (__) {}
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return false;
}

async function sendMessageToTab(tabId, message, maxRetries = 3) {
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
      return true;
    } catch (_) {
      if (retry < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
  return false;
}

async function updateBadge(text) {
  try {
    await chrome.action.setBadgeText({ text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" });
    }
  } catch (_) {}
}

function log(...args) {
  console.log("[Unhooked BG]", ...args);
}

function logError(...args) {
  console.error("[Unhooked BG ERROR]", ...args);
}

// ============================================================================
// TAB LIFECYCLE
// ============================================================================

chrome.tabs.onRemoved.addListener((tabId) => {
  if (volatile.streamingTabId === tabId && volatile.sessionActive) {
    endSession();
  }
});

// ============================================================================
// SERVICE WORKER LIFECYCLE
// ============================================================================

chrome.runtime.onInstalled.addListener(() => initialize());
chrome.runtime.onStartup.addListener(() => initialize());
initialize();

log("Background service worker loaded");
