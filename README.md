# GhostFill

<p align="center">
  <img src="src/assets/logo.png" alt="GhostFill Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>Disposable emails · Secure passwords · Automatic OTP & magic-link fill</strong><br />
  Privacy-first Chrome extension. Runs locally. No cloud account. Free & open source.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/manifest-MV3-orange?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/chrome-109%2B-brightgreen?style=flat-square" alt="Chrome 109+" />
  <img src="https://img.shields.io/badge/license-MIT-yellow?style=flat-square" alt="MIT License" />
  <img src="https://img.shields.io/badge/price-free-success?style=flat-square" alt="Free" />
</p>

<p align="center">
  <a href="https://github.com/Xshya19/ghostfill-extension">GitHub</a> ·
  <a href="https://github.com/Xshya19/ghostfill-extension/issues">Report a bug</a> ·
  <a href="#quick-start">Quick start</a>
</p>

---

## What is GhostFill?

**GhostFill** is a browser extension for signup and login flows where you do not want to burn your real email, retype strong passwords, or hunt OTPs in another tab.

On a normal signup page it can:

1. Generate a **temporary / disposable email** (or a scrambled Gmail alias)
2. Generate a **strong password**
3. Watch the inbox for the verification message
4. Extract the **OTP** or **activation link**
5. **Auto-fill** the code on the page, and/or **auto-open the activation link in a new tab**

Everything runs as a Chrome Manifest V3 extension. Email extraction and form filling happen in your browser. There is no GhostFill backend account and no analytics tracker baked into the product.

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

- Multiple public temp-mail backends (auto-selected by health)
- Provider **self-heal**: if one API is down or slow, GhostFill tries the next
- Inbox polling in the background while you wait for verification
- Preferred provider can be set in **Options → Email**

**Supported services (built-in):**

| Provider | Service key |
| --- | --- |
| Mail.tm | `mailtm` |
| Driftz | `driftz` |
| Mail.gw | `mailgw` |
| Maildrop | `maildrop` |
| Guerrilla Mail | `guerrilla` |
| TempMail | `tempmail` |
| 1secmail | `1secmail` |
| Custom domain (advanced) | `custom` |

> Public temp-mail providers are third-party. Availability, retention, and abuse policies are theirs — GhostFill only integrates their APIs and switches when health checks fail.

### 2. Gmail scrambler (dot & plus aliases)

Optional. Connect Gmail once and generate site-specific aliases that still land in **your** Gmail inbox.

**How Gmail aliases work:**

- Gmail ignores dots in the local part: `j.oh.n@gmail.com` → same as `john@gmail.com`
- Gmail supports plus tags: `john+github@gmail.com` → still delivered to `john@gmail.com`
- GhostFill can combine both so sites see different strings while you keep one inbox

**What the extension does after connect:**

- Creates a deterministic or session alias for the current site
- Searches only recent mail relevant to that alias session
- Extracts OTP / links from those messages
- Never needs your Gmail password inside GhostFill UI — uses OAuth (`gmail.readonly` + basic profile scopes)

Connecting Gmail is **optional**. Temp email works with zero Google setup.

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

- Current email account card
- Generate / refresh email
- Password generate & copy
- Inbox preview
- Temp email vs Gmail alias mode
- Gmail connect / disconnect
- Navigation to aliases, history, full inbox views

### 9. Options page

Full settings in a separate tab (`options.html`):

| Tab | What you configure |
| --- | --- |
| General | Core behavior preferences |
| Email | Preferred provider, custom domain, Gmail OAuth Client ID |
| Password | Generator defaults |
| Automation | Auto-fill OTP, auto-open activation links in a new tab, keyboard shortcuts |
| Privacy | Privacy-related toggles |
| Advanced | Power-user options |
| About | Version, storage usage, links, stack |

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
| `npm run build` | Clean + production webpack build |
| `npm run build:dev` | Clean + development build |
| `npm run dev` | Webpack watch (development) |
| `npm test` | Vitest unit / integration tests |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript `--noEmit` |
| `npm run zip` | Zip the `dist` folder |
| `npm run build:zip` | Build then zip |

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
┌─────────────────────┐     messages      ┌──────────────────────────┐
│  Content script     │ ◄──────────────► │  Service worker (BG)     │
│  FAB, form detect,  │                  │  polling, Gmail, OTP     │
│  OTP fill, SPA fix  │                  │  delivery, health mgmt   │
└─────────────────────┘                  └────────────┬─────────────┘
                                                      │
         ┌──────────────────┬─────────────────────────┼──────────────┐
         ▼                  ▼                         ▼              ▼
   Temp mail APIs     Gmail API (OAuth)      chrome.storage        Popup / Options
   (multi-provider)   readonly search        encrypted secrets     React + Zustand
```

| Area | Tech |
| --- | --- |
| UI | React 18, Zustand, Framer Motion, Lucide |
| Build | Webpack 5, TypeScript, MV3 |
| Extraction | Local dual-engine heuristics (no paid LLM required) |
| Tests | Vitest |
| i18n | `public/_locales` (en, es) |

Key source folders:

```text
src/
  background/     Service worker, polling, messages, notifications
  content/        FAB, form detection, OTP fill
  popup/          Control panel UI
  options/        Settings pages
  services/       Email providers, Gmail, extraction, passwords, storage
  intelligence/   Page analysis / eval tooling
  utils/          Encryption, messaging, validation
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

1. Fork and clone  
2. `npm install`  
3. `npm run dev` or `npm run build`  
4. Load `dist/` unpacked  
5. Prefer small, focused PRs with a clear problem statement  

Please do not commit secrets (OAuth client secrets, personal tokens). Client IDs for public Chrome apps are less sensitive than client secrets — still avoid committing private production secrets.

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
