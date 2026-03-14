/**
 * Offscreen Document — Frame Extraction
 *
 * Receives a tab capture stream, draws frames to a canvas at 1 FPS,
 * and sends JPEG base64 data back to the service worker.
 */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const FRAME_WIDTH = 768;
const FRAME_HEIGHT = 768;
const JPEG_QUALITY = 0.7;
const FRAME_INTERVAL_MS = 1000; // 1 FPS

canvas.width = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;

// Helper to log to background
function logToBackground(message, data) {
    chrome.runtime.sendMessage({
        type: "LOG",
        message: `[Offscreen] ${message}`,
        data: data
    }).catch(() => { });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "START_FRAME_EXTRACTION") {
        startExtraction(message.streamId);
        sendResponse({ success: true });
    } else if (message.type === "STOP_FRAME_EXTRACTION") {
        stopExtraction();
        sendResponse({ success: true });
    }
    return true;
});

async function startExtraction(streamId) {
    try {
        logToBackground(`Starting extraction with streamId: ${streamId}`);

        // Get MediaStream from the tab capture stream ID
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "tab",
                    chromeMediaSourceId: streamId,
                },
            },
        });

        logToBackground("Got media stream", stream.id);

        video.srcObject = stream;
        await video.play();

        logToBackground("Video playing, starting interval");

        frameIntervalId = setInterval(() => {
            try {
                // Draw video frame to canvas, resized to 768x768
                ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

                // Convert to JPEG base64
                const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
                const base64 = dataUrl.split(",")[1];

                // Send frame to service worker
                chrome.runtime.sendMessage({
                    type: "VIDEO_FRAME",
                    data: base64,
                    mimeType: "image/jpeg",
                    timestamp: Date.now(),
                }).catch(err => {
                    // logToBackground("Error sending frame", err.message);
                });
            } catch (frameErr) {
                logToBackground("Error processing frame", frameErr.message);
            }
        }, FRAME_INTERVAL_MS);
    } catch (error) {
        logToBackground("Failed to start frame extraction", error.message);
        chrome.runtime.sendMessage({
            type: "FRAME_EXTRACTION_ERROR",
            error: error.message,
        });
    }
}

function stopExtraction() {
    if (frameIntervalId) {
        clearInterval(frameIntervalId);
        frameIntervalId = null;
    }

    if (video.srcObject) {
        video.srcObject.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
    }

    logToBackground("Frame extraction stopped");
}
