# GhostFill Apple-inspired UI/UX implementation plan

**Date:** 2026-09-25  
**Status:** implementation in progress; this document is the design contract and release checklist  
**Goal:** make every GhostFill interaction feel precise, calm, legible, and cohesive across the Chrome popup, options page, in-page controls, and browser-owned touchpoints.  
**Architecture:** retain the React 18, TypeScript, native CSS, Webpack, Manifest V3, Zustand, Framer Motion, and Shadow DOM architecture. Refine the existing GhostFill token system and shared primitives, then apply one interaction language to each existing workflow.  
**Primary baseline:** [`design-system/ghostfill/MASTER.md`](../../design-system/ghostfill/MASTER.md) and [`PRODUCT.md`](../../PRODUCT.md).

### Implementation checkpoint

- The shared token pass now aligns popup, options, and Shadow DOM controls around one blue action accent, neutral content surfaces, and opaque high-contrast fallbacks.
- The popup has clearer OTP feedback and a real shortcut hint, a quieter Gmail profile plate, visible alias connection state, no redundant alias Back control, keyboard-operated alias tabs, and an explicit password copy action beside a read-only value.
- Settings navigation uses a keyboard-operated vertical tablist; section icons use the same neutral/selected treatment.
- The Options page now uses one reusable glass material on its floating toolbar, responsive navigation rail, popovers, dialogs, and save notice. Settings groups and data rows stay solid. Its previous stacked CSS overrides and always-visible activity strip were removed, and seven sections remain reachable through the rail and command palette.
- Options now has a skip link, a single correctly referenced tab panel, horizontal navigation semantics at compact widths, direct validation recovery, and no nonfunctional “Coming soon” settings. Custom-provider fields are required only while that provider is active; password defaults require at least one character type.
- The in-page assistant uses the shared token source, sentence-case action labels, state-specific field announcements, restrained motion, and an explicit confirmation before clearing form fields.
- EN and ES catalogs include the new alias connection and tab labels, password detail controls, and revised password/verification terminology.
- Source review and static checks are possible in this workspace. A Chrome extension screenshot gallery and human interaction walkthrough remain open because the available browser surface rejected loading the local extension build. Do not treat source review as a visual acceptance pass.

The P0–P8 packages below remain the completion criteria. In particular, route-by-route screenshots, zoom/contrast review, full/public journey review, and remaining literal-string localization are still required before release.

---

## 1. Intent and design decision

GhostFill is used while someone is already doing another task: signing up, choosing an email identity, making a password, and completing verification. The interface should communicate _what identity is active, what GhostFill can do now, and what happened after an action_ within seconds. It should feel like a carefully built browser utility rather than a miniature marketing page.

The visual signature is a **quiet identity workspace**: a restrained functional layer above solid, beautifully typeset task content. The active address and current verification state anchor the popup. System blue marks the one most useful action in the current context. A small, consistent ghost mark supplies product identity; the rest of the UI relies on spacing, typography, precise borders, and controlled depth.

This is a translation of Apple design principles to a Chrome extension. `liquid_glass_widgets` is a Flutter shader/widget library and is not a drop-in dependency for React. Its useful transferable rules are the separation between functional glass and readable content, isolation of layered controls, avoidance of nested refraction, quality fallbacks, and restraint with motion. The Apple design skill explicitly treats non-Apple stacks as translations of principles rather than literal platform component copies. [Liquid Glass Widgets](https://github.com/sdegenaar/liquid_glass_widgets), [its architecture guide](https://raw.githubusercontent.com/sdegenaar/liquid_glass_widgets/main/skills/liquid-glass-widgets/SKILL.md), [Apple Design Skill](https://github.com/dickwu/apple-design-skill), [cross-platform translation](https://raw.githubusercontent.com/dickwu/apple-design-skill/main/references/cross-platform.md).

### Design goals, in priority order

1. **Task speed:** the active email, copy/fill action, and verification state are immediately findable.
2. **Trust:** privacy, external links, destructive actions, and provider failures use exact language and recoverable flows.
3. **Legibility:** content is opaque and readable in both themes, at zoom, and with transparency reduced.
4. **Continuity:** popup, options, in-page FAB, field labels, menus, and feedback use the same tokens and state language.
5. **Craft:** alignment, typography, icon weight, transitions, and empty states receive the same attention as the happy path.

### Constraints and assumptions

- Existing extension capabilities, Chrome permissions, CSP, storage schema, analytics hooks, and public/full build profiles remain intact.
- Existing GhostFill logo, local provider assets, Lucide icon family, platform system font stack, and bundled IBM Plex Mono remain the visual assets. No remote fonts or UI dependencies are needed.
- The popup remains a compact browser action around **375 × 400 CSS px** at normal zoom. At enlarged text or zoom, content may scroll inside the popup so no control becomes unreachable.
- `src/frontend/styles/globals.css` remains the source of truth for frontend tokens; `src/shared/theme.ts` provides the corresponding Shadow DOM tokens.
- User data remains private. Email HTML, remote imagery, URL handling, and permission boundaries are part of the UX review because visual polish cannot weaken those behaviors.
- The working tree already contains extensive uncommitted changes and a partial Apple-inspired baseline. Before implementation, inspect its diff and build on it; do not reset it or assume a clean starting point.
- This plan covers **existing surfaces**. The manifest has a popup and options page; it has no side panel. A side panel or new provider is outside this redesign.

## 2. Research translated into GhostFill rules

| Source principle                                                                                                                                                                                         | GhostFill rule                                                                                            | Practical consequence                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Liquid Glass distinguishes a floating control layer from content. [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)                                             | Glass only on navigation, segmented selectors, popovers, dialogs, and the in-page floating control.       | Identity values, inbox rows, message body, and setting groups are solid surfaces.                                        |
| Glass is used sparingly and is never nested into another refractive control. [Liquid Glass guide](https://raw.githubusercontent.com/dickwu/apple-design-skill/main/references/hig/liquid-glass.md)       | Each view has at most a few glass areas; a glass header does not contain another glass button surface.    | Refactor duplicated material styles into one `glass` treatment and opaque content treatments.                            |
| Purpose, agency, responsibility, familiarity, simplicity, craft, and delight drive decisions. [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles) | A user can understand, reverse, or recover from the result of every important action.                     | Exact statuses, straightforward copy, and one primary action per decision group.                                         |
| Layout follows importance and adapts to available space. [Apple Layout](https://developer.apple.com/design/human-interface-guidelines/layout)                                                            | Active identity and verification are above secondary controls; options has one rail and a reading column. | Compact popup at normal size, stackable settings, long strings and zoom accommodation.                                   |
| Prominent buttons are scarce and have a visible press state. [Apple Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)                                                      | Use solid system blue for the action most likely needed now; keep other controls quiet.                   | Copy, generate, connect, and retry cannot all compete visually at once.                                                  |
| Accessible UI supports contrast, large text, keyboard, and reduced motion. [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)                            | Accessibility is a component contract, not a final overlay.                                               | Named controls, visible focus, 44 px targets in compact UI, contrast checks, keyboard parity, zoom and motion fallbacks. |
| Feedback matches consequence. [Apple Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)                                                                                   | Inline status for ordinary events; modal confirmation for unexpected irreversible loss.                   | Copied state is local to the control; replacing an address warns of inbox loss.                                          |
| Language is short, active, and actionable. [Apple Writing](https://developer.apple.com/design/human-interface-guidelines/writing)                                                                        | Use verbs and explain remedies; avoid decorative or technical copy.                                       | “Connect Gmail to view this inbox” and “Retry provider” beat generic errors.                                             |

## 3. Current product inventory and design debt

### Existing surfaces and implementation owners

| Surface                                            | Current owner                                                                                                                                          | States and actions to retain                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Popup shell, loading, onboarding, view transitions | `src/frontend/popup/App.tsx`, `popup.css`, `SharedComponents.tsx`                                                                                      | Initializing, first run, hub, email detail, passwords, OTP, aliases, help, toast, error boundary.                                                   |
| Hub and identity                                   | `src/frontend/popup/components/Hub.tsx`, `SharedComponents.tsx`                                                                                        | Temp/Gmail selection in full build; active address, email and password copy/generate, sign in/out, recent inbox, message view, OTP/link extraction. |
| Disposable inbox detail                            | `src/frontend/popup/components/EmailGenerator.tsx`                                                                                                     | Account details, refresh, list, empty/loading/error, message view, replacement confirmation.                                                        |
| Gmail aliases                                      | `src/frontend/popup/components/AliasPanel.tsx`                                                                                                         | Connection setup, manual versus OAuth state, alias generator, inbox, history, copying, disconnecting, message view.                                 |
| Password and OTP detail                            | `src/frontend/popup/components/SharedComponents.tsx`                                                                                                   | Password options/history/reveal/copy, OTP readiness/countdown/copy, stale or missing code.                                                          |
| Options shell and navigation                       | `src/frontend/options/OptionsApp.tsx`, `OptionsUI.tsx`, `options.css`                                                                                  | Seven tabs, command palette, save status, validation, load error, modal, theme control.                                                             |
| Options content                                    | `src/frontend/options/components/OptionsTabs.tsx`                                                                                                      | General, Email, Passwords, Automation, Privacy, Advanced, About; provider health, shortcuts, import/export/reset/clear.                             |
| In-page assistant                                  | `src/content/floatingButton.ts`, `floatingButton.shadow.css`, `src/content/ui/GhostLabel.ts`, `pageStatus.ts`, `content.css`                           | FAB idle/loading/success/error/dragging/menu, field labels, page status, form/OTP context and exclusion rules.                                      |
| Browser-owned touchpoints                          | `src/background/notifications.ts`, `contextMenu.ts`, `manifest.json`, `manifest.full-overrides.json`, `public/assets/icons`                            | Native notifications, menu labels, toolbar icon/title, keyboard commands, full/public profile differences.                                          |
| Shared foundation                                  | `src/frontend/styles/globals.css`, `src/frontend/ui/index.tsx`, `src/shared/theme.ts`, `src/frontend/i18n.ts`, `public/_locales/{en,es}/messages.json` | Tokens, primitives, motion, theme, labels/localization.                                                                                             |

### Findings to resolve during implementation

- There is already a coherent token draft in `MASTER.md` and `globals.css`; implementation should refine and enforce it across all surfaces.
- Large CSS files include layers of legacy names and later overrides (`memphis-card`, `spectral-title`, `email-glow`, shimmer and multiple material rules). Consolidate only after recording rendered baselines so removing a selector does not change behavior unexpectedly.
- Shared components and animation presets coexist with component-specific CSS and Framer Motion settings. Define one motion contract, then remove duplicate treatment as each surface is migrated.
- The public build hides Gmail through `IS_GMAIL_ENABLED`; both build profiles need complete, intentional layouts. The options and popup content must not imply Gmail capability in the public profile.
- Notifications are rendered by Chrome. GhostFill controls their copy, icon, buttons, timing, and destination; it does not control native notification material or geometry.
- Some state labels remain literal English in components while EN/ES locale files exist. Inventory all user-facing strings before polishing copy.
- The last design baseline was reviewed from source. Actual Chrome-extension screenshots across states are still an implementation deliverable, so exact spacing decisions remain subject to visual comparison.

## 4. Visual system specification

### 4.1 Layers and material

1. **Canvas:** quiet neutral `--gf-bg`; a slight tonal difference from content surfaces is enough. Avoid wallpaper or decorative glow behind utility content.
2. **Content:** `--gf-surface` and `--gf-surface-2`, hairline separators, no backdrop blur. Address text, password, OTP, inbox rows, email body, and settings all live here.
3. **Functional layer:** one reusable CSS treatment for the popup header/segmented control, options toolbar/rail where appropriate, anchored menus, dialogs, toasts, and FAB. Base style is a legible solid fill. Apply small-area `backdrop-filter` only when supported. Do not animate blur.
4. **Scrim:** dim background under modals and isolate interaction. Modal text sits on a sufficiently opaque surface even when its perimeter has a glass treatment.
5. **Host-page isolation:** all in-page controls inherit generated Shadow DOM tokens and use the same solid fallback regardless of the website behind them. No page-specific light sampling is required for the first pass; predictable contrast is more important.

Material acceptance: no glass on lists or dense cards, no control nested inside another independently blurred control, and no text contrast dependent on the underlying page. `prefers-reduced-transparency` and `prefers-contrast: more` switch functional surfaces to opaque fills and stronger borders. Keep the number and area of blurred layers small. [Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Liquid Glass Widgets architecture](https://raw.githubusercontent.com/sdegenaar/liquid_glass_widgets/main/skills/liquid-glass-widgets/SKILL.md).

### 4.2 Color, type, spacing, and geometry

| Role            | Direction                                                                              | Review rule                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Action          | Existing `--gf-primary` system blue (`#0066cc` light, `#0a84ff` dark).                 | One dominant filled action per view/decision group; blue never means mere decoration.                           |
| Status          | Existing success, warning, danger semantic tokens.                                     | Pair hue with icon and text. Danger only for real loss/error; do not make “generate password” look destructive. |
| Ink             | Existing primary/secondary semantic tokens.                                            | Body and critical instructions at WCAG AA contrast; subdued text only for metadata.                             |
| Display/UI font | Existing platform system stack.                                                        | Sentence case, tight hierarchy, short headings, clear numeral alignment.                                        |
| Data font       | Existing bundled IBM Plex Mono.                                                        | Addresses, generated passwords, OTPs, shortcuts, and numeric values; avoid mono for paragraphs.                 |
| Spacing         | Existing 4 px scale.                                                                   | 12–16 px popup gutters; 8–12 px vertical rhythm; aligned labels, values, and actions.                           |
| Shape           | Controls 10–12 px, groups 16 px, floating panels up to 18 px; pill for segments/chips. | Consistent radii with no indiscriminate capsules.                                                               |
| Elevation       | Flat content; subtle shadow on floating controls.                                      | Depth communicates overlay order, not card decoration.                                                          |

Define typography roles in tokens rather than selector-by-selector values: popup page title, section heading, data value, body, helper, metadata; options page title, group heading, row label, help text. Preserve readable body text. A value can truncate visually only when the full value is available through copy and an accessible label/title. Compare EN and ES at the narrowest supported width. [Apple Typography](https://developer.apple.com/design/human-interface-guidelines/typography), [Apple Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode).

### 4.3 Components and interaction states

Every shared component has `rest`, `hover` where a fine pointer exists, `focus-visible`, `pressed`, `disabled`, `loading`, and any semantic success/error state. A state change uses text or a symbol in addition to color.

- **Primary button:** solid blue, white or contrast-correct foreground, action verb, internal progress indicator and in-place loading text; avoid layout shift.
- **Secondary button:** solid quiet surface or transparent background with border. **Destructive button:** danger only when the outcome destroys or disconnects data.
- **Icon button:** accessible name and tooltip/title, 44 × 44 px hit area in popup/in-page controls, visible focus ring; icon visually centered within a smaller glyph box.
- **Segmented selector:** equal-sized choices with one selected indicator; use it for Temp mail/Gmail and alias subviews, not for unrelated actions. Preserve arrow-key behavior and tab semantics. [Apple Segmented Controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls).
- **Grouped row:** whole row is a button/link if interactive; separators express structure; address or subject text is selectable where copying matters.
- **Text field/select:** persistent visible label, helpful example, inline validation next to the field, keyboard handling, focus restoration after menu close.
- **Switch:** button with `role="switch"`, explicit name, `aria-checked`; visual track may be small inside a 44 px target.
- **Dialog/menu:** one obvious action, Escape to close, focus trap for modal, return focus to trigger, correct `aria-labelledby`/`aria-describedby`, and no background keyboard access.
- **Toast/status:** ordinary successes appear near the action; global toast only for cross-view results. Screen-reader announcement describes the result without duplicating every visual update.
- **Empty/skeleton:** skeleton mirrors the real layout and stops once data is ready. Empty content explains the next useful action.

### 4.4 Motion

Use existing motion tokens as the baseline: approximately 120 ms for press/copy feedback, 160–220 ms for view changes, and up to 340 ms for a rare larger overlay. Prefer opacity and small transforms. Frequent keyboard actions and inbox navigation should feel instant. Avoid animated blur, cycling shine, repeated pulses, unrelated card entrance staggering, and layout movement after a copy action. Reduced motion removes nonessential movement; a progress indicator may remain semantic and calm. The interface should feel responsive before it feels animated. [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Apple Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

## 5. Experience architecture and wireframes

### 5.1 Popup: one primary task at a time

At normal size, show the current email mode, active identity, immediate utility actions, and latest verification/inbox status. Secondary configuration belongs in a detail view or settings. The hub must not require scanning a row of equally prominent buttons.

```text
┌──────────────────────── 375 px ────────────────────────┐
│ GhostFill                                  Help  Settings │
│ [ Temp mail             | Gmail ]  (full build only)    │
│                                                        │
│ ACTIVE IDENTITY                                        │
│ hello@provider.tld                         [Copy] [New] │
│ Password ••••••••••••                    [Show] [Copy] │
│                                                        │
│ VERIFICATION / INBOX                           View all │
│ Latest sender · subject · useful preview              │
│ Code ready / waiting / no messages, as applicable     │
└────────────────────────────────────────────────────────┘
```

This is a hierarchy sketch, not fixed pixel art. If a state requires a primary action such as “Connect Gmail” or “Generate email,” that action replaces irrelevant content rather than pushing the core controls below the viewport. At 200% zoom, use internal scrolling and keep focusable controls reachable. The public build renders a complete Temp mail layout without an empty Gmail selector.

**Popup navigation model:** Hub → Email inbox, Passwords, OTP, or Aliases → back to Hub; message viewer and confirmation are overlays. Route transitions preserve context and focus. If the user switches Temp/Gmail, `currentEmail` and the displayed active address must agree. When Gmail is disconnected, show the exact capability available (manual alias generation versus inbox requiring OAuth).

### 5.2 Options: calm navigation and a reading column

```text
┌───────────────────────────────────────────────────────────────────┐
│ GhostFill Settings                            Search   Appearance │
│ Current behavior summary / load or save status                   │
├────────────────┬──────────────────────────────────────────────────┤
│ General        │ General                                          │
│ Email          │ Appearance                                      │
│ Passwords      │  Theme                 [ System / Light / Dark ] │
│ Automation     │  ...                                             │
│ Privacy        │ Notifications                                   │
│ Advanced       │  ...                                             │
│ About          │ App data                                        │
└────────────────┴──────────────────────────────────────────────────┘
```

At narrow width, navigation becomes a compact section chooser or stacked list that preserves every destination and keyboard behavior. The existing seven sections and command palette remain. The page title is the current section; each setting group has a short heading, aligned rows, a visible label and help text when needed, and a clear save/error state. Import, reset, and clear actions remain in Advanced with consequence-specific confirmation. Search should locate the existing section or setting, not become a second settings schema.

### 5.3 In-page assistant: useful at the point of action

The FAB appears only under the existing site/form rules. It is visually small but has a generous target and does not obscure a field, browser overlay, or page CTA. Its menu opens toward available space; action labels match popup terms. A field label states exactly what it fills. After action, feedback appears by the control and never implies a fill succeeded if the page rejected it. OTP ready has a clear icon/text signal. The hide-on-site action is easy to find and should take effect predictably. Preserve host-page isolation and existing financial/password-manager exclusions.

## 6. Full workflow specifications

### W1 — First run and orientation

- Show a clear GhostFill purpose in one sentence, then the three real capabilities: private address, password, verification help.
- Keep the existing local ghost mark, one main “Get started” action, concise privacy explanation, and direct access to settings/help.
- After dismissal, generate/open the current identity as existing behavior dictates; do not leave an empty decorative hub.
- A repeat opener goes directly to the last relevant active state.

### W2 — Disposable identity

- Make the active address the typographic anchor, with a copy action and explicit copied confirmation.
- Show provider/expiry and refresh state as subdued metadata only when useful; do not imply the address is permanent.
- “New email” is a secondary but discoverable action. If it discards the current inbox, the confirmation names that loss and offers Cancel and Generate.
- On provider delay/failure, preserve the last usable identity where possible, show the failure next to the affected action, and offer Retry.
- In the inbox, distinguish waiting for mail, checking, unread/new, message loading, provider failure, and expired address. A refresh should not blank a populated list.

### W3 — Gmail alias and connection

- Separate “create a Gmail alias” from “read its inbox” in copy and state. Manual connection may create aliases without inbox access; OAuth connection enables inbox.
- The setup screen must explain what Google sign-in enables before the button. Preserve cancellation and setup error remedies.
- The alias generator uses a labeled website/domain field, live or explicit result, clear copy feedback, and the source Gmail account shown as context.
- Keep Generator, Inbox, History as related subviews with consistent tab semantics. Show sign-in, loading, empty, auth-expired, provider error, and message view states.
- Sign-out/disconnect explains the effect on the current fill source and gives feedback when complete.
- In the public build, remove all Gmail affordances and preserve spacing and headings for the remaining feature set.

### W4 — Password generation

- Current password is masked by default. Show and Copy are distinct accessible actions; copying never forces reveal.
- New password generation uses a precise label and immediate progress state. Saved defaults such as length/options remain in the detail view.
- A generation error leaves the previous usable password intact and supplies a retry path.
- In-page fill communicates whether the target field accepted the value; preserve generated-value privacy.
- History, if available, is discoverable without competing with the current value.

### W5 — OTP and activation link

- “Waiting,” “Checking,” “Code ready,” “Expired,” “No code found,” and “Could not check” each need distinct copy, icon, and next action.
- A ready code is set in mono type with a clear Copy or Fill action; countdown is supplemental, not the only expiry cue.
- When extraction finds several candidates, avoid false certainty. Surface the chosen source or prompt the user to inspect the email, according to existing engine behavior.
- Activation links show destination context and a clear open action. Preserve the existing safe-link guard and blocked-link explanation.
- The same status vocabulary appears in popup, in-page label, page-status banner, and native notification.

### W6 — Message reading

- Open the recent message from the hub and full inbox through the same viewer contract.
- Prioritize sender, subject, date, extracted code/link, then body. Keep plain-text reading legible and HTML sandboxed.
- Loading does not flash stale content from a previously selected message. Message-read failure offers retry and a way back.
- Remote email images/assets remain blocked by default and are explained plainly. Message content must never restyle the GhostFill shell.
- Viewer close returns focus to the originating message row; keyboard scrolling works without trapping the user.

### W7 — Settings, automation, and data controls

- Keep all seven current options tabs and current setting meanings. Improve scanning through aligned labels, supporting text, separators, and compact grouped sections.
- Autosave state has a consistent model: Saving → Saved; Invalid and Failed have field-level or global remedies; Retry is explicit. Avoid a silent “saved” claim while settings are still pending.
- Provider health is informative, not a wall of decoration; show status and an explanation a user can act on.
- Shortcuts use the keys actually registered by Chrome and link to browser shortcut settings where supported.
- Import/export/reset/clear must state scope, consequence, and completion; imported data remains schema-validated.
- Theme follows the saved System/Light/Dark behavior already supported by the state model; change feedback must not cause a light/dark flash.

### W8 — Browser-owned UI and brand assets

- Audit Chrome notification title/message/button verbs, icon, auto-clear, and click destination for each existing category: OTP, email, link, success, error, system.
- Do not expose the full OTP or private email body in a notification preview; retain current masking and privacy intent.
- Audit context menu names against popup names; retain shortcut meaning across menus and options.
- Review toolbar icon at 16, 32, 48, and 128 px in light/dark browser chrome for legibility; keep the GhostFill mark recognizable rather than introducing Apple artwork.

## 7. State and copy matrix

Each state below needs a designed visual, exact copy, accessible announcement if important, and a recovery route where applicable. Capture it in both light and dark, and in both build profiles when the feature exists.

| Area                | Required states                                                                            | Minimum recovery/feedback                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Popup boot          | loading, first run, ready, initialization failure                                          | Stable skeleton; retry or safe explanation on failure.                                   |
| Identity            | none, generating, active, copied, expired, provider error, replacing                       | Generate/retry; current identity retained until replacement succeeds; loss confirmation. |
| Gmail               | absent in public, disconnected, manual, signing in, connected, expired auth, fetch failure | Connect/sign in/retry with precise capability language.                                  |
| Inbox               | empty, waiting, checking, unread, opening, read, provider failure                          | View all, refresh/retry, back to identity.                                               |
| Message             | loading, plain text, HTML, OTP/link found, no extraction, unsafe link, error               | Copy/Open only if valid; safe explanation and back/retry.                                |
| Password            | missing, generating, generated, masked, visible, copied, error                             | Generate/retry while retaining prior usable value.                                       |
| OTP                 | waiting, checking, ready, copied, filled, stale, expired, ambiguous, error                 | Copy/fill/inspect message/check again as appropriate.                                    |
| FAB/field label     | hidden, idle, focus, menu, dragging, loading, success, error, OTP ready                    | Escape/close, retry, hide on site; no false success.                                     |
| Options             | loading, dirty/saving, saved, invalid, save failed, load failed, import/clear confirmation | Inline validation, retry, cancellation, focus restoration.                               |
| Chrome notification | suppressed, permitted, delivered, clicked, unavailable                                     | Correct actionable copy; no duplicate noisy alerts.                                      |

**Copy pattern:** state name + relevant object + next step. Examples: “Checking inbox…”, “Code ready to fill”, “Couldn’t load the message. Retry”, “This link was blocked because its destination could not be verified.” Use sentence case and the same term for a feature everywhere. Audit EN and ES catalog coverage for all user-visible strings, including screen-reader labels and notification buttons. [Apple Writing](https://developer.apple.com/design/human-interface-guidelines/writing).

## 8. Implementation sequence and file-level work

Each work package ends with a reviewable screen/state set. Use the current working tree as the starting point. Scope changes to UI and necessary interaction wiring; keep data services and message contracts stable unless a specific UX defect requires a targeted correction.

### P0 — Capture and classify the existing UI

**Files to inspect:** `PRODUCT.md`, `design-system/ghostfill/MASTER.md`, `src/frontend/README.md`, `manifest.json`, `manifest.full-overrides.json`, all surfaces in §3.  
**Actions:** record `git diff` and preserve existing changes; capture the full and public popup, each popup view, all seven options tabs, FAB and field label, both themes, and key empty/error states in an authorized Chrome extension environment; build a route/state inventory and list inconsistent tokens, CSS overrides, strings, and focus problems.  
**Output:** before gallery, component/state map, prioritized issue list.  
**Exit:** every existing surface has an owner and baseline image or a documented reason it cannot yet be captured.

### P1 — Freeze the design contract

**Files:** `design-system/ghostfill/MASTER.md`, `src/frontend/styles/globals.css`, `src/shared/theme.ts`, `src/frontend/ui/index.tsx`.  
**Actions:** reconcile token names, values, dark counterparts, borders, motion, hit targets, and glass fallback; create a short component spec for buttons, fields, switches, segmented controls, grouped rows, panels, overlays, toast, and empty states; retain one Lucide weight/grid and local product marks. Remove dead aliases only after references have been migrated.  
**Output:** token table, two-theme component sheet, accessible state sheet.  
**Exit:** popup/options/Shadow DOM tokens describe the same roles; no component needs a literal color to express a core state.

### P2 — Popup shell and hub hierarchy

**Files:** `src/frontend/popup/App.tsx`, `src/frontend/popup/components/Hub.tsx`, `SharedComponents.tsx`, `src/frontend/popup/popup.css`.  
**Actions:** establish header, navigation, segment, identity value, password row, and inbox preview alignment; settle one primary action per current state; preserve compact height and accessible internal scrolling; unify copy feedback; keep the full/public mode branch intentional.  
**Output:** hub in Temp active/empty/error and Gmail connected/disconnected states.  
**Exit:** at 375 × 400 the active identity and current next action are visible without scrolling at normal zoom; all actions are keyboard operable.

### P3 — Popup detail journeys

**Files:** `EmailGenerator.tsx`, `AliasPanel.tsx`, `SharedComponents.tsx`, `App.tsx`, `popup.css`.  
**Actions:** redesign disposable inbox, alias generator/inbox/history, password, OTP, onboarding, help, and email viewer to the component contract; remove obsolete decorative classes and stacked CSS overrides as each area is complete; keep confirmations, focus, and safe email rendering.  
**Output:** route-by-route state gallery for W1–W6.  
**Exit:** no route has generic empty/error copy, competing filled actions, clipped controls, or decorative glass behind content.

### P4 — Options information architecture

**Files:** `src/frontend/options/OptionsApp.tsx`, `components/OptionsUI.tsx`, `components/OptionsTabs.tsx`, `options.css`.  
**Actions:** refine rail/top bar and narrow layout; normalize setting row geometry and section spacing; keep seven destinations and command palette; clarify save/load/validation states and provider health; review every destructive dialog; eliminate inline styling where a shared token/class suffices.  
**Output:** desktop and narrow options gallery for all tabs and modal/search states.  
**Exit:** settings are findable by navigation and search; no horizontal page overflow at 375/768/1024/1440 px; save status and validation are unambiguous.

### P5 — In-page design and behavior

**Files:** `src/content/floatingButton.ts`, `floatingButton.shadow.css`, `ui/GhostLabel.ts`, `ui/pageStatus.ts`, `styles/content.css`, `src/shared/theme.ts`, `src/shared/icons.ts`.  
**Actions:** map popup actions to in-page labels; refine FAB/menu/tooltip/field-label geometry, anchoring, collision handling, keyboard and touch behavior, and state feedback; normalize the current custom SVGs to the same optical grid/stroke as the Lucide interface while retaining local icon constraints; maintain Shadow DOM and excluded-site behavior.  
**Output:** screenshots on simple, dense, dark, light, and responsive host pages, including a form with OTP.  
**Exit:** no host CSS bleed, blocked field, offscreen menu, ambiguous status, or inaccessible menu action.

### P6 — Copy, browser touchpoints, and asset polish

**Files:** `src/frontend/i18n.ts`, `public/_locales/en/messages.json`, `public/_locales/es/messages.json`, `src/background/notifications.ts`, `src/background/contextMenu.ts`, `public/assets/icons`, popup/options components with literal strings.  
**Actions:** inventory and localize visible strings; align copy vocabulary; check notification privacy and action mapping; polish GhostFill icon sizes and local provider marks; inspect any remote profile-image behavior against the privacy baseline.  
**Output:** content glossary, EN/ES state copy map, icon sheet.  
**Exit:** each visible state has precise text; no untranslated label, missing accessible name, accidental sensitive preview, or icon family drift.

### P7 — Accessibility, performance, and CSS consolidation

**Files:** all touched UI files; `src/frontend/styles/globals.css`; focused UI tests under existing `tests/` or colocated test paths where useful.  
**Actions:** keyboard and screen-reader walkthrough; contrast measurements in both themes and stronger-contrast mode; zoom and text scaling; reduced motion/transparency; measure popup first paint and interaction responsiveness; inspect blur regions and bundle change; consolidate migrated CSS and remove dead rules with before/after image comparison.  
**Output:** accessibility issue log, performance/bundle comparison, final state gallery.  
**Exit:** all acceptance gates in §9 are satisfied, with any remaining limitation recorded explicitly.

### P8 — Release review

**Files:** `README.md`, `src/frontend/README.md`, design-system baseline, relevant screenshots/docs, build outputs only when intentionally generated.  
**Actions:** verify full and public profiles, test critical signup journeys on real pages, review diff for manifest/CSP/permission changes, document the new UI language for future contributors, and package screenshots for reviewer comparison.  
**Exit:** a reviewer can compare before/after, navigate every feature, and see that the redesigned UI preserves behavior and privacy.

### Delivery risks and controls

| Risk                             | Why it matters here                                                                                             | Control during implementation                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS cascade drift                | Popup and options have large stylesheets with historic class names and late overrides.                          | Change one surface at a time; capture before/after at the same size and theme; remove a legacy rule only after its remaining selectors are traced.        |
| Popup height pressure            | The browser action is compact and state-specific copy can grow.                                                 | Maintain a content budget at normal zoom; test long copy and internal scrolling at enlarged text; keep the active identity above details.                 |
| Host-page conflict               | In-page UI appears over arbitrary websites, including dark/bright/animated pages.                               | Preserve Shadow DOM isolation, viewport collision logic, solid fallback, focus behavior, and excluded-site rules; review representative real forms.       |
| Overdraw from glass              | Several blurred surfaces in a small popup or over scrolling page content can harm readability and performance.  | Count blurred areas in every view; inspect scrolling and low-power behavior; fall back to opaque treatment where the material does not improve hierarchy. |
| Cross-context state mismatch     | Popup, service worker, content script, and storage can update at different times.                               | Keep existing messaging contracts; test mode switches, OTP freshness, delayed provider responses, and reopening the popup after an action.                |
| Provider and profile differences | Gmail auth is available only in the full build; provider data can fail independently of UI.                     | Review full/public screenshots and state matrix; avoid capability claims the current build cannot fulfill.                                                |
| Privacy regression               | Visual assets and message viewers could make remote requests or expose secrets.                                 | Use local assets, retain email sandbox and link guard, review remote profile imagery, and keep sensitive notification content masked.                     |
| Accessibility regression         | Custom segmented controls, selectors, dialogs, and animated views can lose keyboard or screen-reader semantics. | Include focus and announcement behavior in component specs, then run route-by-route keyboard and assistive-technology walkthroughs.                       |

## 9. Acceptance gates

### Visual and functional

- At first glance the popup answers: which identity is active, what can be copied/filled, and whether verification is pending or ready.
- Light and dark have the same hierarchy; dark is tuned semantically rather than generated by simple color inversion.
- Content never relies on blur to be readable. Functional glass has a supported and a solid fallback.
- No two prominent filled actions compete in one decision group. Every icon-only control has a discoverable meaning.
- Current value, inbox, OTP, and message states retain existing functionality; public build has no orphaned Gmail UI.
- Navigation/overlays restore focus and preserve context; switching modes updates the actual fill source.

### Accessibility and responsive

- WCAG 2.2 AA text contrast: **4.5:1 for normal text**, **3:1 for large text and nontext UI components** where applicable; use a stronger target for small metadata.
- Popup and in-page interactive targets meet the project 44 × 44 px baseline; visible focus survives light/dark and glass/solid fallbacks.
- Tablist arrow/Home/End behavior, switch state, modal focus trap/Escape/return, menu keyboard access, live announcements, and screen-reader names work.
- Test popup 375 × 400 and 360 px; options 375/768/1024/1440 px; 200% zoom or equivalent text enlargement; long EN/ES strings; reduced motion, reduced transparency, and increased contrast.
- No essential state is conveyed by color or animation alone; no overlay blocks browser or host-page controls.

### Reliability, privacy, and performance

- A failed generation, save, auth, extraction, or email read leaves a safe recoverable state and never reports false success.
- Message HTML remains sandboxed, links remain guarded, imported settings remain validated, and native notifications keep sensitive content masked.
- No new manifest permission, remote font/UI asset, dependency family, or runtime network request is introduced solely for visual styling.
- Glass stays on few small fixed surfaces; scrolling lists and task content remain opaque. Motion uses transforms/opacity where possible and honors reduced motion.
- During implementation, run the existing project checks after relevant slices: `npm run type-check`, `npm run lint`, `npm test`, `npm run build`, `npm run build:public`, and `npm run bundle:check`, plus targeted manual Chrome workflows. This document itself does not imply those checks have been run.

### Review scorecard

Score every surface from 0–3 for each dimension; a release candidate needs **3** for task clarity, accessibility, and privacy, and at least **2** for visual craft and motion, with no open critical failure. Dimensions: hierarchy; typography; contrast; spacing/alignment; material restraint; component consistency; feedback/copy; keyboard/screen reader; narrow/zoom behavior; privacy/security; performance. Keep before/after screenshots beside this scorecard so subjective polish has visible evidence.

## 10. Decision log and open design checks

| Decision                                                                    | Reason                                                                                 | Alternative considered                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Translate Apple HIG and Flutter reference into native React/CSS.            | GhostFill is a Chrome extension with an established stack.                             | Port Flutter widgets or add a shader renderer.            |
| Keep existing semantic tokens and refine them.                              | A partial baseline already exists; one token system is easier to maintain.             | Introduce a parallel theme library.                       |
| Use glass for functional overlays; solid materials for task content.        | Clear hierarchy and readability match the source guidance and privacy utility context. | Apply translucency to every card.                         |
| Keep one GhostFill accent and one Lucide icon family.                       | Consistency and bundle control across popup/options/content.                           | Mix SF Symbols, emoji, and custom packs.                  |
| Preserve the compact popup and progressive detail views.                    | The product is used during an external website flow and must be fast to scan.          | Turn the popup into a long dashboard.                     |
| Design native Chrome notifications through copy, timing, icon, and routing. | The browser owns their visual material.                                                | Simulate a custom Apple notification layer over websites. |
| Preserve both full and public builds.                                       | Current build profile intentionally removes real-mail OAuth features.                  | Assume one universal Gmail interface.                     |

**Checks during the first visual review:** confirm the exact popup height budget with rendered screenshots; decide whether the options rail needs glass or a solid material in the actual page composition; evaluate whether the in-page FAB should default dark on mixed host pages; compare normal and high-contrast material at scroll edges; verify whether any existing animation conveys necessary state before removing it. These are visual tuning decisions within the direction above, not blockers for the plan.

## 11. Recommended delivery order

Deliver in slices **P0–P1 → P2 → P3 → P4 → P5 → P6 → P7–P8**. Each slice should include a before/after view, an updated state matrix, a concise diff summary, and the relevant acceptance checks. The design system and popup hierarchy establish the standard; options and in-page surfaces then inherit it. Reserve a dedicated pass for empty/error and accessibility states rather than treating them as incidental cleanup.

The redesign is complete when the user can move from an online form to a GhostFill identity, receive and use verification, adjust behavior, and recover from failures through one consistent, calm interface across every existing surface.
