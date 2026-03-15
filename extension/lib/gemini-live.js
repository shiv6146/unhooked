/**
 * Gemini Live API Client
 *
 * Streams video frames to Gemini Live and receives scroll commands
 * with observations. Maintains an observation log for digest generation.
 */

import { GoogleGenAI, Modality } from "./genai.bundle.js";

const MODEL = "models/gemini-2.0-flash-live-001";
const MEDIA_RESOLUTION_LOW = "MEDIA_RESOLUTION_LOW";
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_BASE_DELAY_MS = 2000;

let session = null;
let ai = null;
let scrollCommandCallback = null;
let statusChangeCallback = null;
let responseBuffer = "";
let observationLog = [];
let reconnectAttempts = 0;
let reconnectConfig = null;

/**
 * Connect to Gemini Live API
 * @param {string} apiKey
 * @param {string} systemInstruction - Full system prompt from prompts.js
 * @param {function} onScrollCommand - callback({ scroll, observation, relevance })
 * @param {function} [onStatusChange] - callback(status: "connected"|"disconnected"|"error"|"reconnecting")
 */
export async function connect(apiKey, systemInstruction, onScrollCommand, onStatusChange) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  scrollCommandCallback = onScrollCommand;
  statusChangeCallback = onStatusChange || (() => {});
  responseBuffer = "";
  observationLog = [];
  reconnectAttempts = 0;

  reconnectConfig = { apiKey, systemInstruction, onScrollCommand, onStatusChange };

  const config = {
    responseModalities: [Modality.TEXT],
    mediaResolution: MEDIA_RESOLUTION_LOW,
    contextWindowCompression: {
      triggerTokens: 104857,
      slidingWindow: { targetTokens: 52428 },
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  };

  console.log("[GeminiLive] Connecting...");

  session = await ai.live.connect({
    model: MODEL,
    callbacks: {
      onopen: () => {
        console.log("[GeminiLive] Connected");
        reconnectAttempts = 0;
        statusChangeCallback("connected");
      },
      onmessage: (message) => {
        handleMessage(message);
      },
      onerror: (e) => {
        console.error("[GeminiLive] Error:", e.message || e);
        statusChangeCallback("error");
      },
      onclose: (e) => {
        console.log("[GeminiLive] Closed:", e?.reason || "unknown");
        const wasConnected = session !== null;
        session = null;
        statusChangeCallback("disconnected");

        if (wasConnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          attemptReconnect();
        }
      },
    },
    config: config,
  });

  console.log("[GeminiLive] Session established");
}

/**
 * Attempt reconnection with exponential backoff
 */
async function attemptReconnect() {
  if (!reconnectConfig) return;

  reconnectAttempts++;
  const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
  console.log(`[GeminiLive] Reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms`);
  statusChangeCallback("reconnecting");

  await new Promise((r) => setTimeout(r, delay));

  try {
    const { apiKey, systemInstruction, onScrollCommand, onStatusChange } = reconnectConfig;
    await connect(apiKey, systemInstruction, onScrollCommand, onStatusChange);
  } catch (err) {
    console.error("[GeminiLive] Reconnect failed:", err.message);
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      statusChangeCallback("error");
    }
  }
}

/**
 * Send a JPEG frame to the model
 */
export function sendFrame(base64jpeg) {
  if (!session) return;

  session.sendRealtimeInput({
    media: {
      data: base64jpeg,
      mimeType: "image/jpeg",
    },
  });
}

/**
 * Disconnect and clean up
 */
export function disconnect() {
  reconnectConfig = null; // prevent auto-reconnect
  if (session) {
    session.close();
    session = null;
  }
  ai = null;
  scrollCommandCallback = null;
  statusChangeCallback = null;
  responseBuffer = "";
  console.log("[GeminiLive] Disconnected");
}

export function isConnected() {
  return session !== null;
}

/**
 * Get the accumulated observation log
 */
export function getObservationLog() {
  return [...observationLog];
}

/**
 * Clear the observation log (called after digest generation)
 */
export function clearObservationLog() {
  observationLog = [];
}

/**
 * Handle incoming messages from the model
 */
function handleMessage(message) {
  if (message.serverContent?.modelTurn?.parts) {
    for (const part of message.serverContent.modelTurn.parts) {
      if (part.text) {
        responseBuffer += part.text;
      }
    }
  }

  if (message.serverContent?.turnComplete) {
    if (responseBuffer.trim()) {
      const command = parseScrollCommand(responseBuffer);
      if (command) {
        const entry = {
          timestamp: Date.now(),
          scroll: command.scroll,
          observation: command.observation,
          relevance: command.relevance,
        };
        observationLog.push(entry);

        if (scrollCommandCallback) {
          scrollCommandCallback(command);
        }
      }
    }
    responseBuffer = "";
  }
}

/**
 * Parse JSON scroll command from model response.
 * Falls back to SCROLL_DOWN on parse failure to guarantee forward progress.
 */
function parseScrollCommand(text) {
  const trimmed = text.trim();

  // Direct parse
  try {
    const obj = JSON.parse(trimmed);
    return normalizeCommand(obj);
  } catch (_) {}

  // Extract JSON from markdown or surrounding text
  const jsonMatch = trimmed.match(/\{[\s\S]*?"scroll"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      return normalizeCommand(obj);
    } catch (_) {}
  }

  // Last resort: look for scroll command keyword anywhere in text
  const scrollKeywords = ["SCROLL_PAUSE", "SCROLL_SLOW", "SCROLL_FAST", "SCROLL_UP", "SCROLL_DOWN"];
  for (const kw of scrollKeywords) {
    if (trimmed.includes(kw)) {
      return {
        scroll: kw,
        observation: trimmed.replace(/[{}"\n]/g, "").trim(),
        relevance: kw === "SCROLL_PAUSE" ? "high" : kw === "SCROLL_SLOW" ? "medium" : "low",
      };
    }
  }

  // Default: keep scrolling
  console.warn("[GeminiLive] Unparseable response, defaulting to SCROLL_DOWN:", trimmed.slice(0, 200));
  return {
    scroll: "SCROLL_DOWN",
    observation: trimmed.slice(0, 200),
    relevance: "low",
  };
}

function normalizeCommand(obj) {
  const validScrolls = ["SCROLL_DOWN", "SCROLL_SLOW", "SCROLL_PAUSE", "SCROLL_FAST", "SCROLL_UP"];
  const scroll = validScrolls.includes(obj.scroll) ? obj.scroll : "SCROLL_DOWN";
  const relevance = ["high", "medium", "low"].includes(obj.relevance) ? obj.relevance : "low";

  return {
    scroll,
    observation: obj.observation || obj.reason || "",
    relevance,
  };
}
