# GhostFill

GhostFill is a Chrome extension that generates disposable email addresses, creates passwords, and helps fill verification codes during a signup flow.

It is an early build. The default package includes temporary email plus the optional Gmail/Google alias and inbox integration. It does not require a paid API, hosting account, database, domain, or Chrome Web Store listing.

![Illustrated GhostFill workflow: generate a temporary address, fill the signup form, review the inbox, and fill the verification code.](docs/assets/ghostfill-workflow.svg)

The image is an illustrative workflow diagram, not a recording. A clean local demo surface and reproducible recording procedure are in [docs/demo/RECORDING.md](docs/demo/RECORDING.md). No public recording is currently published.

## Install

There is no GitHub Release or Chrome Web Store package yet. You can [download the source](https://github.com/Xshya19/ghostfill-extension/archive/refs/heads/main.zip) and build it locally. A tagged GitHub Release will provide a verified ZIP once a maintainer creates one.

### Build from source

```bash
git clone https://github.com/Xshya19/ghostfill-extension.git
cd ghostfill-extension
npm ci
npm run type-check
npm run build:zip
```

The command creates the full-profile `ghostfill-extension-v1.1.0.zip` and a matching `.sha256` checksum in the repository root. Verify the checksum before installing:

```powershell
Get-FileHash .\ghostfill-extension-v1.1.0.zip -Algorithm SHA256
Get-Content .\ghostfill-extension-v1.1.0.zip.sha256
```

Then:

1. Extract the ZIP to a permanent folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted folder that contains `manifest.json`.

Manual installs do not receive automatic Chrome Web Store updates. Replace the extracted folder with a later verified release when one is published.

The default package requests Gmail OAuth read-only access so Google aliases and inbox sync can work. If you want a temporary-email-only package with no Google OAuth permissions, use `npm run build:public:zip` instead.

## What it does

- **Disposable email:** requests an address from one of the supported public temporary-email providers and polls its inbox.
- **Password generation:** creates a configurable password with browser cryptography and can fill it into a detected field.
- **OTP assistance:** extracts likely verification codes using deterministic text, layout, and pattern heuristics. It associates an active email session with the originating signup tab before offering a fill action.

GhostFill can also identify activation links. Automatic external-link opening is enabled by default and can be disabled under Options -> Automation. Users should still review each destination.

The extension does not guarantee that every website, provider, code format, or React form will work. Temporary-email providers are third parties and may block, rate-limit, change, or lose messages. Do not use GhostFill for banking, brokerages, password managers, sensitive accounts, or anything that needs a durable inbox.

## Privacy and permissions

The extension processes generated identities, temporary-email account state, inbox content needed for the active flow, detected verification codes, and settings in browser storage. It sends provider-specific requests to the selected temporary-email service. It does not make a disposable address a secure account boundary.

Read the project-specific details before installing:

- [Privacy policy](PRIVACY.md)
- [Permission rationale](docs/PERMISSIONS.md)
- [Security policy](SECURITY.md)

The extension manifest retains broad `http` and `https` content-script matching so it can detect signup and OTP forms. It excludes a curated list of major banking, brokerage, password-manager, and Chrome Web Store domains. Those exclusions reduce exposure but are not a substitute for user judgement.

## Gmail and Google aliases

The default build includes the Gmail integration. Open **Options → Gmail (OAuth)** to confirm the OAuth client ID, then select **Gmail** in the popup and connect your Google account. The **Aliases** button opens the site-specific Gmail alias manager; entering a domain produces the deterministic dot/plus alias used for that site.

The Gmail API uses the restricted `gmail.readonly` scope, so an unrestricted public release requires a separately reviewed OAuth client, consent-screen configuration, privacy policy, and any Google review or verification that applies at that time. See [docs/BUILD_PROFILES.md](docs/BUILD_PROFILES.md).

The restricted temporary-email-only package remains available explicitly with `npm run build:public` or `npm run build:public:zip`.

## Development

```bash
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm run bundle:check
npm run zip
```

The default `npm run build` creates the full profile. `npm run build:public` creates the restricted temporary-email-only profile, and `npm run build:full` is retained as a compatibility alias.

## Release process

GitHub Actions runs type checks, lint, tests, the full production build, and the bundle-size gate on Node.js 20 and 22. A verified `v<package-version>` tag runs the release workflow, creates the full-profile ZIP and SHA-256 file, then uses GitHub-generated release notes.

The repository currently has no published release. The exact manual process is in [docs/RELEASING.md](docs/RELEASING.md).
Maintainers should also follow the [GitHub operations and recovery guide](docs/GITHUB_OPERATIONS.md) for branch protection, Actions recovery, and dependency-update handling.

## Contributing and support

- [Contributing guide](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Security reporting](SECURITY.md)
- [Issue tracker](https://github.com/Xshya19/ghostfill-extension/issues)

GhostFill is released under the [MIT License](LICENSE).
