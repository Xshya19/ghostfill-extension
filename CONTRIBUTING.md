# Contributing to GhostFill

Thank you for improving GhostFill. Keep changes focused, reviewable, and grounded in a reproducible issue or user workflow.

## Local setup

```bash
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm run bundle:check
```

Load `dist/` through `chrome://extensions` with Developer mode enabled. The default build is the full profile, including Gmail/Google alias support. Use `npm run build:public` when a temporary-email-only test surface is specifically required. Do not test by creating bulk third-party accounts, bypassing rate limits, or using personal data.

## Pull requests

1. Describe the problem and the behavior change.
2. Add or update a focused test for a confirmed bug.
3. Keep unrelated formatting and refactors out of the change.
4. Run the relevant validation commands and report their actual output.
5. For UI changes, preserve keyboard behavior, reduced-motion support, accessibility, and the fixed popup viewport.
6. Never add secrets, real inboxes, customer data, or personalised recordings.

## Build-profile boundary

Keep the full profile and restricted profile behavior explicit. Changes to Gmail or other real-mail OAuth functionality require review of permissions, OAuth, privacy, and distribution requirements. Do not weaken the restricted profile's boundary or accidentally make a normal build omit the full integration.

## Code of conduct

Be respectful, keep discussions technical, and avoid publishing security-sensitive material in issues or pull requests.
