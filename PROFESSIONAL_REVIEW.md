# GhostFill Professional Hardening Review

**Date:** 2026-09-18  
**Scope:** Manifest V3 boundary, service worker and offscreen relay, settings persistence/import, email rendering, popup, options, content-script UI, build/test/dependency health, accessibility, motion, and bundle performance.

## Executive result

The highest-risk defects found during the review were corrected in the same pass. The extension now builds cleanly, exposes a consistent local-first UI, blocks remote email tracking assets by default, validates its offscreen streaming boundary, and renders every settings section without a runtime crash. The full verification commands and exact final counts belong in the release handoff rather than being frozen in this document.

## Remediated findings

| Severity | Finding                                                                                                      | Resolution                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Email HTML could request remote images/CSS and leak viewing activity                                         | Remote `src`, `srcset`, CSS URLs, and imports are stripped by default; the viewer uses a sandbox, no-referrer policy, and deny-by-default document CSP. |
| High     | Offscreen SSE relay accepted an arbitrary URL from an internal message                                       | Added exact Mail.tm Mercure origin/path/topic/account validation and bounded tokens.                                                                    |
| High     | Automation settings crashed the entire options app when `chrome.commands` was unavailable                    | Added capability detection, manifest-backed fallback commands, and rejection handling.                                                                  |
| High     | Settings imports trusted unbounded and loosely typed JSON                                                    | Added a 256 KB limit and schema reconstruction that ignores unknown, array, wrong-type, non-finite, and nested prototype keys.                          |
| Medium   | The options app treated its initial load as a user edit and could immediately save it                        | Initial loaded object is now distinguished from subsequent user edits.                                                                                  |
| Medium   | Local and test rendering exposed raw i18n keys or threw on extension-only APIs                               | Added a bundled-English fallback and defensive runtime capability checks.                                                                               |
| Medium   | Sender avatars/favicons and a broad extension image CSP created avoidable network/privacy surface            | Replaced remote imagery with deterministic local initials, narrowed CSP image sources, and removed unused web-accessible resources.                     |
| Medium   | Inbox rows relied on generic clickable containers and some visible rows did not open                         | Rows now expose full native button targets, accessible names, focus states, and working open behavior.                                                  |
| Medium   | Popup and settings controls frequently missed the 44px interaction baseline                                  | Header actions, tabs, identity actions, toggles, selectors, links, and feedback actions now expose 44px targets.                                        |
| Medium   | Bundle checking depended on a stats file the build never generated                                           | The checker now scans the real distribution, enforces per-asset/total budgets, and returns a machine-readable total.                                    |
| Medium   | A redundant 768px logo dominated the shipped asset payload                                                   | Popup now reuses the bundled 128px mark; the unpacked package dropped from about 3.12 MB to about 2.54 MB.                                              |
| Medium   | Six moderate development dependency advisories                                                               | Updated the test/parser toolchain; dependency audit is clean.                                                                                           |
| Low      | Motion included a blur animation, layout-height animation, row staggering, and coarse-pointer hover movement | Replaced with restrained transform/opacity transitions, removed inbox staggering, and added pointer/reduced-motion guards.                              |
| Low      | Old design documents described an unrelated glass/gradient system                                            | Replaced with the implemented Private Workspace baseline and delivery checklist.                                                                        |

## Accessibility and interaction evidence

- Popup verified at its 375×400 CSS viewport with no document overflow and no visible interactive control below 44×44px.
- All seven options tabs verified at a 375px CSS viewport with no page-level horizontal overflow. Every visible control meets the target-size contract; the only 1px element is an intentionally screen-reader-only file input.
- Popup tab state and help dialog expose semantic roles and accessible names.
- Options navigation uses a tablist/tab/tabpanel relationship; toggles expose switch semantics.
- Primary, secondary, and accent text tokens meet normal-text contrast. Tertiary light ink was strengthened to clear 4.5:1 on the light canvas.
- CSS and Framer Motion both honor the user’s reduced-motion preference.

## Architecture notes and residual constraints

- Broad `http://*/*` and `https://*/*` content-script coverage is intrinsic to cross-site form filling. Financial/password-manager/Web Store exclusions remain in the manifest. Changing this to optional host access would be a product-permission migration, not a safe incidental refactor.
- Provider host permissions remain broad because the repository intentionally retains compatibility backends. Removing them requires a product decision plus live provider qualification.
- `background.js` remains the largest asset (roughly 861 KB) but is below the 1 MB asset budget. Aggressive code splitting is constrained by MV3 service-worker startup and listener-registration requirements.
- The repository still contains pre-existing formatting debt outside the touched files. It is deliberately not mass-reformatted because that would obscure functional changes and overwrite unrelated work.

## Release gate

Before packaging, require: TypeScript, ESLint, complete Vitest suite, production Webpack build, bundle budgets, dependency audit, module-cycle check, service-worker smoke test, responsive popup/options review, and the project’s Impeccable UI detector.
