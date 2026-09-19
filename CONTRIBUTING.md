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

Load `dist/` through `chrome://extensions` with Developer mode enabled. The default build is the public temporary-email-only profile. Do not test by creating bulk third-party accounts, bypassing rate limits, or using personal data.

## Pull requests

1. Describe the problem and the behavior change.
2. Add or update a focused test for a confirmed bug.
3. Keep unrelated formatting and refactors out of the change.
4. Run the relevant validation commands and report their actual output.
5. For UI changes, preserve keyboard behavior, reduced-motion support, accessibility, and the fixed popup viewport.
6. Never add secrets, real inboxes, customer data, or personalised recordings.

## Public-build boundary

Do not add Gmail or other real-mail OAuth functionality to the default profile. The public build must remain temporary-email-only unless maintainers have reviewed the corresponding permission, OAuth, privacy, and distribution requirements.

## Code of conduct

Be respectful, keep discussions technical, and avoid publishing security-sensitive material in issues or pull requests.
