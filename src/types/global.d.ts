/**
 * Global type augmentations for GhostFill extension.
 *
 * Ensures all browser APIs and CSS custom-property style objects
 * are typed correctly without resorting to `as any` casts.
 */

// ── CSS Custom Properties on React elements ─────────────────────────────────
// React's CSSProperties type only allows known CSS property names.
// CSS custom properties (--foo: bar) require this augmentation.
declare module 'react' {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

// ── requestIdleCallback / cancelIdleCallback ─────────────────────────────────
// These are standard in modern browsers but absent from older @types/web libs.
declare global {
  interface Window {
    requestIdleCallback(cb: IdleRequestCallback, opts?: IdleRequestOptions): number;
    cancelIdleCallback(id: number): void;
  }
}

export {};
