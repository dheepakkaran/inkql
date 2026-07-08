# inkQL

> **A query language written in ink.**
> Handwrite. Ask. The magic answers.

```
ink → vision → answer
```

A handwritten Q&A oracle for iPad, powered by Google Gemini Vision. Write a
question with Apple Pencil on an aged parchment; the ink dissolves into golden
embers, and the answer materializes character-by-character in an elegant serif
hand. Designed to feel like a modern Harry Potter grimoire.

---

## Stack

- **Frontend** — Vanilla HTML / CSS / ES modules · `perfect-freehand` for
  Apple-Pencil-quality strokes · Cinzel + Cormorant Garamond serifs · custom
  particle-fire dissolve rendered on a 2D canvas
- **Backend** — Express (local dev) / Vercel serverless functions (prod) ·
  shared logic in `lib/magic-book.js`
- **AI** — Google Gemini 2.5 Pro (vision mode by default; OCR.space + text
  Gemini as an optional fallback)
- **Deploy** — Vercel edge (static + serverless) · GitHub push-to-deploy

## Features

- Apple Pencil handwriting with pressure sensitivity
- Realistic fire dissolve — embers with buoyancy, motion-blur trails, smoke
  wisps, cross-flash sparks
- Character-by-character golden ink reveal for answers
- Multi-page responses for long context (sentence-boundary paging)
- Rate-limited API (15/min, 100/day per IP)
- Sanitized errors (magical messages, no stack traces to client)
- PWA-ready (`apple-mobile-web-app-capable`, iOS meta tags)

## Setup (local)

```bash
# 1. Get a Gemini key: https://aistudio.google.com/apikey
# 2. Copy env template and paste your key
cp .env.example .env
# edit .env → set GEMINI_API_KEY

# 3. Install + run
npm install
npm run dev
```

Open `http://localhost:3000` on your laptop.

### Test on iPad (same Wi-Fi)

```bash
ipconfig            # find your laptop's IPv4 (e.g. 192.168.0.10)
```

On iPad Safari, open `http://192.168.0.10:3000`. Allow Node.js through Windows
Firewall the first time it prompts.

## Deploy

Push to GitHub, import into [Vercel](https://vercel.com/), set env vars:

| Variable          | Value                                      |
| ----------------- | ------------------------------------------ |
| `GEMINI_API_KEY`  | your key                                   |
| `GEMINI_MODEL`    | `gemini-2.5-pro`                           |
| `TRUST_PROXY`     | `1`                                        |
| `OCR_PROVIDER`    | `gemini`                                   |
| `ALLOWED_ORIGIN`  | `https://<your-app>.vercel.app` *(after first deploy)* |

`vercel.json` routes `/api/*` to the serverless function and `/` to the
static bundle in `public/`.

## Structure

```
inkql/
├── api/
│   └── ask.js              # Vercel serverless entry
├── lib/
│   └── magic-book.js       # shared Gemini + validation + error mapping
├── public/
│   ├── index.html
│   ├── app.js              # canvas, dissolve, reveal, paging
│   └── style.css           # dark theme, gold accents, parchment
├── server.js               # local dev (Express + rate limiting)
├── vercel.json
└── package.json
```

## Roadmap

- [x] Phase 1 — Gemini text
- [x] Phase 2 — Canvas + Apple Pencil
- [x] Phase 3 — Vision OCR + answer
- [x] Phase 4 — Magic UI (fire dissolve, char reveal, multi-page)
- [x] Phase 5a — Security hardening (rate limit, CORS, sanitized errors)
- [ ] Phase 5b — Vercel deploy + PWA manifest
- [ ] Phase 6 — Q&A history (localStorage)
- [ ] Phase 7 — Ambient sound (page flip, quill scratch, chime)
- [ ] Phase 8 — Palm rejection + Pencil hover preview
