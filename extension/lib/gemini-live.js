/**
 * Gemini Live API Client
 *
 * Wraps @google/genai JS SDK to stream video frames to Gemini
 * and receive real-time action responses (SCROLL_DOWN, STOP, etc.)
 */

import { GoogleGenAI, Modality } from "./genai.bundle.js";

// Use the same model as live_video_input.ts
const MODEL = "models/gemini-2.5-flash-native-audio-preview-12-2025";

// MediaResolution values (from the SDK)
const MEDIA_RESOLUTION_MEDIUM = "MEDIA_RESOLUTION_MEDIUM";

const DEFAULT_SYSTEM_INSTRUCTION = `You are Unhooked, a social media curator agent who is watching the social media feed of the user on user's behalf with their consent. Your responsibilities are as follows:
1. Keep track of all the posts that you come across and understand the content and make sense from it
2. Give user a short and quick digest of what you saw in every scroll session so the user is up to date

Available actions:
- SAVE_POST — The post matches the user's specific goal/interest.
- LIKE_POST — The post is high quality or interesting (but maybe not worth saving).
- SCROLL_DOWN — The current post is not interesting, move to next.
- WAIT — Content is loading or you need more time to read.

Response format (JSON ONLY):
{"action": "SAVE_POST", "reason": "Finance tip regarding tax savings", "params": {}}

Rules:
1. Default to SCROLL_DOWN to keep the feed moving.
2. Only SAVE or LIKE if you are confident.
3. If you SAVE a post, usually also LIKE it (send LIKE_POST then SAVE_POST in subsequent turns).
4. Do not hallucinate actions.
`;

let session = null;
let ai = null;
let actionCallback = null;
let responseBuffer = "";

/**
 * Connect to Gemini Live API
 * @param {string} apiKey - Google API key
 * @param {string} userGoal - User's curation goal (optional)
 * @param {function} onAction - callback(actionJSON) when model responds
 * @returns {Promise<void>}
 */
export async function connect(apiKey, userGoal = "", onAction) {
    // Use the same configuration as live_video_input.ts
    ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: { apiVersion: "v1alpha" }
    });
    
    actionCallback = onAction;
    responseBuffer = "";

    let instructions = DEFAULT_SYSTEM_INSTRUCTION;
    if (userGoal && userGoal.trim()) {
        instructions += `\n\nUSER'S CURATION GOAL: "${userGoal.trim()}"\n\nPrioritize actions that align with this goal.`;
    }

    const config = {
        responseModalities: [Modality.TEXT],
        proactivity: { proactiveAudio: true },
        mediaResolution: MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: 'Zephyr',
                }
            }
        },
        contextWindowCompression: {
            triggerTokens: '104857',
            slidingWindow: { targetTokens: '52428' },
        },
        systemInstruction: {
            parts: [{ text: instructions }],
        },
    };

    console.log("[GeminiLive] Connecting with config:", JSON.stringify(config, null, 2));

    session = await ai.live.connect({
        model: MODEL,
        callbacks: {
            onopen: () => {
                console.log("[GeminiLive] Connected to Gemini Live API");
            },
            onmessage: (message) => {
                handleMessage(message);
            },
            onerror: (e) => {
                console.error("[GeminiLive] Error:", e.message || e);
            },
            onclose: (e) => {
                console.log("[GeminiLive] Connection closed:", e?.reason || "unknown");
                session = null;
            },
        },
        config: config
    });

    console.log("[GeminiLive] Session established");
    
    // Send initial client content to start the session
    session.sendClientContent({
        turns: [`User has started screen recording. Begin analyzing the feed.`]
    });
    
    // Start listening for real-time input (video frames)
    // This is called with empty object to start the stream
    session.sendRealtimeInput({});
}

/**
 * Send a JPEG frame to the model
 * @param {string} base64jpeg - base64-encoded JPEG data (no prefix)
 */
export function sendFrame(base64jpeg) {
    if (!session) {
        console.warn("[GeminiLive] No active session, dropping frame");
        return;
    }

    // Send the actual video frame
    session.sendRealtimeInput({
        media: {
            data: base64jpeg,
            mimeType: "image/jpeg",
        },
    });
}

/**
 * Disconnect from Gemini Live API and close session
 */
export function disconnect() {
    if (session) {
        console.log("[GeminiLive] Closing session...");
        session.close();
        session = null;
    }
    ai = null;
    actionCallback = null;
    responseBuffer = "";
    console.log("[GeminiLive] Disconnected");
}

/**
 * Check if connected
 */
export function isConnected() {
    return session !== null;
}

/**
 * Handle incoming messages from the model
 */
function handleMessage(message) {
    // Handle model turn with text parts
    if (
        message.serverContent?.modelTurn?.parts
    ) {
        for (const part of message.serverContent.modelTurn.parts) {
            if (part.text) {
                responseBuffer += part.text;
            }
        }
    }

    // When turn is complete, try to parse the accumulated response
    if (message.serverContent?.turnComplete) {
        if (responseBuffer.trim()) {
            try {
                const action = parseActionJSON(responseBuffer);
                if (action && actionCallback) {
                    actionCallback(action);
                }
            } catch (e) {
                console.warn("[GeminiLive] Failed to parse action:", responseBuffer, e);
            }
        }
        responseBuffer = "";
    }
}

/**
 * Extract and parse JSON from the model's response
 */
function parseActionJSON(text) {
    // Try direct parse
    try {
        return JSON.parse(text.trim());
    } catch (_) {
        // noop
    }

    // Try extracting JSON from markdown code block or surrounding text
    const jsonMatch = text.match(/\{[^}]*"action"\s*:\s*"[^"]+?"[^}]*\}/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[0]);
        } catch (_) {
            // noop
        }
    }

    return null;
}