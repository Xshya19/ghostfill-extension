# Frontend

Everything a user sees in an extension window lives here. Two entry points:

| Path | What it is |
|---|---|
| `popup/index.tsx` → `popup/App.tsx` | The 375×400 popup (fixed size — don't change it) |
| `options/index.tsx` → `options/OptionsApp.tsx` | The full-page settings console |

```
popup/     App.tsx  store.ts  hooks.ts  popup.css  index.html
           components/  Hub · EmailGenerator · AliasPanel · SharedComponents
options/   OptionsApp.tsx  options.css  index.html
           components/  OptionsTabs · OptionsUIComponents
ui/        index.tsx    shared components (Button, Card, Modal, Toast…) + motion tokens
styles/    globals.css   imported by popup.css and options.css (combines design tokens & primitives)
```

One file per concern: `hooks.ts` holds all popup hooks, `store.ts` the whole store,
`ui/index.tsx` every shared component plus its motion presets. No barrels to chase.

## What is deliberately *not* here

- `src/shared/theme.ts` — the theme controller and design-token source. Content scripts
  mirror these tokens into shadow DOM, so it can't live under `frontend/`.
- `src/content/` — page-injected UI (floating button, OTP labels). Different runtime,
  different webpack entry, no shared styling pipeline.

## Design system

"Spectre": dark-first graphite, one Iris accent, hairline borders, mono for data.
Tokens in `styles/globals.css`; dark is `[data-theme="dark"]`, light is `:root`.
