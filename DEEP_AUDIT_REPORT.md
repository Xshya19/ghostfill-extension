# GhostFill Deep Audit Report

Date: 2026-04-25
Workspace: `C:\Users\Xshya\ghostfill-extension-main`

## Post-Fix Status

Follow-up fixes were applied after this audit. Current verification results:

- `npm.cmd run format:check`: pass
- `npm.cmd run lint`: pass
- `npm.cmd run type-check`: pass
- `npm.cmd test`: pass, 57 passed and 1 skipped
- `npm.cmd audit`: pass, 0 vulnerabilities
- `npm.cmd run build`: pass
- `npm.cmd run build:zip`: pass, created `ghostfill-extension-v1.1.0.zip` at 6649.08 KB

Resolved or materially improved: dependency vulnerabilities, lint failures, format script reliability, background message validation, encryption key persistence, unsafe HTML fallback, broad WASM/MJS packaging, stale report/log artifacts, user-facing mojibake in locales/package metadata, remote Google Fonts usage in extension pages, localized manifest metadata, HTTPS-only default content-script/resource exposure, active-learning DOM snapshot persistence, shipped CSS/icon weight, remaining app-code `Math.random()` calls, direct popup OTP cache writes, popup inline-style reduction, and extension-appropriate build warning configuration.

Remaining known work: reduce background/model sizes further, decide whether the broad HTTPS content-script match policy should become opt-in, remove `style-src 'unsafe-inline'` after migrating the remaining React inline styles to classes, clean remaining source-comment mojibake, add deeper tests for message rejection/storage recovery/DOM rendering, and split very large source files.

## Scope Checked

- Authored source: `src/**/*`
- Extension config and packaging: `manifest.json`, `webpack.config.cjs`, `package.json`, `package-lock.json`, `tsconfig.json`, lint/format/style configs, Husky config
- Public assets and locales: `public/**/*`
- Tests and test fixtures: `tests/**/*`, `src/**/__tests__/**/*`
- Scripts: `scripts/**/*`, `test-providers.ts`
- ML/training authored files: `ml/extractor.js`, `ml/train_ghostfill_model.py`, `ml/requirements.txt`, `training/**/*`
- Generated output spot-check: `dist/**/*`
- Repo hygiene: tracked files, ignored/generated/runtime folders, large files, stale reports, package zip

Vendor/runtime folders were not reviewed line-by-line as authored code: `node_modules`, `.venv`, `ml/venv`, `.git`. They were checked for tracking status and excluded from authored-code findings.

## Command Results

- `npm run type-check`: pass
- `npm test`: pass, 57 passed, 1 skipped
- `npm run build`: pass, but emits bundle-size and ONNX Runtime warnings
- `npm run lint`: fail, 23 errors and 26 warnings
- `npm run format:check`: fail, 99 files need formatting
- `npm audit --omit=dev`: fail, 2 production vulnerabilities
- `npm audit`: fail, 5 total vulnerabilities
- `npm run build:zip`: pass, created `ghostfill-extension-v1.1.0.zip` at about 24 MB
- Python syntax compile for authored Python files: pass
- `npm outdated --long`: many outdated packages, including production dependencies

## Critical / High Issues

1. Production dependency vulnerability: `protobufjs <7.5.5` has a critical arbitrary-code-execution advisory. Reported by `npm audit --omit=dev`.

2. Production dependency vulnerability: `dompurify <=3.3.3` has multiple moderate sanitizer bypass advisories. This matters because the extension renders sanitized HTML/SVG in content UI helpers.

3. Dev dependency vulnerabilities: `lodash`, `vite`, and `postcss` are reported vulnerable by full `npm audit`. These are lower runtime risk than production dependencies, but still affect local/dev tooling.

4. Lint is currently broken. `npm run lint` fails with 23 errors and 26 warnings, so CI/pre-commit quality gates are not clean.

5. Duplicate import in `src/background/sseManager.ts:24` and `src/background/sseManager.ts:25`: both import from `../services/emailServices`, triggering `import/no-duplicates`.

6. Constant condition in `src/background/sseManager.ts:269`: ESLint flags `no-constant-condition`. If intentional, it should be isolated and documented; otherwise it may hide an infinite loop/reconnect bug.

7. Multiple `curly` lint errors in OTP/autofill code:
   - `src/content/autoFiller.ts:716`
   - `src/content/autoFiller.ts:719`
   - `src/content/autofill/engines/otp-discovery.ts:93`
   - `src/content/autofill/engines/otp-discovery.ts:95`
   - `src/content/autofill/engines/otp-discovery.ts:96`
   - `src/content/autofill/engines/otp-discovery.ts:261`
   - `src/content/autofill/engines/otp-filler.ts:84`
   - `src/content/autofill/engines/otp-filler.ts:131`
   - `src/content/autofill/engines/otp-filler.ts:181`
   - `src/content/floatingButton.ts:1323`
   - `src/content/otpPageDetector.ts:1728`
   - `src/content/otpPageDetector.ts:1820`
   - `src/content/otpPageDetector.ts:1821`
   - `src/popup/hooks/useOTPExtractor.ts:19`
   - `src/popup/hooks/useOTPExtractor.ts:23`
   - `src/services/emailServices/providerHealthManager.ts:70`
   - `src/utils/diagnosticLogger.ts:210`
   - `src/utils/diagnosticLogger.ts:211`
   - `src/utils/diagnosticLogger.ts:212`
   - `src/utils/diagnosticLogger.ts:213`

8. Background message receiver does not enforce runtime schema validation. `src/background/messageHandler.ts:57` passes raw incoming messages directly into `handleMessage`, while validation exists in `src/utils/validation.ts:289` and is only applied by sender-side helpers. Background must validate because content scripts and extension pages are not a sufficient trust boundary for payload shape.

9. Sensitive storage encryption appears non-persistent despite comments. `src/utils/encryption.ts:439` describes a persistent master key, but the seed is kept in `chrome.storage.session`. On extension/browser reload, sensitive local data encrypted by that key may become undecryptable.

10. Data loss on decrypt failure. `src/services/storageService.ts:621` attempts decrypt and `src/services/storageService.ts:623` drops values on failure. Combined with the session-only master seed, password history and other sensitive records can silently vanish from the app.

11. `clear()` preserves `masterKeySeed` from local storage even though initialization stores it in session storage. `src/services/storageService.ts:924` preserves `masterKeySeed`, but `src/utils/encryption.ts:449` reads it from session storage. This indicates an incomplete migration or mismatched key-storage design.

12. Direct unsafe HTML assignment remains in `src/content/floatingButton.ts:1467`. Most UI HTML uses `setHTML`, but this line bypasses the safer helper.

13. `setHTML` uses `setHTMLUnsafe` when available in `src/utils/setHTML.ts:35`. Even after sanitization, using an explicitly unsafe sink weakens the Trusted Types story and depends heavily on DOMPurify correctness.

14. Manifest CSP allows `style-src 'unsafe-inline'` in `manifest.json:7`. This may be needed for React/CSS behavior, but it weakens extension-page CSP and should be justified or reduced.

15. Content script runs on broad `http://*/*` and `https://*/*` in `manifest.json:34`. The exclusion list covers many financial/password domains, but this still creates broad data-access and review-surface risk.

16. `web_accessible_resources` exposes `"*.wasm"` and `"*.mjs"` to all URLs in `manifest.json:111`. This is broad and makes all root runtime bundles accessible from any web page.

17. `web_accessible_resources` includes `models/*.json`, but `dist/models` only contains `sentinel_brain_v2.onnx` and `sentinel_brain_v2.onnx.data`. This is stale or mismatched manifest surface.

18. The production build copies every ONNX Runtime WASM/MJS variant. `webpack.config.cjs:237` copies `node_modules/onnxruntime-web/dist/*.{wasm,mjs}`, producing about 83 MB of runtime assets in `dist`.

19. The packaged extension zip is about 24 MB. This is large for a browser extension and may affect store review, install time, and update bandwidth.

20. Build warnings show `background.js` is 595 KiB and popup entry is 541 KiB. These exceed Webpack's 500 KiB performance guidance.

## Medium Issues

21. Prettier fails on 99 files. This indicates formatting drift and makes reviews noisy.

22. The existing `issue-report.txt` is stale and encoding-corrupted. It says checks passed on 2026-04-02, but current lint and audit checks fail.

23. Mojibake/encoding corruption appears across user-visible strings and comments, including `manifest.json`, `package.json`, locale JSON, source logs, and `issue-report.txt`.

24. Spanish locale strings are corrupted, for example `contraseÃ±as`, `detecciÃ³n`, and `Â¿` in `public/_locales/es/messages.json`.

25. English locale strings include corrupted punctuation such as `Â·` and `â€”` in `public/_locales/en/messages.json`.

26. `default_locale` is set to `en` in `manifest.json:119`, but the manifest name/description are hardcoded instead of using `__MSG_*__`. Localized extension metadata will not be used by Chrome.

27. Very large source files reduce maintainability:

- `src/content/floatingButton.ts`: 3037 lines
- `src/services/activationLinkExtractor.ts`: 2788 lines
- `src/services/otpExtractor.ts`: 2590 lines
- `src/content/otpPageDetector.ts`: 2229 lines
- `src/background/pollingManager.ts`: 1369 lines
- `src/services/storageService.ts`: 1217 lines

28. `src/popup/styles/popup.css` is 4124 lines and about 109 KB. This is large enough to hide dead styles and visual regressions.

29. Several local storage writes bypass `storageService` and encryption/schema control:

- `src/content/index.ts:311`
- `src/content/utils/intelligenceCore.ts:23`
- `src/intelligence/active-learning/ActiveLearningController.ts:50`
- `src/options/components/tabs/GeneralTab.tsx:112`
- `src/popup/App.tsx:234`
- `src/popup/components/Hub.tsx:128`
- `src/popup/components/Hub.tsx:159`
- `src/popup/hooks/useOTP.ts:88`
- `src/utils/featureFlags.ts:134`
- `src/utils/featureFlags.ts:264`

30. `lastOTP` is written directly to `chrome.storage.local` in `src/popup/hooks/useOTP.ts:88`; OTPs are sensitive short-lived secrets and should probably use session storage or encrypted service storage.

31. Training/active-learning data is written directly to local storage in `src/content/index.ts:311` and `src/intelligence/active-learning/ActiveLearningController.ts:50`. Depending on captured features, this may store site-derived data without central retention controls.

32. Feature flag bucketing uses `Math.random()` in `src/utils/featureFlags.ts:133` and `src/utils/featureFlags.ts:142`. This is probably not security-sensitive, but it is inconsistent with the project’s security-hardening claims.

33. Provider/domain selection uses `Math.random()` in:

- `src/services/emailServices/mailGwService.ts:137`
- `src/services/emailServices/mailTmService.ts:178`
- `src/services/emailServices/tempMailService.ts:214`
  If domain selection affects privacy distribution, use crypto-backed randomness.

34. Random IDs use `Math.random()` in:

- `src/background/notifications.ts:1050`
- `src/content/otpPageDetector.ts:332`
- `src/content/otp/otp-detection-utils.ts:146`
- `src/intelligence/active-learning/ActiveLearningController.ts:36`
  Not necessarily exploitable, but worth standardizing.

35. Some lint warnings are unused imports/variables in security or background code, including `startEmailPolling`, `ProcessedEmailRecord`, `STORAGE_KEY_PROCESSED`, `setupMessageHandler`, `NUM_TEXT_CHANNELS`, `MAX_TEXT_LEN`, and unused caught errors.

36. `@typescript-eslint/no-explicit-any` is disabled globally in `.eslintrc.cjs:39`. That reduces type safety in a codebase handling untrusted page, network, and message data.

37. Security lint rules are weakened in `.eslintrc.cjs`: object injection, unsafe regex, timing attacks, non-literal regexp, and non-literal require are off. Some may be pragmatic, but this should be documented per rule.

38. `skipLibCheck` is enabled in `tsconfig.json:11`. This is common, but it can hide type incompatibilities in dependencies, especially with fast-moving React/Vitest/jsdom versions.

39. `tsconfig.json:9` has `"noEmit": false`, while the `type-check` script passes `--noEmit`. Running plain `tsc` could emit files unexpectedly.

40. `README.md` makes strong claims such as "Unhackable Passwords" and "100% local" while the app uses multiple external disposable-email APIs and has current audit vulnerabilities. Marketing/security wording should be softened.

41. Tests pass but coverage is narrow. There is little direct test coverage for background routing, storage key recovery, extension manifest behavior, provider outage behavior, or real DOM autofill flows.

42. `tests/accuracy_log.txt` and `tests/accuracy_log_utf8.txt` are committed/generated-looking logs with ANSI/control output. `.gitignore` already ignores `tests/accuracy_log*.txt`, so these are stale tracked artifacts.

43. Maildrop test scripts under `tests/test_maildrop*.js` are ad hoc network scripts with console output and no assertions. They are not integrated into `npm test`.

44. `test-providers.ts` is an ad hoc provider checker with inline `any`, direct console output, and broad real-provider calls. It is useful manually but not a reliable automated test.

45. Python requirements are broad and unpinned:

- `torch>=2.0.0`
- `onnx>=1.14.0`
- `onnxruntime>=1.15/1.16`
- `onnxscript>=0.1.0`
  This can make ML builds non-reproducible.

46. `ml/requirements.txt` and `training/requirements.txt` disagree on `onnxruntime` minimum version.

47. `training/data/sentinel_v2_seed.jsonl` is about 21 MB and committed. This may be intended, but it has repository-weight and review-cost implications.

48. Source assets duplicate icons/logos across `src/assets`, `src/popup/assets`, and `public/assets`. Some 128px icons are much larger than expected.

49. `src/assets/icons/icon128.png` is 217 KB, while `public/assets/icons/icon128.png` is 26 KB. This inconsistency may cause different shipped vs source visual assets.

50. `npm outdated --long` shows many stale packages. Important production updates include `dompurify 3.3.3 -> 3.4.1`, `framer-motion 12.23.26 -> 12.38.0`, `lucide-react 0.562.0 -> 1.11.0`, and `zustand 5.0.11 -> 5.0.12`.

## Lower-Priority / Cleanup Issues

51. Import-order warnings appear across background/popup modules.

52. `issue-report.txt` and generated zip files are ignored by pattern but can still exist locally, creating confusion between current and stale check results.

53. Comments and log strings use heavy box-drawing and emoji-style characters. This is fine if the repo commits to UTF-8, but current mojibake shows the encoding pipeline is not reliable.

54. `webpack.config.cjs` disables `Content-Security-Policy` meta injection for generated HTML. Extension CSP is in manifest, but this should be intentional and documented.

55. Build keeps source maps disabled in production, which is good for package size/security, but large minified bundles still make field debugging hard.

56. `dist` exists in the workspace after build. It is ignored/untracked, but stale `dist` can confuse manual extension loading if not rebuilt.

57. The old audit report uses ANSI escape sequences and corrupted line art, making it difficult to read in editors.

58. Several catch blocks intentionally swallow errors. Some are acceptable for extension messaging, but core storage/provider paths should log enough context to diagnose failures.

59. The project has multiple OTP extraction implementations (`src/services/otpExtractor.ts`, `src/services/extraction/otpExtractor.ts`, content OTP utilities, ML extractor). This increases drift risk unless there is a clear ownership boundary.

60. The manifest excludes many banking/password-manager sites manually. That list will always be incomplete; consider user-configurable denylist and sensitive-field/page heuristics.

## Suggested Fix Order

1. Run dependency remediation: upgrade `dompurify` and transitive `protobufjs`, then re-run `npm audit --omit=dev`.
2. Fix ESLint errors, especially duplicate imports, constant condition, and curly violations.
3. Add background-side `validateMessage` enforcement before the `switch`.
4. Decide and fix the encryption persistence model so encrypted local data survives expected restarts or is explicitly session-only.
5. Replace direct `innerHTML` and avoid `setHTMLUnsafe`.
6. Fix UTF-8 mojibake in manifest, package metadata, locales, README, and source strings.
7. Reduce ONNX Runtime assets copied to `dist` to only the needed execution provider files.
8. Add tests for storage recovery, message validation rejection, and content HTML rendering.
9. Normalize formatting with Prettier and keep it enforced.
10. Remove stale tracked generated logs/reports or regenerate them cleanly.
