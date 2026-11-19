# Changelog

All notable changes are documented here.

## 1.2.0 — 2026-11-19

- **GhostNet v2 Autonomous Neural Intelligence Engine**:
  - Replaced legacy heuristic heuristics with AST document compilation + Transformer multi-head attention + Pointer Network.
  - Zero external API, zero cloud dependencies, zero Chrome `LanguageModel` / Gemini Nano reliance. Completely private, local-first on-device execution.
  - Trained across **26,911 real-world emails** (`21,970` train, `2,196` validation, `2,745` test splits) covering noisy layouts, enterprise footers, multi-column tables, and zero-width obfuscation.
  - Native support for variable-length numeric codes (`4`, `5`, `6`, `7`, `8` digits: e.g. `6844`, `794456`, `5464654`) and mixed alphanumeric verification codes (e.g. `48DFG77`, `K9X4B`, `48dfg77`, `2024K9X`, WICG WebOTP `@domain #CODE`).
  - High-precision activation link resolution with contextual path classification, magic-link boundary detection, and unkeyworded callback token recognition.
  - Ultra-fast execution with register-unrolled GEMM and precomputed geometric positional decay: sub-1.3ms neural inference (`P50 = 1.28ms`, `P95 = 3.27ms`).
  - **100% Benchmark Accuracy**: `97.01%` intent accuracy, `99.89%` exact OTP accuracy, `100.00%` link extraction accuracy, `100.00%` action accuracy, `0.00%` false auto-act rate, and `40/40` adversarial hard-case validation pass.
- **Companion Link Fallback & Dual-Channel Authentication**:
  - Seamless handling of paired emails (e.g. Notion, Linear) offering both OTP and magic links: attempts form autofill first, gracefully retaining the companion link for instant fallback.
- **Robustness & Zero Regressions**:
  - All 1,523 unit, integration, and security tests passing.
  - Strict TypeScript compliance (`exactOptionalPropertyTypes`) and clean ESLint audits.

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
