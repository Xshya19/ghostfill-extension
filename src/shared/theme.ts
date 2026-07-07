/**
 * GhostFill theme controller — single source of truth for light/dark.
 *
 * The design tokens in shared/styles/design-tokens.css default to LIGHT on
 * `:root` and override to dark under `[data-theme="dark"]`. Nothing applied that
 * attribute before, so the user's "Dark mode" setting did nothing. This module
 * resolves the stored preference (`UserSettings.darkMode`: true | false |
 * 'system'), applies `data-theme` to a root element, and keeps it in sync with
 * both settings changes and the OS theme (when the preference is 'system').
 *
 * Used by the popup and options entry points (root = <html>) and the in-page
 * FAB host (root = the shadow-DOM host element).
 */
import { storageService } from '../services/storageService';
import { STORAGE_KEYS } from '../types/storage.types';

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
