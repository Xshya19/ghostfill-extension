# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People completing online sign-up and verification flows, including privacy-conscious everyday users and developers or QA testers who repeat those flows often.

## Product Purpose

GhostFill is a Chrome Manifest V3 extension that creates disposable email identities or Gmail aliases, generates secure passwords, receives verification messages, and fills OTP codes or activation links without manual tab switching.

## Positioning

The extension combines privacy-first email identity, local OTP and magic-link extraction, and in-page form assistance in one browser-native workflow.

## Operating Context

Users open a compact browser popup while signing up on a website, configure persistent behavior in an options page, and interact with an in-page floating control when a form is detected.

## Capabilities and Constraints

- Preserve disposable mail, Gmail alias, password, OTP, activation-link, and form-fill functionality.
- Preserve existing settings structure, browser-extension permissions, keyboard interactions, and local assets.
- Use the existing React, TypeScript, native CSS, and Webpack implementation. Do not load remote UI dependencies or fonts.
- The popup must remain usable in its fixed browser-action viewport.

## Brand Commitments

The product name is GhostFill. It is privacy-first, local-heuristic, free, and open source. Its existing ghost mark and official provider logos remain product assets.

## Evidence on Hand

- [README.md](README.md) documents functionality, safety exclusions, and user workflows.
- [manifest.json](manifest.json) defines the browser-extension platform and permissions.
- [src/assets/logo.png](src/assets/logo.png) is the existing GhostFill mark.

## Product Principles

1. Make the current sign-up task faster without making the user think about implementation details.
2. Keep privacy and safety legible through precise feedback, not decoration.
3. Favor immediate scanning, direct actions, and recoverable states.
4. Keep interface behavior consistent across popup, options, and in-page tools.

## Accessibility & Inclusion

The UI must preserve keyboard operation, visible focus, semantic labels, reduced-motion behavior, sufficient text contrast, and readable compact layouts.
