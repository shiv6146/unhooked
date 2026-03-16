/**
 * Digest Generation Module
 *
 * Generates structured digests from observation logs using Gemini
 * generateContent API. Includes recorded video frames as visual
 * ground truth to prevent hallucination.
 */

import { GoogleGenAI } from "./genai.bundle.js";
import { buildDigestPrompt } from "./prompts.js";

const MAX_FRAMES_FOR_DIGEST = 15;

/**
 * Generate a structured digest from the observation log.
 * Includes sampled video frames so the model can verify observations
 * against what was actually on screen.
 *
 * @param {string} apiKey
 * @param {Array} observationLog
 * @param {Object} sessionMeta
 * @param {Array<string>} recordedFrames - base64 JPEG frames from the session
 */
export async function generateDigest(apiKey, observationLog, sessionMeta, recordedFrames = []) {
  const ai = new GoogleGenAI({ apiKey });

  const promptText = buildDigestPrompt(observationLog, sessionMeta);

  // Build multimodal content: frames as visual evidence + text prompt
  const parts = [];

  // Sample frames evenly across the recording
  const frames = sampleFrames(recordedFrames, MAX_FRAMES_FOR_DIGEST);
  for (const frame of frames) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: frame },
    });
  }

  // Add the text prompt after the frames
  parts.push({ text: promptText });

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts }],
      config: { temperature: 0.3, maxOutputTokens: 2000 },
    });

    const text = result.text || "";
    const digest = parseDigestJSON(text);

    if (digest) {
      const highRelevanceObs = observationLog.filter((o) => o.relevance === "high" && o.postUrl);
      digest.mustRead = (digest.mustRead || []).map((item, i) => {
        if (highRelevanceObs[i]?.postUrl) {
          item.postUrl = highRelevanceObs[i].postUrl;
        }
        return item;
      });
      return digest;
    }
  } catch (err) {
    console.error("[Digest] generateContent failed:", err?.message);
  }

  return buildFallbackDigest(observationLog, sessionMeta);
}

function sampleFrames(frames, maxCount) {
  if (!frames || frames.length === 0) return [];
  if (frames.length <= maxCount) return frames;

  const step = frames.length / maxCount;
  const sampled = [];
  for (let i = 0; i < maxCount; i++) {
    sampled.push(frames[Math.floor(i * step)]);
  }
  return sampled;
}

export function computeTimeSaved(postsScanned) {
  return postsScanned * 7;
}

export async function updateAnalytics(sessions) {
  const analytics = {
    totalTimeSaved: 0,
    totalSessions: sessions.length,
    totalPostsScanned: 0,
    avgNoiseRate: 0,
  };

  let noiseRateSum = 0;
  for (const s of sessions) {
    analytics.totalTimeSaved += s.timeSaved || 0;
    analytics.totalPostsScanned += s.postsScanned || 0;
    noiseRateSum += 1 - (s.digest?.matchRate || 0);
  }

  analytics.avgNoiseRate = sessions.length > 0 ? noiseRateSum / sessions.length : 0;
  await chrome.storage.local.set({ analytics });
  return analytics;
}

function parseDigestJSON(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch (_) {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (_) {}
  }

  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)); } catch (_) {}
  }

  return null;
}

function buildFallbackDigest(observationLog) {
  const high = observationLog.filter((o) => o.relevance === "high");
  const medium = observationLog.filter((o) => o.relevance === "medium");
  const low = observationLog.filter((o) => o.relevance !== "high" && o.relevance !== "medium");

  return {
    tldr: high.length > 0
      ? `Found ${high.length} interesting post${high.length > 1 ? "s" : ""} in your feed.`
      : "Not much matching your interests this time. Your feed was mostly noise.",
    mustRead: high.slice(0, 3).map((o) => ({
      title: o.observation.slice(0, 60),
      source: "",
      agentNote: "Agent paused on this content",
      excerpt: o.observation.slice(0, 150),
      postUrl: o.postUrl || "",
      relevance: "high",
    })),
    worthALook: medium.slice(0, 5).map((o) => ({
      title: o.observation.slice(0, 50),
      source: "",
      oneLiner: "Caught the agent's attention",
    })),
    skimmedPast: { total: low.length, categories: { Other: low.length } },
    feedMood: "Mixed content",
    matchRate: observationLog.length > 0 ? Math.round(((high.length + medium.length) / observationLog.length) * 100) / 100 : 0,
  };
}
