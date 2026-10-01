# GhostFill Design System — Liquid Glass

**Status:** production baseline

**Surfaces:** 375×400 popup, responsive options page, in-page Shadow DOM controls

**Design dials:** variance 5/10 · motion 3/10 · density 7/10

GhostFill is a focused privacy utility. Its visual language takes cues from Apple's Liquid Glass and Human Interface Guidelines, translated into the existing cross-platform browser extension. Translucent material now spans navigation, controls, identity panels, inbox rows, and settings sections. Text, verification codes, and email content remain legible through layered opacity and contrast fallbacks.

## Implementation guardrails

- Keep React, native CSS, Webpack, and the existing shared primitives. Do not add Tailwind, shadcn, a second token set, or a second icon family.
- Use the platform system UI font stack and bundled IBM Plex Mono for data. Keep artwork local; no remote fonts, remote UI images, or runtime style dependencies.
- `src/frontend/styles/globals.css` is the token source of truth. Surface styles may compose those tokens, not redefine the visual language.
- Lucide is the interface icon family. Brand marks use local bundled artwork. Do not use emoji as structural icons.
- Preserve extension behavior, manifest permissions, analytics hooks, accessibility semantics, and the fixed popup viewport while polishing UI.

## Visual language

### Color

Use semantic `--gf-*` tokens rather than literals.

| Role                 |     Light |      Dark | Token            |
| -------------------- | --------: | --------: | ---------------- |
| Canvas               | `#f5f5f7` | `#1c1c1e` | `--gf-bg`        |
| Surface              | `#ffffff` | `#2c2c2e` | `--gf-surface`   |
| Raised/hover surface | `#f2f2f7` | `#38383a` | `--gf-surface-2` |
| Primary ink          | `#1d1d1f` | `#f5f5f7` | `--gf-ink`       |
| Secondary ink        | `#60646c` | `#aeaeb2` | `--gf-ink-soft`  |
| Tertiary ink         | `#60646c` | `#aeaeb2` | `--gf-ink-dim`   |
| Action               | `#0066cc` | `#0a84ff` | `--gf-primary`   |
| Success              | `#248a3d` | `#30d158` | `--gf-mint`      |
| Warning              | `#9a6700` | `#ff9f0a` | `--gf-amber`     |
| Danger               | `#d70015` | `#ff453a` | `--gf-coral`     |

Rules:

- System blue is the only general action accent. Status colors communicate status only.
- Use one SDF displacement pass on shape-matched icon surfaces, the in-page button, the selected email segment, and suitable labeled controls. Keep the center neutral and bend only the curved rim. Avoid chromatic channel splitting on utility controls. Reading surfaces and dense menus use stable materials. Never blur text or message content.
- Use the shared material tokens from `globals.css`: panels, controls, clear tracks, and elevated surfaces. Menus and dialogs use `--gf-glass-elevated` with regular blur so underlying text cannot show through their labels; a solid fallback covers unsupported filters. Keep elevation subtle on cards and stronger on menus, dialogs, and floating controls.
- Light glass uses one soft upper glint and a thin neutral boundary; dark glass retains a subtle lower meniscus. Avoid stacking bevels or adding a second backdrop filter to reader chrome. Keep the popup, Settings, and Shadow DOM lighting consistent in both themes.
- Use a static ambient color field so refraction has a visible backdrop. Controls use a directional key highlight, a weaker opposing glint, and a shaded lower meniscus. Keep text and data on the readable panel depth; avoid ongoing decorative motion.
- `src/frontend/styles/optical-glass.css` is the shared optical layer for popup and Options; `src/frontend/ui/GlassFilterDefs.tsx` renders each page's filter definitions once. `scripts/generate-glass-lenses.py` regenerates five geometry-specific maps at 3× resolution and checks their neutral centers and outward normals. The in-page button embeds its own map for a 44px lens in its closed Shadow DOM.
- Light mode uses a neutral pearl canvas, brighter reading panels, and a clear navigation rail. Avoid pastel washes, raised icon tiles, and competing shadows. Unread dots and message count provide inbox status; the header has one “View all” action.
- In-page UI uses `generateHostThemeStyles()` and the existing theme controller. Form, OTP, and link feedback share `pageStatus`; it replaces the current message and owns one dismiss timer and one announcement region. Never create a second in-page toast engine.
- Normal text must meet WCAG 2.2 AA contrast (4.5:1). Never use dim ink for critical instructions.

### Typography

- UI/display: the platform system stack (`-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `system-ui`) for a native reading voice.
- Data, generated identities, passwords, codes, and shortcuts: bundled IBM Plex Mono.
- Use sentence case. Prefer direct labels such as “Desktop notifications” and “Generate new email.”
- Popup body copy should not fall below 11px; options body copy should normally be 13px or larger. Tiny type is reserved for nonessential metadata.
- Avoid gratuitous uppercase, wide tracking, gradient text, and decorative headings.

### Geometry and rhythm

- Spacing follows the 4px scale in `globals.css` (`--space-1` through `--space-10`).
- Core radii: controls 10–12px, panels 16px, elevated dialogs up to 18px; use pill shapes only for compact selectors and badges.
- Every interactive control must expose a minimum 44×44px hit area. Compact visuals may sit inside that area.
- Popup: keep a 12–16px gutter, an 8–12px primary vertical rhythm, and no document scrolling at 375×400. The welcome screen fits the viewport; long translations may scroll inside it without a persistent scrollbar. The hub inbox uses a compact 44px toolbar and one grouped list with sender, date, subject, unread state, and direct code/link actions. The empty state is a horizontal tray illustration and guidance, without repeating the Inbox heading.
- Options: a floating glass rail plus one reading column on desktop, with a clear page title above grouped glass settings; horizontal navigation then stacked content on narrow screens. Never introduce page-level horizontal overflow.

## Component contracts

### Buttons

- Primary: deep blue tinted glass, high-contrast white label, one per decision group.
- Secondary: transparent glass control with a visible hairline rim.
- Destructive: coral only when the action is destructive.
- Icon-only controls require an accessible name and tooltip/title.
- Hover may lift by at most 1px on fine pointers. Press returns to the surface or scales to 0.97. Disabled controls never animate.

### Cards and rows

- A card groups one concept; nested controls use a clearer material depth instead of another heavy card.
- Clickable rows use a native button or link covering the full row, not a click handler on a generic `div`.
- Dividers and section headings provide structure before adding another container.

### Inputs and selectors

- Inputs and custom selectors have a visible label, 44px target height, clear focus ring, and inline validation.
- Error copy explains the remedy. Do not rely on color alone.
- Custom menus align inside the reading column. Highlighted options scroll within the menu without moving the page. Command search keeps a rounded focus treatment and native input keyboard handling.
- Imported settings are treated as untrusted input and rebuilt from the known settings schema.

### Toggles

- The native button target is 44×44px minimum; the visual track remains compact inside it.
- Use `role="switch"`, an accessible name, and `aria-checked`.
- The thumb uses `--gf-switch-thumb`, a crisp light surface in both themes, to clearly separate it from the blue enabled track.

### Dialogs and menus

- Trap focus, close on Escape, restore prior focus, and isolate siblings from keyboard and assistive technology.
- Dialog entrance: opacity plus a small translate/scale. No blur animation.
- One obvious completion action; avoid redundant close controls in tiny dialogs.
- Section navigation returns to the top so the sticky Settings header cannot conceal the new page title. Search has enough space for all seven sections at a normal desktop viewport and scrolls on smaller screens.

## Motion

Motion explains state and preserves context. It is not decoration.

- Reader format selection lives in the footer beside one primary completion action. A detected link is actionable directly in the message summary; do not duplicate it as a footer action when a verification code is present. Privacy annotations follow the document rather than consuming its initial reading area.
- Feedback uses one nonblocking 48px capsule with a leading neutral icon, wrapping text, and 3–8 seconds of reading time. Repeated feedback updates a persistent announcement region. Place it above reader actions; never cover an action or make it intercept clicks. Settings save feedback uses status icons and one announcement region.

- Default durations: 120ms feedback, 160–220ms state/view changes, up to 340ms for a rare large surface.
- Default easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Animate compositor-friendly `transform` and `opacity`. Avoid animated blur, large shadows, height when a transform can express the same relationship, and persistent `will-change`.
- Labeled actions press to 0.985 over 120ms. Icon lenses gently inflate to 1.05 inside their fixed 44px target over 150ms while their glyph stays stationary. The in-page lens uses 1.03. Selected glass lenses move between stable labels over 180ms. Floating menus enter from their trigger over 180ms; rare dialogs arrive over 200ms. Controls never bounce or rotate for routine feedback.
- Settings section changes use a 160ms arrival only after pointer navigation. Keyboard navigation, command palette selection, and OTP values appear immediately. Do not stack CSS keyframes on elements already animated by Framer Motion.
- Frequent keyboard actions are instant. Keyboard focus disables segment travel and press transforms; reduced motion also removes them. List rows do not stagger in the inbox. Fine-pointer hover may brighten a masked rim over 160ms; only opacity changes, with no animation of blur or refraction strength.
- In-page success, error, and OTP readiness use clear icons and restrained border color. Avoid ongoing pulses and shakes for these states, including field highlights.
- Semantic progress may continue under reduced motion at a calm rate; decorative movement is removed.
- Honor both CSS `prefers-reduced-motion` and Framer Motion’s `reducedMotion="user"`.

## Accessibility and responsive baseline

- Semantic landmarks, headings, tablists/tabs, switches, dialogs, and status regions must expose correct roles and names.
- Keyboard focus is always visible; never suppress outlines without a stronger replacement.
- Touch targets are 44×44px minimum. Pointer-only hover states must not be necessary to understand or operate the UI.
- Verify popup at 375×400 and 360px width; verify options at 375, 768, 1024, and 1440px.
- Check light and dark themes, 200% zoom-equivalent layouts, long localized strings, empty/loading/error/success states, reduced motion, and reduced transparency.

## Privacy presentation

- Never load sender avatars, favicons, email images, fonts, or CSS from remote hosts without explicit user intent.
- Email HTML renders in a sandbox with a deny-by-default document CSP; remote assets are blocked and the user is told why.
- Sensitive values are not used as external URL parameters or third-party image lookups.
- Security and privacy states use plain, specific language—no fear-driven decoration.

## Pre-delivery checklist

- [ ] No runtime crash in any popup or options route.
- [ ] No unnamed control, generic clickable container, or undersized interactive target.
- [ ] No page-level horizontal overflow at supported widths.
- [ ] Light/dark contrast and visible focus verified.
- [ ] Reduced-motion behavior verified; no decorative infinite motion.
- [ ] Loading, empty, failure, success, and disconnected states remain usable.
- [ ] CSP, sanitization, settings import, and message boundaries remain hardened.
- [ ] Type-check, lint, complete tests, production build, bundle budget, cycle check, service-worker smoke test, and dependency audit pass.
