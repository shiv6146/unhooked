/**
 * Unhooked Popup Controller
 *
 * Four modes: Onboarding → Mission Brief → Active Session → Digest View
 * Plus Digests tab for session history.
 */

// ============================================================================
// STATE
// ============================================================================

let currentMode = "onboarding";
let onboardStep = 1;
let selectedDuration = 300000;
let selectedGoals = [];
let sessionPoller = null;
let currentDigest = null;

// ============================================================================
// INIT
// ============================================================================

async function init() {
  bindEvents();

  const settings = await getSettings();

  if (settings.onboardingComplete && settings.googleApiKey) {
    showMainUI(settings);
  } else {
    showMode("onboarding");
  }

  // Listen for digest-ready messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "DIGEST_READY" && msg.session) {
      stopSessionPolling();
      showDigestView(msg.session);
    }
  });

  // Check if a session is already active
  try {
    const status = await sendMessage({ type: "SESSION_STATUS" });
    if (status?.active) {
      showMainUI(settings);
      showAgentMode("session");
      startSessionPolling();
    }
  } catch (_) {}
}

// ============================================================================
// EVENT BINDING
// ============================================================================

function bindEvents() {
  // Tabs
  $("tabAgent")?.addEventListener("click", () => switchTab("agent"));
  $("tabDigests")?.addEventListener("click", () => switchTab("digests"));

  // Onboarding
  $("onboardGetStarted")?.addEventListener("click", () => goOnboardStep(2));
  $("onboardVerifyKey")?.addEventListener("click", verifyApiKey);
  $("secToggle")?.addEventListener("click", () => {
    $("secDetail")?.classList.toggle("visible");
  });
  $("onboardFinish")?.addEventListener("click", finishOnboarding);

  // Goal chips
  document.querySelectorAll("#goalChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      updateGoalFromChips();
    });
  });

  // Duration buttons
  document.querySelectorAll(".duration-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".duration-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedDuration = parseInt(btn.dataset.dur);
    });
  });

  // Mission brief
  $("startCuratingBtn")?.addEventListener("click", handleStartSession);

  // Active session
  $("stopSessionBtn")?.addEventListener("click", handleStopSession);

  // Digest view
  $("newSessionBtn")?.addEventListener("click", () => showAgentMode("brief"));

  // Settings
  $("settingsBtn")?.addEventListener("click", toggleSettings);
  $("settSaveBtn")?.addEventListener("click", saveSettingsPanel);
  $("settBackBtn")?.addEventListener("click", toggleSettings);
}

// ============================================================================
// ONBOARDING
// ============================================================================

function goOnboardStep(step) {
  onboardStep = step;
  ["onboardStep1", "onboardStep2", "onboardStep3"].forEach((id, i) => {
    $(id).classList.toggle("visible", i + 1 === step);
  });
  ["dot1", "dot2", "dot3"].forEach((id, i) => {
    const dot = $(id);
    dot.classList.remove("active", "done");
    if (i + 1 === step) dot.classList.add("active");
    else if (i + 1 < step) dot.classList.add("done");
  });
}

async function verifyApiKey() {
  const key = $("onboardApiKey").value.trim();
  if (!key) {
    setApiStatus("onboardApiStatus", "Please enter a key", "invalid");
    return;
  }

  setApiStatus("onboardApiStatus", "Verifying...", "checking");
  $("onboardVerifyKey").disabled = true;

  try {
    const resp = await sendMessage({ type: "VALIDATE_API_KEY", apiKey: key });
    if (resp?.valid) {
      setApiStatus("onboardApiStatus", "Key is valid!", "valid");
      await sendMessage({ type: "UPDATE_SETTINGS", settings: { googleApiKey: key } });
      setTimeout(() => goOnboardStep(3), 600);
    } else {
      setApiStatus("onboardApiStatus", `Invalid: ${resp?.error || "unknown error"}`, "invalid");
    }
  } catch (err) {
    setApiStatus("onboardApiStatus", "Verification failed", "invalid");
  }
  $("onboardVerifyKey").disabled = false;
}

function updateGoalFromChips() {
  const selected = [];
  document.querySelectorAll("#goalChips .chip.selected").forEach((c) => {
    selected.push(c.dataset.goal);
  });
  selectedGoals = selected;

  const customText = $("onboardGoalInput").value.trim();
  if (!customText && selected.length > 0) {
    $("onboardGoalInput").value = selected.join(", ");
  }
}

async function finishOnboarding() {
  const goal = $("onboardGoalInput").value.trim() || selectedGoals.join(", ") || "Interesting content";

  await sendMessage({
    type: "UPDATE_SETTINGS",
    settings: {
      curatorGoal: goal,
      onboardingComplete: true,
    },
  });

  const settings = await getSettings();
  showMainUI(settings);
}

// ============================================================================
// MAIN UI
// ============================================================================

function showMainUI(settings) {
  $("modeOnboarding").classList.remove("visible");
  $("modeOnboarding").style.display = "none";
  $("mainTabs").style.display = "flex";
  $("agentContent").style.display = "block";

  // Populate brief
  $("briefGoalInput").value = settings.curatorGoal || "";

  showAgentMode("brief");
}

function switchTab(tab) {
  if (tab === "agent") {
    $("tabAgent").classList.add("active");
    $("tabDigests").classList.remove("active");
    $("agentContent").style.display = "block";
    $("digestsContent").style.display = "none";
    $("settingsPanel").classList.remove("visible");
  } else {
    $("tabAgent").classList.remove("active");
    $("tabDigests").classList.add("active");
    $("agentContent").style.display = "none";
    $("digestsContent").style.display = "block";
    $("settingsPanel").classList.remove("visible");
    loadDigestsHistory();
  }
}

function showAgentMode(mode) {
  ["modeBrief", "modeSession", "modeDigest"].forEach((id) => {
    $(id).classList.remove("visible");
  });
  $("mode" + mode.charAt(0).toUpperCase() + mode.slice(1))?.classList.add("visible");
  currentMode = mode;
}

function showMode(mode) {
  ["modeOnboarding"].forEach((id) => {
    $(id).classList.toggle("visible", id === "mode" + mode.charAt(0).toUpperCase() + mode.slice(1));
  });
}

// ============================================================================
// SESSION START / STOP
// ============================================================================

async function handleStartSession() {
  const btn = $("startCuratingBtn");
  btn.disabled = true;

  const goal = $("briefGoalInput").value.trim();
  const instructions = $("briefInstructions").value.trim();

  // Save goal
  await sendMessage({ type: "UPDATE_SETTINGS", settings: { curatorGoal: goal } });

  const settings = await getSettings();
  if (!settings.googleApiKey) {
    btn.disabled = false;
    alert("Please set your API key in Settings first.");
    return;
  }

  // Get tab capture stream ID (must be synchronous from user gesture)
  let streamId;
  try {
    streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({}, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  } catch (err) {
    btn.disabled = false;
    alert("Tab capture failed: " + err.message);
    return;
  }

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    btn.disabled = false;
    alert("No active tab found.");
    return;
  }

  // Start video stream
  try {
    const streamResp = await sendMessage({
      type: "START_VIDEO_STREAM",
      streamId,
      tabId: tab.id,
      sessionInstructions: instructions,
    });
    if (!streamResp?.success) {
      btn.disabled = false;
      alert("Streaming failed: " + (streamResp?.error || "unknown"));
      return;
    }
  } catch (err) {
    btn.disabled = false;
    alert("Streaming error: " + err.message);
    return;
  }

  // Start scroll session
  try {
    const scrollResp = await sendMessage({
      type: "START_SCROLL_REQUEST",
      config: {
        tabId: tab.id,
        tabUrl: tab.url,
        duration: selectedDuration,
        sessionInstructions: instructions,
      },
    });
    if (!scrollResp?.success) {
      btn.disabled = false;
      alert("Scroll start failed: " + (scrollResp?.error || "unknown"));
      return;
    }
  } catch (err) {
    btn.disabled = false;
    alert("Scroll error: " + err.message);
    return;
  }

  showAgentMode("session");
  startSessionPolling();
}

async function handleStopSession() {
  $("stopSessionBtn").disabled = true;
  await sendMessage({ type: "STOP_SCROLL_REQUEST" });
  // Digest will arrive via DIGEST_READY message
  // But also handle if it doesn't come:
  setTimeout(async () => {
    if (currentMode === "session") {
      stopSessionPolling();
      showAgentMode("brief");
      $("stopSessionBtn").disabled = false;
    }
  }, 15000);
}

// ============================================================================
// SESSION POLLING
// ============================================================================

function startSessionPolling() {
  stopSessionPolling();
  sessionPoller = setInterval(pollSession, 1000);
  pollSession();
}

function stopSessionPolling() {
  if (sessionPoller) {
    clearInterval(sessionPoller);
    sessionPoller = null;
  }
}

async function pollSession() {
  try {
    const resp = await sendMessage({ type: "SESSION_STATUS" });
    if (!resp?.success) return;

    // Update elapsed
    const elapsed = resp.elapsed || 0;
    const min = Math.floor(elapsed / 60000);
    const sec = Math.floor((elapsed % 60000) / 1000);
    $("elapsedStat").textContent = `${min}:${sec.toString().padStart(2, "0")}`;

    // Posts / observations
    $("obsStat").textContent = resp.observationCount || 0;
    $("postsStat").textContent = resp.scrollCommandCount || 0;

    // Status text
    const stateText = {
      normal: "Scrolling through your feed...",
      slow: "Slowing down... something looks interesting",
      paused: "Paused. Reading closely...",
      fast: "Skipping past irrelevant content...",
      up: "Going back to re-read something...",
      down: "Scrolling through your feed...",
    };
    $("sessionStatusText").innerHTML =
      `<span class="pulse-dot"></span> ${stateText[resp.scrollState] || stateText.normal}`;

    // Observation preview
    if (resp.latestObservation) {
      $("obsPreview").textContent = resp.latestObservation.slice(0, 150);
    }

    // Live action feed
    if (resp.recentActions && resp.recentActions.length > 0) {
      renderActionFeed(resp.recentActions);
    }

    if (!resp.active && currentMode === "session") {
      stopSessionPolling();
      // Wait a moment for digest to arrive
      setTimeout(() => {
        if (currentMode === "session") showAgentMode("brief");
      }, 3000);
    }
  } catch (_) {}
}

function renderActionFeed(actions) {
  const feed = $("actionFeed");
  if (!feed) return;

  const scrollMap = {
    SCROLL_PAUSE: { label: "PAUSE", cls: "pause" },
    SCROLL_SLOW: { label: "SLOW", cls: "slow" },
    SCROLL_FAST: { label: "SKIP", cls: "fast" },
    SCROLL_DOWN: { label: "SCROLL", cls: "down" },
    SCROLL_UP: { label: "BACK", cls: "up" },
  };

  feed.innerHTML = actions.slice().reverse().map((a) => {
    const { label, cls } = scrollMap[a.scroll] || { label: "?", cls: "down" };
    return `<div class="action-item"><span class="action-badge ${cls}">${label}</span><span class="action-obs">${esc(a.obs)}</span></div>`;
  }).join("");

  feed.scrollTop = 0;
}

// ============================================================================
// DIGEST VIEW
// ============================================================================

function showDigestView(session) {
  currentDigest = session;
  showAgentMode("digest");

  const d = session.digest || {};
  const dur = formatDuration(session.duration || 0);
  const platform = session.platform || "feed";

  $("digestSessionHeader").textContent =
    `SESSION COMPLETE · ${dur} · ${platform} · ${session.postsScanned || 0} posts`;

  $("digestTldr").textContent = d.tldr || "Session complete.";

  // Must-Read
  const mrContainer = $("digestMustRead");
  mrContainer.innerHTML = "";
  if (d.mustRead && d.mustRead.length > 0) {
    mrContainer.innerHTML = `<div class="section-title">&#128204; MUST-READ (${d.mustRead.length})</div>`;
    d.mustRead.forEach((item) => {
      const card = document.createElement("div");
      card.className = "must-read-card";
      card.innerHTML = `
        <div class="mr-title">${esc(item.title)}</div>
        <div class="mr-source">${esc(item.source || "")}</div>
        <div class="mr-note">${esc(item.agentNote || "")}</div>
        <div class="mr-excerpt">${esc(item.excerpt || "")}</div>
        ${item.postUrl ? `<a class="mr-link" href="${esc(item.postUrl)}" target="_blank">Open Post &#8594;</a>` : ""}
      `;
      mrContainer.appendChild(card);
    });
  }

  // Worth a Look
  const walContainer = $("digestWorthALook");
  walContainer.innerHTML = "";
  if (d.worthALook && d.worthALook.length > 0) {
    walContainer.innerHTML = `<div class="section-title">&#128064; WORTH A LOOK (${d.worthALook.length})</div>`;
    d.worthALook.forEach((item) => {
      const div = document.createElement("div");
      div.className = "wal-item";
      div.innerHTML = `<span class="wal-title">${esc(item.title)}</span> <span class="wal-source">${esc(item.source || "")}</span> &mdash; ${esc(item.oneLiner || "")}`;
      walContainer.appendChild(div);
    });
  }

  // Skimmed Past
  const skimContainer = $("digestSkimmed");
  skimContainer.innerHTML = "";
  if (d.skimmedPast) {
    const cats = d.skimmedPast.categories || {};
    const catStr = Object.entries(cats).map(([k, v]) => `${k} (${v})`).join(", ");
    skimContainer.innerHTML = `
      <div class="section-title" style="cursor:pointer;" id="skimToggle">&#128168; SKIMMED PAST</div>
      <div class="skimmed-summary">${d.skimmedPast.total || 0} posts: ${catStr}</div>
    `;
  }

  // Time saved + token usage
  const tsContainer = $("digestTimeSaved");
  const timeSavedMin = Math.round((session.timeSaved || 0) / 60);
  const noiseRate = Math.round((1 - (d.matchRate || 0)) * 100);
  const tokens = session.tokenUsage || {};
  const totalTokens = (tokens.totalInputTokens || 0) + (tokens.totalOutputTokens || 0);
  const estCost = (totalTokens / 1000000 * 0.15).toFixed(4); // ~$0.15/1M tokens for flash

  getAnalytics().then((analytics) => {
    const cumTimeSaved = formatTimeSavedLong(analytics.totalTimeSaved || 0);

    tsContainer.innerHTML = `
      <div class="ts-main">Saved ~${timeSavedMin} min this session</div>
      <div class="ts-cumulative">${analytics.totalSessions || 0} sessions · ${cumTimeSaved} saved total · ${analytics.totalPostsScanned || 0} posts scanned</div>
      <div class="noise-bar"><div class="noise-bar-fill" style="width:${noiseRate}%"></div></div>
      <div class="noise-label">${noiseRate}% noise</div>
      ${totalTokens > 0 ? `<div class="token-stats">Tokens: ${totalTokens.toLocaleString()} · Est. cost: $${estCost}</div>` : ""}
    `;
  });
}

// ============================================================================
// DIGESTS HISTORY TAB
// ============================================================================

async function loadDigestsHistory() {
  const resp = await sendMessage({ type: "GET_DIGESTS" });
  const sessions = resp?.digests || [];
  const analytics = await getAnalytics();

  const cumCard = $("cumulativeCard");
  if (sessions.length > 0) {
    cumCard.style.display = "block";
    cumCard.innerHTML = `
      <div class="cc-sessions">${analytics.totalSessions || sessions.length}</div>
      <div class="cc-detail">sessions · ${formatTimeSavedLong(analytics.totalTimeSaved || 0)} saved · ${analytics.totalPostsScanned || 0} posts scanned</div>
    `;
  } else {
    cumCard.style.display = "none";
  }

  const list = $("digestsHistoryList");
  list.innerHTML = "";

  if (sessions.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">&#128493;</div><div class="empty-text">No sessions yet. Start curating!</div></div>`;
    return;
  }

  sessions.forEach((s) => {
    const item = document.createElement("div");
    item.className = "digest-history-item";
    item.innerHTML = `
      <div class="dh-top">
        <span class="dh-date">${formatTimeAgo(s.timestamp)}</span>
        <span class="dh-platform">${s.platform || "feed"}</span>
      </div>
      <div class="dh-tldr">${esc(s.digest?.tldr || "Session completed")}</div>
      <div class="dh-stats">
        <span>~${Math.round((s.timeSaved || 0) / 60)} min saved</span>
        <span>${s.postsScanned || 0} posts</span>
        <span>${formatDuration(s.duration || 0)}</span>
      </div>
    `;
    item.addEventListener("click", () => {
      switchTab("agent");
      showDigestView(s);
    });
    list.appendChild(item);
  });
}

// ============================================================================
// SETTINGS
// ============================================================================

let settingsVisible = false;

async function toggleSettings() {
  settingsVisible = !settingsVisible;
  const panel = $("settingsPanel");

  if (settingsVisible) {
    panel.classList.add("visible");
    $("agentContent").style.display = "none";
    $("digestsContent").style.display = "none";
    $("mainTabs").style.display = "none";

    const settings = await getSettings();
    $("settApiKey").value = settings.googleApiKey || "";
    $("settGoal").value = settings.curatorGoal || "";
  } else {
    panel.classList.remove("visible");
    $("mainTabs").style.display = "flex";
    $("agentContent").style.display = "block";
    $("settingsBtn").classList.remove("active");
  }
}

async function saveSettingsPanel() {
  const apiKey = $("settApiKey").value.trim();
  const goal = $("settGoal").value.trim();

  if (apiKey) {
    setApiStatus("settApiStatus", "Verifying...", "checking");
    const resp = await sendMessage({ type: "VALIDATE_API_KEY", apiKey });
    if (!resp?.valid) {
      setApiStatus("settApiStatus", "Invalid key: " + (resp?.error || ""), "invalid");
      return;
    }
    setApiStatus("settApiStatus", "Valid!", "valid");
  }

  await sendMessage({
    type: "UPDATE_SETTINGS",
    settings: { googleApiKey: apiKey, curatorGoal: goal },
  });

  setTimeout(() => toggleSettings(), 500);
}

// ============================================================================
// HELPERS
// ============================================================================

async function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    } catch (e) { reject(e); }
  });
}

async function getSettings() {
  const resp = await sendMessage({ type: "GET_SETTINGS" });
  return resp?.settings || {};
}

async function getAnalytics() {
  try {
    const resp = await sendMessage({ type: "GET_ANALYTICS" });
    return resp?.analytics || {};
  } catch (_) {
    return {};
  }
}

function $(id) { return document.getElementById(id); }

function esc(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function setApiStatus(id, text, cls) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "api-status " + (cls || "");
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatTimeSavedLong(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

// ============================================================================
// LIFECYCLE
// ============================================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
