/**
 * Gemini Live API Client — Real-time Video Analysis
 *
 * Uses gemini-2.5-flash-native-audio via bidiGenerateContent (Live API)
 * with outputAudioTranscription to get text transcripts of the model's
 * spoken observations. Audio output is discarded; we only use the text.
 */

import { GoogleGenAI, Modality } from "./genai.bundle.js";

const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2000;
const PROMPT_INTERVAL_MS = 5000;

let session = null;
let ai = null;
let scrollCommandCallback = null;
let statusChangeCallback = null;
let observationLog = [];
let reconnectAttempts = 0;
let reconnectConfig = null;
let transcriptBuffer = "";
let promptIntervalId = null;
let promptCount = 0;
let tokenUsage = { totalInputTokens: 0, totalOutputTokens: 0 };

function safeStatusChange(status) {
  try {
    if (typeof statusChangeCallback === "function") statusChangeCallback(status);
  } catch (_) {}
}

export async function connect(apiKey, systemInstruction, onScrollCommand, onStatusChange) {
  ai = new GoogleGenAI({ apiKey });
  scrollCommandCallback = onScrollCommand;
  statusChangeCallback = onStatusChange || (() => {});
  observationLog = [];
  reconnectAttempts = 0;
  transcriptBuffer = "";
  promptCount = 0;
  tokenUsage = { totalInputTokens: 0, totalOutputTokens: 0 };

  reconnectConfig = { apiKey, systemInstruction, onScrollCommand, onStatusChange };

  const config = {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Zephyr" },
      },
    },
    outputAudioTranscription: {},
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
    contextWindowCompression: {
      triggerTokens: "104857",
      slidingWindow: { targetTokens: "52428" },
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  };

  console.log("[GeminiLive] Connecting to", MODEL);

  try {
    session = await ai.live.connect({
      model: MODEL,
      callbacks: {
        onopen: () => {
          console.log("[GeminiLive] WebSocket opened");
          reconnectAttempts = 0;
          safeStatusChange("connected");
        },
        onmessage: (message) => {
          handleMessage(message);
        },
        onerror: (e) => {
          console.error("[GeminiLive] Error:", e?.message || e);
          safeStatusChange("error");
        },
        onclose: (e) => {
          console.log("[GeminiLive] Closed:", e?.reason || e?.code || "unknown");
          const wasConnected = session !== null;
          session = null;
          if (promptIntervalId) { clearInterval(promptIntervalId); promptIntervalId = null; }
          safeStatusChange("disconnected");

          if (wasConnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && reconnectConfig) {
            attemptReconnect();
          }
        },
      },
      config,
    });

    console.log("[GeminiLive] Session established via Live API");
    startPromptLoop();
  } catch (err) {
    console.error("[GeminiLive] Connection failed:", err?.message || err);
    session = null;
    safeStatusChange("error");
    throw err;
  }
}

function startPromptLoop() {
  if (promptIntervalId) clearInterval(promptIntervalId);
  promptCount = 0;
  setTimeout(() => sendPrompt(), 3000);
  promptIntervalId = setInterval(() => sendPrompt(), PROMPT_INTERVAL_MS);
}

function sendPrompt() {
  if (!session) return;
  promptCount++;
  const prompts = [
    "What do you see on the screen right now? Only describe content you can actually read or see. Tell me if I should pause, slow down, or keep scrolling.",
    "Look at the current screen. Is there anything matching my interests? Only reference what's actually visible. Scroll decision?",
    "Describe what's visible now. Do NOT make up any content — only say what you can see. Worth reading or skip?",
    "What's on the feed right now? Be specific about what you can actually read on screen. Pause, slow, or keep going?",
    "Analyze the current screen. Only mention real content visible in the video. Any match to my curator goal?",
  ];
  try {
    session.sendClientContent({ turns: [prompts[promptCount % prompts.length]] });
  } catch (err) {
    console.error("[GeminiLive] sendClientContent error:", err?.message);
  }
}

async function attemptReconnect() {
  if (!reconnectConfig) return;
  reconnectAttempts++;
  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
  console.log(`[GeminiLive] Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms`);
  safeStatusChange("reconnecting");
  await new Promise((r) => setTimeout(r, delay));
  try {
    const cfg = reconnectConfig;
    if (!cfg) return;
    await connect(cfg.apiKey, cfg.systemInstruction, cfg.onScrollCommand, cfg.onStatusChange);
  } catch (err) {
    console.error("[GeminiLive] Reconnect failed:", err?.message);
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) safeStatusChange("error");
  }
}

export function sendFrame(base64jpeg) {
  if (!session) return;
  try {
    session.sendRealtimeInput({ media: { data: base64jpeg, mimeType: "image/jpeg" } });
  } catch (err) {
    console.error("[GeminiLive] sendFrame error:", err?.message);
  }
}

export function disconnect() {
  reconnectConfig = null;
  if (promptIntervalId) { clearInterval(promptIntervalId); promptIntervalId = null; }
  if (session) {
    try { session.close(); } catch (_) {}
    session = null;
  }
  ai = null;
  scrollCommandCallback = null;
  statusChangeCallback = null;
  transcriptBuffer = "";
  console.log("[GeminiLive] Disconnected. Observations:", observationLog.length);
}

export function isConnected() { return session !== null; }
export function getObservationLog() { return [...observationLog]; }
export function clearObservationLog() { observationLog = []; }
export function getTokenUsage() { return { ...tokenUsage }; }

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(message) {
  const sc = message.serverContent;

  // Track token usage from usageMetadata
  if (message.usageMetadata || sc?.usageMetadata) {
    const um = message.usageMetadata || sc.usageMetadata;
    if (um.totalTokenCount) {
      tokenUsage.totalInputTokens = um.promptTokenCount || um.totalTokenCount || 0;
      tokenUsage.totalOutputTokens = um.candidatesTokenCount || 0;
    }
  }

  // outputAudioTranscription — primary text source
  const transcript = sc?.outputTranscription?.text;
  if (transcript) {
    transcriptBuffer += transcript;
    if (transcriptBuffer.includes(".") || transcriptBuffer.includes("!") ||
        transcriptBuffer.includes("?") || transcriptBuffer.length > 150) {
      processTranscript(transcriptBuffer.trim());
      transcriptBuffer = "";
    }
    return;
  }

  // modelTurn text parts (fallback)
  if (sc?.modelTurn?.parts) {
    for (const part of sc.modelTurn.parts) {
      if (part.text) transcriptBuffer += part.text;
    }
  }

  if (sc?.turnComplete) {
    if (transcriptBuffer.trim()) processTranscript(transcriptBuffer.trim());
    transcriptBuffer = "";
  }
}

function processTranscript(text) {
  if (!text) return;
  const command = parseScrollCommand(text);
  if (!command) return;

  console.log("[GeminiLive] Transcript ->", command.scroll, "|", command.relevance, "|", command.observation.slice(0, 80));

  observationLog.push({
    timestamp: Date.now(),
    scroll: command.scroll,
    observation: command.observation,
    relevance: command.relevance,
  });

  if (typeof scrollCommandCallback === "function") {
    scrollCommandCallback(command);
  }
}

// ---------------------------------------------------------------------------
// Transcript → scroll command parsing (NLP + JSON)
// ---------------------------------------------------------------------------

function parseScrollCommand(text) {
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  try { return normalizeCommand(JSON.parse(trimmed)); } catch (_) {}

  const jsonMatch = trimmed.match(/\{[\s\S]*?"scroll"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try { return normalizeCommand(JSON.parse(jsonMatch[0])); } catch (_) {}
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("pause") || lower.includes("stop") || lower.includes("interesting") || lower.includes("relevant") || lower.includes("this matches")) {
    return { scroll: "SCROLL_PAUSE", observation: trimmed.slice(0, 300), relevance: "high" };
  }
  if (lower.includes("slow down") || lower.includes("closer look") || lower.includes("worth a look") || lower.includes("let me slow")) {
    return { scroll: "SCROLL_SLOW", observation: trimmed.slice(0, 300), relevance: "medium" };
  }
  if (lower.includes("skip") || lower.includes("irrelevant") || lower.includes("not relevant") || lower.includes("promoted") || lower.includes("advertisement")) {
    return { scroll: "SCROLL_FAST", observation: trimmed.slice(0, 300), relevance: "low" };
  }
  if (lower.includes("go back") || lower.includes("scroll up") || lower.includes("missed")) {
    return { scroll: "SCROLL_UP", observation: trimmed.slice(0, 300), relevance: "medium" };
  }

  return { scroll: "SCROLL_DOWN", observation: trimmed.slice(0, 300), relevance: "low" };
}

function normalizeCommand(obj) {
  const validScrolls = ["SCROLL_DOWN", "SCROLL_SLOW", "SCROLL_PAUSE", "SCROLL_FAST", "SCROLL_UP"];
  return {
    scroll: validScrolls.includes(obj.scroll) ? obj.scroll : "SCROLL_DOWN",
    observation: obj.observation || obj.reason || "",
    relevance: ["high", "medium", "low"].includes(obj.relevance) ? obj.relevance : "low",
  };
}
