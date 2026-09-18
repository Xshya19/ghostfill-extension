# GhostFill Interface Hardening Summary

The active interface is **Private Workspace**: a restrained, browser-native system for a privacy utility. Earlier experimental glass, gradient, blob, confetti, and oversized-card directions are retired.

## Current composition

- Popup: one compact header, a two-option mail rail, a two-row identity dock, and one inbox surface.
- Options: slim header, horizontal behavior summary, grouped navigation rail, and one reading column.
- In-page controls: isolated Shadow DOM, consistent status colors, and motion that never blocks form entry.

## Quality baseline

- Local bundled fonts and artwork only.
- One semantic token system in `src/frontend/styles/globals.css`.
- Lucide for interface icons; no emoji-based structure.
- 44px interactive targets and visible keyboard focus.
- Short transform/opacity transitions with complete reduced-motion fallbacks.
- Native buttons/links for interactive rows and explicit ARIA for tabs, switches, dialogs, and statuses.
- Dark and light themes use the same hierarchy and meet normal-text contrast targets.

## Performance and privacy

- Flat cards and opaque surfaces avoid expensive backdrop blur.
- Dense inbox rows do not use staggered entrance animation.
- The bundled 128px mark replaces a redundant 768px popup asset.
- Remote sender imagery and email assets are blocked by default to prevent tracking.
- Email documents use a sandbox and deny-by-default document CSP.

The authoritative rules and delivery checklist live in `design-system/ghostfill/MASTER.md`.
