# GhostFill — Layer 3 audit verification and light-theme refinement

Reviewed 26 September 2026 against the working tree and the supplied screenshots. This report covers every supplied finding, 98–155. The pasted audit was treated as a set of claims to investigate. Its severity labels and proposed implementations were not assumed to be correct.

## What the screenshots establish

- The light Settings view has weak separation between canvas, navigation, and reading panels. Small utility buttons cast too much shadow relative to their function.
- The inbox header competes with the message row: a separate “New” label repeats the unread dot/count, while “Open” does not describe the destination clearly.
- The Qwen plain-text reader reproduces whitespace-only email spacer lines, leaving a large blank region between meaningful paragraphs. The formatted email remains an author-supplied document; its white background in dark mode is intentional.
- The three latest images do not establish live animation quality, GPU performance, screen-reader behavior, or closed Shadow DOM filter interoperability. Those require a running browser.

## Changes implemented

1. **Light materials:** quieter pearl canvas, clearer reading panels, a more translucent navigation rail, neutral hairline borders, one light-mode inner highlight, and restrained utility-button shadows. Light section icons no longer sit inside a second boxed surface. Dark materials retain their existing backing.
2. **Inbox and reader:** sender and subject typography are separated more clearly; the redundant header “New” label is removed; “View all” is localized in English and Spanish. Plain text removes whitespace-only spacer lines and limits repeated blank lines while preserving paragraphs and meaningful indentation.
3. **In-page feedback:** the existing `pageStatus` singleton now handles form, verification-code, and activation-link feedback. The separate OTP toast class and FAB sentinel toast are deleted. A newer notification cancels the previous dismiss timer; repeat announcements replace a text node in one persistent polite region. Loading, information, success, and error remain distinct states.
4. **Theme synchronization:** FAB, inline labels, and page feedback share the existing theme controller and one generated light/dark palette. A detached controller ignores pending storage reads. Light ink aliases and success foreground/background pairs are corrected.
5. **Touch and placement:** the FAB uses 44px geometry consistently, long press tolerates up to 8px of movement, and a completed long press suppresses the synthetic tap. FAB tooltips clamp to the viewport and flip below when necessary. Inline tooltip positioning is also clamped.
6. **Inline field indicators:** cached stylesheets replace one allocation per field; unnecessary delayed entry, icon wobble, old shadow stacks, and duplicate focus styling are removed. The active `ghost-label` component is retained: `autoFiller.ts` creates it.
7. **Optical assets and cleanup:** five shape-specific displacement maps are rasterized at 3× their CSS dimensions. The FAB map is 132×132 for a 44px lens; the five PNGs total 23,245 bytes. Unused host highlight rules and redundant early Options fallback blocks are removed.

The linked library is a Flutter/Dart implementation, with platform-dependent shader and quality paths. Its own documentation emphasizes navigation chrome, controlled backdrops, accessibility, and graceful quality fallback. These principles were adapted to the existing React/CSS extension. This is not an installation of Flutter or a claim that GhostFill now renders Apple's proprietary material identically. [Liquid Glass Widgets documentation](https://github.com/sdegenaar/liquid_glass_widgets)

## Verification of findings 98–155

“Preference” means the observation can inform design, but the audit did not establish a functional failure. “Unverified” means source inspection cannot settle the browser-specific claim.

| Finding | Result | Evidence / action |
| --- | --- | --- |
| 98 — Chromium Shadow DOM filter failure | Unverified; blanket claim unsupported | SVG URL references are part of the backdrop-filter syntax. A closed ShadowRoot alone does not prove failure. Keep the fallback and require live Chrome inspection for this specific rendering path. |
| 99 — 44px map distortion | Partially valid; improved | The original FAB raster was small. It was not stretched over every menu/card: separate shape maps already existed. All five maps now use 3× raster density with unchanged CSS geometry. |
| 100 — Missing chromatic dispersion | Visual ceiling | The current edge lens does not separate RGB refraction. This is not evidence that controls fail. No channel-splitting renderer was added without a rendered comparison and measured cost. |
| 101 — Static border lighting | Preference | A static light direction is present. Pointer tracking on every utility control is not required for correct interaction; stable glyphs and short feedback are retained. |
| 102 — Press lens enlarges | Intentional | Only the inner optical layer magnifies. The glyph and hit area remain stable. Treating this as scaling the entire button misreads the layer structure. |
| 103 — Circular corners versus continuous corners | Visual ceiling | Rounded rectangles are not exact native continuous corners. The existing browser-compatible geometry is retained; no unsupported corner-smoothing declaration is introduced. |
| 104 — Bezier named as spring | Partially valid | A bezier is not a simulated oscillator. Stale inline aliases are removed. Frequent feedback remains short CSS motion; adding a physical spring to every click would not fix a demonstrated defect. |
| 105 — Missing physical Fresnel renderer | Visual ceiling | CSS highlights and SVG displacement are an approximation. No evidence establishes the pasted formula as Apple's implementation or a drop-in renderer for this extension. |
| 106 — 94% light backing | Context misapplied | Dense elevated overlays protect readable text over arbitrary webpages. Clear controls and reading surfaces have different backing requirements; the light hierarchy is refined accordingly. |
| 107 — Four conflicting inner bevels | Stale | The four-edge stack was already removed before this pass. Light surfaces now use one inner highlight; dark surfaces keep a restrained top/bottom meniscus. |
| 108 — Missing fallback contrast | Already present; strengthened | Solid backing and stronger borders exist for missing filters, reduced transparency, and increased contrast. New light selectors explicitly preserve these fallbacks. |
| 109 — FAB TS/CSS size mismatch | Confirmed; fixed | TypeScript's normal size was 46px while CSS used 44px. Both now use 44px. |
| 110 — Quiet hover hitbox flicker | Unsupported | Quiet state already keeps a stable hit area. No runtime hover flicker was demonstrated. |
| 111 — Spinner wobble | Unverified visual claim | Rotation is centered in the existing glyph box. The claim needs frames from Chrome. The inline and page-feedback spinners use 0.8s rotation and explicit reduced-motion handling. |
| 112 — Badge shadow in light mode | Valid polish; fixed | Shadow opacity is reduced from .22 to .12; the success text/background pair is theme-specific. |
| 113 — Badge font conflicts | Overstated; improved | The actual custom property already selected a monospace stack. Content controls now prefer platform monospace, SFMono-Regular, or Consolas without assuming an unbundled font. |
| 114 — Waiting indicator blinks | Incorrect | The cited opacity change was a state transition, not a repeating blink animation. No decorative waiting pulse is added. |
| 115 — Shadow DOM z-index numbers | Maintenance preference | Shadow DOM by itself is not a stacking context. Host isolation and local stacking order matter. Removing the sentinel removes one layer; renumbering valid local layers alone would not improve rendering. |
| 116 — Missing tooltip arrow | Preference | An arrow is not required for a usable tooltip. Anchoring, readable backing, keyboard access, and viewport bounds are more relevant; those are retained or improved. |
| 117 — Tooltip overflow | Confirmed; fixed | A maximum width did not clamp a centered tooltip. The FAB now shifts horizontally and flips below near the upper edge. |
| 118 — Fixed menu transform origin | Incorrect | `ContextualMenu.calculatePosition()` already calculates top/bottom and left/right origins from placement, and the presenter assigns that value. |
| 119 — Focus outline clips icon | Unsupported | An inset outline and item padding do not by themselves prove clipping. Native keyboard focus and 44px targets remain. |
| 120 — Long press canceled by small movement | Confirmed; fixed | An 8px tolerance replaces cancellation on every touchmove. Touch cancellation, synthetic-click suppression, and cleanup are checked. |
| 121 — Sentinel horizontal underflow | Confirmed; removed | The entire sentinel notification surface is deleted; page feedback uses viewport-safe fixed placement. |
| 122 — Sentinel top clipping | Confirmed; removed | No negative top-position sentinel remains. |
| 123 — Foreign page-feedback palette | Mixed; simplified | Some cited literals were fallback values, not the computed theme. The replacement surface uses the shared palette directly. |
| 124 — Cream text | Stale / misleading | Current semantic ink is neutral. Old fallback styling is removed with the duplicate surface. |
| 125 — Duplicate OTP toast | Confirmed; removed | OTP feedback now uses `pageStatus`; the duplicate Shadow DOM, keyframes, and timers are deleted. |
| 126 — Navigation causes context errors from slide-out | Causality unsupported; lifecycle improved | Removing a DOM node does not itself cause an extension-context error. The actual pending timers, animation frame, and theme subscription now have explicit ownership and pagehide cleanup. |
| 127 — Competing live announcements | Partially valid; coordinated | Polite live regions ordinarily queue rather than literally speak over one another. One page-feedback region removes duplicate announcements; local field status remains associated with its field. |
| 128 — 44px dismiss target too large | Incorrect | The old banner was not a 40px-high container. The new banner keeps an accessible 44px dismiss target with 64px minimum height. |
| 129 — OTP masking bullet style | Preference; clarified | Success feedback says “ending XX” and identifies the source. It does not expose the full OTP. |
| 130 — Toast durations differ | Partially valid; improved | Different messages may need different duration. One timer and a 3s minimum plus a length-based reading allowance prevent premature dismissal. |
| 131 — Token interpolation hazard | Incorrect framing; allocation improved | `STYLES` is a module constant evaluated once, not reconstructed in each constructor. The real per-instance stylesheet allocation is replaced with one cached sheet. |
| 132 — Inline fallback colors | Simplified | Obsolete fallback declarations are removed from inline-label styles; the shared theme owns those values. |
| 133 — Success rotation/pop | Valid polish; removed | Inline state icons remain stable. No negative-rotation pop remains. |
| 134 — Compound hover scaling | Stale / simplified | A later override had already disabled glyph hover motion. The duplicated transform rules are removed rather than stacked further. |
| 135 — Different spinner dimensions | Not inherently a defect; aligned | Small inline and larger page spinners need different sizes. Their timing is aligned at 0.8s; reduced motion stops rotation. |
| 136 — Inline opaque shadow stack | Valid polish; fixed | The inline indicator now uses the shared inner highlight without a hardcoded outer shadow. |
| 137 — Double focus ring | Partially valid; simplified | The inner div is not independently focusable, so two simultaneous rings were not established. Only the focusable host owns the ring now. |
| 138 — Inline tooltip dark contrast | Unverified original visual claim; improved | Dense elevated backing, semantic ink, border, and spacing are used in both themes. A live host-page contrast check remains necessary. |
| 139 — Host geometry overrides | Latent risk; removed | The cited rules were unused. They no longer impose radius, opacity, or borders on host fields. |
| 140 — Orphan highlight classes | Confirmed; removed | Repository-wide caller search found no uses of these classes; the rules are deleted. |
| 141 — Global :root content variables | Confirmed unnecessary; removed | The obsolete content-only variables are deleted. Active Shadow DOM controls keep scoped variables. |
| 142 — No dark awareness in dead highlights | Obsolete path removed | The unused highlight layer is gone. Active controls use the shared stored preference and system-theme controller. |
| 143 — Broad reduced-motion transform override | Latent risk; removed | Unused host-field rules no longer clear transforms. Reduced motion now targets extension-owned visuals. |
| 144 — Duplicate Options transparency blocks | Confirmed overlap; reduced | The earlier redundant block is removed; the broader final fallback remains. |
| 145 — Duplicate Options filter-support blocks | Confirmed overlap; reduced | The earlier generic glass block is removed; the canonical material block remains. |
| 146 — Repeated Options header selector | Overstated | Separate blocks contain layout, responsive, and material rules. Their count does not prove a cascade defect. Necessary responsive behavior is retained. |
| 147 — Light sidebar washout | Visible in screenshot; improved | The exact claimed 1.15 ratio was not measured by the audit. A quieter canvas, clearer rail, flatter blue selection, and neutral stroke now establish hierarchy. |
| 148 — Removed macOS shortcut badges | Incorrect prescribed fix | Some removed badges did not describe the actual shortcut consistently. Existing Ctrl/Cmd+K search remains. Importing Apple's font would not correct a wrong shortcut label. |
| 149 — Circular toggle knob | Preference | The component is a toggle, not a drag gesture. A stable circular knob, native semantics, and existing brief transition remain. |
| 150 — Select needs a VisionOS rim | Preference | The menu already uses elevated backing and selected-row feedback. A drag-stretch effect is not necessary for a non-drag selection interaction. |
| 151 — Palette needs 40–60px blur | Unsupported requirement | No cited Apple requirement establishes that fixed range. The existing dense modal backing separates text from the page; readable contrast is more useful than increasing blur everywhere. |
| 152 — Different focus radii | Not a defect by itself | Focus follows each control's shape. Circular switches and rounded rectangular fields should not be forced to the same radius. |
| 153 — Number inputs need volume squish | Preference | A number input is not a deformable drag object. Native range/value behavior remains; no decorative geometry is attached to ordinary value edits. |
| 154 — Missing stable scrollbar gutter | Incorrect | `options.css` already declares `scrollbar-gutter: stable` on html. |
| 155 — #60646c fails at 3.9:1 | Incorrect calculation | Computed sRGB ratios are 4.73:1 on #e5e5ea, 5.05:1 on #e9edf3, and 5.94:1 on white. Actual translucent composites still need live inspection. A separate success-fill foreground pair was corrected. |

SVG URL references are explicitly allowed by the filter-effects draft and documented by MDN. That supports the syntax, not a guarantee that every Chrome/Shadow DOM combination renders it correctly. The draft's backdrop-root rules also do not say that every ShadowRoot is a backdrop root or stacking context. [CSS Filter Effects Level 2 draft](https://drafts.csswg.org/filter-effects-2/#BackdropFilterProperty), [MDN backdrop-filter reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)

## The proposed “exact Apple” formula

The mathematical sketch is not an implementation or an authenticated Apple specification:

- The supplied Lp-norm level set describes a superellipse. For n ≠ 2 it is not generally the Euclidean signed distance required for uniform physical edge thickness.
- A 2D gradient supplies an edge direction, not the full 3D surface normal and depth needed for the proposed refraction calculation. Camera direction, surface thickness, background sampling, and edge handling remain unspecified.
- Fresnel and specular formulas describe possible optical models; they do not identify Apple's renderer. Applying them without a controlled backdrop does not guarantee a realistic result.
- In 2D, keeping area constant requires sx × sy = 1. The proposed sx = 1/√sy preserves 3D volume only when a second transverse scale also equals sx. It is not a general 2D area-preserving rule.

The existing shape-specific edge model therefore remains an explicit approximation, now with sharper rasters. The generator documents its fixed-geometry ceiling and retains the two MIT notices in `docs/third-party`.

## Motion review

| Before | After | Why |
| --- | --- | --- |
| Three unrelated feedback entrances and dismiss timers | One 180ms feedback entrance and one owned timer | Prevent overlapping messages and old timers dismissing new progress. |
| Inline delayed reveal and success wobble | Next-frame reveal with 160ms opacity; stable state icon | Make frequent field actions clear without waiting for decorative motion. |
| Any touchmove canceled long press | 450ms hold with 8px tolerance; completed hold suppresses tap | Accommodate normal finger movement without opening during a drag. |
| Small optical textures at display size | 3× rasters, unchanged CSS lens dimensions | Improve rim sampling without adding a running shader loop. |
| Moving/opaque presentation could survive accessibility preferences | Explicit reduced-motion and solid contrast/transparency fallback | Preserve access and legibility across preference changes. |

**Source/behavior verdict: Approve.** The changed paths keep stable hit areas, short state feedback, semantic controls, and bounded timer ownership. **Live visual sign-off: Block pending Chrome review.** Source checks cannot establish pixel accuracy, animation feel, frame rate, or real closed-shadow refraction.

## Checks and reproducibility

- `npm run type-check` — passed.
- `npm run lint` — passed without warnings.
- `node scripts/check-ui-feedback.cjs` — passed. Exercises the real normalizer, theme controller, shared page feedback, repeat announcements, timer ownership, cleanup, tooltip bounds, long-press logic, and existing reader/link cases through a DOM harness.
- PostCSS parsing of seven changed CSS files — passed.
- Generator assertions for neutral centers, outward normals, alpha, and 3× dimensions — passed.
- Impeccable static detection across the ten changed UI targets — no findings. This is a source scan, not visual proof.
- `git diff --check` — passed; Windows line-ending notices are informational.
- `npx --no-install webpack --env profile=full --mode=production` — passed for background and web bundles.
- `node scripts/check-bundle-size.js` — passed; unpacked total 2.65 MB, within the 4 MB budget and 1 MB per-asset limit.
- Copied optical assets equal their source bytes; both MIT notices and both inbox translations are present in `dist` — passed.

The app's browser security policy rejected the local preview route during this task. Live extension review was not performed through another route. To inspect this build, reload GhostFill from `dist` in Chrome's Extensions page, reopen popup/Settings, and refresh existing webpages to replace their older content scripts.

## Revalidation of the repeated Layer 3 attachment

The attachment at `4df4a322-b58a-4c0b-ba35-3a4a758c9cc0/Pasted text.txt` is byte-for-byte identical to the earlier Layer 3 attachment. Both have SHA256 `4C07971615666AF6C2A6D807E623993197F94627673DDF0C074B88749341F227`. The findings table above remains the disposition of all 58 claims; repeated text is not evidence that previously removed code has returned.

Current caller searches confirm that OTP, form, and FAB feedback route through `pageStatus`. The obsolete `ToastFeedback`, sentinel surface, invasive field-highlight rules, and 46px FAB geometry remain removed. Options retains its stable scrollbar gutter. The shared palette remains scoped to extension UI.

### Additional supported fixes

The remaining notification timer counted elapsed time while the page was hidden and while the dismiss control was being used. This could discard background feedback before a person returned, or remove the keyboard target during interaction. The existing singleton now counts only available reading time:

- Hidden tabs, mouse/pen hover, and keyboard focus pause expiry.
- Resuming preserves the remaining allowance using the monotonic `performance.now()` clock.
- Replacement messages receive their own allowance; indefinite loading messages cannot inherit a previous success timer.
- Touch events do not latch a hover pause or cancel a mouse pause on devices with both inputs.
- Dismissal and pagehide cancel pending work; pagehide also removes the visibility listener.

Success, error, and information now have distinct check, alert, and information glyphs. Their geometry stays fixed; loading retains the existing spinner. The 180ms entrance, reduced-motion behavior, shared palette, single polite region, and 44px dismiss target are preserved.

| Before | After | Why |
| --- | --- | --- |
| Expiry continued in a hidden tab | Remaining reading time resumes when visible | Prevent feedback disappearing before it can be read. |
| Hover/focus could outlive the notification | Hover and keyboard focus pause expiry | Keep the reading surface and focused dismiss target available. |
| One information glyph for every completed state | Stable check, alert, or information glyph | Communicate the result through shape as well as color. |

**Interaction verdict: Approve.** The focused DOM check covers hidden-tab expiry, overlapping hover/focus pauses, touch coexistence, replacement timing, explicit dismissal, normal expiry, progress replacement, and navigation cleanup. **Live visual verdict: Block pending Chrome review.** The installed Chrome extension is not exposed to this task's browser tools, and the local preview route was previously rejected by the browser security policy. No alternate route was used to bypass that restriction.

### Upstream source verification

The linked library has several rendering paths. Its current lightweight shader uses rounded-rectangle distance calculations, edge-weighted texture offsets, optional RGB sampling offsets, and a fallback when a background texture is unavailable. That is more specific than the audit's claim that every widget must run the same raymarched superellipse pipeline. The full SDF source separately supports squircle, ellipse, and rounded-rectangle shapes. [Lightweight shader](https://raw.githubusercontent.com/sdegenaar/liquid_glass_widgets/main/shaders/lightweight_glass.frag), [SDF source](https://raw.githubusercontent.com/sdegenaar/liquid_glass_widgets/main/shaders/sdf.glsl)

Its spring controller uses Flutter's `SpringSimulation` and preserves velocity when retargeting; the audit's suggested custom RK4 loop is not a required implementation. Shader texture capture and Flutter physics are not drop-in APIs for this React/CSS extension. The current CSS easing remains identified as easing, and the web material remains an approximation with readable fallbacks. [Spring controller source](https://raw.githubusercontent.com/sdegenaar/liquid_glass_widgets/main/lib/utils/glass_spring.dart)

No new renderer, dependency, permission, remote font, or icon family was added in this revalidation. The existing MIT notices remain in place.

### Checks for this revalidation

- `node scripts/check-ui-feedback.cjs` — passed with the additional timer-lifecycle assertions.
- Targeted ESLint for `src/content/ui/pageStatus.ts` — passed.
- `npm run type-check` — passed.
- Direct full production Webpack build — passed.

These checks establish source and DOM behavior. They do not establish an exact match to Apple's renderer or a measured frame rate in Chrome.

## Main implementation evidence

- [Light palette](C:/Users/Aayush/Documents/ghostfill-extension-main/src/frontend/styles/globals.css)
- [Material hierarchy and accessibility fallbacks](C:/Users/Aayush/Documents/ghostfill-extension-main/src/frontend/styles/optical-glass.css)
- [Reader normalization and inbox header](C:/Users/Aayush/Documents/ghostfill-extension-main/src/frontend/popup/components/SharedComponents.tsx)
- [Shared theme controller and in-page palette](C:/Users/Aayush/Documents/ghostfill-extension-main/src/shared/theme.ts)
- [Single page-feedback surface](C:/Users/Aayush/Documents/ghostfill-extension-main/src/content/ui/pageStatus.ts)
- [FAB touch and tooltip placement](C:/Users/Aayush/Documents/ghostfill-extension-main/src/content/floatingButton.ts)
- [Inline indicator lifecycle](C:/Users/Aayush/Documents/ghostfill-extension-main/src/content/ui/GhostLabel.ts)
- [Optical asset generator](C:/Users/Aayush/Documents/ghostfill-extension-main/scripts/generate-glass-lenses.py)
- [Focused runnable check](C:/Users/Aayush/Documents/ghostfill-extension-main/scripts/check-ui-feedback.cjs)
