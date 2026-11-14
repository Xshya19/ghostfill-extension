# Changelog

All notable changes are documented here.

## 1.1.7 — 2026-11-14

- Complete system audit, security hardening, and reliability overhaul.
- Added strict origin binding (`signupOriginBinder.ts`) and delivery funnels (`deliveryFunnel.ts`) to prevent cross-tab code leakage.
- Enhanced activation link guard and intelligent intent classification for magic links and one-time verification.
- Added native value setters for React, Vue, and Angular input forms.
- Added normalized message list parsing across all temporary email providers.
- Expanded full internationalization (i18n) support for English and Spanish.
- Formatted all codebase files with Prettier and added extensive regression test coverage (1,512 tests passed).

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
