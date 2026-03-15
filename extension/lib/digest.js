/**
 * Digest Generation Module
 *
 * Generates structured digests from observation logs using
 * Gemini generateContent API (not the Live API).
 */

import { GoogleGenAI } from "./genai.bundle.js";
import { buildDigestPrompt } from "./prompts.js";

/**
 * Generate a structured digest from the observation log.
 *
 * @param {string} apiKey
 * @param {Array} observationLog - [{ timestamp, scroll, observation, relevance, postUrl? }]
 * @param {Object} sessionMeta - { platform, curatorGoal, duration, postsScanned }
 * @returns {Object} digest JSON matching the persistence schema
 */
export async function generateDigest(apiKey, observationLog, sessionMeta) {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = buildDigestPrompt(observationLog, sessionMeta);

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = result.text || "";
    const digest = parseDigestJSON(text);

    if (digest) {
      // Merge post URLs from observations into mustRead items
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
    console.error("[Digest] generateContent failed:", err);
  }

  // Fallback: build a basic digest from raw observations
  return buildFallbackDigest(observationLog, sessionMeta);
}

/**
 * Calculate estimated time saved in seconds.
 * Average human scan time per post ≈ 7 seconds.
 */
export function computeTimeSaved(postsScanned) {
  return postsScanned * 7;
}

/**
 * Recompute analytics totals from sessions array and write to storage.
 */
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseDigestJSON(text) {
  const trimmed = text.trim();

  // Direct parse
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  // Strip markdown fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }

  // Try to find JSON object
  const braceStart = trimmed.indexOf("{");
  const braceEnd = trimmed.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    try {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1));
    } catch (_) {}
  }

  return null;
}

function buildFallbackDigest(observationLog, sessionMeta) {
  const high = observationLog.filter((o) => o.relevance === "high");
  const medium = observationLog.filter((o) => o.relevance === "medium");
  const low = observationLog.filter((o) => o.relevance === "low" || !o.relevance);

  const mustRead = high.slice(0, 3).map((o) => ({
    title: o.observation.slice(0, 60),
    source: "",
    agentNote: "Agent paused on this content",
    excerpt: o.observation.slice(0, 150),
    postUrl: o.postUrl || "",
    relevance: "high",
  }));

  const worthALook = medium.slice(0, 5).map((o) => ({
    title: o.observation.slice(0, 50),
    source: "",
    oneLiner: "Caught the agent's attention",
  }));

  const total = low.length;
  const matchRate = observationLog.length > 0
    ? (high.length + medium.length) / observationLog.length
    : 0;

  return {
    tldr: high.length > 0
      ? `Found ${high.length} interesting post${high.length > 1 ? "s" : ""} in your feed.`
      : "Not much matching your interests this time.",
    mustRead,
    worthALook,
    skimmedPast: { total, categories: { Other: total } },
    feedMood: "Mixed content",
    matchRate: Math.round(matchRate * 100) / 100,
  };
}
