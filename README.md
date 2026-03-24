<![CDATA[<div align="center">

<img src="public/assets/icons/icon128.png" alt="GhostFill" width="96" height="96" />

# GhostFill

**The invisible privacy layer for everything you sign up for.**

Disposable emails · Secure passwords · Automatic OTP fill · Local AI · 100% Free

[![Version](https://img.shields.io/badge/version-1.1.0-blueviolet?style=flat-square)](https://github.com/your-repo/ghostfill-extension)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?style=flat-square)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

## What is GhostFill?

GhostFill is a Chrome extension that acts as an invisible privacy shield for your online registrations. It generates disposable email addresses, creates cryptographically secure passwords, and — its killer feature — **automatically detects OTP codes and activation links in incoming emails and fills them into your browser without you lifting a finger.**

No account. No server. No API key. Everything runs locally.

---

## ✨ Feature Highlights

### 📬 Disposable Email Engine
- **10 email providers** wired in parallel: Mail.tm, Mail.gw, TMailor (500+ domains), Maildrop, DropMail, Guerrilla Mail, TempMail.lol, 1secmail, and your own **Custom Domain**
- **Intelligent health scoring** — every provider is scored by response time and failure rate; GhostFill auto-routes to the best available provider
- **Automatic fallback** — if your preferred provider fails, the system silently retries the next-best healthy provider with exponential backoff (up to 3 attempts)
- **Session reset on email change** — OTP cache, dedup history, and link activation queue are all wiped when you generate a fresh address
- Health check results are persisted to storage and reused for up to 1 hour to avoid cold-start delays

### 🔐 Password Generator
- Configurable length, character sets (uppercase, lowercase, numbers, symbols), ambiguous character exclusion
- Generated passwords history, copyable from the popup with one click
- Integrated into the Smart Autofill pipeline — password fields are detected and filled automatically

### 🧠 Intelligent OTP & Link Detection (5-Layer Pipeline)

GhostFill's detection engine is its most sophisticated component:

| Layer | What it does |
|---|---|
| **1. Provider Detection** | Identifies the email sender (Google, Facebook, GitHub, Qwen, etc.) for context-aware extraction |
| **2. OTP Extraction** | Multi-strategy regex, label-adjacent scanning, and position heuristics across subject + body |
| **3. Link Extraction** | Detects activation/verification URLs with CTA analysis and confidence scoring |
| **4. Cross-Validation** | If an OTP code appears embedded in the link URL, it discards the OTP and prefers the link |
| **5. Intent Classification** | Final `otp` / `link` / `both` / `none` verdict with confidence percentage |

Detection results are cached in `chrome.storage.session` encrypted with **AES-256-GCM** so repeat email checks hit memory instantly.

### 🔗 Activation Link Service
- Detected links are opened in a **silent background tab** — you never leave your current page
- URL security gate: blocks bad schemes, raw IPs, localhost, suspicious TLDs, and embedded credentials
- Code extracted from the URL's query params / path / hash is pre-saved for fallback
- Full retry queue with linear backoff (up to 2 retries) and activation history for debugging

### 👻 Floating Ghost Button
- A smart floating button appears on every web page, positioned out of the way
- Auto-detects OTP fields using multi-strategy heuristics (DOM signals, ARIA labels, framework hints)
- Manual paste, smart autofill, and real-time form detection via an internal Proactive Shadow Scanner for SPAs
- Rendered in an isolated **Shadow DOM** so page styles never bleed in

### 📋 Smart Form Autofill
- Detects email, password, username, first name, last name, phone, address, and OTP fields
- Uses **AI field classification** as the primary strategy with regex heuristics as fallback
- Framework-aware: React, Vue, Angular, and vanilla JS forms all handled correctly
- Automatically excludes banking and financial sites (Chase, BoA, Fidelity, Barclays, etc.)

### 🔔 Real-time Polling Feedback
When you fill a form and submit, GhostFill:
1. Starts fast-polling your inbox (every ~1–2 seconds)
2. Shows a **"Studying new email..."** toast on your page the moment a new message arrives
3. Injects the OTP directly or opens the activation link silently in a background tab
4. Shows **"Activation link handled in background"** so you know it worked

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION (MV3)                        │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐  │
│  │   Popup UI   │  │            Background Service Worker          │  │
│  │  (React 18)  │  │                                              │  │
│  │  ─ Identity  │  │  ┌─────────────────┐  ┌──────────────────┐  │  │
│  │  ─ Email     │  │  │ PollingManager  │  │  MessageHandler  │  │  │
│  │  ─ Inbox     │  │  │  Fast / Slow    │  │  (main router)   │  │  │
│  │  ─ Password  │  │  │  AlarmScheduler │  └──────────────────┘  │  │
│  └──────────────┘  │  └────────┬────────┘                         │  │
│                    │           │                                   │  │
│  ┌──────────────┐  │  ┌────────▼────────┐  ┌──────────────────┐  │  │
│  │  Options UI  │  │  │  SmartDetection │  │   LinkService    │  │  │
│  │  (React 18)  │  │  │  5-Layer Engine │  │  (background tab │  │  │
│  └──────────────┘  │  │  AES-256 cache  │  │   activation)    │  │  │
│                    │  └─────────────────┘  └──────────────────┘  │  │
│                    │                                              │  │
│                    │  ┌─────────────────┐  ┌──────────────────┐  │  │
│                    │  │  EmailService   │  │  StorageService  │  │  │
│                    │  │  10 providers   │  │  AES-256 encrypt │  │  │
│                    │  │  health scoring │  │  session /local  │  │  │
│                    │  └─────────────────┘  └──────────────────┘  │  │
│                    └──────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                   Content Script (every page)                  │   │
│  │   OTPPageDetector · FloatingButton · AutoFiller · FormDetector │   │
│  │   ToastFeedback (Shadow DOM) · DOMObserver · FieldWatcher      │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────┐                                                    │
│  │   Offscreen  │  ONNX Runtime Web — Local ML inference             │
│  │   Document   │  (no external API calls)                          │
│  └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Files

| Path | Role |
|---|---|
| `src/background/pollingManager.ts` | Inbox polling engine — fast/slow modes, alarm scheduler, dedup cache |
| `src/background/messageHandler.ts` | Central message router for all background↔content↔popup communication |
| `src/services/smartDetectionService.ts` | 5-layer OTP/link detection with encrypted session cache |
| `src/services/intelligentExtractor.ts` | Core extraction pipeline: provider detection, OTP, link, cross-validation |
| `src/services/linkService.ts` | Background tab activation queue with security gate and retry logic |
| `src/services/emailServices/index.ts` | 10-provider email aggregator with health scoring and auto-fallback |
| `src/services/storageService.ts` | AES-256-GCM encrypted storage with batched writes |
| `src/content/otpPageDetector.ts` | OTP field detection, auto-fill trigger, toast feedback UI |
| `src/content/floatingButton.ts` | Ghost button — Shadow DOM, SPA observer, manual override |
| `src/content/autoFiller.ts` | OTP fill pipeline: split-field, single-field, framework-aware |
| `src/services/identityService.ts` | Identity profile generation (name, address, username) |
| `src/services/passwordService.ts` | Cryptographically secure password generation and history |

---

## 🔒 Security Model

GhostFill is designed with privacy as a first-class concern:

- **No telemetry, no analytics, no remote logging** — all data stays on your device
- **AES-256-GCM encryption** on all persisted data (storage service) and detection cache (session)
- **Master key + Session key architecture** — session keys rotate on each service worker restart; master key is stored encrypted in `chrome.storage.local`
- **API keys are never persisted** — LLM keys and custom domain keys live in `chrome.storage.session` only and are cleared on extension unload
- **DOMPurify** used for all HTML rendering in content scripts to prevent XSS
- **Banking sites excluded by default** — 30+ financial institutions in the manifest `exclude_matches` list
- **URL security gate** in LinkService — validates scheme, blocks IPs, localhost, suspicious TLDs (.xyz, .top, .buzz, etc.), and embedded credentials before opening any link

---

## ⌨️ Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Open GhostFill popup | `Ctrl+Shift+E` | `Cmd+Shift+E` |
| Generate new email | `Ctrl+Shift+M` | `Cmd+Shift+M` |
| Auto-fill current form | `Ctrl+Shift+F` | `Cmd+Shift+F` |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Chrome 109+ (Manifest V3 required)

### Install & Build

```bash
# Clone the repo
git clone https://github.com/your-repo/ghostfill-extension.git
cd ghostfill-extension

# Install dependencies
npm install

# Development build (watch mode)
npm run dev

# Production build
npm run build

# Package as .zip for distribution
npm run zip
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. GhostFill appears in the toolbar

---

## 🛠️ Development

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Webpack watch (development mode) |
| `npm run build` | Production build (cleans dist first) |
| `npm run build:dev` | Development build (no watch) |
| `npm run test` | Run Vitest test suite |
| `npm run test:ui` | Vitest with browser UI |
| `npm run type-check` | TypeScript compiler check (no emit) |
| `npm run lint` | ESLint on all `.ts` / `.tsx` files |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run zip` | Bundle `dist/` into a distributable `.zip` |

### Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.3 |
| UI (Popup / Options) | React 18 + Zustand + Framer Motion |
| Icons | Lucide React |
| Validation | Zod |
| ML Inference | ONNX Runtime Web (local, no API) |
| HTML Sanitization | DOMPurify |
| Build | Webpack 5 + ts-loader |
| Testing | Vitest + jsdom |
| Linting | ESLint + Prettier + Stylelint |

### Email Providers

| Provider | Auth Type | Notes |
|---|---|---|
| **Mail.tm** | JWT token | Primary default; IMAP-quality API |
| **Mail.gw** | JWT token | Backup to Mail.tm |
| **TMailor** | None | 500+ rotating domains |
| **Maildrop** | None | GraphQL API |
| **DropMail** | Session token | GraphQL API |
| **Guerrilla Mail** | Session token | Long-lived sessions |
| **TempMail.lol** | JWT token | |
| **1secmail / TempMail** | None | Multiple domain aliases |
| **Custom Domain** | Configurable | Bring your own endpoint |

---

## 🧪 How Email Detection Works — End to End

```
New email arrives
      │
      ▼
PollingManager detects it
      │
      ▼
SmartDetectionService.detect()
  ├── DOMPurify sanitizes HTML
  ├── ProviderDetector → identifies sender brand
  ├── OTPExtractor → regex + label-adjacent
  ├── LinkExtractor → URL scoring + CTA detection
  ├── Cross-validation → discard OTP if embedded in link
  └── Final verdict: otp | link | both | none
      │
      ├─ (otp) ──→ deliverOTP() → sendMessage AUTO_FILL_OTP → content script fills field
      │                           └── ToastFeedback "✅ Filled!"
      │
      └─ (link) ─→ LinkService.handleNewEmail()
                    ├── validateUrl() security gate
                    ├── chrome.tabs.create({ active: false })
                    ├── waitForTabLoad()
                    ├── deliverCode() if URL contains embedded code
                    └── ToastFeedback "🔗 Activation link handled"
```

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Run tests: `npm run test` and type-check: `npm run type-check`
4. Commit with a clear message and open a PR

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with 👻 by Xshya · [Report an Issue](https://github.com/your-repo/ghostfill-extension/issues)

</div>
]]>
