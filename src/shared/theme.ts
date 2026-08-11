/**
 * GhostFill theme controller & design tokens — single source of truth for UI state and styling.
 *
 * Provides:
 * 1. Theme control (resolveTheme, applyTheme, initTheme) for light/dark synchronization.
 * 2. Design token constants (TOKENS) and Shadow DOM CSS generator functions.
 */
import { storageService } from '../services/storageService';
import { STORAGE_KEYS } from '../types/storage.types';

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
  let pref: ThemeMode = 'system';
  const mql = darkMediaQuery();

  const render = (): void => applyTheme(resolveTheme(pref), root);

  const onSystemChange = (): void => {
    if (pref === 'system') {
      render();
    }
  };

  // Paint immediately from the default, then refine once settings load so the
  // popup never flashes the wrong theme for longer than a frame.
  render();

  void storageService
    .getSettings()
    .then((settings) => {
      pref = settings.darkMode ?? 'system';
      render();
    })
    .catch(() => {
      /* keep the 'system' default on failure */
    });

  const unsubscribeStore = storageService.onChanged((changes) => {
    if (STORAGE_KEYS.SETTINGS in changes) {
      void storageService
        .getSettings()
        .then((settings) => {
          pref = settings.darkMode ?? 'system';
          render();
        })
        .catch(() => {
          /* ignore */
        });
    }
  });

  mql?.addEventListener?.('change', onSystemChange);

  return () => {
    unsubscribeStore();
    mql?.removeEventListener?.('change', onSystemChange);
  };
}

/* ── Design Tokens Source of Truth ───────────────────────────────────────── */

/**
 * GhostFill design token source of truth for Shadow DOM and content UI.
 * Keep this aligned with src/shared/styles/design-tokens.css.
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
  cardElevated: '#1f232b',
  sunken: '#0C0E12',
  sunkenRgb: '12, 14, 18',
  line: 'rgba(255, 255, 255, 0.08)',
  line2: 'rgba(255, 255, 255, 0.13)',
  hi: 'rgba(255, 255, 255, 0.06)',

  // Ink (cool light on dark)
  ink: '#EEF1F6',
  inkRgb: '238, 241, 246',
  inkSoft: '#AAB2C0',
  inkSoftRgb: '170, 178, 192',
  cream: '#EEF1F6',
  textMuted: '#AAB2C0',
  // #727a88 measures only 3.99:1 on `surface` and fails AA for the label text
  // this token carries; #7d8492 clears 4.59:1 and looks identical.
  textDim: '#7d8492',

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

  // Solid-fill contrast pairs. The brightened Iris is only 3.21:1 behind white,
  // so a solid fill uses primaryDeep (4.78:1). Mint/amber can never clear
  // 4.5:1 with white in either theme, so they take dark ink instead.
  primaryFillDeep: '#464cd6',
  dangerFill: '#c73e43',
  dangerFillDeep: '#a8353a',
  onFillLight: '#ffffff',
  successSoft: '#0f2a25',
  warningSoft: '#2a2110',
  dangerSoft: '#2c1414',
  scrim: 'rgba(4, 5, 7, 0.7)',
  fontMono: "'IBM Plex Mono', 'Space Mono', 'JetBrains Mono', ui-monospace, monospace",
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
    --gf-line-2: ${TOKENS.line2};
    --gf-hi: ${TOKENS.hi};
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
    --nb-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.42), 0 16px 36px -12px rgba(0, 0, 0, 0.6);
    --nb-shadow-sm: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.4);
    --nb-shadow-lg: 0 1px 0 rgba(255, 255, 255, 0.05), 0 10px 26px -8px rgba(0, 0, 0, 0.5), 0 40px 80px -20px rgba(0, 0, 0, 0.72);
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
    --gf-on-primary: ${TOKENS.onFillLight};
    --gf-success: ${TOKENS.mint};
    --gf-warning: ${TOKENS.yellow};
    --gf-danger: ${TOKENS.coral};
    --gf-accent: ${TOKENS.violet};
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
    --gf-coral-text: ${TOKENS.coral};
    --gf-danger-text: ${TOKENS.coral};
    /* Solid fills + the ink guaranteed readable on each. */
    --gf-primary-fill: ${TOKENS.primaryDeep};
    --gf-primary-fill-deep: ${TOKENS.primaryFillDeep};
    --gf-success-fill: ${TOKENS.mint};
    --gf-warning-fill: ${TOKENS.yellow};
    --gf-danger-fill: ${TOKENS.dangerFill};
    --gf-danger-fill-deep: ${TOKENS.dangerFillDeep};
    --gf-on-fill-light: ${TOKENS.onFillLight};
    --gf-on-fill-dark: ${TOKENS.bg};
    --gf-scrim: ${TOKENS.scrim};
    --gf-font-mono: ${TOKENS.fontMono};
    --brand-font-mono: ${TOKENS.fontMono};
    --gf-grad-cobalt: linear-gradient(180deg, ${TOKENS.primaryDeep}, ${TOKENS.primaryFillDeep});
    --gf-grad-cobalt-hover: linear-gradient(180deg, #8b91ff, #6a70f5);
    --gf-grad-mint: linear-gradient(180deg, #12b886, ${TOKENS.mint});
    --gf-grad-coral: linear-gradient(180deg, ${TOKENS.dangerFill}, ${TOKENS.dangerFillDeep});
    --gf-border: 1px solid ${TOKENS.line};
    --gf-border-strong: 1px solid ${TOKENS.line2};
    --gf-border-thin: 1px solid ${TOKENS.line};
    --gf-shadow-sm: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.4);
    --gf-shadow: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.42), 0 16px 36px -12px rgba(0, 0, 0, 0.6);
    --gf-shadow-lg: 0 1px 0 rgba(255, 255, 255, 0.05), 0 10px 26px -8px rgba(0, 0, 0, 0.5), 0 40px 80px -20px rgba(0, 0, 0, 0.72);
    --shadow-hard-sm: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.4);
    --shadow-hard: 0 1px 0 rgba(255, 255, 255, 0.04), 0 2px 6px rgba(0, 0, 0, 0.42), 0 16px 36px -12px rgba(0, 0, 0, 0.6);
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
