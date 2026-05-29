/**
 * GhostFill 3.0 — Memphis Neon Archive — Single Source of Truth
 *
 * ALL color values live here and ONLY here.
 * Every Shadow DOM `:host` block and content-script CSS derives from this object.
 * If you change a color here, it changes everywhere.
 *
 * @see popup.css `:root` which mirrors these values via `--gf-*` custom properties.
 */
export const TOKENS = {
  // ── Surfaces ──
  bg: '#10101C',
  surface: '#18152A',
  card: '#211B3D',
  ink: '#000000',

  // ── Text ──
  cream: '#FFF3D6',
  textMuted: '#B8A8D9',
  textDim: '#7B6CA3',

  // ── Neon Accents ──
  magenta: '#FF3BD4',
  cyan: '#20F4FF',
  violet: '#8B5CFF',
  yellow: '#FFD84D',
  coral: '#FF6A4D',
  mint: '#62F2B3',

  // ── RGB Decomposed (for rgba() usage) ──
  magentaRgb: '255, 59, 212',
  cyanRgb: '32, 244, 255',
  violetRgb: '139, 92, 255',
  yellowRgb: '255, 216, 77',
  coralRgb: '255, 106, 77',
  mintRgb: '98, 242, 179',
  bgRgb: '16, 16, 28',
  surfaceRgb: '24, 21, 42',
  cardRgb: '33, 27, 61',
} as const;

/**
 * Generates CSS custom property declarations for use in Shadow DOM `:host` blocks.
 *
 * Usage in a Shadow DOM style string:
 * ```
 * :host {
 *   ${generateHostTokens()}
 * }
 * ```
 */
export function generateHostTokens(): string {
  return `
    --gf-bg: ${TOKENS.bg};
    --gf-bg-rgb: ${TOKENS.bgRgb};
    --gf-surface: ${TOKENS.surface};
    --gf-surface-rgb: ${TOKENS.surfaceRgb};
    --gf-card: ${TOKENS.card};
    --gf-card-rgb: ${TOKENS.cardRgb};
    --gf-ink: ${TOKENS.ink};
    --gf-cream: ${TOKENS.cream};
    --gf-text-muted: ${TOKENS.textMuted};
    --gf-text-dim: ${TOKENS.textDim};
    --gf-magenta: ${TOKENS.magenta};
    --gf-magenta-rgb: ${TOKENS.magentaRgb};
    --gf-cyan: ${TOKENS.cyan};
    --gf-cyan-rgb: ${TOKENS.cyanRgb};
    --gf-violet: ${TOKENS.violet};
    --gf-violet-rgb: ${TOKENS.violetRgb};
    --gf-yellow: ${TOKENS.yellow};
    --gf-yellow-rgb: ${TOKENS.yellowRgb};
    --gf-coral: ${TOKENS.coral};
    --gf-coral-rgb: ${TOKENS.coralRgb};
    --gf-mint: ${TOKENS.mint};
    --gf-mint-rgb: ${TOKENS.mintRgb};
  `.trim();
}

/**
 * Generates content-script CSS variable declarations for `#ghostfill-fab` scope.
 * These values MUST stay in sync with `generateHostTokens()` above.
 *
 * Usage in content.css:
 * ```css
 * #ghostfill-fab {
 *   /* Auto-generated from shared/tokens.ts — do not edit manually *\/
 *   --gf-magenta: #FF3BD4;
 *   ...
 * }
 * ```
 */
export function generateFabScopeTokens(): string {
  return `
    --gf-bg: ${TOKENS.bg};
    --gf-bg-rgb: ${TOKENS.bgRgb};
    --gf-surface: ${TOKENS.surface};
    --gf-surface-rgb: ${TOKENS.surfaceRgb};
    --gf-card: ${TOKENS.card};
    --gf-card-rgb: ${TOKENS.cardRgb};
    --gf-ink: ${TOKENS.ink};
    --gf-cream: ${TOKENS.cream};
    --gf-text-muted: ${TOKENS.textMuted};
    --gf-text-dim: ${TOKENS.textDim};
    --gf-magenta: ${TOKENS.magenta};
    --gf-magenta-rgb: ${TOKENS.magentaRgb};
    --gf-cyan: ${TOKENS.cyan};
    --gf-cyan-rgb: ${TOKENS.cyanRgb};
    --gf-violet: ${TOKENS.violet};
    --gf-violet-rgb: ${TOKENS.violetRgb};
    --gf-yellow: ${TOKENS.yellow};
    --gf-yellow-rgb: ${TOKENS.yellowRgb};
    --gf-coral: ${TOKENS.coral};
    --gf-coral-rgb: ${TOKENS.coralRgb};
    --gf-mint: ${TOKENS.mint};
    --gf-mint-rgb: ${TOKENS.mintRgb};
  `.trim();
}
