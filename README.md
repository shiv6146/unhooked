# Unhooked — AI-Powered Social Feed Agent

> **Chrome extension that scrolls your social feeds in the background, captures content via Gemini Vision, and generates intelligent digests.**

Built for the [Gemini Live Agent Challenge](https://ai.google.dev/competition).

---

## Quick Start (Local)

### 1. Start the Backend

```bash
cd server
uv venv && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env   # paste your GEMINI_API_KEY
python main.py          # starts on http://localhost:8080
```

### 2. Load the Extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin Unhooked to your toolbar

### 3. Use It

1. Navigate to Twitter / Instagram / Reddit / LinkedIn
2. Click the Unhooked icon → **Start**
3. Browse freely — the agent scrolls, extracts, and analyzes in the background
4. Click **Stop** or wait for the timer — a digest is generated automatically

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension                                         │
│                                                           │
│  Popup UI ←──→ Service Worker ←──→ Content Script         │
│  (controls)     (orchestrator)     (scroll + extract)     │
│                       │                                   │
│                       ▼                                   │
│              FastAPI Backend (localhost:8080)              │
│              ├─ /analyze  (Gemini Vision)                 │
│              └─ /digest   (Gemini Summarization)          │
└──────────────────────────────────────────────────────────┘
```

### Extension (Chrome MV3)

| File | Role |
|------|------|
| `background.js` | Service worker — session management, screenshot capture, backend communication |
| `content.js` | Content script — scrolling, post extraction, video capture, AI action execution |
| `popup/` | User interface — start/stop, settings, digest viewer |
| `agent/` | Ambient status page |

### Server (Python FastAPI)

| File | Role |
|------|------|
| `main.py` | FastAPI entry point with `/health`, `/analyze`, `/digest` routes |
| `app/gemini.py` | Gemini 2.0 Flash vision integration — decodes base64 screenshots, returns actions |
| `app/agent.py` | Orchestrator — action planning + digest generation |

---

## Features

- **Automated scrolling** with human-like behavior (variable timing, pauses, back-scrolling)
- **Gemini Vision analysis** — screenshots sent to Gemini 2.0 Flash for intelligent navigation
- **AI-powered digests** — session summaries with topics and sentiment via Gemini
- **Video recording** — optional tab recording saved to Downloads
- **Scheduled sessions** — recurring runs via `chrome.alarms`
- **Multi-platform** — Twitter/X, Instagram, Reddit, LinkedIn, Facebook
- **Privacy-first** — screenshots go to *your* backend, not a third party

---

## Supported Sites

| Platform | Selector Strategy |
|----------|------------------|
| Twitter / X | `article[data-testid="tweet"]` |
| Instagram | `article` |
| Reddit | `shreddit-post` |
| LinkedIn | `.feed-shared-update-v2` |
| Facebook | `[role="article"]` |
| Other | Generic `article` fallback |

---

## Configuration

Settings are accessible via the popup ⚙️ button:

| Setting | Default | Notes |
|---------|---------|-------|
| Duration | 5 min | Session length |
| Scroll Speed | 2000 ms | Delay between scrolls |
| Scroll Amount | 400 px | Pixels per scroll |
| Video Capture | Off | Records visible tab |
| Scheduling | Off | Auto-run at intervals |
| Schedule Interval | 120 min | Time between auto-runs |

---

## Development

### Extension

```bash
# Make changes → reload in chrome://extensions/ → test
# Background logs: chrome://extensions/ → Inspect service worker
# Content logs: F12 on the scrolled page
# Popup logs: right-click icon → Inspect popup
```

### Server

```bash
cd server
source .venv/bin/activate
python main.py  # auto-reloads on save with uvicorn
```

### Adding a New Site

1. Add hostname detection in `content.js` → `detectSite()`
2. Create a selector function (post, text, author, timestamp, link, image, video)
3. Reload extension and test

---

## Project Structure

```
unhooked/
├── extension/              # Chrome extension (load this as unpacked)
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup/
│   ├── agent/
│   └── icons/
├── server/                 # FastAPI backend
│   ├── main.py
│   ├── app/
│   │   ├── agent.py
│   │   └── gemini.py
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── infrastructure/         # Pulumi IaC (for Cloud Run deployment)
├── LICENSE
└── README.md               # this file
```

---

## License

MIT — see [LICENSE](LICENSE).
