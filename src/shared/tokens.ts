/**
 * GhostFill design token source of truth for Shadow DOM and content UI.
 * Keep this aligned with src/shared/styles/design-tokens.css.
 *
 * The in-page floating UI (FAB / labels / page status) renders as a dark
 * graphite "Spectre" glass console on ANY site, so these mirror the dark theme.
 */
export const TOKENS = {
  // Raw accent swatches — folded into the Iris family (200 tint, 300 base, 400 deep).
  xxxViolet200: '#23264a',
  xxxViolet200Rgb: '35, 38, 74',
  xxxViolet300: '#7C83FF',
  xxxViolet300Rgb: '124, 131, 255',
  xxxViolet400: '#5A61F0',
  xxxViolet400Rgb: '90, 97, 240',
  xxxPink200: '#2a2350',
  xxxPink200Rgb: '42, 35, 80',
  xxxPink300: '#A78BFF',
  xxxPink300Rgb: '167, 139, 255',
  xxxPink400: '#7d66e6',
  xxxPink400Rgb: '125, 102, 230',
  xxxRed200: '#2c1414',
  xxxRed200Rgb: '44, 20, 20',
  xxxRed300: '#FF6B6B',
  xxxRed300Rgb: '255, 107, 107',
  xxxRed400: '#e0463f',
  xxxRed400Rgb: '224, 70, 63',
  xxxOrange200: '#2a2110',
  xxxOrange200Rgb: '42, 33, 16',
  xxxOrange300: '#F4B740',
  xxxOrange300Rgb: '244, 183, 64',
  xxxOrange400: '#d8950f',
  xxxOrange400Rgb: '216, 149, 15',
  xxxYellow200: '#2a2110',
  xxxYellow200Rgb: '42, 33, 16',
  xxxYellow300: '#F4B740',
  xxxYellow300Rgb: '244, 183, 64',
  xxxYellow400: '#d8950f',
  xxxYellow400Rgb: '216, 149, 15',
  xxxLime200: '#0f2a25',
  xxxLime200Rgb: '15, 42, 37',
  xxxLime300: '#3FE0C5',
  xxxLime300Rgb: '63, 224, 197',
  xxxLime400: '#12b886',
  xxxLime400Rgb: '18, 184, 134',
  xxxCyan200: '#1c2040',
  xxxCyan200Rgb: '28, 32, 64',
  xxxCyan300: '#7C83FF',
  xxxCyan300Rgb: '124, 131, 255',
  xxxCyan400: '#5A61F0',
  xxxCyan400Rgb: '90, 97, 240',

  // Canvas (Spectre — graphite glass console on any site)
  bg: '#101216',
  bgRgb: '16, 18, 22',
  surface: '#181B21',
  surfaceRgb: '24, 27, 33',
  surface2: '#1F232B',
  card: '#181B21',
  cardRgb: '24, 27, 33',
  cardElevated: '#1C2330',
  sunken: '#0C0E12',
  sunkenRgb: '12, 14, 18',
  line: 'rgba(255, 255, 255, 0.10)',
  hi: 'rgba(255, 255, 255, 0.06)',

  // Ink (cool light on dark)
  ink: '#EEF1F6',
  inkRgb: '238, 241, 246',
  inkSoft: '#AAB2C0',
  cream: '#EEF1F6',
  textMuted: '#AAB2C0',
  textDim: '#727A88',

  // Semantic legacy aliases → Spectre family
  mustard: '#F4B740',
  mustardRgb: '244, 183, 64',
  sienna: '#FF6B6B',
  siennaRgb: '255, 107, 107',
  teal: '#3FE0C5',
  tealRgb: '63, 224, 197',
  coralWarm: '#A78BFF',
  coralWarmRgb: '167, 139, 255',

  magenta: '#A78BFF',
  magentaRgb: '167, 139, 255',
  cyan: '#7C83FF',
  cyanRgb: '124, 131, 255',
  violet: '#A78BFF',
  violetRgb: '167, 139, 255',
  yellow: '#F4B740',
  yellowRgb: '244, 183, 64',
  coral: '#FF6B6B',
  coralRgb: '255, 107, 107',
  mint: '#3FE0C5',
  mintRgb: '63, 224, 197',

  // Iris primary + gradients (used by the in-page FAB / labels)
  primary: '#7C83FF',
  primaryRgb: '124, 131, 255',
  primaryDeep: '#5A61F0',
  primarySoft: '#1C2040',
} as const;

/**
 * Generates CSS custom property declarations for Shadow DOM hosts.
 */
export function generateHostTokens(): string {
  return `
    --xxx-violet-200: ${TOKENS.xxxViolet200};
    --xxx-violet-200-rgb: ${TOKENS.xxxViolet200Rgb};
    --xxx-violet-300: ${TOKENS.xxxViolet300};
    --xxx-violet-300-rgb: ${TOKENS.xxxViolet300Rgb};
    --xxx-violet-400: ${TOKENS.xxxViolet400};
    --xxx-violet-400-rgb: ${TOKENS.xxxViolet400Rgb};
    --xxx-pink-200: ${TOKENS.xxxPink200};
    --xxx-pink-200-rgb: ${TOKENS.xxxPink200Rgb};
    --xxx-pink-300: ${TOKENS.xxxPink300};
    --xxx-pink-300-rgb: ${TOKENS.xxxPink300Rgb};
    --xxx-pink-400: ${TOKENS.xxxPink400};
    --xxx-pink-400-rgb: ${TOKENS.xxxPink400Rgb};
    --xxx-red-200: ${TOKENS.xxxRed200};
    --xxx-red-200-rgb: ${TOKENS.xxxRed200Rgb};
    --xxx-red-300: ${TOKENS.xxxRed300};
    --xxx-red-300-rgb: ${TOKENS.xxxRed300Rgb};
    --xxx-red-400: ${TOKENS.xxxRed400};
    --xxx-red-400-rgb: ${TOKENS.xxxRed400Rgb};
    --xxx-orange-200: ${TOKENS.xxxOrange200};
    --xxx-orange-200-rgb: ${TOKENS.xxxOrange200Rgb};
    --xxx-orange-300: ${TOKENS.xxxOrange300};
    --xxx-orange-300-rgb: ${TOKENS.xxxOrange300Rgb};
    --xxx-orange-400: ${TOKENS.xxxOrange400};
    --xxx-orange-400-rgb: ${TOKENS.xxxOrange400Rgb};
    --xxx-yellow-200: ${TOKENS.xxxYellow200};
    --xxx-yellow-200-rgb: ${TOKENS.xxxYellow200Rgb};
    --xxx-yellow-300: ${TOKENS.xxxYellow300};
    --xxx-yellow-300-rgb: ${TOKENS.xxxYellow300Rgb};
    --xxx-yellow-400: ${TOKENS.xxxYellow400};
    --xxx-yellow-400-rgb: ${TOKENS.xxxYellow400Rgb};
    --xxx-lime-200: ${TOKENS.xxxLime200};
    --xxx-lime-200-rgb: ${TOKENS.xxxLime200Rgb};
    --xxx-lime-300: ${TOKENS.xxxLime300};
    --xxx-lime-300-rgb: ${TOKENS.xxxLime300Rgb};
    --xxx-lime-400: ${TOKENS.xxxLime400};
    --xxx-lime-400-rgb: ${TOKENS.xxxLime400Rgb};
    --xxx-cyan-200: ${TOKENS.xxxCyan200};
    --xxx-cyan-200-rgb: ${TOKENS.xxxCyan200Rgb};
    --xxx-cyan-300: ${TOKENS.xxxCyan300};
    --xxx-cyan-300-rgb: ${TOKENS.xxxCyan300Rgb};
    --xxx-cyan-400: ${TOKENS.xxxCyan400};
    --xxx-cyan-400-rgb: ${TOKENS.xxxCyan400Rgb};
    --xxx-spectrum: linear-gradient(90deg, ${TOKENS.primary}, ${TOKENS.primaryDeep});
    --xxx-spectrum-tight: linear-gradient(90deg, ${TOKENS.primary}, ${TOKENS.primaryDeep});
    --gf-bg: ${TOKENS.bg};
    --gf-bg-rgb: ${TOKENS.bgRgb};
    --gf-surface: ${TOKENS.surface};
    --gf-surface-rgb: ${TOKENS.surfaceRgb};
    --gf-surface-2: ${TOKENS.surface2};
    --gf-card: ${TOKENS.card};
    --gf-card-rgb: ${TOKENS.cardRgb};
    --gf-card-elevated: ${TOKENS.cardElevated};
    --gf-sunken: ${TOKENS.sunken};
    --gf-sunken-rgb: ${TOKENS.sunkenRgb};
    --gf-line: ${TOKENS.line};
    --gf-line-2: ${TOKENS.line};
    --gf-hi: ${TOKENS.hi};
    --gf-ink: ${TOKENS.ink};
    --gf-ink-rgb: ${TOKENS.inkRgb};
    --gf-ink-soft: ${TOKENS.inkSoft};
    --gf-cream: ${TOKENS.cream};
    --gf-text-muted: ${TOKENS.textMuted};
    --gf-text-dim: ${TOKENS.textDim};
    --gf-mustard: ${TOKENS.mustard};
    --gf-mustard-rgb: ${TOKENS.mustardRgb};
    --gf-sienna: ${TOKENS.sienna};
    --gf-sienna-rgb: ${TOKENS.siennaRgb};
    --gf-teal: ${TOKENS.teal};
    --gf-teal-rgb: ${TOKENS.tealRgb};
    --gf-coral-warm: ${TOKENS.coralWarm};
    --gf-coral-warm-rgb: ${TOKENS.coralWarmRgb};
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
    --nb-bg: ${TOKENS.bg};
    --nb-surface: ${TOKENS.surface};
    --nb-ink: ${TOKENS.ink};
    --nb-border: 1px solid ${TOKENS.line};
    --nb-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px rgba(0, 0, 0, 0.55);
    --nb-shadow-sm: 0 1px 0 rgba(255, 255, 255, 0.04), 0 3px 10px rgba(0, 0, 0, 0.42);
    --nb-shadow-lg: 0 1px 0 rgba(255, 255, 255, 0.05), 0 18px 48px rgba(0, 0, 0, 0.66);
    --nb-radius: 14px;
    --nb-radius-sm: 9px;
    --gf-paper: ${TOKENS.bg};
    --gf-paper-2: ${TOKENS.surface};
    --gf-ink-dim: ${TOKENS.textDim};
    --gf-amber: ${TOKENS.yellow};
    --gf-primary: ${TOKENS.primary};
    --gf-primary-rgb: ${TOKENS.primaryRgb};
    --gf-primary-deep: ${TOKENS.primaryDeep};
    --gf-primary-soft: ${TOKENS.primarySoft};
    --gf-success: ${TOKENS.mint};
    --gf-warning: ${TOKENS.yellow};
    --gf-danger: ${TOKENS.coral};
    --gf-accent: ${TOKENS.violet};
    --gf-grad-cobalt: linear-gradient(180deg, ${TOKENS.primary}, ${TOKENS.primaryDeep});
    --gf-grad-mint: linear-gradient(180deg, #12b886, ${TOKENS.mint});
    --gf-grad-coral: linear-gradient(180deg, #e0463f, ${TOKENS.coral});
    --gf-border: 1px solid ${TOKENS.line};
    --gf-border-thin: 1px solid ${TOKENS.line};
    --gf-shadow-sm: 0 1px 0 rgba(255, 255, 255, 0.04), 0 3px 10px rgba(0, 0, 0, 0.42);
    --gf-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px rgba(0, 0, 0, 0.55);
    --gf-radius: 14px;
    --gf-radius-sm: 9px;
  `.trim();
}

/**
 * Generates content-script CSS variable declarations for #ghostfill-fab scope.
 */
export function generateFabScopeTokens(): string {
  return generateHostTokens();
}
