# Changelog

All notable changes are documented here.

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
