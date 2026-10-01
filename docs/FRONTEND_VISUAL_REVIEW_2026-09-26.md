# GhostFill frontend look audit — 26 September 2026

Scope: the 375 × 400 popup, message reader, onboarding, Options page, and in-page control. Evidence includes the screenshots supplied in this task and the current React/CSS implementation. The screenshots predate this polish pass; the final build still needs a visual review inside an installed extension.

| Finding | Impact | Change in this pass |
| --- | --- | --- |
| Popup buttons accumulated a base style, page style, and optical style, producing different fills, radii, shadows, and hover behavior. | Primary and secondary actions competed visually. | Added a final popup action sheet with primary, secondary, icon, and destructive tiers; normalized geometry, type, hover, press, disabled, and focus states. |
| Header and utility icon buttons rendered their whole 44px target as a heavy glass square. | The toolbar felt crowded. | Kept a 44px target with a 34px visible optical capsule. |
| Alias copy, message-row open/copy, and account utilities used separate button treatments. | The popup changed visual language between screens. | Brought them into the same glass and tertiary tiers while keeping their full hit targets. |
| Segmented tracks and their moving selections both refracted the same area. | Tabs looked layered and blurry. | Made the track quiet and kept the optical effect on the selected thumb. |
| Inbox code and link actions read like extra primary buttons. | Message scanning was slower. | Kept 44px targets with smaller visible glass chips and semantic text color. |
| Message reader controls had a redundant “Message view” label and an always-visible Windows scrollbar. | Less room for the email and a busier header. | Removed the label, retained the accessible format group, and hid scrollbar chrome while preserving scrolling. |
| First-run benefits appeared as three separate cards. | The popup felt assembled from components. | Recast them as one grouped list with hairline separators. |
| Content sections used both hairline borders and broad shadows. | Depth was flat and repetitive. | Removed card shadows; reserved elevation for dialogs and overlays. |
| Several action labels used jargon or inconsistent title case. | The action was less predictable. | Renamed “Sync Inbox” to “Refresh inbox,” “Auto-Fill” to “Fill code,” and aligned related labels. |

## Material and behavior rules

- One blue primary action per decision group. Secondary actions use a clear glass surface. Tertiary icon actions have a quiet visible capsule inside a full hit target.
- Shape-matched refraction now covers icon lenses, the selected email segment, the Settings selector, and suitable reader controls. Content panels provide stable contrast for addresses, codes, settings, and messages; elevated menus retain a dense backing.
- Hover gives a small color change; press gives a short scale response. Loading and disabled states preserve labels and hit target geometry.
- Reduced transparency and increased contrast switch to solid surfaces. Reduced motion removes transition duration.

## Dark mode follow-up

- The shared root sets a definite light or dark color scheme so native controls follow GhostFill's preference instead of the operating system alone.
- Theme changes in Settings repaint immediately and save without the normal debounce. An invalid unrelated form field no longer blocks the theme preference from reaching the popup.
- The in-page floating control now reads the selected mode and updates when Settings changes. Its closed shadow root has both light and dark token sets.
- Plain-text email content uses semantic surface and ink colors. Formatted sender HTML still retains the sender's original colors for readability.

## Validation boundary

Source lint, type checking, production compilation, static design detection, and bundle size can run locally. A final visual check of light and dark popup states, long labels, inbox messages, and the Options page requires the installed extension in Chrome; the local preview route was blocked by the app's browser security policy during this task.

## Latest screenshot audit

All 15 supplied images were inspected at original resolution. Images 8/9 and 12/13 repeat the same state; 14/15 show the same popup composition with a small width difference. These findings describe the supplied images. Changes below are source corrections and require confirmation in the rebuilt extension.

| Images | Before | Source correction |
| --- | --- | --- |
| 1 | Dark Settings cards look blue and flat; bright beveled borders compete with content; translucent switch thumbs blend into enabled tracks. | Neutral panel material, restrained rims, lighter heading/label weights, and crisp light switch thumbs. |
| 2, 7 | Provider names and health metrics show through the menu and collide with option labels. | Split menus from content panels; elevated material uses 94–96% opacity and 24–26px blur, with solid fallback. Menu aligns at the trailing edge of its control, has 44px rows, and scrolls only its own list. |
| 3, 8, 9 | Secondary actions appear gray and heavy; the Advanced heading is concealed after scrolling or switching sections. | Remove full-control chromatic filters, soften control shadows, return section navigation to scroll position zero, and increase sticky-header opacity. Normalize “Clear data” sentence case. |
| 4 | Version display is terse and the storage bar implies at least 2% usage even for a nearly empty store. | Explicit version label and accurate proportional storage fill with an accessible byte count. |
| 5, 6 | Light controls and selected navigation look dark gray; the open theme menu exposes the enabled switch below it. | Clear neutral controls without chromatic splitting; stable blue selected navigation; readable elevated menu; rename the Light/Dark/System field “Color theme.” |
| 10, 11 | Search exposes the entire Settings page through its rows; the focus outline cuts across rounded corners; seven rows force needless scrolling. | Readable elevated search surface, inset rounded search field with search/close icons, compact 48px result rows, viewport-based list height, and highlighted-result scrolling. Keyboard handling belongs to the input so the close button works independently. |
| 12, 13 | Dark popup selection has a diamond-like glint; utility buttons use different materials; empty inbox has one vague line in a large blank space. | Remove selection displacement and chromatic blending, unify icon capsule material/press response, and center a clear inbox state with a useful next step. |
| 14, 15 | Light header buttons are gray while identity actions are nearly invisible; the selector glint remains. | All icon capsules use the same shared material with a gentle single displacement pass; selected segments use stable blur. |

### Related in-page control correction

The last optical CSS rules used dark color literals in both themes. They now use the selected theme's shared control/elevated tokens. The in-page icon distortion matches the gentle popup treatment; menu labels use denser readable glass. Existing 120–200ms interaction motion and reduced-motion behavior are retained.

### Runnable boundary check

The menu scroll adjustment is checked for a row above, below, and inside the visible list. Run from the repository root:

```powershell
node -e "const assert=require('node:assert/strict'); const delta=(top,bottom)=>Math.min(0,top-100)+Math.max(0,bottom-200); assert.equal(delta(80,124),-20); assert.equal(delta(180,224),24); assert.equal(delta(120,164),0);"
```

This arithmetic check does not replace a browser check of focus, layout, theme persistence, or animation.

### Checks completed for this pass

- TypeScript compilation: passed.
- ESLint: passed.
- Static design detector on changed frontend and in-page styles: no findings.
- Menu scroll arithmetic check above: passed.
- Production Webpack compilation: passed.
- Bundle budget: passed, 2.63 MB unpacked.
- Live extension visual confirmation: pending; the browser preview remains unavailable under the app's security policy.

## Inbox and optical glass follow-up

The latest three screenshots were inspected at original resolution. This pass strengthens the clear control layer and replaces the centered inbox empty state. It supersedes the earlier restriction that kept selected segments and all labeled controls on blur alone.

| Image | Finding | Correction |
| --- | --- | --- |
| 1 — dark popup | Flat gray surfaces, weak control depth, and an empty state that repeats the Inbox concept while consuming a whole column. | Curved lens edges, directional rim highlights, a compact 44px inbox toolbar, and a horizontal tray illustration with specific guidance. |
| 2 — light Settings | Nearly uniform white and gray layers make controls and panels difficult to distinguish. | A static blue, warm, and cyan light field; clear control bodies; opposing specular glints; a shaded lower edge; and a softly elevated navigation rail. Panel text keeps a stable reading surface. |
| 3 — light popup | Small utilities resemble ordinary white buttons; the inbox lacks a useful hierarchy. | Corrected 34px utility lens geometry inside 44px targets, stronger refraction, sharper ink, a quieter grouped message list, unread markers, readable subjects, and direct Copy/code and link actions. |

### What was adapted from the repositories

- The Flutter library supplies the material model: an undistorted interior, curved edge refraction, directional key and opposing highlights, and a shaded meniscus. Its control layer and reduced-motion/transparency guidance inform the composition. [Library](https://github.com/sdegenaar/liquid_glass_widgets), [shader](https://github.com/sdegenaar/liquid_glass_widgets/blob/main/shaders/lightweight_glass.frag).
- Press growth is adapted to the compact popup: the 34px visual icon lens grows 5% inside its existing 44px target, with its glyph stationary. This preserves neighboring hit areas. [Button implementation](https://github.com/sdegenaar/liquid_glass_widgets/blob/main/lib/widgets/interactive/glass_button.dart).
- The React reference supplies the local PNG displacement-map and SVG backdrop-filter technique. GhostFill now has separate maps for the selected pill, normal and wide controls, small utility icons, and the in-page button. The track and reading panels do not add a second refractive pass. [React renderer](https://github.com/LeonardSEO/liquid-glass-react).
- Both MIT notices are retained in `docs/third-party`. No Flutter runtime, new rendering dependency, remote asset, font, or icon family was added.

These are web adaptations, not Apple's private native rendering engine. Static maps are calibrated to the dominant control dimensions; a future geometry change must regenerate them. Menus stay at 94–96% material density so overlapping text cannot interfere with option labels.

### Interaction review

| Before | After | Why |
| --- | --- | --- |
| The entire utility button shrank, including its glyph. | Its glass surface grows to 1.05 over 150ms; the glyph and target remain fixed. | Tactile lens response without losing icon sharpness or shifting adjacent controls. |
| Glass highlights stayed flat during interaction. | A masked rim brightens on fine-pointer hover over 160ms. | Gives the surface a light response while keeping its label unobscured. Only opacity changes. |
| CSS segment travel could also run during arrow-key navigation. | Keyboard focus removes the segment transition and press transforms. | Frequent keyboard operations remain immediate. |
| Stronger optics could reduce a floating glyph's contrast on arbitrary sites. | The in-page control has a denser regular-material core and a clear perimeter. | Maintains a usable glyph while retaining edge refraction. |
| New effects could persist under accessibility preferences. | Reduced motion removes growth and transitions; reduced transparency/high contrast removes refraction and rim overlays. | The enhanced material has a usable solid fallback. |

**Source review verdict: Approve.** Added motion is bounded, interruptible, and limited to interaction feedback. No spring loop, animated blur, staggered inbox arrival, or pointer-tracking React state was introduced. Final animation feel and pixel appearance still need review in the installed Chrome extension because browser preview is blocked in this environment.

Source locations: `src/frontend/popup/popup-buttons.css:436` (lens growth), `src/frontend/popup/popup-buttons.css:332` (pointer highlights), `src/frontend/popup/popup-buttons.css:737` (keyboard press), `src/frontend/popup/popup-buttons.css:741` (keyboard segment travel), `src/frontend/popup/popup-buttons.css:814` (reduced motion), and `src/content/floatingButton.shadow.css:816` (regular-material core).

### Runnable optics check

```powershell
python scripts/generate-glass-lenses.py
```

The generator checks each map's neutral center, outward edge normals, and opaque alpha before writing it. The five maps total approximately 5.5 KB. Sampled contrast checks pass: secondary light ink on a blue-tinted backing is 4.68:1; primary light ink is 13.27:1; secondary dark ink on a panel is 4.99:1. These checks cover the specified colors, not a browser-rendered accessibility audit.

### Final build checks

- TypeScript and ESLint: passed.
- Formatting and whitespace checks on changed source: passed.
- Static design detector: no findings.
- Generator optics checks and sampled contrast checks: passed.
- Production build: passed; `dist` contains all five matching PNG maps, the shared optical CSS, and both MIT license notices.
- Bundle budget: passed at 2.65 MB unpacked.
- Live popup, Settings, and floating-control visual confirmation: pending because browser preview is blocked. Reload the extension from `dist` in Chrome before reviewing the updated materials.
