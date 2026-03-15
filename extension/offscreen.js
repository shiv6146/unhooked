/**
 * Offscreen Document — Frame Extraction
 *
 * Receives a tab capture stream, draws frames to a canvas at ~1 FPS,
 * and sends JPEG base64 data back to the service worker.
 * Includes frame-change detection to skip near-duplicate frames.
 */

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const FRAME_WIDTH = 512;
const FRAME_HEIGHT = 512;
const JPEG_QUALITY = 0.5;
const FRAME_INTERVAL_MS = 1000;
const CHANGE_THRESHOLD = 0.05; // 5% pixel change required to send frame

canvas.width = FRAME_WIDTH;
canvas.height = FRAME_HEIGHT;

let frameIntervalId = null;
let previousFrameData = null;

function logToBackground(message, data) {
  chrome.runtime.sendMessage({
    type: "LOG",
    message: `[Offscreen] ${message}`,
    data: data,
  }).catch(() => {});
}

chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" }).catch(() => {});

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

function hasSignificantChange(currentData) {
  if (!previousFrameData) return true;

  const len = currentData.length;
  const sampleStep = 16; // sample every 16th pixel channel for speed
  let diffCount = 0;
  let sampleCount = 0;

  for (let i = 0; i < len; i += sampleStep) {
    sampleCount++;
    if (Math.abs(currentData[i] - previousFrameData[i]) > 20) {
      diffCount++;
    }
  }

  return sampleCount > 0 && diffCount / sampleCount > CHANGE_THRESHOLD;
}

async function startExtraction(streamId) {
  try {
    // Guard against double-start
    if (frameIntervalId !== null) {
      clearInterval(frameIntervalId);
      frameIntervalId = null;
    }

    logToBackground("Starting extraction", streamId);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    video.srcObject = stream;

    // Wait for video to be ready before starting extraction
    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener("loadeddata", onLoaded);
        resolve();
      };
      video.addEventListener("loadeddata", onLoaded);
      setTimeout(() => reject(new Error("Video load timeout")), 10000);
    });

    await video.play();
    logToBackground("Video playing, starting frame extraction");

    previousFrameData = null;

    frameIntervalId = setInterval(() => {
      try {
        if (video.readyState < 2) return; // HAVE_CURRENT_DATA

        ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

        const imageData = ctx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        if (!hasSignificantChange(imageData.data)) return;

        previousFrameData = new Uint8ClampedArray(imageData.data);

        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        const base64 = dataUrl.split(",")[1];

        chrome.runtime.sendMessage({
          type: "VIDEO_FRAME",
          data: base64,
          mimeType: "image/jpeg",
          timestamp: Date.now(),
        }).catch(() => {});
      } catch (frameErr) {
        logToBackground("Frame error", frameErr.message);
      }
    }, FRAME_INTERVAL_MS);
  } catch (error) {
    logToBackground("Failed to start extraction", error.message);
    chrome.runtime.sendMessage({
      type: "FRAME_EXTRACTION_ERROR",
      error: error.message,
    });
  }
}

function stopExtraction() {
  if (frameIntervalId !== null) {
    clearInterval(frameIntervalId);
    frameIntervalId = null;
  }

  previousFrameData = null;

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }

  logToBackground("Frame extraction stopped");
}
