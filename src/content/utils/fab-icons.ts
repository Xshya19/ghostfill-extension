/**
 * fab-icons.ts — Icon System
 *
 * Extracted from floatingButton.ts §6. Pure SVG string constants for
 * all FAB button modes with gradient definitions.
 */
import type { ButtonMode } from './fab-types';

const ICONS: Readonly<Record<ButtonMode, string>> = {
  magic: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfGG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7c5cfc"/><stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient></defs>
    <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z" fill="url(#gfGG)"/>
    <circle cx="9" cy="10" r="1.5" fill="white"/><circle cx="15" cy="10" r="1.5" fill="white"/>
  </svg>`,

  email: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfEG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient></defs>
    <rect x="2" y="4" width="20" height="16" rx="3" fill="url(#gfEG)"/>
    <path d="M2 7l10 6 10-6" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  password: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfKG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#7c5cfc"/>
    </linearGradient></defs>
    <circle cx="8" cy="15" r="5" fill="url(#gfKG)"/>
    <path d="M12 12l8-8M18 6l2 2M20 4l2 2" stroke="url(#gfKG)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="8" cy="15" r="2" fill="white" fill-opacity="0.4"/>
  </svg>`,

  otp: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfOG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#d97706"/>
    </linearGradient></defs>
    <rect x="3" y="11" width="18" height="11" rx="3" fill="url(#gfOG)"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#gfOG)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="12" cy="16" r="1.5" fill="white"/>
  </svg>`,

  user: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfUG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient></defs>
    <circle cx="12" cy="8" r="5" fill="url(#gfUG)"/>
    <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="url(#gfUG)"/>
  </svg>`,

  form: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <defs><linearGradient id="gfFG" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#0891b2"/>
    </linearGradient></defs>
    <rect x="3" y="3" width="18" height="18" rx="3" fill="url(#gfFG)"/>
    <rect x="6" y="7"  width="8"  height="2" rx="1" fill="white" opacity="0.9"/>
    <rect x="6" y="11" width="12" height="2" rx="1" fill="white" opacity="0.7"/>
    <rect x="6" y="15" width="6"  height="2" rx="1" fill="white" opacity="0.5"/>
  </svg>`,
};

export class IconSystem {
  static get(mode: ButtonMode): string {
    return ICONS[mode] ?? ICONS.magic;
  }

  static getSpinner(): string {
    return '<div class="gf-spinner" role="status" aria-label="Loading"></div>';
  }

  static getSuccess(): string {
    return `<svg class="gf-success-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#22c55e"/>
      <path d="M8 12.5l2.5 2.5 5-5" stroke="white" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  static getError(): string {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#ef4444"/>
      <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2"
            stroke-linecap="round"/>
    </svg>`;
  }
}
