# Unhooked — AI Feed Curator

> **Stop scrolling. Start living.**  
> Unhooked is a Chrome extension that uses Google's Gemini Live API to scroll your social media feed in real-time, observe content through AI vision, and deliver a curated digest of what actually matters — so you never have to scroll yourself.

<p align="center">
  <img src="extension/icons/icon128.png" alt="Unhooked Logo" width="80"/>
</p>

## The Problem

The average person spends **2.5 hours per day** scrolling social media, yet only **~13% of content** matches their interests. The rest is ads, memes, and noise. Users feel compelled to scroll "just in case" they miss something important.

## The Solution

Unhooked is a **read-only AI agent** that:
1. **Watches your feed** through real-time video streaming via the Gemini Live API
2. **Adaptively scrolls** — pausing on interesting content, speeding past ads and noise
3. **Generates a curated digest** — a casual, skimmable summary of what the agent found
4. **Tracks your time saved** — proving the value with noise percentage and time metrics

The agent is **completely read-only** — it can only scroll. It cannot like, save, follow, post, comment, or interact with any element on the page.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────────────┐
│  Chrome Tab  │────>│  Offscreen   │────>│   Gemini Live API     │
│  (Feed)      │     │  Document    │     │   (bidiGenerateContent)│
│              │     │  1 FPS JPEG  │     │   WebSocket            │
└──────┬───────┘     └──────────────┘     └───────────┬───────────┘
       │                                               │
       │  SCROLL_COMMAND                    Audio transcript
       │  (PAUSE/SLOW/FAST/DOWN/UP)        (outputAudioTranscription)
       │                                               │
┌──────▼───────┐     ┌──────────────┐     ┌───────────▼───────────┐
│  Content     │<────│  Background  │<────│   NLP Parse           │
│  Script      │     │  Service     │     │   transcript → scroll │
│  Scroll SM   │     │  Worker      │     │   commands            │
└──────────────┘     └──────┬───────┘     └───────────────────────┘
                            │
                            │ Session End
                            ▼
                     ┌──────────────┐     ┌───────────────────────┐
                     │  Digest Gen  │────>│   gemini-2.5-flash    │
                     │  (generateContent) │   (text-only)         │
                     └──────┬───────┘     └───────────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Popup UI    │
                     │  Rich Digest │
                     │  + History   │
                     └──────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Live Video Analysis** | Gemini Live API (`bidiGenerateContent`) via `@google/genai` JS SDK |
| **Model (Real-time)** | `gemini-2.5-flash-native-audio-preview-12-2025` |
| **Model (Digest)** | `gemini-2.5-flash` via `generateContent` |
| **Extension** | Chrome Manifest V3 (service worker, offscreen document, content script) |
| **Tab Capture** | `chrome.tabCapture` → offscreen canvas → JPEG frames at 1 FPS |
| **Google Cloud** | Gemini API on `generativelanguage.googleapis.com` |

## Key Features

- **Gemini Live API integration** — Real-time WebSocket connection streams video frames and receives spoken observations via `outputAudioTranscription`
- **Adaptive scroll state machine** — 5 states (NORMAL/SLOW/PAUSED/FAST/UP) with auto-resume timeouts
- **Natural language observation parsing** — Extracts scroll commands from the model's spoken analysis
- **Rich digest generation** — TL;DR, Must-Read cards, Worth-a-Look items, Skimmed Past categories, noise percentage
- **Live action feed** — Real-time scroll decisions visible in the popup during sessions
- **Session history & analytics** — Cumulative time saved, noise rate, session count
- **Token usage tracking** — Per-session token count and estimated cost
- **BYOK (Bring Your Own Key)** — API key stays local, only sent to Google's API endpoint

## Setup

### Prerequisites
- Google Chrome 116+
- A Google Gemini API key ([get one free](https://aistudio.google.com/apikey))

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/shiv6146/unhooked.git
   cd unhooked
   ```

2. **(Optional)** Pre-configure your API key:
   ```bash
   export GEMINI_API_KEY="your-key-here"
   bash setup_env.sh
   ```

3. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (top right)
   - Click **Load unpacked** → select the `extension/` folder

4. Navigate to any social media feed and click the Unhooked icon to start curating.

### Supported Sites
Twitter/X, Reddit, Instagram, LinkedIn, Facebook, TikTok, Hacker News, BBC, CNN, Reuters, TechCrunch, The Verge, and any website with scrollable content.

## How It Works

1. **Onboarding** — Enter your Gemini API key and set your curator goal (e.g., "AI news, startups")
2. **Mission Brief** — Optionally add session-specific instructions and choose duration (3/5/10 min)
3. **Start Curating** — The agent connects via the Gemini Live API, captures your tab as video, and begins adaptive scrolling
4. **Real-time Analysis** — Gemini watches the feed and narrates observations. The extension parses these into scroll commands (pause on interesting content, skip ads)
5. **Digest** — After the session, a rich digest is generated with Must-Read highlights, Worth-a-Look items, noise breakdown, and time saved

## Hackathon

Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) (Feb 16 - Mar 16, 2026).

**Category**: Live Agents — Real-time interaction (audio/vision)

**Google Cloud Services Used**:
- Gemini Live API (`bidiGenerateContent` via WebSocket) — real-time video analysis
- Gemini API (`generateContent`) — digest generation
- Google GenAI JS SDK (`@google/genai`)

## License

MIT
