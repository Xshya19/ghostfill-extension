<div align="center">

<img src="public/assets/icons/icon128.png" alt="GhostFill logo" width="128" height="128" />

# GhostFill

Disposable email, password generation, and OTP assistance for Chromium browsers.

<p>
  GhostFill helps you move through sign-up and verification flows without juggling tabs, inboxes, and copy-paste steps.
</p>

[![Version](https://img.shields.io/badge/version-1.1.0-blueviolet?style=for-the-badge)](https://github.com/Xshya19/ghostfill-extension/releases)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-orange?style=for-the-badge)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)](LICENSE)

[Getting Started](#getting-started) - [Development](#development) - [Architecture](#architecture) - [Contributing](#contributing)

</div>

---

## At a Glance

| Area         | Summary                                                   |
| ------------ | --------------------------------------------------------- |
| Email        | Generates disposable inboxes from supported providers     |
| Passwords    | Creates secure passwords from saved defaults              |
| Verification | Detects OTPs and activation links from incoming email     |
| ML           | Runs local ONNX-based field classification in the browser |
| UI           | Includes popup, options, and page-level assistive flows   |

## Contents

- [Overview](#overview)
- [What GhostFill Does](#what-ghostfill-does)
- [Core Features](#core-features)
- [Supported Providers](#supported-providers)
- [Privacy and Security](#privacy-and-security)
- [Permissions](#permissions)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Packaging](#packaging)
- [Development](#development)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Known Boundaries](#known-boundaries)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Overview

GhostFill is a Chrome extension that helps with sign-up and verification flows by combining:

- disposable email generation
- strong password generation
- OTP and activation-link detection from incoming email
- browser-side form assistance
- local ML inference for field classification

The extension is designed to keep the workflow inside the browser. Instead of switching between tabs and inboxes, GhostFill can generate credentials, watch a temporary inbox, detect the verification artifact that matters, and help deliver it back into the page you are already using.

> GhostFill is designed to reduce friction in temporary email and verification workflows, not to guarantee full automation on every site.

## What GhostFill Does

GhostFill focuses on four main jobs:

1. Generate a temporary email address from a supported provider.
2. Generate a secure password based on saved defaults.
3. Monitor the temporary inbox for OTPs and verification links.
4. Assist with filling supported fields on the current page.

Depending on the email content and page context, GhostFill may:

- surface the latest OTP for manual use
- fill a detected OTP into a waiting field
- open a verification link in a new tab when link confirmation is enabled

## Core Features

### Temporary email workflow

- Supports multiple disposable email providers with provider health checks and fallback behavior.
- Saves the currently active temporary email for continued inbox polling.
- Tracks inbox state and processed messages to reduce duplicate handling.

### Password generation

- Generates passwords with configurable defaults.
- Supports options such as length, uppercase, lowercase, numbers, symbols, and ambiguous-character exclusion.
- Integrates with the extension popup and field-fill actions.

### OTP and link detection

- Reads incoming email from supported temporary inbox providers.
- Detects OTP codes and verification links from message content.
- Uses cross-validation rules to avoid treating link tokens as standalone OTPs when a link is the better action.

### Local ML-assisted classification

- Uses `onnxruntime-web` in an offscreen document.
- Runs model inference locally in the extension package.
- Helps classify form fields and verification intent without sending page data to a remote AI service.

### Browser integration

- Popup UI for inbox, password, identity, and quick actions.
- Options page for behavior, email, privacy, and advanced settings.
- Content scripts for field detection, OTP page detection, and page-level autofill assistance.

## Feature Snapshot

| Capability                  | Included |
| --------------------------- | -------- |
| Disposable inbox generation | Yes      |
| Password generation         | Yes      |
| OTP detection from email    | Yes      |
| Activation link detection   | Yes      |
| Local ML inference          | Yes      |
| Popup and options UI        | Yes      |
| Third-party analytics       | No       |

## Supported Providers

GhostFill is currently configured to work with provider integrations for:

- `mail.tm`
- `mail.gw`
- `1secmail`
- `guerrillamail`
- `tempmail`
- `maildrop`
- `dropmail`

Provider availability depends on the upstream services. GhostFill includes fallback and health-state handling, but it cannot guarantee uptime for third-party inbox providers.

## Privacy and Security

GhostFill is built to minimize unnecessary data exposure.

- No built-in analytics or tracking.
- Sensitive data is stored with encrypted storage flows where applicable.
- Session-only secrets are separated from persisted settings.
- Email HTML is sanitized before downstream processing.
- Local ML inference runs inside the extension package.
- Sensitive site categories such as common banking and password-manager domains are excluded from the default content script.

GhostFill still communicates with the disposable email providers you choose to use. That network access is required for inbox creation, polling, and message retrieval.

## Permissions

GhostFill uses the following main Chrome permissions:

- `activeTab`
- `storage`
- `clipboardWrite`
- `contextMenus`
- `alarms`
- `notifications`
- `offscreen`

It also requests host permissions for supported email-provider APIs and the Mail.tm Mercure SSE endpoint used for real-time inbox updates.

## Architecture

At a high level, the extension is split into four parts:

### 1. Background service worker

Responsible for:

- message routing
- inbox polling
- provider health checks
- OTP and link processing
- notification and alarm coordination

### 2. Content scripts

Responsible for:

- field detection
- OTP page detection
- page-level fill actions
- in-page assistive UI

### 3. Popup and options UIs

Built with React and used for:

- identity generation
- inbox inspection
- password generation
- extension settings

### 4. Offscreen ML runtime

Responsible for:

- loading the ONNX model
- running local field classification inference
- isolating ML execution from the visible UI surfaces

### Key files

| Path                               | Responsibility                                         |
| ---------------------------------- | ------------------------------------------------------ |
| `src/background/serviceWorker.ts`  | Background boot flow and phased initialization         |
| `src/background/messageHandler.ts` | Main request routing between UI/content/background     |
| `src/content/index.ts`             | Content-script bootstrap and page integration          |
| `src/content/otpPageDetector.ts`   | OTP page detection and field targeting                 |
| `src/offscreen/inferenceEngine.ts` | Local ONNX inference engine                            |
| `src/intelligence/ml/MLService.ts` | ML service integration for classification              |
| `src/utils/validation.ts`          | Runtime message validation                             |
| `manifest.json`                    | Extension capabilities, permissions, commands, and CSP |

## Project Structure

```text
ghostfill-extension-main/
|-- public/                 # static assets and locales
|-- scripts/                # build and packaging helpers
|-- src/
|   |-- background/         # service worker and background orchestration
|   |-- content/            # content scripts, page detection, autofill
|   |-- intelligence/       # ML and detection logic
|   |-- offscreen/          # offscreen document runtime
|   |-- options/            # settings UI
|   |-- popup/              # popup UI
|   |-- services/           # provider and workflow services
|   |-- types/              # shared TypeScript types
|   `-- utils/              # shared helpers
|-- manifest.json
|-- package.json
`-- webpack.config.cjs
```

## Getting Started

### Requirements

- Node.js 18 or newer
- npm
- Chrome 109+ or another Chromium browser with Manifest V3 support

### Install dependencies

```bash
npm install
```

### Development build

Watch mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

### Load the extension locally

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Packaging

Build first:

```bash
npm run build
```

Then create the zip package:

```bash
npm run build:zip
```

Note: `build:zip` packages the existing `dist/` directory. It does not run the production build automatically.

## Development

### Scripts

| Command                | Description                           |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Webpack watch build for development   |
| `npm run build`        | Production build into `dist/`         |
| `npm run build:dev`    | Development-mode build into `dist/`   |
| `npm run clean`        | Remove `dist/`                        |
| `npm run lint`         | Run ESLint                            |
| `npm run lint:fix`     | Run ESLint with fixes                 |
| `npm run type-check`   | Run TypeScript without emitting files |
| `npm run test`         | Run Vitest test suite                 |
| `npm run test:watch`   | Run Vitest in watch mode              |
| `npm run test:ui`      | Open the Vitest UI                    |
| `npm run format:check` | Run Prettier checks                   |
| `npm run zip`          | Package the current `dist/` folder    |

### Recommended local workflow

```bash
npm install
npm run lint
npm run type-check
npm run test
npm run build
```

## Keyboard Shortcuts

Configured extension commands:

| Action                  | Windows / Linux | macOS             |
| ----------------------- | --------------- | ----------------- |
| Open GhostFill          | `Ctrl+Shift+E`  | `Command+Shift+E` |
| Generate new temp email | `Ctrl+Shift+M`  | `Command+Shift+M` |
| Auto-fill current form  | `Ctrl+Shift+F`  | `Command+Shift+F` |

The `generate-password` command exists in the manifest but does not currently define a suggested default key combination.

## Known Boundaries

- GhostFill depends on third-party temporary email services, so provider outages can affect inbox generation or retrieval.
- Some sites use custom verification flows that may not expose fields in a way the content script can safely target.
- Automatic activation-link handling depends on both email structure and the target page behavior.
- The extension intentionally avoids running on a set of sensitive domains by default.

## FAQ

### Does GhostFill read my personal inbox?

No. GhostFill is designed around temporary email accounts it creates through supported providers. It does not integrate with personal Gmail, Outlook, or work mailboxes.

### Does GhostFill send form data to an AI API?

No remote AI API is required for the local ML flow shown in this repository. Model inference is packaged into the extension and runs locally through `onnxruntime-web`.

### Is every verification flow fully automatic?

No. Some flows can be partially automated, and some require manual confirmation depending on the provider, target site, and field structure.

## Contributing

Contributions are welcome. A good default workflow is:

1. Fork the repository
2. Create a branch for your change
3. Make the change with focused scope
4. Run:

   ```bash
   npm run lint
   npm run type-check
   npm run test
   npm run build
   ```

5. Open a pull request with a clear summary of the change

If you are reporting a bug, include:

- browser version
- reproduction steps
- expected behavior
- actual behavior
- relevant console or extension logs when available

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

<div align="center">

<img src="public/assets/icons/icon48.png" alt="GhostFill small logo" width="48" height="48" />

Built by [Xshya19](https://github.com/Xshya19)

</div>
