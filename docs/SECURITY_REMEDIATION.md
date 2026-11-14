# Audit remediation — 21 October 2026

All 18 confirmed findings from the 18 October audit are fixed in the current source. Existing uncommitted work was preserved. The original audit describes the pre-fix behavior; its bug-reproduction proofs were replaced by permanent tests that assert the corrected behavior.

| Finding | Corrected behavior | Regression coverage |
| --- | --- | --- |
| 1. Domain trust | Shared Public Suffix List checks isolate unrelated public/private-domain tenants while retaining intended first-party aliases. The already-installed `tldts` package is now a production dependency. | `verification_delivery_regression`, `email_provider_privacy`, `core_utilities_deep` |
| 2. Wrong Mail.tm mailbox token | Tokens are bound to mailbox credentials; creating an account clears the previous authentication state. | `provider_audit_regression` |
| 3. Mail.tm read after refresh | A 401 invalidates the rejected token, refreshes against the correct mailbox, and subsequent reads keep the replacement token. | `provider_audit_regression` |
| 4. Missing shortcuts | Command handlers register synchronously on every service-worker evaluation, after their state is initialized. Listener installation remains idempotent. | `audit_background_regression` |
| 5. Passwords in logs | Verification warnings include field/strategy metadata and never include expected or actual field values. | `security_logging_regression` |
| 6. Codes in logs | Numeric/mixed-code redaction hides the code, and extractor messages pass code values through sensitive structured fields. | `security_logging_regression` |
| 7. Incomplete clearing | Options requests background cleanup. Cleanup stops mailbox/link work, disconnects provider caches, invalidates late authentication results, drains dispatched credential/profile writes, clears identity/dedup/diagnostic state, and wipes storage last. | `clear_data_regression`, `gmail_credential_reset`, `real_mail_credential_reset`, `link_session_reset`, `provider_audit_regression` |
| 8. Remote avatars | Inbox avatars use bundled assets or a local fallback; rendering rows performs no remote favicon lookup. | `content_frontend_regressions`, `email_identity` |
| 9. Split OTP fields | Smart fill uses the existing group-aware filler and excludes OTP fields from the generic/focused fill paths. | `content_frontend_regressions`, `otp_field_compatibility` |
| 10. Replaced SPA fields | Meaningful observed mutations invalidate the scan fingerprint; disconnected candidates force a fresh scan. | `content_frontend_regressions` |
| 11. Empty identity cache | Successful email/password generation invalidates the cached identity before refetching it. | `content_frontend_regressions` |
| 12. Hydrated email extraction | OTP/link extraction fingerprints relevant message content, invalidates changed results, and drops stale links. | `content_frontend_regressions` |
| 13. Provider failure streak | A fresh successful inbox request records success and resets the failure streak. Cached circuit responses do not count as fresh success. | `provider_audit_regression` |
| 14. Unstable custom message IDs | Fallback IDs use stable message content and duplicate occurrence counts instead of polling time or batch index. | `provider_audit_regression` |
| 15. Mailnesia dispatch | Stored Mailnesia accounts use Mailnesia's full-message reader. | `provider_audit_regression` |
| 16. Mailinator preference | An explicit saved Mailinator preference is honored, with the existing error fallback policy retained. | `provider_audit_regression` |
| 17. Private endpoint access | Both profiles permit HTTPS connections in CSP and declare optional HTTPS host access. A settings button requests only the configured host; the provider checks the grant before requests, omits cookies, and rejects redirects. Required/default host permissions were not widened. | `custom_endpoint_permission`, `provider_audit_regression`, `service_robustness` |
| 18. Misleading diagnostic PASS | The issue reporter preserves failed process status/output and continues reporting the remaining checks without successful shell fallbacks. | `audit_background_regression` |

Also fixed the additional updater observation: dismissing an update remains effective for that release; a newer release can notify again. Covered by `auto_updater_regression`.

## Verification

- Full suite: **1,387 tests passed across 81 files**.
- TypeScript: passed.
- ESLint: passed with no warnings or errors.
- GitHub workflow policy: passed for three workflows.
- Full and public production profiles: both built and passed repository bundle budgets (3,039,142 and 3,033,351 unpacked bytes respectively).
- Both ZIP packages were created and their SHA-256 sidecars verified against the actual archive bytes.
- Webpack emits a popup entry-size recommendation warning: full 883 KiB/public 881 KiB versus its 879 KiB recommendation. Repository hard size budgets pass; no limits were raised to hide the warning.

Machine-readable results and command output are in `audits/2026-10-21/`. Source/package versions remain 1.1.2. Fresh builds use separate audit directories; the pre-existing `dist/` and installed browser extension were not replaced.

Fresh full package: `audits/2026-10-21/full/ghostfill-extension-v1.1.2.zip`. The restricted public package is in the sibling `public/` directory. Custom-endpoint users must choose **Allow endpoint access** in Email settings before using their endpoint.

## Remaining verification limits

No live OAuth, real-provider compatibility/uptime, real Chrome suspension, native permission-dialog, or assistive-technology check was performed. Deferred-promise and Chrome/HTTP fixtures cover the repaired race/error paths. A browser tab creation already dispatched before clearing cannot be undone by resetting a queue.

Online dependency advisories remain unverified. The earlier approval rejection of dependency-metadata transmission was respected; no dependency tree was sent for another audit. The unconfirmed SSE suspension lead remains an integration check, not a claimed fix.
