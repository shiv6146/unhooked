# Unhooked — Demo Video Script

**Target Duration**: 3-4 minutes  
**Format**: Screen recording with voiceover  
**Goal**: Show the complete user journey in a way that makes judges think "I need this"

---

## Opening Hook (0:00 - 0:15)

**Visual**: Split screen — left shows a timer counting "2h 31m spent scrolling today", right shows a social media feed blurring past.

**Voiceover**: "The average person spends 2.5 hours a day scrolling social media. 87% of that content is noise. What if AI could scroll for you — and just tell you what matters?"

**Text overlay**: "Introducing Unhooked"

---

## Problem Setup (0:15 - 0:30)

**Visual**: Quick cuts of different social feeds (TikTok, Twitter, Reddit) with highlighted ads, memes, irrelevant content.

**Voiceover**: "You scroll because you're afraid of missing something. But most of what you see is ads, memes, and content that doesn't match your interests. Unhooked changes that."

---

## Onboarding (0:30 - 0:50)

**Visual**: Screen recording of the extension popup onboarding flow.

1. Show the "Stop scrolling. Start living." welcome screen → click "Get Started"
2. Paste API key → click "Verify Key" → green checkmark
3. Select interest chips: "AI & Tech", "Cooking" → click "Start Curating"

**Voiceover**: "Setup takes 10 seconds. Enter your Gemini API key, pick your interests, and you're ready."

---

## Mission Brief (0:50 - 1:05)

**Visual**: Show the Mission Brief screen with goal set.

1. Goal: "AI news, startup funding, cooking recipes"
2. Add session instruction: "Also look for EU AI Act posts"
3. Select "3 min" duration
4. Click "Start Curating"

**Voiceover**: "Before each session, set your curator goal and optional instructions. The AI knows exactly what to look for."

---

## The Magic — Live Session (1:05 - 2:30) ⭐ CENTERPIECE

**Visual**: Screen recording of TikTok/Twitter with the popup open showing live session.

**This is the most important section. Show:**

1. **Auto-scrolling starts** — page begins scrolling automatically
2. **Status changes** — "Scrolling through your feed..." → "Slowing down..." → "Paused. Reading closely..."
3. **Live action feed** — show the colored badges (PAUSE, SCROLL, SKIP, SLOW) appearing in real-time
4. **Observation preview** — show the latest observation text updating live: "I see content from @CookingWithCaitlin about Quick 30-Min Meals..."
5. **Scroll behavior adapting** — the page visibly pauses on cooking content, speeds past ads
6. **Stats ticking** — elapsed timer counting, posts and observations incrementing

**Voiceover**: "Watch the AI work. It's streaming your feed through the Gemini Live API in real-time. When it spots something matching your interests — it pauses. Ads and noise? Skipped instantly. You can see every decision in the live feed."

**Key moment**: Highlight when the agent pauses on a highly relevant post — show the PAUSE badge appear and the observation text fill in.

---

## Digest Reveal (2:30 - 3:10) ⭐ PAYOFF

**Visual**: Click "Stop Session" → wait for digest to load → show the full digest view.

1. **TL;DR card**: "Looks like a great mix today! Found a bunch of funny videos and trending content, plus some solid cooking ideas for you."
2. **Must-Read cards**: Show 2-3 cards with titles, sources, agent notes
3. **Worth a Look**: Show brief items
4. **Skimmed Past**: "47 posts: Ads (12), Memes (18), Other (17)"
5. **Time Saved**: "Saved ~7 min this session"
6. **Noise bar**: "81% noise" with animated bar
7. **Token usage**: "6,279 tokens (~$0.0009)"

**Voiceover**: "In 3 minutes, the agent scanned 59 posts and found 10 must-reads. It saved you 7 minutes of scrolling. 81% of your feed was noise. And it cost less than a tenth of a cent."

---

## Session History (3:10 - 3:25)

**Visual**: Switch to Digests tab showing multiple sessions.

1. Show "11 sessions · 37m saved · 322 posts scanned"
2. Click on a past session → it expands inline
3. Show the inline digest with TL;DR and must-reads

**Voiceover**: "Every session is saved. Over time, you see patterns — how much of your feed is noise, what topics dominate, how much time you're reclaiming."

---

## Architecture Slide (3:25 - 3:45)

**Visual**: Architecture diagram from the README.

**Voiceover**: "Under the hood: we capture your tab as video, stream frames to the Gemini Live API via WebSocket, receive spoken observations through audio transcription, parse them into scroll commands, and generate a rich digest using generateContent. All running locally in a Chrome extension — no backend needed."

**Text overlay**: Highlight "Gemini Live API", "bidiGenerateContent", "@google/genai SDK"

---

## Closing (3:45 - 4:00)

**Visual**: Return to the popup showing "Stop scrolling. Start living."

**Voiceover**: "Unhooked. Your time is worth more than scrolling. Let AI do it for you."

**Text overlay**: GitHub repo URL, "Built with Gemini Live API"

---

## Recording Tips

1. **Use a clean browser profile** — no bookmarks bar, minimal extensions
2. **Pre-load TikTok Explore or Twitter** with real content visible
3. **Use a 1080p screen recording** at 30fps
4. **Add subtle background music** — something ambient/techy
5. **Keep voiceover conversational**, not corporate
6. **Speed up the waiting parts** (digest generation) in post-production
7. **Highlight key moments** with subtle zoom-ins or border glows
8. **Show the extension icon in the toolbar** with the green "ON" badge during the session
