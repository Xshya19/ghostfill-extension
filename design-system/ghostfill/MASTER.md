# GhostFill Design System — Private Workspace

**Status:** production baseline

**Surfaces:** 375×400 popup, responsive options page, in-page Shadow DOM controls

**Design dials:** variance 5/10 · motion 4/10 · density 7/10

GhostFill is a focused privacy utility. It should feel calm, precise, and browser-native—not like a marketing site or a playful dashboard. Hierarchy comes from spacing, type, borders, and state; decoration stays subordinate to the task.

## Implementation guardrails

- Keep React, native CSS, Webpack, and the existing shared primitives. Do not add Tailwind, shadcn, a second token set, or a second icon family.
- Use only bundled fonts and assets. No remote fonts, remote UI images, or runtime style dependencies.
- `src/frontend/styles/globals.css` is the token source of truth. Surface styles may compose those tokens, not redefine the visual language.
- Lucide is the interface icon family. Brand marks use local bundled artwork. Do not use emoji as structural icons.
- Preserve extension behavior, manifest permissions, analytics hooks, accessibility semantics, and the fixed popup viewport while polishing UI.

## Visual language

### Color

Use semantic `--gf-*` tokens rather than literals.

| Role                 |     Light |      Dark | Token            |
| -------------------- | --------: | --------: | ---------------- |
| Canvas               | `#f7f8fa` | `#10151e` | `--gf-bg`        |
| Surface              | `#ffffff` | `#171e29` | `--gf-surface`   |
| Raised/hover surface | `#f2f4f7` | `#1d2632` | `--gf-surface-2` |
| Primary ink          | `#172033` | `#f3f6fa` | `--gf-ink`       |
| Secondary ink        | `#5e6b7c` | `#aab5c4` | `--gf-ink-soft`  |
| Tertiary ink         | `#667284` | `#7e8b9c` | `--gf-ink-dim`   |
| Action               | `#2f5fd0` | `#88a8ff` | `--gf-primary`   |
| Success              | `#14805c` | `#5ac89e` | `--gf-mint`      |
| Warning              | `#b66f00` | `#f2b64d` | `--gf-amber`     |
| Danger               | `#c43a3a` | `#f18484` | `--gf-coral`     |

Rules:

- Cobalt is the only general action accent. Status colors communicate status only.
- Default cards are flat with a hairline border. Reserve shadows for menus, dialogs, toasts, and other floating layers.
- Gradients, glass blur, ambient blobs, and decorative glow are not part of this system.
- Normal text must meet WCAG 2.2 AA contrast (4.5:1). Never use dim ink for critical instructions.

### Typography

- UI/display: bundled Space Grotesk.
- Data, generated identities, passwords, codes, and shortcuts: bundled IBM Plex Mono.
- Use sentence case. Prefer direct labels such as “Desktop notifications” and “Generate new email.”
- Popup body copy should not fall below 11px; options body copy should normally be 13px or larger. Tiny type is reserved for nonessential metadata.
- Avoid gratuitous uppercase, wide tracking, gradient text, and decorative headings.

### Geometry and rhythm

- Spacing follows the 4px scale in `globals.css` (`--space-1` through `--space-10`).
- Core radii: controls 8px, panels 12px, elevated dialogs up to 16px.
- Every interactive control must expose a minimum 44×44px hit area. Compact visuals may sit inside that area.
- Popup: keep a 12–16px gutter, an 8px primary vertical rhythm, and no document scrolling at 375×400.
- Options: one rail plus one reading column on desktop; two-column navigation then stacked content on narrow screens. Never introduce page-level horizontal overflow.

## Component contracts

### Buttons

- Primary: solid cobalt, high-contrast label, one per decision group.
- Secondary: quiet surface with hairline border.
- Destructive: coral only when the action is destructive.
- Icon-only controls require an accessible name and tooltip/title.
- Hover may lift by at most 1px on fine pointers. Press returns to the surface or scales to 0.97. Disabled controls never animate.

### Cards and rows

- A card groups one concept; avoid nested-card stacks.
- Clickable rows use a native button or link covering the full row, not a click handler on a generic `div`.
- Dividers and section headings provide structure before adding another container.

### Inputs and selectors

- Inputs and custom selectors have a visible label, 44px target height, clear focus ring, and inline validation.
- Error copy explains the remedy. Do not rely on color alone.
- Imported settings are treated as untrusted input and rebuilt from the known settings schema.

### Toggles

- The native button target is 44×44px minimum; the visual track remains compact inside it.
- Use `role="switch"`, an accessible name, and `aria-checked`.

### Dialogs and menus

- Trap focus, close on Escape, restore prior focus, and isolate siblings from keyboard and assistive technology.
- Dialog entrance: opacity plus a small translate/scale. No blur animation.
- One obvious completion action; avoid redundant close controls in tiny dialogs.

## Motion

Motion explains state and preserves context. It is not decoration.

- Default durations: 120ms feedback, 160–220ms state/view changes, up to 340ms for a rare large surface.
- Default easing: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Animate compositor-friendly `transform` and `opacity`. Avoid animated blur, large shadows, height when a transform can express the same relationship, and persistent `will-change`.
- Frequent keyboard actions are instant. List rows do not stagger in the inbox.
- Semantic progress may continue under reduced motion at a calm rate; decorative movement is removed.
- Honor both CSS `prefers-reduced-motion` and Framer Motion’s `reducedMotion="user"`.

## Accessibility and responsive baseline

- Semantic landmarks, headings, tablists/tabs, switches, dialogs, and status regions must expose correct roles and names.
- Keyboard focus is always visible; never suppress outlines without a stronger replacement.
- Touch targets are 44×44px minimum. Pointer-only hover states must not be necessary to understand or operate the UI.
- Verify popup at 375×400 and 360px width; verify options at 375, 768, 1024, and 1440px.
- Check light and dark themes, 200% zoom-equivalent layouts, long localized strings, empty/loading/error/success states, and reduced motion.

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
