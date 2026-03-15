/**
 * Gemini Frame Analyzer
 *
 * Sends captured video frames to gemini-2.5-flash via generateContent
 * for real-time analysis. Returns structured JSON scroll commands.
 *
 * Replaces the Live API (bidiGenerateContent) approach because the
 * native-audio Live API models force audio output. generateContent
 * with gemini-2.5-flash gives us text-only JSON responses from video frames.
 */

import { GoogleGenAI } from "./genai.bundle.js";

const MODEL = "gemini-2.5-flash";
const ANALYSIS_INTERVAL_MS = 3000; // Analyze every 3 seconds
const MAX_RETRIES = 2;

let ai = null;
let systemInstruction = "";
let scrollCommandCallback = null;
let statusChangeCallback = null;
let observationLog = [];
let analysisIntervalId = null;
let pendingFrame = null; // Latest frame waiting to be analyzed
let analyzing = false;
let connected = false;
let frameCount = 0;

/**
 * Initialize the analyzer.
 * @param {string} apiKey
 * @param {string} sysInstruction - System prompt from prompts.js
 * @param {function} onScrollCommand - callback({ scroll, observation, relevance })
 * @param {function} [onStatusChange] - callback(status)
 */
export async function connect(apiKey, sysInstruction, onScrollCommand, onStatusChange) {
  ai = new GoogleGenAI({ apiKey });
  systemInstruction = sysInstruction;
  scrollCommandCallback = onScrollCommand;
  statusChangeCallback = onStatusChange || (() => {});
  observationLog = [];
  frameCount = 0;
  analyzing = false;
  pendingFrame = null;

  // Validate connection with a quick test
  try {
    console.log("[GeminiAnalyzer] Validating API key with gemini-2.5-flash...");
    const testResult = await ai.models.generateContent({
      model: MODEL,
      contents: "Respond with just: ok",
    });
    if (!testResult.text) throw new Error("Empty response from validation call");
    console.log("[GeminiAnalyzer] API key validated successfully");
  } catch (err) {
    console.error("[GeminiAnalyzer] API key validation failed:", err?.message);
    statusChangeCallback("error");
    throw err;
  }

  connected = true;
  statusChangeCallback("connected");

  // Start the analysis loop
  analysisIntervalId = setInterval(analyzeNextFrame, ANALYSIS_INTERVAL_MS);
  console.log("[GeminiAnalyzer] Analysis loop started (every " + ANALYSIS_INTERVAL_MS + "ms)");
}

/**
 * Buffer a frame for analysis. Only the latest frame is kept.
 */
export function sendFrame(base64jpeg) {
  if (!connected) return;
  pendingFrame = base64jpeg;
  frameCount++;
}

/**
 * Analyze the latest buffered frame via generateContent.
 */
async function analyzeNextFrame() {
  if (!connected || !ai || analyzing || !pendingFrame) return;

  const frame = pendingFrame;
  pendingFrame = null;
  analyzing = true;

  try {
    const result = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: frame,
              },
            },
            {
              text: "Analyze this social media feed screenshot. Respond with a single JSON object: {\"scroll\": \"SCROLL_DOWN|SCROLL_SLOW|SCROLL_PAUSE|SCROLL_FAST|SCROLL_UP\", \"observation\": \"what you see\", \"relevance\": \"high|medium|low\"}",
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3,
        maxOutputTokens: 300,
      },
    });

    const text = result.text || "";
    if (text.trim()) {
      const command = parseScrollCommand(text);
      if (command) {
        console.log("[GeminiAnalyzer] Frame analyzed:", command.scroll, "| relevance:", command.relevance, "| obs:", command.observation.slice(0, 80));

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
  } catch (err) {
    console.error("[GeminiAnalyzer] Frame analysis failed:", err?.message?.slice(0, 200));
    // Don't disconnect on individual frame failures
  } finally {
    analyzing = false;
  }
}

export function disconnect() {
  connected = false;
  if (analysisIntervalId) {
    clearInterval(analysisIntervalId);
    analysisIntervalId = null;
  }
  ai = null;
  scrollCommandCallback = null;
  statusChangeCallback = null;
  pendingFrame = null;
  analyzing = false;
  console.log("[GeminiAnalyzer] Disconnected. Frames received:", frameCount, "| Observations:", observationLog.length);
}

export function isConnected() {
  return connected;
}

export function getObservationLog() {
  return [...observationLog];
}

export function clearObservationLog() {
  observationLog = [];
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseScrollCommand(text) {
  const trimmed = text.trim();

  // Direct JSON parse
  try {
    return normalizeCommand(JSON.parse(trimmed));
  } catch (_) {}

  // Extract from markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return normalizeCommand(JSON.parse(fenced[1].trim()));
    } catch (_) {}
  }

  // Find JSON object in surrounding text
  const jsonMatch = trimmed.match(/\{[\s\S]*?"scroll"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      return normalizeCommand(JSON.parse(jsonMatch[0]));
    } catch (_) {}
  }

  // Keyword fallback
  const scrollKeywords = ["SCROLL_PAUSE", "SCROLL_SLOW", "SCROLL_FAST", "SCROLL_UP", "SCROLL_DOWN"];
  for (const kw of scrollKeywords) {
    if (trimmed.includes(kw)) {
      return {
        scroll: kw,
        observation: trimmed.replace(/[{}"\n]/g, "").trim().slice(0, 200),
        relevance: kw === "SCROLL_PAUSE" ? "high" : kw === "SCROLL_SLOW" ? "medium" : "low",
      };
    }
  }

  // Default
  console.warn("[GeminiAnalyzer] Unparseable response:", trimmed.slice(0, 150));
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
