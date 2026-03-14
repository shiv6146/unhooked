/**
 * Unhooked Agent Page Script
 * Displays ambient UI showing agent status and stats
 *
 * @fileoverview Agent page controller for the Unhooked extension
 */

// Update UI based on agent status
let statsInterval = null;

/**
 * Update stats from background
 */
async function updateStats() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_STATS",
    });

    if (response?.success && response.stats) {
      const stats = response.stats;

      // Update counters
      document.getElementById("scrollsCount").textContent =
        stats.totalScrolls || 0;
      document.getElementById("postsCount").textContent = Math.floor(
        (stats.totalScrolls || 0) / 10,
      );
      document.getElementById("sessionsCount").textContent =
        stats.totalSessions || 0;
      document.getElementById("digestsCount").textContent =
        stats.totalDigests || 0;

      // Update status
      const isActive = stats.activeCount > 0;
      const statusIndicator = document.getElementById("statusIndicator");
      const statusText = document.getElementById("statusText");
      const statusMessage = document.getElementById("statusMessage");
      const statusDetail = document.getElementById("statusDetail");

      if (isActive) {
        statusIndicator.classList.remove("idle");
        statusText.textContent = "Active";
        statusMessage.textContent = "Scrolling and processing...";
        statusDetail.innerHTML =
          '<span class="scroll-indicator"></span><span class="scroll-indicator"></span><span class="scroll-indicator"></span>';

        // Show progress bar
        document.getElementById("progressContainer").style.display = "block";
      } else {
        statusIndicator.classList.add("idle");
        statusText.textContent = "Idle";
        statusMessage.textContent = "Waiting for next session";
        statusDetail.textContent = "Agent is ready to scroll your feeds";

        // Hide progress bar
        document.getElementById("progressContainer").style.display = "none";
      }
    }
  } catch (error) {
    console.error("[Agent] Failed to update stats", error);
  }
}

/**
 * Load settings from background
 */
async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_SETTINGS",
    });

    if (response?.success && response.settings) {
      const settings = response.settings;

      // Show schedule info if enabled
      if (settings.enableScheduling) {
        const scheduleInfo = document.getElementById("scheduleInfo");
        const nextRun = document.getElementById("nextRun");

        scheduleInfo.style.display = "block";
        nextRun.textContent = `Every ${settings.scheduleInterval} minutes`;
      }
    }
  } catch (error) {
    console.error("[Agent] Failed to load settings", error);
  }
}

/**
 * Initialize agent page
 */
async function init() {
  console.log("[Agent] Initializing agent page...");

  await updateStats();
  await loadSettings();

  // Update stats every second
  statsInterval = setInterval(updateStats, 1000);

  console.log("[Agent] Agent page ready");
}

/**
 * Cleanup on unload
 */
window.addEventListener("unload", () => {
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});

/**
 * Start initialization
 */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
