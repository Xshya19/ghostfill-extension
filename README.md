# GhostFill — Disposable Email & Automatic OTP Autofill Chrome Extension

<p align="center">
  <img src="src/assets/logo.png" alt="GhostFill Logo" width="104" height="104" />
</p>

<p align="center">
  <strong>Instant Disposable Emails · Cryptographic Passwords · Automatic OTP & Magic Link Autofill</strong><br />
  <em>The privacy-first Manifest V3 browser extension that eliminates spam, disposable email tab-hopping, and manual code entry. 100% Local Heuristics · Zero Cloud Trackers · Free & Open Source.</em>
</p>

<p align="center">
  <a href="https://github.com/Xshya19/ghostfill-extension/releases"><img src="https://img.shields.io/badge/version-1.1.0-blue?style=flat-square" alt="Version 1.1.0" /></a>
  <img src="https://img.shields.io/badge/manifest-MV3-orange?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome-109%2B-brightgreen?style=flat-square" alt="Chrome 109+" />
  <img src="https://img.shields.io/badge/typescript-5.3-blue?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/tests-977%20passing-success?style=flat-square" alt="977 Tests Passing" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs Welcome" />
</p>

<p align="center">
  <a href="#what-is-ghostfill">Overview</a> •
  <a href="#why-ghostfill">Why GhostFill?</a> •
  <a href="#core-features">Features & Providers</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture-high-level">Architecture</a> •
  <a href="#faq">FAQ</a> •
  <a href="https://github.com/Xshya19/ghostfill-extension/issues">Report Issue</a>
</p>

---

## Table of Contents

- [What is GhostFill?](#what-is-ghostfill)
- [Why GhostFill? (Feature Comparison)](#why-ghostfill)
- [Who It Is For](#who-it-is-for)
- [Core Features](#core-features)
  - [1. Disposable Temporary Emails (17+ Backends)](#1-disposable-temporary-emails)
  - [2. Gmail Scrambler (Dot & Plus Aliases)](#2-gmail-scrambler-dot--plus-aliases)
  - [3. Smart OTP Detection & Auto-Fill](#3-smart-otp-detection--auto-fill)
  - [4. Magic & Activation Links (Auto-Open in New Tab)](#4-magic--activation-links-auto-open-in-a-new-tab)
  - [5. Cryptographically Secure Password Generator](#5-secure-password-generator)
  - [6. Identity-Aware Form Fill](#6-identity-aware-form-fill)
  - [7. Floating Action Button (FAB)](#7-floating-action-button-fab)
  - [8. Options & Settings Console](#9-options-page)
  - [9. Keyboard Shortcuts](#10-keyboard-shortcuts)
- [How a Typical Flow Works](#how-a-typical-flow-works)
- [Privacy, Cryptography & Security](#privacy--security)
- [Safety Exclusions](#safety-exclusions)
- [Requirements & Browser Compatibility](#requirements)
- [Quick Start](#quick-start)
  - [Install from Pre-Built `dist/`](#install-from-a-pre-built-dist-end-users)
  - [Build from Source](#build-from-source-developers)
- [Gmail OAuth Setup (Optional)](#gmail-setup-optional)
- [Architecture & Tech Stack](#architecture-high-level)
- [Frequently Asked Questions (FAQ)](#faq)
- [Contributing & License](#contributing)

---

## What is GhostFill?

**GhostFill** is a privacy-first browser extension designed for modern web signup and authentication flows. It replaces the tedious cycle of switching tabs to copy temporary emails, generating one-off passwords, waiting for inboxes, and hunting for verification codes.

On any signup or registration page, GhostFill automatically:

1. **Generates human-like disposable emails** (or privacy-preserving Gmail dot/plus aliases).
2. **Generates cryptographically secure passwords** directly inside the password field.
3. **Monitors the mailbox in the background** without requiring you to switch tabs or open web inboxes.
4. **Extracts verification OTP codes and magic activation links** using local layout & regex heuristics.
5. **Autofills the OTP code on the page** and/or **auto-opens the activation link in a new tab**.

Everything executes locally inside your browser as a Google Chrome **Manifest V3** extension with zero server tracking and zero external telemetry.

---

## Why GhostFill?

| Feature | GhostFill | Web Temp Mail Sites | Password Managers |
| :--- | :---: | :---: | :---: |
| **In-Page Form Autofill** | ✅ **Instant One-Click** | ❌ Manual copy-paste | ⚠️ Passwords only |
| **Automatic OTP Code Extraction** | ✅ **Dual-Engine Local Heuristics** | ❌ Manual inbox reading | ❌ No temp mail OTPs |
| **Magic / Activation Link Auto-Open** | ✅ **Auto-Opens in New Tab** | ❌ Manual tab switching | ❌ Unsupported |
| **Multiple Temp Mail Backends** | ✅ **17 Public APIs + Custom + Self-Heal** | ❌ Single domain/provider | ❌ None |
| **Human-Like Username Formats** | ✅ **`first.last##` (Anti-Bot Friendly)** | ❌ Obvious random hashes | ❌ N/A |
| **Gmail Dot/Plus Alias Support** | ✅ **Built-In OAuth Search** | ❌ Not available | ❌ Unsupported |
| **Local Encryption at Rest** | ✅ **Web Crypto AES-GCM 256-bit** | ❌ Cloud-hosted inboxes | ✅ Encrypted vaults |
| **Privacy / No Cloud Account** | ✅ **100% Free & Open Source** | ⚠️ Ad-heavy trackers | ⚠️ Paid subscriptions |

---

## Who it is for

| Use case | How GhostFill helps |
| --- | --- |
| Trying a new SaaS / AI tool | Temp email so marketing mail never hits your real inbox |
| Avoiding cross-site email tracking | Gmail dot/plus aliases so each site sees a different address |
| Lazy OTP entry | Detects 4–8 digit / alphanumeric codes and fills them for you |
| Activation / magic links | Finds verify / confirm / activate links and **auto-opens them in a new tab** |
| Strong unique passwords | Local password generator with length & character options |
| Dev / QA signups | Fast identity + email + password + OTP loop |

**Not for:** banking, brokerages, or password-manager sites. GhostFill deliberately does **not** inject on major banks, brokerages, and password managers (see [Safety exclusions](#safety-exclusions)).

---

## Core features

### 1. Disposable temporary emails

Generate a throwaway address and use it on signup forms.

- **Human-Like Username Generator**: Automatically creates realistic human email prefixes (`sarah.mitchell92`, `james.wilson`, `d.johnson47`) across all supported providers instead of suspicious random alphanumeric text.
- Multiple public temp-mail backends (auto-selected by health and benchmark performance)
- Provider **self-heal**: if one API is down or slow, GhostFill tries the next
- Inbox polling in the background while you wait for verification
- Preferred provider can be set in **Options → Email**

**Supported services (18 built-in public providers + Custom Domain + Real Mailbox Alias engines, ordered by health & priority):**

| Provider | Service Key | Primary Domain(s) | Human Names | Highlights |
| --- | --- | --- | --- | --- |
| **Driftz.net** | `driftz` | `bbjbinin.mn` *(default)*, `manornewtech.org` | ✅ Yes | 🛡️ **Primary Default** · Anti-disposable blocklist bypass (`.mn`, `.org`) |
| **CatchMail.io** | `catchmail` | `catchmail.io` | ✅ Yes | ⚡ **Fast (939ms avg)** & 7-Day Retention |
| **Throwawaymail.app** | `throwawaymail` | `throwawaymail.app` | ✅ Yes | 🚀 Fast REST API & Instant delivery |
| **Tempmail.plus** | `tempmailplus` | `tempmail.plus`, `mailto.plus`, `fexbox.org` | ✅ Yes | Multi-domain alias support with PIN lock |
| **Mail.tm** | `mailtm` | Dynamic API domains | ✅ Yes | High-reliability REST API with JWT Auth |
| **Mail.gw** | `mailgw` | Dynamic API domains | ✅ Yes | Dedicated domain pool & JWT Auth |
| **Guerrilla Mail** | `guerrilla` | `guerrillamail.com`, `sharklasers.com`, `grr.la`, `pokemail.net`, +6 more | ✅ Yes | **10 Stealth Domains** (sharklasers, grr.la) |
| **Maildrop** | `maildrop` | `maildrop.cc` | ✅ Yes | Apollo GraphQL API & 24h retention |
| **1secmail** | `tempmail` / `1secmail` | `1secmail.com`, `1secmail.net`, `1secmail.org`, `kzccv.com`, +5 more | ✅ Yes | 9 public domains |
| **MailboxTemp** | `mailboxtemp` | `mailboxtemp.com` | ✅ Yes | Fast REST API & 24h retention |
| **Dropmail.me** | `dropmail` | `dropmail.me`, `emlpro.com`, +2 more | ✅ Yes | GraphQL API & 4 rotating domains |
| **GetNada / Inboxes** | `getnada` | `getnada.com`, `nada.ltd`, `inboxes.com`, `clic2load.com` | ✅ Yes | 4 multi-TLD domain options |
| **TempMail.lol** | `tempmaillol` | `tempmail.lol`, `disposable.com` | ✅ Yes | REST API v2 integration |
| **OpenInbox.io** | `openinbox` | `openinbox.io` | ✅ Yes | Webhook-ready for fast OTP extraction |
| **EvilMail.pro** | `evilmail` | `evilmail.dev`, `evilmail.pro` | ✅ Yes | REST API with customizable message TTL |
| **Mail.cx** | `mailcx` | `mail.cx` | ✅ Yes | Real-time SSE streaming & 24h retention |
| **Mailinator** | `mailinator` | `mailinator.com` | ✅ Yes | Public inbox generator & REST parser |
| **Mailnesia** | `mailnesia` | `mailnesia.com` | ✅ Yes | Public inbox with automated RSS parser |
| **Custom Domain** | `custom` | *User-defined* | ✅ Yes | Private Cloudflare Worker / self-hosted API |

### 2. Real Inbox Aliases (Gmail, Zoho Mail & Microsoft Outlook)

Optional. Connect your real email accounts once and generate site-specific plus/dot aliases that land directly in your real inbox while keeping your address private and tracking-resistant.

| Provider | Alias Format | OAuth Integration | Inbox Polling |
| :--- | :--- | :--- | :--- |
| **Gmail** | `u.s.e.r+tag@gmail.com` | Google Identity (`gmail.readonly`) | ✅ Gmail REST API |
| **Zoho Mail** | `user+ghostfill-tag@zoho.com` | Zoho OAuth 2.0 (Auto-detects US/EU/IN/AU/JP/CN) | ✅ Zoho Mail REST API |
| **Microsoft Outlook** | `user+ghostfill-tag@outlook.com` | Microsoft Identity (`Mail.Read`) | ✅ Microsoft Graph API |

**How real inbox aliases work:**

- **Gmail:** Combines dot variations + plus suffixes (`j.o.h.n+github@gmail.com`).
- **Zoho Mail:** Uses plus tags with automatic regional endpoint detection (`user+ghostfill-brand@zoho.com`).
- **Microsoft Outlook:** Uses plus tags with Microsoft Graph search for `@outlook.com`, `@hotmail.com`, `@live.com`, and `@msn.com`.
- **OTP Auto-Detection:** Background service worker monitors the inbox for incoming messages delivered to that specific alias, extracts the verification OTP or magic link, and auto-fills it directly on your signup tab.
- **Privacy & Security:** Tokens are stored in ephemeral session storage (`chrome.storage.session`) and never written to disk unencrypted. Zero passwords stored.

Connecting real accounts is **completely optional**. Disposable temporary emails work immediately with zero setup.

### 3. Smart OTP detection & auto-fill

When a site asks for a verification code:

1. Background polling watches the active email account (temp or Gmail alias)
2. Dual extraction engines scan the message:
   - **Cognitive / layout** — bold text, tables, prominent digit groups
   - **Heuristic / pattern** — code-like tokens; filters years, prices, phone fragments, noise
3. When a confident OTP is found, GhostFill delivers it to the tab that started the flow
4. Content script fills the OTP field (including multi-box and React-controlled inputs when possible)
5. Floating button (FAB) turns green so you can also click-to-fill

**Settings:** Options → Automation → **Auto-fill OTP**

### 4. Magic / activation links (auto-open in a new tab)

Many services send “Verify email” / “Confirm account” buttons instead of (or in addition to) numeric OTPs.

GhostFill:

- Scores candidate URLs (verify, confirm, activate, magic link, etc.)
- When a confident activation link is found, **opens it automatically in a new browser tab** so the account is verified without you hunting the email
- Tracks that tab as an “activation tab” so OTP delivery still targets your original signup page
- Still fills OTPs if both a code and a link appear in the same mail

**On by default.** Toggle under Options → Automation → **Auto-open verification links** (`autoConfirmLinks`).

### 5. Secure password generator

Local cryptographically-backed generator (browser crypto). Defaults are configurable:

- Length (8–128)
- Uppercase / lowercase / numbers / symbols
- Filled into password fields via FAB, popup, or shortcut

**Settings:** Options → Password

### 6. Identity-aware form fill

GhostFill can generate a lightweight identity profile (name / username style fields) and keep email + password consistent for a session so multi-step signups do not thrash values.

### 7. Floating action button (FAB)

On supported pages, a compact control appears near email / password / OTP fields:

| State | Meaning |
| --- | --- |
| Idle | Ready to generate or fill |
| Pulsing blue | Working — generating, waiting for mail, extracting |
| Green | OTP / value ready — click to fill |

Uses a Shadow DOM style isolation so site CSS is less likely to break the UI.

### 8. Popup control panel (Hub)

Click the toolbar icon (or `Ctrl+Shift+E`) for:

- **Complete Email Address Visibility:** Zero truncation — smart wrapping displays long usernames while keeping domain tags (e.g. `@bbjbinin.mn`) fully visible and highlighted in brand indigo. Single-click copy directly on the email badge.
- **Instant Identity & Password Generation:** One-click generate / refresh with Driftz.net as primary default, plus instant password generator & copy.
- **Safe Sandboxed Mailbox Viewer:** Live email preview with automated broken image/tracking pixel suppression and presentation-layer OTP & verification link safety net.
- **Provider Hub:** Quick-toggle between Disposable Temp Mail and Real Inboxes (Gmail, Zoho Mail, Microsoft Outlook) with uniform provider iconography (soft-rounded squircle for Zoho).
- **Navigation:** Seamless tabs for identity hub, alias tracking, full email viewer, and settings.

### 9. Options page

Full settings in a separate tab (`options.html`):

| Tab | What you configure |
| --- | --- |
| **General** | Theme mode (Dark, Light, System Auto), check interval (3–60s), history retention (1–365 days), audio alert cues |
| **Email** | Preferred email provider (18 backends + custom, Driftz.net default), Live Provider Health Monitor (latency & circuit breakers), custom API endpoint, OAuth Client credentials (Gmail, Zoho, Microsoft Outlook) |
| **Password** | Default length (8–128), character sets (uppercase, lowercase, numbers, symbols), exclude ambiguous characters (`l`, `1`, `O`, `0`) |
| **Automation** | Auto-fill OTP on active tab, auto-open verification/magic links in new tab (`autoConfirmLinks`), keyboard shortcut toggles |
| **Privacy** | Form data tracking prevention, Web Crypto AES-GCM local storage encryption, storage quota manager & pruning |
| **Advanced** | Custom field classification rules, session secrets manager (in-memory LLM / custom API keys), raw storage viewer & export, debug logging level |
| **About** | Version info (v1.1.0), live storage usage breakdown, GitHub repository links, architecture & tech stack specifications |

### 10. Keyboard shortcuts

| Shortcut (Windows / Linux) | Mac | Action |
| --- | --- | --- |
| `Ctrl+Shift+E` | `⌘+Shift+E` | Open GhostFill popup |
| `Ctrl+Shift+M` | `⌘+Shift+M` | Generate new temp email |
| `Ctrl+Shift+G` | `⌘+Shift+G` | Generate password |
| `Ctrl+Shift+F` | `⌘+Shift+F` | Auto-fill current form |

Customize under `chrome://extensions/shortcuts`.  
Toggle shortcuts in Options → Automation.

### 11. Context menus, notifications, clipboard

- Right-click context menu actions where registered
- Desktop notifications when codes/links are found (Chrome notifications permission)
- One-click copy for email, password, and OTP

---

## How a typical flow works

```text
You open a signup page
        │
        ▼
FAB / popup / shortcut → generate email + password
        │
        ▼
You submit the form → site sends verification mail
        │
        ▼
Background service worker polls inbox (temp provider or Gmail API)
        │
        ▼
Dual extractors find OTP and/or verification link
        │
        ▼
OTP delivered to the waiting tab → content script fills field
   and/or activation link opens in a **new tab** (on by default)
        │
        ▼
You continue signup — real inbox never saw the spam
```

**Important details under the hood:**

- Waiters are registered for the tab that requested verification so the OTP returns to the right page
- Domain matching prefers delivering codes to the site that started the session
- Activation links open via `chrome.tabs.create` in a **new tab** (not the current page)
- Activation tabs are excluded from OTP routing so codes still go to the signup tab
- Content scripts re-inject when needed if the page was a heavy SPA
- Banking / PM sites are excluded at the manifest level

---

## Privacy & security

### What GhostFill does right

| Principle | Practice |
| --- | --- |
| No GhostFill account | No signup to use the extension |
| Local processing | OTP / link extraction runs in the extension / browser |
| Optional Gmail only | Gmail OAuth is opt-in; scope is read-only mail + basic profile |
| Encrypted local storage | Sensitive values use browser crypto APIs before storage |
| No ads / no built-in product analytics trackers | Product is free OSS |
| Fintech exclusion list | Content script does not run on major banks / brokers / PMs |

### What you should still know (honest)

- **Temp-mail providers** can read messages they host. Do not use disposable mail for accounts that protect real money, government IDs, or long-term recovery.
- **Gmail OAuth** grants the extension permission to **read** Gmail messages (for OTP search). Only connect accounts you trust on this machine. Revoke anytime in [Google Account → Security → Third-party access](https://myaccount.google.com/permissions).
- **Local encryption** protects data at rest in extension storage better than plain text, but a compromised OS / profile can still be attacked. GhostFill is not a full password manager substitute for Bitwarden / 1Password.
- **Loaded unpacked** builds use a fixed extension ID only if you pin one; Chrome Web Store / packed IDs differ — Gmail OAuth redirect URIs must match **your** extension ID.

---

## Safety exclusions

GhostFill content scripts **do not run** on (among others):

- Major US / UK / CA / AU banks and brokerages (Chase, BofA, Wells Fargo, Citi, Capital One, Schwab, Fidelity, HSBC, etc.)
- Password managers (1Password, LastPass, Dashlane, Bitwarden, Keeper, …)
- Chrome Web Store / `chrome.google.com` pages

Full list lives in `manifest.json` → `content_scripts.exclude_matches`.

---

## Requirements

- **Google Chrome**, **Edge**, **Brave**, **Opera**, or another Chromium browser
- Chrome **109+** (Manifest V3)
- For developers: **Node.js** 18+ recommended, npm

---

## Quick start

### Install from a pre-built `dist/` (end users)

1. Get the project (clone or download ZIP) and ensure a `dist/` folder exists (build it if not — see below).
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the **`dist`** folder (not the repo root)
6. Pin GhostFill from the puzzle-piece menu

Reload the extension after every rebuild.

### Build from source (developers)

```bash
# Clone
git clone https://github.com/Xshya19/ghostfill-extension.git
cd ghostfill-extension

# Install dependencies
npm install

# Production build → ./dist
npm run build

# Optional: watch mode while developing
npm run dev

# Optional: package zip
npm run build:zip
```

| Script | Purpose |
| --- | --- |
| `npm run build` | Clean + production Webpack build (`dist/`) |
| `npm run build:dev` | Clean + development Webpack build |
| `npm run dev` | Webpack watch mode (auto-rebuild on file changes) |
| `npm test` | Vitest unit & integration test suites (960+ tests) |
| `npm run test:watch` | Vitest interactive test watcher |
| `npm run test:ui` | Vitest browser UI test runner |
| `npm run type-check` | TypeScript strict type validation (`tsc --noEmit`) |
| `npm run lint` | ESLint static analysis for TypeScript & React |
| `npm run lint:fix` | ESLint automated code fixing |
| `npm run format:check` | Prettier code style validation |
| `npm run eval` | Local heuristic & ML intelligence benchmark evaluation |
| `npm run logs` | Local debug log collector server |
| `npm run clean` | Clean and remove `dist/` directory |
| `npm run zip` | Package `dist/` folder into distributable zip |
| `npm run build:zip` | Production build and zip package |

Then **Load unpacked** → `dist/`.

---

## Gmail setup (optional)

Use this only if you want **Gmail aliases + inbox OTP** from your real Gmail.

### 1. Create a Google Cloud OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Gmail API**
4. Configure **OAuth consent screen** (External is fine for personal use; add your Google account as a test user while in Testing)
5. Create credentials → **OAuth client ID** → Application type: **Chrome Extension** (or Web application if you use web auth flow)
6. For Chrome Extension type, set the **Item ID** to your extension ID from `chrome://extensions/`

### 2. Redirect / origin for unpacked extensions

Your extension ID is shown on `chrome://extensions/` (Developer mode).  
Typical Chrome identity redirect shape:

```text
https://<EXTENSION_ID>.chromiumapp.org/
```

Add that URI where Google Cloud asks for authorized redirect URIs (web client style).

### 3. Put the Client ID into GhostFill

1. Open GhostFill **Options** → **Email**
2. Paste **Google OAuth Client ID** (`….apps.googleusercontent.com`)
3. Save
4. Open the popup → **Connect Gmail** and complete the consent screen

### 4. Scopes requested

- `gmail.readonly` — search and read messages for OTPs / links  
- `userinfo.email` / `userinfo.profile` — show which account is connected  

GhostFill does **not** request send-mail scope.

### Troubleshooting Gmail

| Symptom | Likely fix |
| --- | --- |
| Invalid client / blocked | Client ID wrong, or extension ID not registered in Cloud Console |
| Works once then fails | Clear site data for Google auth, reconnect; ensure only one auth path is used |
| No OTP from Gmail | Confirm alias mode is active; mail may be in Spam; alias must match what you typed on the form |
| Consent screen “app not verified” | Expected for personal Testing apps — continue as the test user you added |

The repo ships a default `oauth2.client_id` in `manifest.json` for Chrome `getAuthToken`. For local/dev builds you should use **your own** Client ID tied to **your** extension ID (Options → Email is the right place for a custom ID).

---

## Day-to-day usage

### Signup with temp email

1. Focus the email field on the site  
2. Click the FAB → generate temp email (or `Ctrl+Shift+M`)  
3. Generate password for the password field  
4. Submit the form  
5. When mail arrives:
   - **OTP** → green FAB / auto-fill on the signup tab  
   - **Activation link** → opens automatically in a **new tab** (if enabled)  
6. Finish signup  

### Signup with Gmail alias

1. Connect Gmail once in the popup  
2. Switch preferred mode to Gmail / alias  
3. Generate alias for the site and paste/fill into the form  
4. Wait — GhostFill searches Gmail for the verification message  
5. OTP fills on the signup tab, and/or activation link opens in a **new tab**  

### Manual inbox

Open the popup Hub → inbox list / full inbox to read messages, copy codes, or open links yourself if auto-fill / auto-open is off.

---

## Architecture (high level)

```text
┌─────────────────────┐     messages     ┌──────────────────────────┐
│  Content script     │ ◄──────────────► │  Service worker (BG)     │
│  FAB, form detect,  │                  │  polling, Gmail, OTP     │
│  OTP fill, SPA fix  │                  │  delivery, health mgmt   │
└─────────────────────┘                  └────────────┬─────────────┘
                                                      │
         ┌──────────────────┬─────────────────────────┼──────────────┐
         ▼                  ▼                         ▼              ▼
   Temp mail APIs     Gmail API (OAuth)      chrome.storage        Popup / Options
   (17+ providers)    readonly search        encrypted secrets     React + Zustand
```

| Area | Tech |
| --- | --- |
| **UI** | React 18, Zustand 5, Framer Motion 12, Lucide React, "Spectre" Design Tokens |
| **Build & Platform** | Webpack 5, TypeScript 5, Chrome Manifest V3 |
| **Extraction Engine** | Local dual-engine heuristics (Cognitive layout + Regex patterns) & ML benchmark |
| **Security & Validation** | Web Crypto API (AES-GCM 256-bit, PBKDF2), Zod 4 schemas, DOMPurify |
| **Tests & QA** | Vitest (36 test suites, 977 tests passed) |
| **i18n** | Chrome i18n (`public/_locales` with English & Spanish) |

Key source folders:

```text
src/
  background/     Service worker, polling manager, SSE streams, notifications, message broker
  content/        Floating Action Button (Shadow DOM), form detection, OTP autofill
  frontend/       Modern React frontend application
    popup/        Popup toolbar control panel (Hub, Email, Passwords, History)
    options/      Full-page options & settings dashboard
    ui/           Shared Spectre design system UI components & motion presets
    styles/       Global stylesheets and design tokens (globals.css)
  services/       Email providers (18 backends + custom + Gmail/Zoho/Outlook), extraction, passwords, encrypted storage
  intelligence/   Local cognitive heuristics, intent scoring models, eval benchmark
  offscreen/      Offscreen document manager for safe DOM parsing & audio cues
  shared/         Theme engine, design tokens, field classification
  types/          Strict TypeScript definitions & message contracts
  utils/          Web Crypto encryption, sanitization, validation pipeline, logger, core helpers
```

---

## FAQ

**Is GhostFill free?**  
Yes. MIT licensed, no subscription, no ads.

**Do I need a Google account?**  
No. Temp email works immediately. Gmail is optional.

**Does GhostFill send my emails to its servers?**  
There is no GhostFill cloud inbox. Temp providers host disposable mail (third party). Gmail stays between your browser and Google APIs.

**Why did OTP extract work but the field stay empty?**  
Common on heavy SPAs: the field may mount late, use React controlled inputs, or the tab was not registered as the waiter. Reload the page after loading the latest `dist/`, keep the signup tab focused, and try the green FAB. Check the service worker console for delivery logs.

**Why “sandboxed environment” in the console?**  
On pages with strict storage restrictions, GhostFill falls back to an in-memory path so it keeps working instead of crashing.

**Can I use this on my bank?**  
Intentionally no — those domains are excluded.

**Which browser?**  
Chromium-based browsers that support MV3 extensions (Chrome, Edge, Brave, Opera, etc.).

**Can I change the temp mail provider?**  
Yes — Options → Email → preferred service. Health manager may still fail over if the preferred one is unhealthy.

**How do I report a bug?**  
[GitHub Issues](https://github.com/Xshya19/ghostfill-extension/issues) — include site domain (if shareable), whether temp vs Gmail, and service worker / content console snippets.

---

## Project status

| Item | Value |
| --- | --- |
| Version | **1.1.0** |
| Manifest | **V3** |
| License | **MIT** |
| Repository | [Xshya19/ghostfill-extension](https://github.com/Xshya19/ghostfill-extension) |

---

## Contributing

We welcome contributions to GhostFill! This project is open source under the MIT License and accepts pull requests for:

- New **temporary email provider** integrations (see `src/services/emailServices/`)
- Improvements to **OTP extraction heuristics** and **activation link detection** (see `src/services/extraction/`)
- **Browser compatibility** fixes for Chromium-based browsers (Chrome, Edge, Brave, Opera)
- **Privacy and security** enhancements
- **i18n / internationalization** for additional languages (currently: English `en`, Spanish `es`)

### Development Setup

1. Fork and clone the repository: `git clone https://github.com/Xshya19/ghostfill-extension.git`
2. Install dependencies: `npm install`
3. Start watch mode: `npm run dev`
4. Load `dist/` as an **unpacked extension** in `chrome://extensions/` (Developer mode)
5. Run tests: `npm test` (36 test suites, 977 tests, Vitest)
6. Type-check: `npm run type-check` (strict TypeScript)
7. Prefer small, focused pull requests with a clear problem statement

Please do not commit secrets (OAuth client secrets, personal tokens). Client IDs for public Chrome apps are less sensitive than client secrets — still avoid committing private production secrets.

---

## Related Projects & Alternatives

If GhostFill isn't what you're looking for, here are related tools in the space:

| Tool | Type | Key Difference |
| --- | --- | --- |
| [Temp Mail sites](https://temp-mail.org) | Web App | Browser tab-switching required; no autofill |
| [10 Minute Mail](https://10minutemail.com) | Web App | 10-minute TTL; no OTP extraction |
| [SimpleLogin](https://simplelogin.io) | Email Forwarding | Real forwarding aliases; not disposable |
| [AnonAddy](https://anonaddy.com) | Email Forwarding | Privacy-first aliases; not temp inboxes |
| [Bitwarden](https://bitwarden.com) | Password Manager | Passwords only; no temp email or OTP autofill |

**GhostFill's edge**: All-in-one in-browser solution — temp inbox + OTP autofill + password generation without switching tabs.

---

## Disclaimer

GhostFill is provided as-is for privacy convenience and productivity. You are responsible for how you use disposable emails and for complying with each website’s terms of service. Do not use GhostFill to evade legal identity requirements, commit fraud, or abuse third-party mail systems.

---

## License

MIT — see [`LICENSE`](LICENSE).

---

<p align="center">
  Built for people who are tired of spam, weak passwords, and tab-hopping for OTPs.
</p>
