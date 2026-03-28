<div align="center">

<img src="public/assets/icons/icon128.png" alt="GhostFill Logo" width="96" height="96" />

# GhostFill

**The invisible privacy layer for everything you sign up for.**

*Generate disposable emails · Secure passwords · Automatic OTP fill · Local AI · 100% Free*

[![Version](https://img.shields.io/badge/version-1.1.0-blueviolet?style=flat-square&logo=semver)](https://github.com/Xshya19/ghostfill-extension/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=flat-square&logo=googlechrome)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## 🧩 What is GhostFill?

GhostFill is a **Chrome extension** that acts as your invisible privacy shield for online registrations. It generates disposable email addresses, creates cryptographically secure passwords, and — its killer feature — **automatically detects OTP codes and activation links in incoming emails and fills them into your browser without you lifting a finger.**

> No account. No server. No API key. **Everything runs locally.**

---

## ✨ Feature Highlights

<table>
<tr>
<td width="50%">

### 📬 Disposable Email Engine
10 providers wired in parallel with intelligent health scoring, automatic fallback with exponential backoff, and session-aware cache resets.

### 🔐 Password Generator
Cryptographically secure, fully configurable passwords with one-click copy and auto-injection into detected password fields.

### 🔗 Activation Link Service
Detected links are opened in a **silent background tab** — you never leave your current page. Includes a URL security gate blocking bad schemes, raw IPs, and suspicious TLDs.

</td>
<td width="50%">

### 👻 Floating Ghost Button
Sits in an isolated **Shadow DOM** on every page. Auto-detects OTP fields with multi-strategy heuristics and a Proactive Shadow Scanner for SPAs.

### 📋 Smart Form Autofill
Detects email, password, username, name, phone, address, and OTP fields. Framework-aware across React, Vue, Angular, and vanilla JS.

### 🔔 Real-time Polling Feedback
Fast-polls your inbox (~1–2 s), shows live toasts, and injects OTPs or silently handles activation links the moment an email lands.

</td>
</tr>
</table>

---

## 🧠 5-Layer OTP & Link Detection Pipeline

GhostFill's intelligence engine is its most sophisticated component. Every incoming email passes through five stages:

| # | Layer | What it does |
|---|---|---|
| **1** | **Provider Detection** | Identifies the sender brand (Google, GitHub, Facebook, Qwen…) for context-aware extraction |
| **2** | **OTP Extraction** | Multi-strategy regex, label-adjacent scanning, and position heuristics across subject + body |
| **3** | **Link Extraction** | Detects activation/verification URLs with CTA analysis and confidence scoring |
| **4** | **Cross-Validation** | If an OTP code is embedded in the link URL, the standalone OTP is discarded in favour of the link |
| **5** | **Intent Classification** | Final verdict — `otp` / `link` / `both` / `none` — with a confidence percentage |

Results are cached in `chrome.storage.session` encrypted with **AES-256-GCM** so repeat checks hit memory instantly.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CHROME EXTENSION (MV3)                        │
│                                                                      │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐  │
│  │   Popup UI   │  │            Background Service Worker         │  │
│  │  (React 18)  │  │                                              │  │
│  │  • Identity  │  │  ┌─────────────────┐  ┌──────────────────┐   │  │
│  │  • Email     │  │  │ PollingManager  │  │  MessageHandler  │   │  │
│  │  • Inbox     │  │  │  Fast / Slow    │  │   (main router)  │   │  │
│  │  • Password  │  │  │  AlarmScheduler │  └──────────────────┘   │  │
│  └──────────────┘  │  └────────┬────────┘                         │  │
│                    │           │                                  │  │
│  ┌──────────────┐  │  ┌────────▼────────┐  ┌──────────────────┐   │  │
│  │  Options UI  │  │  │ SmartDetection  │  │   LinkService    │   │  │
│  │  (React 18)  │  │  │  5-Layer Engine │  │  (background tab │   │  │
│  └──────────────┘  │  │  AES-256 cache  │  │   activation)    │   │  │
│                    │  └─────────────────┘  └──────────────────┘   │  │
│                    │                                              │  │
│                    │  ┌─────────────────┐  ┌──────────────────┐   │  │
│                    │  │  EmailService   │  │  StorageService  │   │  │
│                    │  │  10 providers   │  │  AES-256 encrypt │   │  │
│                    │  │  health scoring │  │  session / local │   │  │
│                    │  └─────────────────┘  └──────────────────┘   │  │
│                    └──────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                   Content Script (every page)                  │  │
│  │   OTPPageDetector · FloatingButton · AutoFiller · FormDetector │  │
│  │   ToastFeedback (Shadow DOM) · DOMObserver · FieldWatcher      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌──────────────┐                                                    │
│  │   Offscreen  │  ONNX Runtime Web — Local ML inference             │
│  │   Document   │  (no external API calls ever)                      │
│  └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Key Source Files

| Path | Role |
|---|---|
| `src/background/pollingManager.ts` | Inbox polling — fast/slow modes, alarm scheduler, dedup cache |
| `src/background/messageHandler.ts` | Central message router for all cross-context communication |
| `src/services/smartDetectionService.ts` | 5-layer OTP/link detection with encrypted session cache |
| `src/services/intelligentExtractor.ts` | Core extraction pipeline: provider → OTP → link → cross-validation |
| `src/services/linkService.ts` | Background tab activation queue, security gate, and retry logic |
| `src/services/emailServices/index.ts` | 10-provider aggregator with health scoring and auto-fallback |
| `src/services/storageService.ts` | AES-256-GCM encrypted storage with batched writes |
| `src/content/otpPageDetector.ts` | OTP field detection, auto-fill trigger, toast feedback UI |
| `src/content/floatingButton.ts` | Ghost button — Shadow DOM, SPA observer, manual override |
| `src/content/autoFiller.ts` | OTP fill pipeline: split-field, single-field, framework-aware |
| `src/services/identityService.ts` | Identity profile generation (name, address, username) |
| `src/services/passwordService.ts` | Cryptographically secure password generation and history |

---

## 🔒 Security Model

GhostFill is built with privacy as a **first-class requirement**, not an afterthought.

| Concern | How it's addressed |
|---|---|
| **No telemetry** | Zero analytics, zero remote logging — all data stays on your device |
| **Encrypted storage** | AES-256-GCM on all persisted data and the detection cache |
| **Rotating session keys** | Session keys reset on each service worker restart; master key is encrypted at rest |
| **API keys never persisted** | LLM / custom domain keys live in `chrome.storage.session` only — cleared on unload |
| **XSS prevention** | DOMPurify sanitises all HTML in content scripts before rendering |
| **Banking sites excluded** | 30+ financial institutions in `manifest.json` `exclude_matches` list |
| **URL security gate** | Validates scheme, blocks raw IPs, localhost, suspicious TLDs (`.xyz`, `.top`, `.buzz`) |

---

## 🧪 End-to-End Email Detection Flow

```
New email arrives
      │
      ▼
PollingManager detects it (dedup check)
      │
      ▼
SmartDetectionService.detect()
  ├── DOMPurify sanitizes HTML
  ├── ProviderDetector  → identifies sender brand
  ├── OTPExtractor      → regex + label-adjacent heuristics
  ├── LinkExtractor     → URL scoring + CTA detection
  ├── Cross-validation  → discard OTP if embedded in link
  └── Final verdict: otp | link | both | none
        │
        ├─ (otp)  ──→ deliverOTP()
        │              └── sendMessage AUTO_FILL_OTP → content script fills field
        │                  └── Toast: "✅ OTP filled!"
        │
        └─ (link) ──→ LinkService.handleNewEmail()
                       ├── validateUrl() security gate
                       ├── chrome.tabs.create({ active: false })
                       ├── waitForTabLoad()
                       ├── deliverCode() if URL contains embedded code
                       └── Toast: "🔗 Activation link handled in background"
```

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
- **Node.js** 18+
- **Chrome** 109+ (Manifest V3)

### Install & Build

```bash
# 1. Clone the repository
git clone https://github.com/Xshya19/ghostfill-extension.git
cd ghostfill-extension

# 2. Install dependencies
npm install

# 3. Start development (watch mode)
npm run dev

# 4. Production build
npm run build

# 5. Package as .zip for distribution
npm run zip
```

### Load in Chrome

1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `dist/` folder
4. GhostFill appears in your toolbar — you're ready to go!

---

## 🛠️ Development Reference

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Webpack watch (development mode) |
| `npm run build` | Production build (cleans `dist/` first) |
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
| ML Inference | ONNX Runtime Web (local — no external API) |
| HTML Sanitisation | DOMPurify |
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
| **TempMail.lol** | JWT token | — |
| **1secmail / TempMail** | None | Multiple domain aliases |
| **Custom Domain** | Configurable | Bring your own endpoint |

---

## 🤝 Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Run `npm run test` and `npm run type-check` to validate your changes
4. Commit with a clear, conventional message and open a Pull Request

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with 👻 by [Xshya19](https://github.com/Xshya19) &nbsp;·&nbsp; [Report an Issue](https://github.com/Xshya19/ghostfill-extension/issues) &nbsp;·&nbsp; [View on GitHub](https://github.com/Xshya19/ghostfill-extension)

</div>
