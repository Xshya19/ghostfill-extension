# Frontend

GhostFill’s user-facing extension surfaces use the **Private Workspace** design system: calm cobalt accents, opaque paper/slate surfaces, hairline structure, local Space Grotesk and IBM Plex Mono fonts, and purposeful motion.

| Entry point                                    | Surface                       |
| ---------------------------------------------- | ----------------------------- |
| `popup/index.tsx` → `popup/App.tsx`            | Fixed 375×400 extension popup |
| `options/index.tsx` → `options/OptionsApp.tsx` | Responsive full-page settings |

```text
popup/      App.tsx · store.ts · hooks.ts · popup.css
            components/Hub · EmailGenerator · AliasPanel · SharedComponents
options/    OptionsApp.tsx · options.css
            components/OptionsTabs · OptionsUI
ui/         Shared React primitives and motion tokens
styles/     globals.css — design tokens and primitive styling
```

`src/shared/theme.ts` controls theme application because content-script Shadow DOM also consumes the shared theme model. In-page UI remains under `src/content/`, with its own isolated stylesheet and runtime constraints.

Use `design-system/ghostfill/MASTER.md` as the product baseline. Keep controls semantic, targets at least 44px, motion transform/opacity based, and all runtime assets local.
