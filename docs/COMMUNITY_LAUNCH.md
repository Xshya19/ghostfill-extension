# Early-user feedback plan and announcement drafts

These are drafts. Do not post them until a release package has been verified and a maintainer has reviewed the final permission and privacy documentation.

## 15-second demonstration storyboard

| Time   | On-screen action                                           | Truthful caption                                    |
| ------ | ---------------------------------------------------------- | --------------------------------------------------- |
| 0-3s   | Open GhostFill on the local demo page.                     | Generate a temporary signup address.                |
| 3-6s   | Fill the email and password fields.                        | Fill the current form without copying between tabs. |
| 6-10s  | Show a controlled fixture message in GhostFill's inbox.    | Review the verification message and suggested code. |
| 10-14s | Use the explicit OTP fill action on the local code inputs. | Fill the code into the active signup tab.           |
| 14-15s | Show the privacy and feedback links.                       | Early build: report a reproducible issue.           |

## Chrome-extension community announcement

I am preparing GhostFill, an open-source Manifest V3 extension for disposable-email signup workflows. It can generate a temporary address, generate a password, inspect a temporary inbox, use Gmail/Google aliases, and suggest or fill a verification code. The default full build includes Gmail OAuth, while `npm run build:public` remains available for a temporary-email-only package. I am looking for feedback on reproducible signup and OTP flows, especially error states and provider failures. Please do not post private inbox content, passwords, or codes in issues.

## Independent-maker announcement

I am releasing an early version of GhostFill for people who test signups frequently and prefer a disposable-email workflow in Chrome. The project is open source, has no paid backend, and uses public temporary-email providers. It is not a password manager, durable inbox, or universal signup bypass. I would value reports of real, reproducible failures more than broad feature requests.

## Show HN draft

Show HN: GhostFill - an open-source Chrome extension for disposable email and OTP assistance

GhostFill is a Manifest V3 extension that creates a temporary email address, generates a password, can create site-specific Gmail aliases, polls the selected provider's inbox, and uses deterministic heuristics to identify likely verification codes for the originating signup tab. The default package includes Gmail OAuth; a restricted temporary-email-only package is available with `npm run build:public:zip`. I am publishing it as an early, manually installed build and would appreciate feedback on reproducible flows, provider failures, OAuth setup, and false OTP candidates. It should not be used for financial accounts, password managers, or anything needing a durable inbox.

## Technical article outline

**Working title:** Routing a verification code back to the signup tab in a Manifest V3 extension

1. The problem: an inbox event is not enough when two signup tabs are active.
2. Session identity: mapping a temporary-email account and registration context to a tab.
3. Extraction: deterministic pattern, layout, and context heuristics rather than a shipping machine-learning model.
4. Candidate handling: stale, unrelated, and multiple code-like values.
5. Filling: grouped OTP inputs and React-controlled fields.
6. MV3 constraints: service-worker suspension, storage, alarms, and retries.
7. Privacy boundaries: broad content-script matching, sensitive-site exclusions, temporary-provider requests, and user-controlled external links.

## Zero-cost feedback loop

1. Ship one verified GitHub Release with the checksum and manual install guide.
2. Ask each early user for one reproducible flow, Chrome version, extension version, expected behavior, and actual behavior.
3. Turn confirmed defects into focused regression tests before making broad changes.
4. Triage provider availability separately from local routing or extraction defects.
5. Keep public issue templates free of inbox content, passwords, tokens, and OTPs.
