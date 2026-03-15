/**
 * Gemini Live API Client — Real-time Video Analysis
 *
 * Uses gemini-2.5-flash-native-audio via bidiGenerateContent (Live API)
 * with outputAudioTranscription to get text transcripts of the model's
 * spoken observations. Audio output is discarded; we only use the text.
 *
 * This approach uses the real-time WebSocket Live API which:
 * - Maintains stateful context across the entire session
 * - Processes continuous video frames with memory of what it's seen
 * - Handles reels/shorts/video content (not just static screenshots)
 * - Qualifies for the Gemini Live Agent Challenge hackathon
 */

import { GoogleGenAI, Modality } from "./genai.bundle.js";

const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2000;

let session = null;
let ai = null;
let scrollCommandCallback = null;
let statusChangeCallback = null;
let observationLog = [];
let reconnectAttempts = 0;
let reconnectConfig = null;
let transcriptBuffer = "";

/**
 * Connect to Gemini Live API with audio transcription enabled.
 */
export async function connect(apiKey, systemInstruction, onScrollCommand, onStatusChange) {
  ai = new GoogleGenAI({ apiKey });

  scrollCommandCallback = onScrollCommand;
  statusChangeCallback = onStatusChange || (() => {});
  observationLog = [];
  reconnectAttempts = 0;
  transcriptBuffer = "";

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
          statusChangeCallback("connected");
        },
        onmessage: (message) => {
          handleMessage(message);
        },
        onerror: (e) => {
          console.error("[GeminiLive] Error:", e?.message || e);
          statusChangeCallback("error");
        },
        onclose: (e) => {
          console.log("[GeminiLive] Closed:", e?.reason || e?.code || "unknown");
          const wasConnected = session !== null;
          session = null;
          statusChangeCallback("disconnected");

          if (wasConnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS && reconnectConfig) {
            attemptReconnect();
          }
        },
      },
      config,
    });

    console.log("[GeminiLive] Session established via Live API");
  } catch (err) {
    console.error("[GeminiLive] Connection failed:", err?.message || err);
    session = null;
    statusChangeCallback("error");
    throw err;
  }
}

async function attemptReconnect() {
  if (!reconnectConfig) return;
  reconnectAttempts++;
  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
  console.log(`[GeminiLive] Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms`);
  statusChangeCallback("reconnecting");
  await new Promise((r) => setTimeout(r, delay));
  try {
    const { apiKey, systemInstruction, onScrollCommand, onStatusChange } = reconnectConfig;
    await connect(apiKey, systemInstruction, onScrollCommand, onStatusChange);
  } catch (err) {
    console.error("[GeminiLive] Reconnect failed:", err?.message);
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) statusChangeCallback("error");
  }
}

export function sendFrame(base64jpeg) {
  if (!session) return;
  try {
    session.sendRealtimeInput({
      media: { data: base64jpeg, mimeType: "image/jpeg" },
    });
  } catch (err) {
    console.error("[GeminiLive] sendFrame error:", err?.message);
  }
}

export function disconnect() {
  reconnectConfig = null;
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

// ---------------------------------------------------------------------------
// Message handling — we read outputTranscription for text
// ---------------------------------------------------------------------------

function handleMessage(message) {
  // outputAudioTranscription delivers text transcripts of what the model says
  const transcript = message.serverContent?.outputTranscription?.text;
  if (transcript) {
    transcriptBuffer += transcript;

    // Process on sentence boundaries or after accumulating enough text
    if (transcriptBuffer.includes("}") || transcriptBuffer.length > 200) {
      processTranscript(transcriptBuffer.trim());
      transcriptBuffer = "";
    }
    return;
  }

  // Also try modelTurn text parts (some responses may include direct text)
  if (message.serverContent?.modelTurn?.parts) {
    for (const part of message.serverContent.modelTurn.parts) {
      if (part.text) {
        transcriptBuffer += part.text;
      }
    }
  }

  if (message.serverContent?.turnComplete) {
    if (transcriptBuffer.trim()) {
      processTranscript(transcriptBuffer.trim());
    }
    transcriptBuffer = "";
  }
}

function processTranscript(text) {
  if (!text) return;

  const command = parseScrollCommand(text);
  if (command) {
    console.log("[GeminiLive] Transcript ->", command.scroll, "|", command.relevance, "|", command.observation.slice(0, 80));

    observationLog.push({
      timestamp: Date.now(),
      scroll: command.scroll,
      observation: command.observation,
      relevance: command.relevance,
    });

    if (scrollCommandCallback) {
      scrollCommandCallback(command);
    }
  }
}

// ---------------------------------------------------------------------------
// Transcript parsing — extract scroll commands from spoken observations
// The model's spoken response may be natural language, not strict JSON.
// We parse flexibly.
// ---------------------------------------------------------------------------

function parseScrollCommand(text) {
  const trimmed = text.trim();

  // Try JSON parse first
  try { return normalizeCommand(JSON.parse(trimmed)); } catch (_) {}

  // Extract JSON from markdown or mixed text
  const jsonMatch = trimmed.match(/\{[\s\S]*?"scroll"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try { return normalizeCommand(JSON.parse(jsonMatch[0])); } catch (_) {}
  }

  // Natural language parsing — the model speaks its observations
  const lowerText = trimmed.toLowerCase();

  if (lowerText.includes("pause") || lowerText.includes("stop") || lowerText.includes("wait") || lowerText.includes("interesting") || lowerText.includes("relevant")) {
    return { scroll: "SCROLL_PAUSE", observation: trimmed.slice(0, 300), relevance: "high" };
  }
  if (lowerText.includes("slow") || lowerText.includes("closer look") || lowerText.includes("worth")) {
    return { scroll: "SCROLL_SLOW", observation: trimmed.slice(0, 300), relevance: "medium" };
  }
  if (lowerText.includes("skip") || lowerText.includes("ad") || lowerText.includes("irrelevant") || lowerText.includes("not relevant") || lowerText.includes("promoted")) {
    return { scroll: "SCROLL_FAST", observation: trimmed.slice(0, 300), relevance: "low" };
  }
  if (lowerText.includes("go back") || lowerText.includes("scroll up") || lowerText.includes("missed")) {
    return { scroll: "SCROLL_UP", observation: trimmed.slice(0, 300), relevance: "medium" };
  }

  // Default: continue scrolling — the model is describing content
  return {
    scroll: "SCROLL_DOWN",
    observation: trimmed.slice(0, 300),
    relevance: "low",
  };
}

function normalizeCommand(obj) {
  const validScrolls = ["SCROLL_DOWN", "SCROLL_SLOW", "SCROLL_PAUSE", "SCROLL_FAST", "SCROLL_UP"];
  return {
    scroll: validScrolls.includes(obj.scroll) ? obj.scroll : "SCROLL_DOWN",
    observation: obj.observation || obj.reason || "",
    relevance: ["high", "medium", "low"].includes(obj.relevance) ? obj.relevance : "low",
  };
}
