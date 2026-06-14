# GhostFill

GhostFill is a privacy-first Chrome MV3 extension for temporary email, Gmail aliases,
password generation, OTP detection, and smart form autofill.

The current architecture is local and heuristic-first: form classification, email
understanding, OTP extraction, activation-link detection, and safety decisions run in
the extension without sending page contents or email bodies to an external AI API.

## Key Features

- Temporary inboxes with provider failover across Mail.tm, Mail.gw, Maildrop,
  GuerrillaMail, TempMail, and related services.
- Gmail alias support through read-only Google OAuth scopes.
- Local OTP and verification-link extraction from incoming messages.
- Explainable email decision engine that decides whether to fill an OTP, open a
  link, hold for review, or ignore an email.
- Secure password generation using browser cryptography.
- Content-script autofill with Shadow DOM UI isolation.
- Background polling, SSE support where available, and notification routing.

## Architecture

```text
ghostfill-extension-main/
|-- src/
|   |-- background/      # Service worker, polling, messaging, Gmail, notifications
|   |-- content/         # DOM detection, autofill, page analysis, floating UI
|   |-- popup/           # React popup UI
|   |-- options/         # React options page
|   |-- offscreen/       # Offscreen document for clipboard/background helpers
|   |-- intelligence/    # Heuristic classifier and navigation helpers
|   |-- services/        # Email, OTP, link, storage, password, decision services
|   |-- shared/          # Shared constants and utilities
|   |-- types/           # Shared TypeScript contracts
|   `-- utils/           # Validation, logging, encryption, sanitization
|-- public/              # Locales and static extension assets
|-- scripts/             # Build, bundle, icon, and release helpers
`-- tests/               # Vitest unit and integration tests
```

## Intelligence Flow

1. The content script analyzes forms locally and classifies fields with heuristic
   signals from labels, attributes, layout, autocomplete hints, and nearby text.
2. The background poller reads new email from the selected provider.
3. `smartDetectionService` extracts OTPs and activation links through the
   intelligent extractor pipeline.
4. `emailDecisionEngine` combines extraction signals, sender/link context, current
   site domains, and URL risk signals into an explainable decision.
5. The poller and link service act only when the decision allows automation.

This replaced the older ML pipeline. The repository no longer ships local model
binaries or Python datasets.

## Development

### Prerequisites

- Node.js 18 or newer
- npm 9 or newer
- Chrome or Chromium for loading the unpacked extension

### Install

```bash
npm install
```

### Build

```bash
npm run build:dev
npm run build
```

The extension output is written to `dist/`.

### Load In Chrome

1. Open `chrome://extensions/`.
2. Enable Developer mode.
3. Select Load unpacked.
4. Choose the `dist/` directory.

## Verification

```bash
npm run type-check
npm test
npm run lint
npm run build:dev
```

## Packaging

```bash
npm run build:zip
```

This builds the extension and creates a versioned ZIP in the project root.

## Privacy Notes

- Form and email analysis is local to the extension runtime.
- Gmail support uses read-only scopes.
- Sensitive cached extension data is stored through the project storage layer and
  encrypted where supported.
- Activation links are safety-gated before automatic opening.

## License

GhostFill is open-source software licensed under the [MIT License](LICENSE).
