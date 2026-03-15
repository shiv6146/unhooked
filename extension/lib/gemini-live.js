/**
 * Gemini Live API Client
 *
 * Streams video frames to Gemini Live and receives scroll commands
 * with observations. Maintains an observation log for digest generation.
 */

import { GoogleGenAI, Modality } from "./genai.bundle.js";

const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
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
 * @param {function} [onStatusChange] - callback(status)
 */
export async function connect(apiKey, systemInstruction, onScrollCommand, onStatusChange) {
  ai = new GoogleGenAI({ apiKey });

  scrollCommandCallback = onScrollCommand;
  statusChangeCallback = onStatusChange || (() => {});
  responseBuffer = "";
  observationLog = [];
  reconnectAttempts = 0;

  reconnectConfig = { apiKey, systemInstruction, onScrollCommand, onStatusChange };

  const config = {
    responseModalities: [Modality.AUDIO],
    mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Zephyr",
        },
      },
    },
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
          console.log("[GeminiLive] Connected successfully");
          reconnectAttempts = 0;
          statusChangeCallback("connected");
        },
        onmessage: (message) => {
          handleMessage(message);
        },
        onerror: (e) => {
          console.error("[GeminiLive] WebSocket error:", e?.message || e);
          statusChangeCallback("error");
        },
        onclose: (e) => {
          console.log("[GeminiLive] WebSocket closed:", e?.reason || e?.code || "unknown");
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

    console.log("[GeminiLive] Session established, ready to receive frames");
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
    console.error("[GeminiLive] Reconnect failed:", err?.message || err);
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      statusChangeCallback("error");
    }
  }
}

export function sendFrame(base64jpeg) {
  if (!session) return;

  try {
    session.sendRealtimeInput({
      media: {
        data: base64jpeg,
        mimeType: "image/jpeg",
      },
    });
  } catch (err) {
    console.error("[GeminiLive] sendFrame error:", err?.message || err);
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
  responseBuffer = "";
  console.log("[GeminiLive] Disconnected");
}

export function isConnected() {
  return session !== null;
}

export function getObservationLog() {
  return [...observationLog];
}

export function clearObservationLog() {
  observationLog = [];
}

let messageCount = 0;

function handleMessage(message) {
  messageCount++;

  if (messageCount <= 5) {
    console.log("[GeminiLive] Message #" + messageCount + " keys:", Object.keys(message).join(", "));
    if (message.serverContent) {
      const sc = message.serverContent;
      console.log("[GeminiLive]   serverContent keys:", Object.keys(sc).join(", "));
      if (sc.modelTurn?.parts) {
        console.log("[GeminiLive]   parts count:", sc.modelTurn.parts.length,
          "types:", sc.modelTurn.parts.map(p => p.text ? "text" : p.inlineData ? "audio" : "other").join(","));
      }
    }
  }

  if (message.serverContent?.modelTurn?.parts) {
    for (const part of message.serverContent.modelTurn.parts) {
      if (part.text) {
        responseBuffer += part.text;
      }
    }
  }

  if (message.serverContent?.turnComplete) {
    if (responseBuffer.trim()) {
      console.log("[GeminiLive] Turn complete, raw text:", responseBuffer.slice(0, 300));
      const command = parseScrollCommand(responseBuffer);
      if (command) {
        console.log("[GeminiLive] Parsed command:", command.scroll, "| relevance:", command.relevance);
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
    } else {
      console.log("[GeminiLive] Turn complete, no text (audio-only turn)");
    }
    responseBuffer = "";
  }
}

function parseScrollCommand(text) {
  const trimmed = text.trim();

  try {
    const obj = JSON.parse(trimmed);
    return normalizeCommand(obj);
  } catch (_) {}

  const jsonMatch = trimmed.match(/\{[\s\S]*?"scroll"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      return normalizeCommand(obj);
    } catch (_) {}
  }

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

  console.warn("[GeminiLive] Unparseable, defaulting SCROLL_DOWN:", trimmed.slice(0, 200));
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
