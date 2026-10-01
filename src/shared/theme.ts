/**
 * GhostFill theme controller & design tokens — single source of truth for UI state and styling.
 *
 * Provides:
 * 1. Theme control (resolveTheme, applyTheme, initTheme) for light/dark synchronization.
 * 2. Design token constants (TOKENS) and Shadow DOM CSS generator functions.
 */
import { storageService } from '../services/storageService';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../types/storage.types';

/* ── Theme Controller ─────────────────────────────────────────────────────── */

export type ThemeMode = boolean | 'system';
export type ResolvedTheme = 'light' | 'dark';

const darkMediaQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** Resolve a stored preference into a concrete light/dark value. */
export function resolveTheme(pref: ThemeMode): ResolvedTheme {
  if (pref === 'system') {
    return darkMediaQuery()?.matches ? 'dark' : 'light';
  }
  return pref ? 'dark' : 'light';
}

/** Apply a resolved theme to a root element (defaults to <html>). */
export function applyTheme(
  theme: ResolvedTheme,
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null
): void {
  if (!root) {
    return;
  }
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

/**
 * Read the stored preference, apply it to `root`, and keep it live.
 * Returns an unsubscribe function that detaches all listeners.
 */
export function initTheme(
  root: HTMLElement | null = typeof document !== 'undefined' ? document.documentElement : null
): () => void {
  let pref: ThemeMode = DEFAULT_SETTINGS.darkMode;
  let readGeneration = 0;
  const mql = darkMediaQuery();

  const render = (): void => applyTheme(resolveTheme(pref), root);

  const onSystemChange = (): void => {
    if (pref === 'system') {
      render();
    }
  };

  // Paint from the product default until the stored preference is available.
  render();

  const loadPreference = (): void => {
    const generation = ++readGeneration;
    void storageService
      .getSettings()
      .then((settings) => {
        if (generation !== readGeneration) {
          return;
        }
        pref = settings.darkMode ?? DEFAULT_SETTINGS.darkMode;
        render();
      })
      .catch(() => {
        /* keep the last applied preference on failure */
      });
  };

  loadPreference();

  const unsubscribeStore = storageService.onChanged((changes) => {
    if (STORAGE_KEYS.SETTINGS in changes) {
      loadPreference();
    }
  });

  mql?.addEventListener?.('change', onSystemChange);

  return () => {
    readGeneration += 1;
    unsubscribeStore();
    mql?.removeEventListener?.('change', onSystemChange);
  };
}

/* ── Design Tokens Source of Truth ───────────────────────────────────────── */

/**
 * GhostFill dark material tokens for Shadow DOM and content UI.
 * Keep this aligned with src/frontend/styles/globals.css and the design-system baseline.
 */
export const TOKENS = {
  // Semantic accent swatches for the in-page controls and states
  xxxViolet200: 'rgba(10, 132, 255, 0.18)',
  xxxViolet200Rgb: '10, 132, 255',
  xxxViolet300: '#69B5FF',
  xxxViolet300Rgb: '105, 181, 255',
  xxxViolet400: '#0A84FF',
  xxxViolet400Rgb: '10, 132, 255',
  xxxPink200: 'rgba(191, 155, 255, 0.16)',
  xxxPink200Rgb: '191, 155, 255',
  xxxPink300: '#D6BFFF',
  xxxPink300Rgb: '214, 191, 255',
  xxxPink400: '#BF9BFF',
  xxxPink400Rgb: '191, 155, 255',
  xxxRed200: 'rgba(255, 69, 58, 0.16)',
  xxxRed200Rgb: '255, 69, 58',
  xxxRed300: '#FF6961',
  xxxRed300Rgb: '255, 105, 97',
  xxxRed400: '#FF453A',
  xxxRed400Rgb: '255, 69, 58',
  xxxOrange200: 'rgba(255, 159, 10, 0.16)',
  xxxOrange200Rgb: '255, 159, 10',
  xxxOrange300: '#FFB340',
  xxxOrange300Rgb: '255, 179, 64',
  xxxOrange400: '#FF9F0A',
  xxxOrange400Rgb: '255, 159, 10',
  xxxYellow200: 'rgba(255, 159, 10, 0.16)',
  xxxYellow200Rgb: '255, 159, 10',
  xxxYellow300: '#FFB340',
  xxxYellow300Rgb: '255, 179, 64',
  xxxYellow400: '#FF9F0A',
  xxxYellow400Rgb: '255, 159, 10',
  xxxLime200: 'rgba(48, 209, 88, 0.16)',
  xxxLime200Rgb: '48, 209, 88',
  xxxLime300: '#5EE27A',
  xxxLime300Rgb: '94, 226, 122',
  xxxLime400: '#30D158',
  xxxLime400Rgb: '48, 209, 88',
  xxxCyan200: 'rgba(10, 132, 255, 0.18)',
  xxxCyan200Rgb: '10, 132, 255',
  xxxCyan300: '#69B5FF',
  xxxCyan300Rgb: '105, 181, 255',
  xxxCyan400: '#0A84FF',
  xxxCyan400Rgb: '10, 132, 255',

  // Dark system palette for UI attached to arbitrary webpages
  bg: '#1C1C1E',
  bgRgb: '28, 28, 30',
  surface: '#2C2C2E',
  surfaceRgb: '44, 44, 46',
  surface2: '#38383A',
  card: '#2C2C2E',
  cardRgb: '44, 44, 46',
  cardElevated: '#38383A',
  sunken: '#18181A',
  sunkenRgb: '24, 24, 26',
  line: 'rgba(132, 132, 137, 0.32)',
  line2: 'rgba(174, 174, 178, 0.48)',
  hi: 'rgba(255, 255, 255, 0.09)',
  glass: 'rgba(42, 48, 58, 0.53)',
  glassSolid: '#29292B',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.2)',
  glassShadow: '0 14px 34px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.14)',
  glassBlur: '26px',
  glassControl:
    'radial-gradient(ellipse at 25% 0%, rgba(255, 255, 255, 0.09), transparent 65%), linear-gradient(155deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.02))',
  glassPanel: 'linear-gradient(150deg, rgba(57, 60, 68, 0.7), rgba(39, 42, 48, 0.55))',
  glassElevated: 'rgba(42, 45, 52, 0.96)',
  glassContentStrong: 'rgba(43, 46, 53, 0.88)',
  glassStroke: 'rgba(255, 255, 255, 0.1)',
  glassInner: 'inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.12)',
  glassSaturate: '155%',

  // High-contrast neutral ink
  ink: '#F5F5F7',
  inkRgb: '245, 245, 247',
  inkSoft: '#AEAEB2',
  inkSoftRgb: '174, 174, 178',
  cream: '#F5F5F7',
  textMuted: '#AEAEB2',
  textDim: '#AEAEB2',

  // Semantic status colors
  mustard: '#FF9F0A',
  mustardRgb: '255, 159, 10',
  sienna: '#FF453A',
  siennaRgb: '255, 69, 58',
  teal: '#30D158',
  tealRgb: '48, 209, 88',
  coralWarm: '#69B5FF',
  coralWarmRgb: '105, 181, 255',

  magenta: '#BF9BFF',
  magentaRgb: '191, 155, 255',
  cyan: '#0A84FF',
  cyanRgb: '10, 132, 255',
  violet: '#BF9BFF',
  violetRgb: '191, 155, 255',
  yellow: '#FF9F0A',
  yellowRgb: '255, 159, 10',
  coral: '#FF453A',
  coralRgb: '255, 69, 58',
  coralText: '#FF6961',
  mint: '#30D158',
  mintRgb: '48, 209, 88',

  // System blue
  primary: '#0A84FF',
  primaryRgb: '10, 132, 255',
  primaryDeep: '#0066CC',
  primaryText: '#69B5FF',
  primarySoft: 'rgba(10, 132, 255, 0.18)',

  primaryFillDeep: '#0057B8',
  warningFill: '#805500',
  dangerFill: '#D70015',
  dangerFillDeep: '#A40010',
  onFillLight: '#ffffff',
  onFillDark: '#1C1C1E',
  successSoft: 'rgba(48, 209, 88, 0.16)',
  warningSoft: 'rgba(255, 159, 10, 0.16)',
  dangerSoft: 'rgba(255, 69, 58, 0.16)',
  scrim: 'rgba(0, 0, 0, 0.52)',
  fontMono: "ui-monospace, 'SFMono-Regular', Consolas, monospace",
  panelRadius: '16px',
  controlRadius: '10px',
  controlHeight: '44px',
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
    --xxx-spectrum: ${TOKENS.primary};
    --xxx-spectrum-tight: ${TOKENS.primary};
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
    --gf-line-2: ${TOKENS.line2};
    --gf-hi: ${TOKENS.hi};
    --gf-glass: ${TOKENS.glass};
    --gf-glass-solid: ${TOKENS.glassSolid};
    --gf-glass-border: ${TOKENS.glassBorder};
    --gf-glass-highlight: ${TOKENS.glassHighlight};
    --gf-glass-shadow: ${TOKENS.glassShadow};
    --gf-glass-blur: ${TOKENS.glassBlur};
    --gf-glass-control: ${TOKENS.glassControl};
    --gf-glass-panel: ${TOKENS.glassPanel};
    --gf-glass-elevated: ${TOKENS.glassElevated};
    --gf-glass-content-strong: ${TOKENS.glassContentStrong};
    --gf-glass-stroke: ${TOKENS.glassStroke};
    --gf-glass-inner: ${TOKENS.glassInner};
    --gf-glass-saturate: ${TOKENS.glassSaturate};
    --gf-ink: ${TOKENS.ink};
    --gf-ink-rgb: ${TOKENS.inkRgb};
    --gf-ink-soft: ${TOKENS.inkSoft};
    --gf-ink-soft-rgb: ${TOKENS.inkSoftRgb};
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
    --nb-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    --nb-shadow-sm: 0 3px 8px rgba(0, 0, 0, 0.26);
    --nb-shadow-lg: 0 14px 30px rgba(0, 0, 0, 0.38);
    --nb-radius: 16px;
    --nb-radius-sm: 10px;
    --gf-paper: ${TOKENS.bg};
    --gf-paper-2: ${TOKENS.surface};
    --gf-ink-dim: ${TOKENS.textDim};
    --gf-amber: ${TOKENS.yellow};
    --gf-primary: ${TOKENS.primary};
    --gf-primary-rgb: ${TOKENS.primaryRgb};
    --gf-primary-deep: ${TOKENS.primaryDeep};
    --gf-primary-text: ${TOKENS.primaryText};
    --gf-primary-soft: ${TOKENS.primarySoft};
    --gf-on-primary: ${TOKENS.onFillLight};
    --gf-success: ${TOKENS.mint};
    --gf-warning: ${TOKENS.yellow};
    --gf-danger: ${TOKENS.coral};
    --gf-accent: ${TOKENS.primary};
    --gf-success-rgb: ${TOKENS.mintRgb};
    --gf-warning-rgb: ${TOKENS.yellowRgb};
    --gf-danger-rgb: ${TOKENS.coralRgb};
    --gf-success-soft: ${TOKENS.successSoft};
    --gf-warning-soft: ${TOKENS.warningSoft};
    --gf-danger-soft: ${TOKENS.dangerSoft};
    --gf-amber-rgb: ${TOKENS.yellowRgb};
    --gf-mint-rgb: ${TOKENS.mintRgb};
    /* On dark, the bright hues already clear 4.5:1 on their own *-soft chip,
       so the -text tokens alias the hue rather than darkening it. */
    --gf-mint-text: ${TOKENS.mint};
    --gf-amber-text: ${TOKENS.yellow};
    --gf-coral-text: ${TOKENS.coralText};
    --gf-danger-text: ${TOKENS.coralText};
    /* Solid fills + the ink guaranteed readable on each. */
    --gf-primary-fill: ${TOKENS.primaryDeep};
    --gf-primary-fill-deep: ${TOKENS.primaryFillDeep};
    --gf-success-fill: ${TOKENS.mint};
    --gf-warning-fill: ${TOKENS.warningFill};
    --gf-danger-fill: ${TOKENS.dangerFill};
    --gf-danger-fill-deep: ${TOKENS.dangerFillDeep};
    --gf-on-primary: ${TOKENS.onFillLight};
    --gf-on-danger: ${TOKENS.onFillLight};
    --gf-on-success: ${TOKENS.onFillDark};
    --gf-on-warning: ${TOKENS.onFillLight};
    --gf-on-fill-light: ${TOKENS.onFillLight};
    --gf-on-fill-dark: ${TOKENS.onFillDark};
    --gf-scrim: ${TOKENS.scrim};
    --gf-font-mono: ${TOKENS.fontMono};
    --brand-font-mono: ${TOKENS.fontMono};
    --gf-grad-cobalt: ${TOKENS.primaryDeep};
    --gf-grad-cobalt-hover: ${TOKENS.primaryFillDeep};
    --gf-grad-mint: ${TOKENS.mint};
    --gf-grad-coral: ${TOKENS.dangerFill};
    --gf-border: 1px solid ${TOKENS.line};
    --gf-border-strong: 1px solid ${TOKENS.line2};
    --gf-border-thin: 1px solid ${TOKENS.line};
    --gf-shadow-sm: 0 3px 8px rgba(0, 0, 0, 0.28);
    --gf-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
    --gf-shadow-lg: 0 14px 32px rgba(0, 0, 0, 0.4);
    --shadow-hard-sm: 0 1px 2px rgba(0, 0, 0, 0.28);
    --shadow-hard: 0 5px 14px rgba(0, 0, 0, 0.3);
    --gf-radius: ${TOKENS.panelRadius};
    --gf-radius-sm: 10px;
    --gf-panel-radius: ${TOKENS.panelRadius};
    --gf-control-radius: ${TOKENS.controlRadius};
    --gf-control-h: ${TOKENS.controlHeight};
  `.trim();
}

/**
 * Generates content-script CSS variable declarations for #ghostfill-fab scope.
 */
export function generateFabScopeTokens(): string {
  return generateHostTokens();
}

/** Theme palette for isolated in-page UI. Keep light values aligned with globals.css. */
export function generateHostThemeStyles(): string {
  return `
    :host { ${generateHostTokens()} }
    :host([data-theme='dark']) { color-scheme: dark; }
    :host([data-theme='light']) {
      color-scheme: light;
      --gf-bg: #f5f5f7;
      --gf-bg-rgb: 245, 245, 247;
      --gf-surface: #fff;
      --gf-surface-rgb: 255, 255, 255;
      --gf-surface-2: #f2f2f7;
      --gf-sunken: #e5e5ea;
      --gf-card: #fff;
      --gf-card-rgb: 255, 255, 255;
      --gf-card-elevated: #fff;
      --gf-line: rgba(60, 60, 67, 0.16);
      --gf-line-2: rgba(60, 60, 67, 0.28);
      --gf-hi: rgba(255, 255, 255, 0.92);
      --gf-ink: #1d1d1f;
      --gf-ink-rgb: 29, 29, 31;
      --gf-ink-soft: #60646c;
      --gf-ink-soft-rgb: 96, 100, 108;
      --gf-text-muted: #60646c;
      --gf-text-dim: #60646c;
      --gf-cream: #1d1d1f;
      --gf-glass: rgba(255, 255, 255, 0.62);
      --gf-glass-solid: #f5f5f7;
      --gf-glass-border: rgba(255, 255, 255, 0.72);
      --gf-glass-highlight: rgba(255, 255, 255, 0.78);
      --gf-glass-shadow: 0 8px 24px rgba(29, 38, 54, 0.07), 0 1px 3px rgba(29, 38, 54, 0.04);
      --gf-glass-control:
        radial-gradient(ellipse at 25% 0%, rgba(255, 255, 255, 0.42), transparent 65%),
        linear-gradient(155deg, rgba(255, 255, 255, 0.54), rgba(255, 255, 255, 0.22));
      --gf-glass-panel: linear-gradient(145deg, rgba(255, 255, 255, 0.94), rgba(255, 255, 255, 0.82) 60%, rgba(255, 255, 255, 0.86));
      --gf-glass-elevated: rgba(250, 251, 253, 0.94);
      --gf-glass-content-strong: rgba(255, 255, 255, 0.9);
      --gf-glass-stroke: rgba(60, 67, 80, 0.16);
      --gf-glass-inner: inset 0 1px 0 rgba(255, 255, 255, 0.78);
      --gf-primary: #0066cc;
      --gf-primary-rgb: 0, 102, 204;
      --gf-primary-text: #0066cc;
      --gf-primary-deep: #0057b8;
      --gf-primary-fill: #0066cc;
      --gf-primary-fill-deep: #0057b8;
      --gf-primary-soft: #eaf4ff;
      --gf-mint: #248a3d;
      --gf-mint-text: #207a36;
      --gf-mint-rgb: 36, 138, 61;
      --gf-success-fill: #207a36;
      --gf-on-success: #fff;
      --gf-amber: #9a6700;
      --gf-amber-text: #805500;
      --gf-coral: #d70015;
      --gf-coral-rgb: 215, 0, 21;
      --gf-coral-text: #bd0013;
      --gf-violet: #5b61b9;
      --gf-cyan: #0066cc;
      --gf-danger: #d70015;
      --gf-on-fill-dark: #1d1d1f;
      --gf-on-fill-light: #fff;
    }
  `;
}
