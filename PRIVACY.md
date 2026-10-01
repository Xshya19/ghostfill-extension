# GhostFill Privacy Policy

Last updated: 2026-09-19

GhostFill is a browser extension. This policy describes the default full build in this repository, which includes optional Gmail/Google alias and inbox features. The explicitly named `build:public` profile is temporary-email-only.

## Information processed

To provide its features, GhostFill processes generated identity values, generated passwords, the temporary email address and account state for a selected provider, message metadata and content needed to show an inbox, detected OTPs and activation links, settings, and signup-tab routing information. Some data is held in Chrome extension storage so a service-worker restart does not lose the active flow. Some sensitive working values are designed for session storage or memory, but users should treat all local extension storage as information on their browser profile.

## Information sent outside the browser

When the user generates an address or checks an inbox, GhostFill makes requests to the selected temporary-email provider. Those providers receive the request data necessary to operate that mailbox and may have their own logs, retention, availability, rate limits, or privacy policies. GhostFill does not make claims about those providers' privacy practices.

The explicitly named `build:public` profile does not request Gmail OAuth and does not include Google, Microsoft, or Zoho host permissions. The default build is the full profile and includes the real-mail permissions described below.

The default full build can request Gmail OAuth with the restricted `gmail.readonly` scope and basic profile scopes. When the user chooses Gmail, Google handles the sign-in flow through Chrome's identity API; GhostFill does not operate a hosted mail backend. The extension uses the authorized account to read the inbox needed for verification flows and stores the associated profile, alias sessions, inbox metadata, and settings in extension storage. OAuth access tokens are handled by Chrome's identity flow and in-memory service state rather than sent to a GhostFill server. Google may process data under Google's own terms and privacy policy.

## Storage and deletion

Settings and active workflow state are stored through the extension's browser-storage service. The Options page provides data-reset and history controls. Uninstalling the extension removes its extension storage from that Chrome profile. Temporary-email providers may retain mailbox information independently, and GhostFill cannot delete data held by them.

## Links, clipboard, and notifications

Copy actions write only the value the user asks to copy to the clipboard. The extension may show operational notifications when enabled. Automatic verification-link opening is enabled by default and can be disabled in Options. Links are evaluated by the extension's verification-link logic before a new tab is opened, but users should still review destinations.

## Security limitations

Disposable email does not make an account anonymous, secure, or recoverable. Do not use GhostFill for financial services, password managers, sensitive accounts, or services that require a durable inbox. The content script uses broad website matching for signup detection and therefore has a curated sensitive-domain exclusion list rather than a guarantee that every sensitive site is blocked.

## Changes and contact

Policy changes are made in this file. For a security issue, follow [SECURITY.md](SECURITY.md). For product and privacy questions, use the [GitHub issue tracker](https://github.com/Xshya19/ghostfill-extension/issues) without posting passwords, tokens, private inbox content, or exploit details.
