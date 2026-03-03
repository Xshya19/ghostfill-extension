# 👻 GhostFill — Privacy Suite for the Web

<div align="center">

![GhostFill Banner](https://img.shields.io/badge/👻_GhostFill-Privacy_Suite_v1.1-7c5cfc?style=for-the-badge&labelColor=0f0f1a)

[![GitHub stars](https://img.shields.io/github/stars/Xshya19/ghostfill-extension?style=for-the-badge&logo=github&color=yellow)](https://github.com/Xshya19/ghostfill-extension/stargazers)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_18-20232A?flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Webpack 5](https://img.shields.io/badge/Webpack_5-8DD6F9?flat-square&logo=webpack&logoColor=black)](https://webpack.js.org/)

**🛡️ Disposable emails · Secure passwords · Automatic OTP detection & fill — 100% local, 100% free.**

[Features](#-features) • [Installation](#-installation) • [Usage](#-usage) • [Architecture](#-architecture) • [Security](#-security)

</div>

---

## ✨ Features

### 📧 Temporary Email Engine
- Generate unlimited disposable email addresses instantly
- **8 providers supported:** Mail.gw (default), Mail.tm, Maildrop, 1secmail, Guerrilla Mail, DropMail, TempMail.lol, Tmailor
- Automatic provider health-checking — falls back to a working provider if one is down
- Real-time inbox polling every 10 seconds (configurable)
- Persistent email across browser sessions

### 🔐 Secure Password Generator
- Cryptographically secure via the **Web Crypto API** (never `Math.random()`)
- Configurable length (4–128 chars), character sets (upper, lower, numbers, symbols)
- "Avoid ambiguous characters" mode (`I`, `l`, `1`, `O`, `0`)
- Password strength meter with estimated crack time
- Preset templates: Standard · Strong · PIN · Passphrase

### 🔢 Automatic OTP Detection & Fill
- **Local AI engine** — extracts verification codes from emails with no external API required
- Supports 4–8 digit numeric codes, alphanumeric tokens, and magic links
- **PhantomTyper**: simulates real keystrokes to fill OTP into fields (not clipboard paste)
- Fills codes directly in the **current tab** — no new tabs opened for OTP input
- Multi-field OTP input support (e.g. 6 separate single-digit boxes)

### 👻 GhostLabel 3.0 — Smart Inline Icons
- Spatial glass icons appear **inside** input fields (email, password, OTP, username)
- Hover animations, entry/exit animations, 5 visual states (idle · loading · success · error · otp-ready)
- Powered by `IntersectionObserver` + `MutationObserver` + `requestAnimationFrame` for pixel-perfect tracking
- Full dark mode and `prefers-reduced-motion` support
- Works on React, Vue, Angular, and custom auth UIs (including React Aria components)

### 🤖 Smart Floating Button
- Context-aware menu appears near focused input fields
- Detects page type: login / signup / OTP / verification / generic
- Tracks fields through scroll, resize, and SPA navigation
- Reconnects automatically if the DOM is mutated by a framework

### ⌨️ Keyboard Shortcuts
| Shortcut | Action |
|---|---|
| `Ctrl+Shift+E` | Open GhostFill popup |
| `Ctrl+Shift+M` | Generate new temp email |
| `Ctrl+Shift+G` | Generate new password |
| `Ctrl+Shift+F` | Auto-fill current form |

---

## 🚀 Installation

### Load from Source (Recommended for Development)

```bash
# 1. Clone the repo
git clone https://github.com/Xshya19/ghostfill-extension.git
cd ghostfill-extension/GhostFill-extension

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build
```

Then in Chrome:
1. Open `chrome://extensions/`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select the **`dist/`** folder

> ✅ **No API key required.** All OTP extraction uses the built-in local AI engine.

### Development with Watch Mode

```bash
npm run dev
```

Watches for file changes and rebuilds automatically. Reload the extension in `chrome://extensions/` after each build.

---

## 📖 Usage

### 1. Generate a Temporary Email
- Click the 👻 GhostFill icon in the browser toolbar
- A disposable email is shown on the main screen
- Click 📋 to copy, or 🔄 to generate a new one

### 2. Auto-Fill Forms
- Visit any sign-up form — GhostFill detects the fields automatically
- A ghost icon (👻) appears inside email, password, username, and OTP fields
- Click the icon to fill that field instantly

### 3. Automatic OTP Codes
- Sign up on a website using your temp email
- GhostFill monitors your inbox in the background
- When a code arrives, it's shown as a green badge in the popup
- The code is also automatically typed into the OTP field on the page (via PhantomTyper)

### 4. Activation Links
- When a verification link is found in an email, GhostFill opens it in the **current tab**
- No extra tabs opened unless the link explicitly requires it

### 5. Right-Click Context Menu
- Right-click any text field → **GhostFill** menu
- Quick actions: Fill email · Fill password · Copy OTP

---

## 🏗️ Architecture

```
GhostFill-extension/
├── src/
│   ├── background/          # Service worker (Chrome Extension background)
│   │   ├── serviceWorker.ts   # Boot & lifecycle
│   │   ├── messageHandler.ts  # Popup ↔ content ↔ services routing
│   │   ├── pollingManager.ts  # Inbox polling scheduler
│   │   ├── notifications.ts   # Desktop notification triggers
│   │   ├── contextMenu.ts     # Right-click menu UI
│   │   └── offscreenManager.ts
│   │
│   ├── content/             # Injected into web pages
│   │   ├── floatingButton.ts  # Context-aware floating action button
│   │   ├── autoFiller.ts      # Form field detection & auto-fill engine
│   │   ├── phantomTyper.ts    # Human-like keystroke simulation
│   │   ├── fieldAnalyzer.ts   # Input field classification
│   │   ├── otpPageDetector.ts # OTP page pattern detection
│   │   └── ui/
│   │       └── GhostLabel.ts  # GhostLabel 3.0 — inline field icons
│   │
│   ├── popup/               # React extension popup
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Hub.tsx           # Landing dashboard
│   │   │   ├── EmailGenerator.tsx
│   │   │   ├── PasswordGenerator.tsx
│   │   │   ├── OTPDisplay.tsx
│   │   │   └── Header.tsx
│   │   └── hooks/               # useEmail, useOTP, usePassword, useStorage
│   │
│   ├── services/            # Business logic (framework-agnostic)
│   │   ├── emailServices/     # 8 provider integrations
│   │   ├── extraction/        # Link + OTP extraction pipeline
│   │   ├── storageService.ts  # AES-256-GCM encrypted storage
│   │   ├── smartDetectionService.ts  # Local AI OTP classifier
│   │   ├── cryptoService.ts
│   │   ├── identityService.ts
│   │   ├── passwordService.ts
│   │   └── linkService.ts     # Activation link handler
│   │
│   ├── options/             # Extension settings page
│   ├── types/               # TypeScript type definitions
│   └── utils/               # Logging, crypto, messaging, validation
│
├── dist/                    # Built extension (load this in Chrome)
├── public/                  # Static assets
├── _locales/en/             # i18n strings
└── manifest.json            # Chrome Extension Manifest V3
```

---

## 🔒 Security

| Feature | Implementation |
|---|---|
| Password generation | Web Crypto API (`crypto.getRandomValues`) — never `Math.random()` |
| Storage encryption | AES-256-GCM with PBKDF2 key derivation |
| API keys | Stored in `chrome.storage.session` only — never persisted to disk |
| Shadow DOM | Floating button and GhostLabel isolated from page styles |
| No tracking | Zero analytics, zero external telemetry |
| Clipboard OTP | Clipboard NOT used for OTP fill — PhantomTyper types directly |
| CSP | Strict `script-src 'self'` — no `eval`, no remote scripts |
| Sensitive logging | All logs automatically redact emails, passwords, and OTPs |

---

## 🌐 Email Providers

| Provider | API | Status |
|---|---|---|
| **Mail.gw** (default) | REST + JWT | ✅ Primary |
| **Mail.tm** | REST + JWT | ✅ Active |
| **1secmail** | REST | ✅ Active |
| **Maildrop** | REST | ✅ Active |
| **Guerrilla Mail** | REST | ✅ Active |
| **DropMail** | GraphQL | ✅ Active |
| **TempMail.lol** | REST | ✅ Active |
| **Tmailor** | REST | ✅ Active |

All providers are automatically health-checked. GhostFill switches to the next available provider if the selected one goes offline.

---

## ⚠️ Known Limitations

Some websites actively block disposable email domains. This affects **all** disposable email tools, not just GhostFill.

| ✅ Works well on | ❌ May be blocked on |
|---|---|
| Newsletter signups | Amazon, eBay |
| Free trials & demos | Banks, PayPal |
| One-time verifications | Netflix, Spotify |
| Forum & community signups | Some social media |
| Dev & testing environments | Government portals |

> 💡 **Tip:** For sites that block disposable emails, try [SimpleLogin](https://simplelogin.io/) or [Firefox Relay](https://relay.firefox.com/) for email aliasing.

---

## 🛠️ Scripts

| Command | Description |
|---|---|
| `npm run build` | Production build → `dist/` |
| `npm run dev` | Development build with file watcher |
| `npm run lint` | Run ESLint |
| `npm run format` | Format code with Prettier |
| `npm run build:zip` | Package `dist/` as a `.zip` for Chrome Web Store |

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

Made with ❤️ · Built for privacy · Powered by open source

</div>
