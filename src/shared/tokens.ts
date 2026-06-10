/**
 * GhostFill design token source of truth for Shadow DOM and content UI.
 * Keep this aligned with src/shared/styles/design-tokens.css.
 */
export const TOKENS = {
  xxxViolet200: '#A8A6FF',
  xxxViolet200Rgb: '168, 166, 255',
  xxxViolet300: '#918EFA',
  xxxViolet300Rgb: '145, 142, 250',
  xxxViolet400: '#807DFA',
  xxxViolet400Rgb: '128, 125, 250',
  xxxPink200: '#FFA6F6',
  xxxPink200Rgb: '255, 166, 246',
  xxxPink300: '#FA8CEF',
  xxxPink300Rgb: '250, 140, 239',
  xxxPink400: '#FA7FEE',
  xxxPink400Rgb: '250, 127, 238',
  xxxRed200: '#FF9F9F',
  xxxRed200Rgb: '255, 159, 159',
  xxxRed300: '#FA7A7A',
  xxxRed300Rgb: '250, 122, 122',
  xxxRed400: '#F76363',
  xxxRed400Rgb: '247, 99, 99',
  xxxOrange200: '#FFC29F',
  xxxOrange200Rgb: '255, 194, 159',
  xxxOrange300: '#FF965B',
  xxxOrange300Rgb: '255, 150, 91',
  xxxOrange400: '#FA8543',
  xxxOrange400Rgb: '250, 133, 67',
  xxxYellow200: '#FFF066',
  xxxYellow200Rgb: '255, 240, 102',
  xxxYellow300: '#FFE500',
  xxxYellow300Rgb: '255, 229, 0',
  xxxYellow400: '#FFE500',
  xxxYellow400Rgb: '255, 229, 0',
  xxxLime200: '#B8FF9F',
  xxxLime200Rgb: '184, 255, 159',
  xxxLime300: '#9DFC7C',
  xxxLime300Rgb: '157, 252, 124',
  xxxLime400: '#7DF752',
  xxxLime400Rgb: '125, 247, 82',
  xxxCyan200: '#A6FAFF',
  xxxCyan200Rgb: '166, 250, 255',
  xxxCyan300: '#79F7FF',
  xxxCyan300Rgb: '121, 247, 255',
  xxxCyan400: '#53F2FC',
  xxxCyan400Rgb: '83, 242, 252',

  bg: '#FFFDF6',
  bgRgb: '255, 253, 246',
  surface: '#FFFDF6',
  surfaceRgb: '255, 253, 246',
  card: '#FFF066',
  cardRgb: '255, 240, 102',
  cardElevated: '#FFE500',
  sunken: '#A6FAFF',
  sunkenRgb: '166, 250, 255',
  line: '#181818',

  ink: '#181818',
  inkRgb: '24, 24, 24',
  inkSoft: '#2F2F2F',
  cream: '#181818',
  textMuted: '#555047',
  textDim: '#776F62',

  mustard: '#FFE500',
  mustardRgb: '255, 229, 0',
  sienna: '#FF965B',
  siennaRgb: '255, 150, 91',
  teal: '#53F2FC',
  tealRgb: '83, 242, 252',
  coralWarm: '#FA8CEF',
  coralWarmRgb: '250, 140, 239',

  magenta: '#FA8CEF',
  magentaRgb: '250, 140, 239',
  cyan: '#79F7FF',
  cyanRgb: '121, 247, 255',
  violet: '#918EFA',
  violetRgb: '145, 142, 250',
  yellow: '#FFE500',
  yellowRgb: '255, 229, 0',
  coral: '#FA7A7A',
  coralRgb: '250, 122, 122',
  mint: '#9DFC7C',
  mintRgb: '157, 252, 124',
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
    --xxx-spectrum: linear-gradient(90deg, ${TOKENS.xxxViolet200} 0%, ${TOKENS.xxxViolet300} 5%, ${TOKENS.xxxViolet400} 10%, ${TOKENS.xxxPink200} 15%, ${TOKENS.xxxPink300} 20%, ${TOKENS.xxxPink400} 25%, ${TOKENS.xxxRed200} 30%, ${TOKENS.xxxRed300} 35%, ${TOKENS.xxxRed400} 40%, ${TOKENS.xxxOrange200} 45%, ${TOKENS.xxxOrange300} 50%, ${TOKENS.xxxOrange400} 55%, ${TOKENS.xxxYellow200} 60%, ${TOKENS.xxxYellow300} 65%, ${TOKENS.xxxYellow400} 70%, ${TOKENS.xxxLime200} 75%, ${TOKENS.xxxLime300} 80%, ${TOKENS.xxxLime400} 85%, ${TOKENS.xxxCyan200} 90%, ${TOKENS.xxxCyan300} 95%, ${TOKENS.xxxCyan400} 100%);
    --xxx-spectrum-tight: linear-gradient(90deg, ${TOKENS.xxxViolet300}, ${TOKENS.xxxPink300}, ${TOKENS.xxxRed300}, ${TOKENS.xxxOrange300}, ${TOKENS.xxxYellow300}, ${TOKENS.xxxLime300}, ${TOKENS.xxxCyan300});
    --gf-bg: ${TOKENS.bg};
    --gf-bg-rgb: ${TOKENS.bgRgb};
    --gf-surface: ${TOKENS.surface};
    --gf-surface-rgb: ${TOKENS.surfaceRgb};
    --gf-card: ${TOKENS.card};
    --gf-card-rgb: ${TOKENS.cardRgb};
    --gf-card-elevated: ${TOKENS.cardElevated};
    --gf-sunken: ${TOKENS.sunken};
    --gf-sunken-rgb: ${TOKENS.sunkenRgb};
    --gf-line: ${TOKENS.line};
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
    --nb-border: 2px solid ${TOKENS.ink};
    --nb-shadow: 4px 4px 0 ${TOKENS.ink};
    --nb-shadow-sm: 2px 2px 0 ${TOKENS.ink};
    --nb-shadow-lg: 6px 6px 0 ${TOKENS.ink};
    --nb-radius: 8px;
    --nb-radius-sm: 6px;
  `.trim();
}

/**
 * Generates content-script CSS variable declarations for #ghostfill-fab scope.
 */
export function generateFabScopeTokens(): string {
  return generateHostTokens();
}
