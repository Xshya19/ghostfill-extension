# Changelog

All notable changes are documented here.

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
