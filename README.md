<div align="center">

<img src="public/assets/icons/icon128.png" alt="GhostFill Logo" width="128" height="128" />

# 👻 GhostFill

**The ultimate invisible privacy layer for your digital identity.** <br>
_Generate disposable emails · Secure passwords · Automatic OTP fill · Local AI Inference · 100% Free_

[![Version](https://img.shields.io/badge/version-1.1.0-blueviolet?style=for-the-badge&logo=semver)](https://github.com/Xshya19/ghostfill-extension/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=for-the-badge&logo=googlechrome)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

[**Install GhostFill**](#-getting-started) • [**Report a Bug**](https://github.com/Xshya19/ghostfill-extension/issues) • [**Request Feature**](https://github.com/Xshya19/ghostfill-extension/issues)

</div>

---

<details open>
<summary><h2>📑 Table of Contents</h2></summary>

- [🧩 What is GhostFill?](#-what-is-ghostfill)
- [✨ Killer Features](#-killer-features)
- [🧠 The 5-Layer Intelligence Engine](#-the-5-layer-intelligence-engine)
- [🏗️ Architecture Deep Dive](#️-architecture-deep-dive)
- [🔒 Privacy & Security Model](#-privacy--security-model)
- [🧪 How It Works: The Magic Flow](#-how-it-works-the-magic-flow)
- [🚀 Getting Started](#-getting-started)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [❓ FAQ](#-faq)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

</details>

---

## 🧩 What is GhostFill?

GhostFill is a **Next-Gen Chrome Extension** that acts as your invisible privacy shield. Are you tired of giving away your personal email and switching tabs back and forth just to hunt for an OTP code?

GhostFill handles the entire sign-up lifecycle seamlessly:

1. **Generates** a disposable email on the fly.
2. **Creates** a cryptographically secure password.
3. **Automatically detects** OTP codes and activation links in incoming emails.
4. **Fills** them right into your browser without you breaking a sweat!

> 🛡️ **Zero Tracking. No Telemetry. Open Source.** GhostFill processes everything locally in your browser — it connects only to the email provider APIs you choose.

---

## ✨ Killer Features

GhostFill isn't just a basic email generator. It's an intelligent AI-backed local assistant.

<table>
<tr>
<td width="50%">

### 📬 Resilient Email Engine

Powered by 7 independent, highly-vetted providers running in parallel. GhostFill features **intelligent health scoring**, automatic fallback mechanisms with exponential backoff, and AES-encrypted session-aware cache resets. Never lose an inbox.

### 🔐 Unhackable Passwords

Generate cryptographically impregnable passwords tailored to standard requirements. One-click copy, history logs, and instant auto-injection into detected application password fields.

### 🔗 Silent Activation Service

Say goodbye to "Click here to verify". Detected link activations are dynamically opened in a **silent background tab**—meaning you stay right exactly where you are. It ships with a powerful URL gatekeeper that blocks suspicious TLDs and bad schemes.

</td>
<td width="50%">

### 👻 The Floating Ghost

Your ever-present companion. Sits safely isolated within a **Shadow DOM** on every webpage. Watches for OTP requirements using aggressive multi-strategy heuristics and a Proactive Shadow Scanner custom-built for modern SPAs.

### 💎 Premium Fluid UI

The entire frontend is powered by a custom **mass-spring-damper physics engine (Framer Motion)**. Enjoy liquid-smooth spatial routing, hardware-accelerated glassmorphism, and satisfying micro-interactions that feel natively integrated into your OS.

### 📋 Smart Form Autofill

A framework-aware form scanner designed to handle React, Vue, Angular, and Vanilla JS forms cleanly. Automatically injects standard fields, usernames, and dynamic OTP boxes.

### 🔔 Lightning Fast Polling

No delayed emails. GhostFill rapidly polls your active inboxes (~5–10s cycle time), alerting you with non-intrusive toasts, and executing OTP injection quickly after the email hits your inbox!

</td>
</tr>
</table>

---

## 🧠 The 5-Layer Intelligence Engine

GhostFill's Crown Jewel is its deeply sophisticated intelligence engine. Every single email is processed through **Five Stages of Deep Analysis**:

|  Stage   | Name                      | Operations Performed                                                                          |
| :------: | ------------------------- | --------------------------------------------------------------------------------------------- |
| 🔍 **1** | **Provider Detection**    | Determines contextual brand sender (e.g. Google, GitHub, Amazon).                             |
| 🧩 **2** | **OTP Extraction**        | Deploys multi-strategy regex, adjacent-label parsing, & ML position heuristics.               |
| 🔗 **3** | **Link Extraction**       | Scrapes for activation/verification URLs with call-to-action (CTA) confidence scoring.        |
| ⚖️ **4** | **Cross-Validation**      | Intelligently negates standard OTPs if embedded directly inside a verification link.          |
| 🎯 **5** | **Intent Classification** | Emits a final normalized verdict (`otp` / `link` / `both` / `none`) with accuracy confidence. |

_Results are instantly cached directly into `chrome.storage.session` and hardware-encrypted using **AES-256-GCM** to ensure zero performance lag during repeat checks._

---

## 🏗️ Architecture Deep Dive

GhostFill’s complex workflow is highly modular, split between background service workers, decoupled content scripts, and specialized offscreen AI documents.

<details>
<summary><b>Click to expand the Architecture Diagram</b></summary>
<br>

```text
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
│                    │  │  7 providers    │  │  AES-256 encrypt │   │  │
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
│  │   Document   │  (never makes an external API call!)               │
│  └──────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

</details>

<details>
<summary><b>Key Source Files</b></summary>
<br>

| Path Focus                              | Primary Responsibility                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `src/background/pollingManager.ts`      | Handles multi-speed polling modes, smart dedup caching, and alarm scheduling.  |
| `src/services/smartDetectionService.ts` | The brains of the 5-layer pipeline; utilizes AES-encrypted local cache logic.  |
| `src/services/linkService.ts`           | Securely manages hidden background tabs for silent, seamless email activation. |
| `src/services/emailServices/index.ts`   | Aggregates and maintains our heavy 7-provider email strategy.                  |
| `src/content/otpPageDetector.ts`        | Listens for inputs needing OTP codes.                                          |
| `src/offscreen/inferenceEngine.ts`      | Local execution environment for ONNX AI models to find forms & OTP intents!    |

</details>

---

## 🔒 Privacy & Security Model

We care about your data so much that **we don't want it.** GhostFill handles security at the architectural base level.

✅ **Zero Telemetry**: No tracking pixels, Google Analytics, or shady logs. Your device is the only source of truth. <br>
✅ **Military-Grade Encryption**: `AES-256-GCM` encryption wraps your settings, persistent data, and cache blocks. <br>
✅ **Rotating Session Keys**: Fresh cryptographic keys are spun up each time your browser restarts. Your master key sits fully encrypted at rest. <br>
✅ **Hardened Execution**: DOMPurify vigorously scrubs all email HTML bodies against XSS attacks before reading them. <br>
✅ **Safeguarded Zones**: Over 30 major financial domain platforms are heavily walled-off (`exclude_matches`) out-of-the-box. <br>
✅ **The URL Gatekeeper**: Refuses to launch links involving raw IP addresses, localhost injections, or spam domains (`.xyz`, `.top`, `.buzz`).

---

## 🧪 How It Works: The Magic Flow

Ever wondered what happens under the hood when you hit "Send OTP"?

```text
1️⃣  New Email Hits the Provider!
        │
2️⃣  Background PollingManager snags it instantly (skipping duplicates).
        │
3️⃣  SmartDetectionService rips the email apart locally:
      ├── DOMPurify cleans dangerous markup.
      ├── The ProviderDetector figures out who sent it.
      ├── OTPExtractor pulls possible OTP numbers via Regex.
      ├── LinkExtractor pulls the Activation button via CTA tags.
      └── The engine makes a final verdict: (It's an OTP!).
        │
4️⃣  The GhostFill Ghost receives a background message via `AUTO_FILL_OTP`.
        │
5️⃣  The Ghost injects it directly into the input field you're staring at!
        │
6️⃣  🎉 BOOM! Success Toast shows! You didn't even leave the tab!
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: v18 or higher
- **Browser**: Chrome v109+ (or any Chromium browser supporting Manifest V3)

### 🛠️ Local Installation & Build

<details>
<summary><b>Show Step-by-Step Installation</b></summary>
<br>

1. **Clone the Source Code**

   ```bash
   git clone https://github.com/Xshya19/ghostfill-extension.git
   cd ghostfill-extension
   ```

2. **Install all necessary Node modules**

   ```bash
   npm install
   ```

3. **Spin up Development Watch Mode (Hot Reloading)**

   ```bash
   npm run dev
   ```

4. **Build it for Production!**

   ```bash
   npm run build
   ```

5. **Package into a Deployable Extension**
   ```bash
   npm run zip    # Generates a fresh distribute file from dist/
   ```

</details>

### 💻 Load it into your Browser

1. Open your browser and head to `chrome://extensions/`.
2. Toggle the **Developer mode** switch (Usually top-right).
3. Click the **Load unpacked** button.
4. Select the inner `dist/` folder.
5. Watch the ghost magically appear in your toolbar! 🎈

---

## ⌨️ Keyboard Shortcuts

Speed up your workflow and never let your hands leave the keyboard!

| Action               | Windows / Linux                                   | macOS                                            |
| -------------------- | ------------------------------------------------- | ------------------------------------------------ |
| Open GhostFill Panel | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>E</kbd> |
| Blast a New Email    | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> |
| Autofill Field!      | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> | <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> |

---

## ❓ FAQ

<details>
<summary><b>Can it read my personal emails?</b></summary>
No! GhostFill ONLY has access to the temporary disposable emails it dynamically generates for you. It never touches your actual personal or work inboxes.
</details>

<details>
<summary><b>Why do you need an ONNX inference engine?</b></summary>
To guarantee complete zero-trust privacy! GhostFill houses a local ML pipeline to intelligently find complex form fields instead of sending your screen data to a cloud API.
</details>

<details>
<summary><b>Is GhostFill entirely free?</b></summary>
Yes, 100% free and open-source! Our temporary email partners are fully integrated via open APIs without paid keys. 
</details>

---

## 🤝 Contributing

We love builders helping builders! If you see bugs or want some cool enhancements:

1. Fork the repo!
2. Create your own feature branch: `git checkout -b feat/your-awesome-feature`
3. Make sure things pass! Run `npm run test` and `npm run type-check`.
4. Commit your awesome work with a detailed message.
5. Open up a PR and we'll take a look!

---

## 📄 License

GhostFill is protected and fully open-source under the MIT License — see [LICENSE](LICENSE) for the legal details.

---

<div align="center">

<img src="public/assets/icons/icon48.png" alt="GhostFill Tiny Logo" width="48" height="48" />

**Built with 👻 and ☕ by [Xshya19](https://github.com/Xshya19)**  
[Report an Issue](https://github.com/Xshya19/ghostfill-extension/issues) &nbsp;·&nbsp; [Leave a Star! ⭐](https://github.com/Xshya19/ghostfill-extension)

<br>

<p align="center">
  <i>If you love GhostFill, consider leaving a star on the repository!</i>
</p>

</div>
