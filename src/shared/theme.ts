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
  // Raw accent swatches (200 tint, 300 base, 400 deep)
  xxxViolet200: 'rgba(136, 168, 255, 0.16)',
  xxxViolet200Rgb: '136, 168, 255',
  xxxViolet300: '#B8CBFF',
  xxxViolet300Rgb: '184, 203, 255',
  xxxViolet400: '#88A8FF',
  xxxViolet400Rgb: '136, 168, 255',
  xxxPink200: 'rgba(136, 168, 255, 0.16)',
  xxxPink200Rgb: '136, 168, 255',
  xxxPink300: '#B8CBFF',
  xxxPink300Rgb: '184, 203, 255',
  xxxPink400: '#88A8FF',
  xxxPink400Rgb: '136, 168, 255',
  xxxRed200: 'rgba(241, 132, 132, 0.16)',
  xxxRed200Rgb: '241, 132, 132',
  xxxRed300: '#F18484',
  xxxRed300Rgb: '241, 132, 132',
  xxxRed400: '#D75B5B',
  xxxRed400Rgb: '215, 91, 91',
  xxxOrange200: 'rgba(242, 182, 77, 0.16)',
  xxxOrange200Rgb: '242, 182, 77',
  xxxOrange300: '#F2B64D',
  xxxOrange300Rgb: '242, 182, 77',
  xxxOrange400: '#D79425',
  xxxOrange400Rgb: '215, 148, 37',
  xxxYellow200: 'rgba(242, 182, 77, 0.16)',
  xxxYellow200Rgb: '242, 182, 77',
  xxxYellow300: '#F2B64D',
  xxxYellow300Rgb: '242, 182, 77',
  xxxYellow400: '#D79425',
  xxxYellow400Rgb: '215, 148, 37',
  xxxLime200: 'rgba(90, 200, 158, 0.16)',
  xxxLime200Rgb: '90, 200, 158',
  xxxLime300: '#5AC89E',
  xxxLime300Rgb: '90, 200, 158',
  xxxLime400: '#3EA97E',
  xxxLime400Rgb: '62, 169, 126',
  xxxCyan200: 'rgba(136, 168, 255, 0.16)',
  xxxCyan200Rgb: '136, 168, 255',
  xxxCyan300: '#B8CBFF',
  xxxCyan300Rgb: '184, 203, 255',
  xxxCyan400: '#88A8FF',
  xxxCyan400Rgb: '136, 168, 255',

  // Canvas (Private Workspace night slate)
  bg: '#10151E',
  bgRgb: '16, 21, 30',
  surface: '#171E29',
  surfaceRgb: '23, 30, 41',
  surface2: '#1D2632',
  card: '#171E29',
  cardRgb: '23, 30, 41',
  cardElevated: '#202A37',
  sunken: '#111721',
  sunkenRgb: '17, 23, 33',
  line: 'rgba(243, 246, 250, 0.10)',
  line2: 'rgba(243, 246, 250, 0.18)',
  hi: 'rgba(255, 255, 255, 0.06)',

  // Ink (clear contrast under ambient light)
  ink: '#F3F6FA',
  inkRgb: '243, 246, 250',
  inkSoft: '#AAB5C4',
  inkSoftRgb: '170, 181, 196',
  cream: '#F3F6FA',
  textMuted: '#AAB5C4',
  textDim: '#7E8B9C',

  // Semantic legacy aliases
  mustard: '#F2B64D',
  mustardRgb: '242, 182, 77',
  sienna: '#F18484',
  siennaRgb: '241, 132, 132',
  teal: '#5AC89E',
  tealRgb: '90, 200, 158',
  coralWarm: '#B8CBFF',
  coralWarmRgb: '184, 203, 255',

  magenta: '#B8CBFF',
  magentaRgb: '184, 203, 255',
  cyan: '#88A8FF',
  cyanRgb: '136, 168, 255',
  violet: '#AFB6FF',
  violetRgb: '175, 182, 255',
  yellow: '#F2B64D',
  yellowRgb: '242, 182, 77',
  coral: '#F18484',
  coralRgb: '241, 132, 132',
  mint: '#5AC89E',
  mintRgb: '90, 200, 158',

  // Primary blue
  primary: '#88A8FF',
  primaryRgb: '136, 168, 255',
  primaryDeep: '#5E85E6',
  primarySoft: 'rgba(136, 168, 255, 0.16)',

  primaryFillDeep: '#456BC7',
  dangerFill: '#D75B5B',
  dangerFillDeep: '#BD4545',
  onFillLight: '#ffffff',
  successSoft: 'rgba(90, 200, 158, 0.16)',
  warningSoft: 'rgba(242, 182, 77, 0.16)',
  dangerSoft: 'rgba(241, 132, 132, 0.16)',
  scrim: 'rgba(7, 10, 15, 0.76)',
  fontMono: "'IBM Plex Mono', 'Space Mono', 'JetBrains Mono', ui-monospace, monospace",
  panelRadius: '12px',
  controlRadius: '8px',
  controlHeight: '36px',
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
    --nb-radius: 12px;
    --nb-radius-sm: 8px;
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
    --gf-grad-cobalt: ${TOKENS.primaryDeep};
    --gf-grad-cobalt-hover: ${TOKENS.primaryFillDeep};
    --gf-grad-mint: ${TOKENS.mint};
    --gf-grad-coral: ${TOKENS.dangerFill};
    --gf-border: 1px solid ${TOKENS.line};
    --gf-border-strong: 1px solid ${TOKENS.line2};
    --gf-border-thin: 1px solid ${TOKENS.line};
    --gf-shadow-sm: 0 3px 8px rgba(0, 0, 0, 0.26);
    --gf-shadow: 0 6px 16px rgba(0, 0, 0, 0.3);
    --gf-shadow-lg: 0 14px 30px rgba(0, 0, 0, 0.38);
    --shadow-hard-sm: 0 1px 2px rgba(0, 0, 0, 0.28);
    --shadow-hard: 0 5px 14px rgba(0, 0, 0, 0.3);
    --gf-radius: 12px;
    --gf-radius-sm: 8px;
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
