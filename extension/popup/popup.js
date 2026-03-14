/**
 * Unhooked Popup Controller
 * Manages UI, settings, and communication with background service worker
 *
 * @fileoverview Popup interface for Unhooked extension
 * @version 1.0.1
 * @updated 2024-02-14
 */

// ============================================================================
// STATE
// ============================================================================

let currentTab = "agent";
let statsPoller = null;
let isPolling = false;

// ============================================================================
// DOM REFERENCES
// ============================================================================

const ui = {
  // Tabs
  tabAgent: null,
  tabDigests: null,
  agentContent: null,
  digestsContent: null,

  // Status
  statusIndicator: null,
  statusText: null,

  // Stats
  scrollsValue: null,
  postsValue: null,
  sessionsValue: null,
  digestsValue: null,

  // Controls
  startBtn: null,
  stopBtn: null,
  openAgentBtn: null,

  // Settings
  settingsBtn: null,
  settingsPanel: null,
  targetUrlInput: null,
  durationInput: null,
  scrollSpeedInput: null,
  videoCaptureToggle: null,
  schedulingToggle: null,
  scheduleSettings: null,
  scheduleIntervalInput: null,
  saveSettingsBtn: null,

  // Digests
  digestsList: null,
};

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize popup
 */
async function init() {
  log("Initializing popup...");

  try {
    // Get DOM references
    bindUIElements();

    // Setup event listeners
    setupEventListeners();

    // Load settings
    await loadSettings();

    // Load stats
    await loadStats();

    // Load digests
    await loadDigests();

    // Start polling
    startPolling();

    log("Popup initialized");
  } catch (error) {
    logError("Failed to initialize popup", error);
  }
}

/**
 * Bind UI elements
 */
function bindUIElements() {
  // Tabs
  ui.tabAgent = document.getElementById("tabAgent");
  ui.tabDigests = document.getElementById("tabDigests");
  ui.agentContent = document.getElementById("agentContent");
  ui.digestsContent = document.getElementById("digestsContent");

  // Status
  ui.statusIndicator = document.getElementById("statusIndicator");
  ui.statusText = document.getElementById("statusText");

  // Stats
  ui.scrollsValue = document.getElementById("scrollsValue");
  ui.postsValue = document.getElementById("postsValue");
  ui.sessionsValue = document.getElementById("sessionsValue");
  ui.digestsValue = document.getElementById("digestsValue");

  // Controls
  ui.startBtn = document.getElementById("startBtn");
  ui.stopBtn = document.getElementById("stopBtn");
  ui.openAgentBtn = document.getElementById("openAgentBtn");

  // Settings
  ui.settingsBtn = document.getElementById("settingsBtn");
  ui.settingsPanel = document.getElementById("settingsPanel");
  ui.apiKeyInput = document.getElementById("apiKeyInput");
  ui.curatorGoalInput = document.getElementById("curatorGoalInput");
  ui.streamingMode = document.getElementById("streamingMode");
  ui.targetUrlInput = document.getElementById("targetUrlInput");
  ui.durationInput = document.getElementById("durationInput");
  ui.scrollSpeedInput = document.getElementById("scrollSpeedInput");
  ui.videoCaptureToggle = document.getElementById("videoCaptureToggle");
  ui.schedulingToggle = document.getElementById("schedulingToggle");
  ui.scheduleSettings = document.getElementById("scheduleSettings");
  ui.scheduleIntervalInput = document.getElementById("scheduleIntervalInput");
  ui.saveSettingsBtn = document.getElementById("saveSettingsBtn");

  // Digests
  ui.digestsList = document.getElementById("digestsList");
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Tabs
  ui.tabAgent?.addEventListener("click", () => switchTab("agent"));
  ui.tabDigests?.addEventListener("click", () => switchTab("digests"));

  // Controls
  ui.startBtn?.addEventListener("click", handleStart);
  ui.stopBtn?.addEventListener("click", handleStop);
  ui.openAgentBtn?.addEventListener("click", handleOpenAgentTab);

  // Settings
  ui.settingsBtn?.addEventListener("click", toggleSettings);
  ui.saveSettingsBtn?.addEventListener("click", handleSaveSettings);
  ui.schedulingToggle?.addEventListener("change", handleSchedulingToggle);

  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyboard);
}

// ============================================================================
// TAB SWITCHING
// ============================================================================

/**
 * Switch between tabs
 */
function switchTab(tab) {
  currentTab = tab;

  // Update tab styles
  if (tab === "agent") {
    ui.tabAgent?.classList.add("active");
    ui.tabDigests?.classList.remove("active");
    ui.agentContent.style.display = "block";
    ui.digestsContent.style.display = "none";
  } else {
    ui.tabAgent?.classList.remove("active");
    ui.tabDigests?.classList.add("active");
    ui.agentContent.style.display = "none";
    ui.digestsContent.style.display = "block";
  }

  // Load fresh data for the tab
  if (tab === "digests") {
    loadDigests();
  }

  log(`Switched to ${tab} tab`);
}

// ============================================================================
// SETTINGS MANAGEMENT
// ============================================================================

/**
 * Toggle settings panel visibility
 */
function toggleSettings() {
  ui.settingsPanel?.classList.toggle("visible");
  ui.settingsBtn?.classList.toggle("active");
}

/**
 * Load settings from background
 */
/**
 * Load settings from background
 */
async function loadSettings() {
  try {
    const response = await sendMessage({ type: "GET_SETTINGS" });

    if (response?.success && response.settings) {
      const settings = response.settings;

      // Populate UI
      if (ui.targetUrlInput) {
        ui.targetUrlInput.value = settings.targetUrl || "https://twitter.com";
      }
      if (ui.durationInput) {
        ui.durationInput.value = Math.floor(settings.sessionDuration / 60000);
      }
      if (ui.scrollSpeedInput) {
        ui.scrollSpeedInput.value = settings.scrollSpeed;
      }
      if (ui.videoCaptureToggle) {
        ui.videoCaptureToggle.checked = settings.captureVideo;
      }
      if (ui.schedulingToggle) {
        ui.schedulingToggle.checked = settings.enableScheduling;
      }
      if (ui.scheduleIntervalInput) {
        ui.scheduleIntervalInput.value = settings.scheduleInterval;
      }

      // Update schedule settings visibility
      updateScheduleSettingsVisibility(settings.enableScheduling);

      // API key
      if (ui.apiKeyInput) {
        ui.apiKeyInput.value = settings.googleApiKey || "";
      }

      if (ui.streamingMode) {
        ui.streamingMode.textContent = settings.googleApiKey
          ? "✅ Direct streaming"
          : "Not set";
        ui.streamingMode.style.color = settings.googleApiKey
          ? "#22c55e"
          : "#64748b";
      }

      // Curator Goal
      if (ui.curatorGoalInput) {
        ui.curatorGoalInput.value = settings.curatorGoal || "";
      }

      log("Settings loaded", settings);
    }
  } catch (error) {
    logError("Failed to load settings", error);
  }
}

/**
 * Save settings to background
 */
async function handleSaveSettings() {
  try {
    const targetUrl = ui.targetUrlInput?.value || "https://twitter.com";
    const durationMinutes = parseInt(ui.durationInput?.value || "5");
    const scrollSpeed = parseInt(ui.scrollSpeedInput?.value || "1000");
    const captureVideo = ui.videoCaptureToggle?.checked || false;
    const enableScheduling = ui.schedulingToggle?.checked || false;
    const scheduleInterval = parseInt(ui.scheduleIntervalInput?.value || "120");

    const settings = {
      targetUrl,
      sessionDuration: durationMinutes * 60000, // Convert to ms
      scrollSpeed,
      captureVideo,
      enableScheduling,
      scheduleInterval,
      googleApiKey: ui.apiKeyInput?.value?.trim() || "",
      curatorGoal: ui.curatorGoalInput?.value?.trim() || "",
    };

    const response = await sendMessage({
      type: "UPDATE_SETTINGS",
      settings,
    });

    if (response?.success) {
      log("Settings saved", settings);
      showFeedback("✅ Settings saved!");
    } else {
      showFeedback("❌ Failed to save settings");
    }
  } catch (error) {
    logError("Failed to save settings", error);
    showFeedback("❌ Error saving settings");
  }
}

/**
 * Handle scheduling toggle
 */
function handleSchedulingToggle() {
  const enabled = ui.schedulingToggle?.checked || false;
  updateScheduleSettingsVisibility(enabled);
}

/**
 * Update schedule settings visibility
 */
function updateScheduleSettingsVisibility(enabled) {
  if (ui.scheduleSettings) {
    ui.scheduleSettings.style.display = enabled ? "block" : "none";
  }
}

// ============================================================================
// SESSION CONTROLS
// ============================================================================

/**
 * Handle start button click
 */
async function handleStart() {
  try {
    log("Starting session...");

    // Disable button
    if (ui.startBtn) ui.startBtn.disabled = true;

    // Get current settings
    const durationMinutes = parseInt(ui.durationInput?.value || "5");
    const scrollSpeed = parseInt(ui.scrollSpeedInput?.value || "1000");
    const captureVideo = ui.videoCaptureToggle?.checked || false;

    const config = {
      sessionDuration: durationMinutes * 60000,
      scrollSpeed,
      captureVideo,
    };

    // Check if API key is set for streaming mode
    const settingsResp = await sendMessage({ type: "GET_SETTINGS" });
    const apiKey = settingsResp?.settings?.googleApiKey;

    if (apiKey) {
      // STREAMING MODE: Use the current tab (where user clicked extension icon)
      // This tab must be the social media site the user wants to scroll
      // 1. Capture the current tab's stream (MUST be first to preserve user gesture)
      log("Requesting tab capture stream ID...");
      let streamId;
      try {
        streamId = await new Promise((resolve, reject) => {
          chrome.tabCapture.getMediaStreamId({}, (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          });
        });
        log("Got tab capture stream ID", streamId);
      } catch (captureErr) {
        logError("Tab capture failed", captureErr);
        showFeedback("❌ Tab capture failed. Reload extension?");
        if (ui.startBtn) ui.startBtn.disabled = false;
        return;
      }

      // 2. Get current tab info
      const [currentTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!currentTab?.id) {
        showFeedback("❌ No active tab found");
        if (ui.startBtn) ui.startBtn.disabled = false;
        return;
      }

      log(`Streaming mode: using current tab ${currentTab.id} (${currentTab.url})`);

      // 3. Start video streaming FIRST (to minimize stream ID expiry risk)
      config.tabId = currentTab.id;

      log("Sending START_VIDEO_STREAM...", {
        streamId,
        tabId: config.tabId,
      });

      let streamSuccess = false;
      try {
        const streamResp = await sendMessage({
          type: "START_VIDEO_STREAM",
          streamId,
          tabId: config.tabId,
        });

        if (streamResp?.success) {
          log("Video stream started successfully");
          updateStatus(true, "🎥 Streaming to Gemini AI");
          streamSuccess = true;
        } else {
          logError("Video stream start failed", streamResp?.error);
          showFeedback("⚠️ Streaming failed, scroll-only mode");
        }
      } catch (videoErr) {
        logError("Video stream error", videoErr);
      }

      // 4. Start scroll session on this tab
      log("Sending START_SCROLL_REQUEST...", config);

      const response = await sendMessage({
        type: "START_SCROLL_REQUEST",
        config,
      });

      if (!response?.success) {
        logError("Failed to start session", response?.error);
        showFeedback(`❌ ${response?.error || "Failed to start"}`);
        // If getting here, we might want to stop video stream if scroll failed?
        // But let's keep it simple for now.
        if (ui.startBtn) ui.startBtn.disabled = false;
        return;
      }

      if (ui.stopBtn) ui.stopBtn.disabled = false;
    } else {
      // NO API KEY: Original flow — create agent tab, scroll only
      const response = await sendMessage({
        type: "START_SCROLL_REQUEST",
        config,
      });

      if (response?.success) {
        log("Session started", response);
        updateStatus(true, `Scrolling on tab ${response.tabId}`);
        if (ui.stopBtn) ui.stopBtn.disabled = false;
      } else {
        logError("Failed to start session", response?.error);
        showFeedback(`❌ ${response?.error || "Failed to start"}`);
        if (ui.startBtn) ui.startBtn.disabled = false;
      }
    }
  } catch (error) {
    logError("Error starting session", error);
    showFeedback("❌ Error starting session");

    if (ui.startBtn) ui.startBtn.disabled = false;
  }
}

/**
 * Handle stop button click
 */
async function handleStop() {
  try {
    log("Stopping session...");

    // Disable button
    if (ui.stopBtn) ui.stopBtn.disabled = true;

    const response = await sendMessage({ type: "STOP_SCROLL_REQUEST" });

    if (response?.success) {
      log("Session stopped");
      updateStatus(false, "Ready to scroll");

      if (ui.startBtn) ui.startBtn.disabled = false;
    } else {
      logError("Failed to stop session", response?.error);
      showFeedback(`❌ ${response?.error || "Failed to stop"}`);

      if (ui.stopBtn) ui.stopBtn.disabled = false;
    }
  } catch (error) {
    logError("Error stopping session", error);
    showFeedback("❌ Error stopping session");

    if (ui.stopBtn) ui.stopBtn.disabled = false;
  }
}

/**
 * Handle open agent tab button click
 */
async function handleOpenAgentTab() {
  try {
    log("Opening agent tab...");

    const response = await sendMessage({ type: "OPEN_AGENT_TAB" });

    if (response?.success) {
      log("Agent tab opened", response);
      showFeedback("✅ Agent tab opened!");
    } else {
      logError("Failed to open agent tab", response?.error);
      showFeedback(`❌ ${response?.error || "Failed to open"}`);
    }
  } catch (error) {
    logError("Error opening agent tab", error);
    showFeedback("❌ Error opening agent tab");
  }
}

// ============================================================================
// STATS POLLING
// ============================================================================

/**
 * Start polling for stats
 */
function startPolling() {
  if (isPolling) return;

  isPolling = true;
  pollStats();

  // Poll every second
  statsPoller = setInterval(pollStats, 1000);

  log("Stats polling started");
}

/**
 * Stop polling for stats
 */
function stopPolling() {
  if (!isPolling) return;

  isPolling = false;

  if (statsPoller) {
    clearInterval(statsPoller);
    statsPoller = null;
  }

  log("Stats polling stopped");
}

/**
 * Poll stats from background
 */
async function pollStats() {
  try {
    const response = await sendMessage({ type: "GET_STATS" });

    if (response?.success && response.stats) {
      updateStatsUI(response.stats);
    }
  } catch (error) {
    // Silently fail polling errors to avoid console spam
  }
}

/**
 * Load stats once
 */
async function loadStats() {
  try {
    const response = await sendMessage({ type: "GET_STATS" });

    if (response?.success && response.stats) {
      updateStatsUI(response.stats);
    }
  } catch (error) {
    logError("Failed to load stats", error);
  }
}

/**
 * Update stats UI
 */
function updateStatsUI(stats) {
  // Update values
  if (ui.scrollsValue) {
    ui.scrollsValue.textContent = formatNumber(stats.totalScrolls || 0);
  }

  // Posts extracted (not yet tracked separately, use scrolls/10 as estimate)
  if (ui.postsValue) {
    ui.postsValue.textContent = formatNumber(
      Math.floor((stats.totalScrolls || 0) / 10),
    );
  }

  if (ui.sessionsValue) {
    ui.sessionsValue.textContent = formatNumber(stats.totalSessions || 0);
  }

  if (ui.digestsValue) {
    ui.digestsValue.textContent = formatNumber(stats.totalDigests || 0);
  }

  // Update status based on active tabs
  const isActive = stats.activeCount > 0;
  const statusText = isActive
    ? `Scrolling in background (${stats.activeCount} session${stats.activeCount > 1 ? "s" : ""})`
    : "Ready to scroll";
  updateStatus(isActive, statusText);

  // Update button states
  if (isActive) {
    if (ui.startBtn) ui.startBtn.disabled = true;
    if (ui.stopBtn) ui.stopBtn.disabled = false;
  } else {
    if (ui.startBtn) ui.startBtn.disabled = false;
    if (ui.stopBtn) ui.stopBtn.disabled = true;
  }
}

/**
 * Update status indicator
 */
function updateStatus(active, text) {
  if (ui.statusIndicator) {
    if (active) {
      ui.statusIndicator.classList.add("active");
    } else {
      ui.statusIndicator.classList.remove("active");
    }
  }

  if (ui.statusText) {
    ui.statusText.textContent = text;
  }
}

// ============================================================================
// DIGESTS
// ============================================================================

/**
 * Load and display digests
 */
async function loadDigests() {
  try {
    const response = await sendMessage({ type: "GET_DIGESTS" });

    if (response?.success && response.digests) {
      displayDigests(response.digests);
    }
  } catch (error) {
    logError("Failed to load digests", error);
  }
}

/**
 * Display digests in UI
 */
function displayDigests(digests) {
  if (!ui.digestsList) return;

  // Clear existing
  ui.digestsList.innerHTML = "";

  if (!digests || digests.length === 0) {
    ui.digestsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-text">No digests yet. Start a session to create one!</div>
      </div>
    `;
    return;
  }

  // Create digest items
  digests.forEach((digest) => {
    const item = createDigestItem(digest);
    ui.digestsList.appendChild(item);
  });

  log(`Displayed ${digests.length} digests`);
}

/**
 * Create a digest item element
 */
function createDigestItem(digest) {
  const div = document.createElement("div");
  div.className = "digest-item";

  const timeAgo = formatTimeAgo(digest.timestamp);
  const duration = formatDuration(digest.duration);

  div.innerHTML = `
    <div class="digest-header">
      <div class="digest-time">${timeAgo}</div>
      ${digest.isScheduled ? '<div class="digest-badge">Scheduled</div>' : ""}
    </div>
    <div class="digest-summary">${digest.summary}</div>
    <div class="digest-stats">
      <span>⏱️ ${duration}</span>
      <span>📊 ${digest.postCount} posts</span>
      <span>📜 ${digest.scrollCount} scrolls</span>
    </div>
  `;

  // Click to view details
  div.addEventListener("click", () => showDigestDetails(digest));

  return div;
}

/**
 * Show digest details (placeholder)
 */
function showDigestDetails(digest) {
  log("Showing digest details", digest);
  // TODO: Implement detailed view in a modal or separate page
  alert(
    `Digest Details:\n\n${digest.summary}\n\nPosts: ${digest.postCount}\nScrolls: ${digest.scrollCount}\nDuration: ${formatDuration(digest.duration)}`,
  );
}

// ============================================================================
// MESSAGING
// ============================================================================

/**
 * Send message to background
 */
async function sendMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// UI HELPERS
// ============================================================================

/**
 * Show temporary feedback message
 */
function showFeedback(message) {
  if (ui.statusText) {
    const originalText = ui.statusText.textContent;
    ui.statusText.textContent = message;

    setTimeout(() => {
      ui.statusText.textContent = originalText;
    }, 2000);
  }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboard(event) {
  // Ctrl/Cmd + Enter: Start
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    if (!ui.startBtn?.disabled) {
      handleStart();
    }
  }

  // Escape: Stop
  if (event.key === "Escape") {
    event.preventDefault();
    if (!ui.stopBtn?.disabled) {
      handleStop();
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toLocaleString();
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
 * Format timestamp to "time ago" string
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  } else if (hours > 0) {
    return `${hours}h ago`;
  } else if (minutes > 0) {
    return `${minutes}m ago`;
  } else {
    return "just now";
  }
}

/**
 * Log helper
 */
function log(...args) {
  console.log("[Unhooked Popup]", ...args);
}

/**
 * Error log helper
 */
function logError(...args) {
  console.error("[Unhooked Popup ERROR]", ...args);
}

// ============================================================================
// LIFECYCLE
// ============================================================================

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Cleanup when popup closes
window.addEventListener("unload", () => {
  stopPolling();
  log("Popup closed");
});
