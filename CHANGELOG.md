# Changelog

All notable changes are documented here.

## 1.1.6 — 2026-10-04

- Stabilize popup inbox refresh controls while loading: rotate only the centered SVG glyph, keep the button fixed during hover/press, and slow the spinner slightly to prevent visible wobble.

## 1.1.5 — 2026-10-04

- Add opt-in automatic Windows updates: a current-user helper checks stable releases every six hours, verifies the ZIP and checksum, retains rollback, and records installed status. GhostFill loads newer installed files when verification and writes are idle and extension pages are closed.
- Remove the current Mailinator and YOPmail adapters from new-provider choices and automatic fallback; use one supported-provider registry and recheck admission cached by older versions. Stored accounts retain read routing.
- Accept both JSON-array and Hydra collections in Mail.tm/Mail.gw domain and message APIs, remove obsolete fallback domains, and check locally generated providers before presenting a new address.
- Use random alphanumeric Mail.tm usernames after reproducing HTTP 422 with the previous default; verify account creation, authentication, and inbox retrieval with the corrected adapter.
- Replace static domain-list health pings with bounded real API checks. Unreachable providers leave automatic fallback until a later check recovers; session-based integrations stay explicitly unchecked.
- Correct Tempmail.plus receiving domains and complete-address inbox queries; preserve sender names and actual message timestamps, and report provider errors instead of claiming an empty inbox.
- Add a captioned 47-second illustrated installation, signup, verification, and automatic-update walkthrough to the README.
- Share concurrent verification extraction, normalize code evidence once per message, and serialize the bounded encrypted detection cache. Optional cache failures no longer hang verification.
- Reuse hydrated Driftz and Catchmail message bodies within a bounded, address-scoped memory cache while continuing to refresh inbox lists; persist recovered bodies even when headers do not change.
- Preserve provider detail timestamps when inbox summaries omit them. Undated messages stay available for review with a clear unavailable-date label and no automatic verification actions.
- Share concurrent message reads and account creation, respect read-only inbox requests, and stop provider fallback and retry waits when a request is cancelled.
- Prevent late storage reads or decryption from replacing newer values, restoring deleted data, or repopulating memory after unload. Share overlapping batch/single reads and storage-change listeners.
- Cancel superseded optimistic edits and delayed writes when data is cleared; bound remaining storage read, removal, and clear operations.
- Prevent duplicate polling timers and stale SSE connections from modifying a newer session; restore bounded reconnect backoff and retain the offscreen relay across ordinary worker suspension.
- Restore keyboard command registration and initialize a cold service worker before executing a shortcut.
- Suppress notifications from superseded inbox sessions, including delayed settings/permission checks and retries.
- Produce debug-history snapshots on demand and fix OTP redaction that mistakenly repeated the secret code.
- Add reproducible extraction benchmarks and backend regression coverage; keep release delivery manual.

## 1.1.4 — 2026-10-03

- Require visible verification instructions before treating numbers as OTPs; extractor agreement cannot promote postal codes, customer numbers, or newsletter artifacts.
- Decode numeric HTML entities before scanning text so invisible formatting such as `&#8203;` cannot become a verification code.
- Apply the shared activation-link gate in the email reader; ordinary newsletter and unsubscribe links no longer appear as verification actions.
- Withhold OTP desktop alerts for uncertain codes and skip automatic actions and alerts for messages older than ten minutes, including stale full messages behind recent inbox summaries.
- Preserve processed inbox history across session changes and cover replay prevention with regression tests.
- Remove the unnecessary passthrough Trusted Types policy that restricted sites block; keep DOMPurify sanitization.

## 1.1.3 — 2026-10-02

- Verify timed-out storage writes against disk, retain unsaved values for bounded automatic retries, and preserve newer queued updates when an older write fails.
- Clear completed storage deadlines, bound quota measurements, cancel retries when clearing data, and keep pruned sensitive records encrypted during quota recovery.
- Refresh runtime dependencies and build tools to their latest compatible stable releases, including React 19, Motion 13, Vitest 5, and Webpack CLI 7.
- Migrate lint rules to ESLint's flat configuration and TypeScript aliases away from deprecated `baseUrl`; preserve security and accessibility checks.
- Update ZIP packaging for Archiver 8 and remove unused or deprecated development dependencies and obsolete dependency overrides.
- Declare the production minifier explicitly so clean installs can build without relying on Webpack's former transitive dependencies.
- Configure CI for Node 22, 24, and 26, use Node 24 for releases, add a vulnerability audit gate, and exercise the Windows updater in CI.
- Align Chrome API types and nullable React refs with current definitions; validate stored values before using encryption keys, selector memory, provider health, or debug settings.
- Refresh all GitHub Action references to verified stable releases pinned by full commit SHA.

## 1.1.2 — 2026-10-02

- Report temporary inbox timeouts, network failures, and throttling as warnings with the cause visible; retain automatic retries and error-level reporting for unexpected failures.
- Add **Options → About → Updates** to check stable GitHub releases, download a newer built ZIP and checksum, and reload after the files are updated.
- Prevent downgrade offers and explain updates for the temporary-email-only build.
- Include the Windows update shortcut in source checkouts and built packages.
- Normalize workflow-test line endings so Windows checkouts pass the same policy checks.

- Fixed popup inbox OTP extraction so the content-side fill action receives the same cached code.
- Made the full Gmail/Google alias profile the default build; retained an explicit temporary-email-only public build command.
- Enabled automatic verification-link opening by default for new settings; users can disable it in Options.
- Added a public temporary-email-only build profile that removes real-mail OAuth permissions and controls.
- Removed the unsafe historical demo GIF and added a clean local recording harness and workflow poster.
- Added release, privacy, security, contribution, and GitHub-maintenance documentation.
- Hardened GitHub Actions with immutable action pins, bounded CI jobs, dependency review, CodeQL scanning, and retry-safe tagged releases.
