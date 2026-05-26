/**
 * fab-icons.ts — Ultra-Detailed Icon System — Memphis Neon Archive
 *
 * Museum-quality, high-fidelity SVG icons optimized for 20px display.
 * Employs the 2-weight Memphis stroke system and distinct self-contained defs
 * to ensure bulletproof cross-browser rendering in Shadow DOM contexts.
 */
import type { ButtonMode } from './fab-types';

// ═══════════════════════════════════════════════════════════
// MEMPHIS NEON ARCHIVE — EXACT TOKEN VALUES
// Source: popup.css :root — DO NOT DEVIATE
// ═══════════════════════════════════════════════════════════
const TOKENS = {
  cyan: '#20F4FF',      // --gf-cyan
  magenta: '#FF3BD4',   // --gf-magenta  
  violet: '#8B5CFF',    // --gf-violet
  yellow: '#FFD84D',    // --gf-yellow
  coral: '#FF6A4D',     // --gf-coral
  mint: '#62F2B3',      // --gf-mint
  ink: '#000000',       // --gf-ink
  cream: '#FFF3D6',     // --gf-cream
  surface: '#18152A',   // --gf-surface
  card: '#211B3D',      // --gf-card
  glowSubtle: '0.15',
  glowMedium: '0.35',
  glowStrong: '0.65',
} as const;

// ═══════════════════════════════════════════════════════════
// MEMPHIS STROKE SYSTEM — Two weights only
// Primary: 1.5px — Main outlines and high-contrast ink lines
// Detail:  0.8px — Secondary highlights and decorative marks
// ═══════════════════════════════════════════════════════════
const STROKE = {
  primary: '1.5',
  detail: '0.8',
} as const;

// We export SHARED_SVG_DEFS as an empty string to maintain back-compat,
// since we now embed defs directly inside each SVG for bulletproof rendering.
export const SHARED_SVG_DEFS = '';

// ═══════════════════════════════════════════════════════════
// ICONS — ULTRA-DETAILED MEMPHIS NEON ARCHIVE
// ═══════════════════════════════════════════════════════════
const ICONS: Readonly<Record<ButtonMode, string>> = {
  /**
   * MAGIC — GhostFill Mascot
   * Clean-vector mascot with high-contrast outlines, glowing gradient fill,
   * expressive eyes, cute cyber-blush details, and Memphis retro sparkles.
   */
  magic: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-magic-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${TOKENS.violet}"/>
        <stop offset="100%" stop-color="${TOKENS.magenta}"/>
      </linearGradient>
      <filter id="gf-magic-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.8" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- Background Sparkle (Top-Center) -->
    <path d="M12 2 L12.5 3.5 L14 4 L12.5 4.5 L12 6 L11.5 4.5 L10 4 L11.5 3.5 Z" fill="${TOKENS.yellow}" filter="url(#gf-magic-glow)"/>
    <!-- Left Tiny Sparkle -->
    <circle cx="3.5" cy="14" r="1" fill="${TOKENS.cyan}"/>
    
    <!-- Ghost Body -->
    <path d="M4.5 10.5 C4.5 6.36 7.86 3 12 3 C16.14 3 19.5 6.36 19.5 10.5 V18 L17 16.5 L14.5 18 L12 16.5 L9.5 18 L7 16.5 L4.5 18 V10.5 Z" 
          fill="url(#gf-magic-grad)" 
          stroke="${TOKENS.ink}" 
          stroke-width="${STROKE.primary}" 
          stroke-linejoin="round"
          filter="url(#gf-magic-glow)"/>
    <!-- Tech scanlines on body -->
    <line x1="8" y1="7.5" x2="16" y2="7.5" stroke="${TOKENS.cream}" stroke-width="${STROKE.detail}" opacity="0.25" stroke-dasharray="1 1"/>
    <line x1="12" y1="5" x2="12" y2="10" stroke="${TOKENS.cream}" stroke-width="${STROKE.detail}" opacity="0.25" stroke-dasharray="1 1"/>
    
    <!-- Eyes -->
    <circle cx="9.5" cy="11.5" r="1.8" fill="${TOKENS.ink}"/>
    <circle cx="10" cy="11" r="0.6" fill="${TOKENS.cream}"/>
    <circle cx="14.5" cy="11.5" r="1.8" fill="${TOKENS.ink}"/>
    <circle cx="15" cy="11" r="0.6" fill="${TOKENS.cream}"/>
    <!-- Cyber Blush -->
    <rect x="7.5" y="13.5" width="2" height="0.8" rx="0.4" fill="${TOKENS.cyan}"/>
    <rect x="14.5" y="13.5" width="2" height="0.8" rx="0.4" fill="${TOKENS.cyan}"/>
    <!-- Smile -->
    <path d="M11 14.5 Q12 15.5 13 14.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    
    <!-- Right Tiny Sparkle -->
    <path d="M21 7.5 L21.4 8.3 L22.2 8.5 L21.4 8.7 L21 9.5 L20.6 8.7 L19.8 8.5 L20.6 8.3 Z" fill="${TOKENS.magenta}"/>
  </svg>`,

  /**
   * EMAIL — Holographic Data Envelope
   * Clean geometric envelope with sharp folds, domain @ badge, and details.
   */
  email: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-email-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${TOKENS.cyan}"/>
        <stop offset="100%" stop-color="#005B7F"/>
      </linearGradient>
      <filter id="gf-email-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- Background accent sparkle -->
    <path d="M21 5 L21.3 5.8 L22.1 6 L21.3 6.2 L21 7 L20.7 6.2 L19.9 6 L20.7 5.8 Z" fill="${TOKENS.yellow}" filter="url(#gf-email-glow)"/>
    <circle cx="3.5" cy="16.5" r="1.5" stroke="${TOKENS.magenta}" stroke-width="${STROKE.detail}"/>
    <!-- Envelope Body -->
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" 
          fill="url(#gf-email-grad)" 
          stroke="${TOKENS.ink}" 
          stroke-width="${STROKE.primary}"
          filter="url(#gf-email-glow)"/>
    <!-- Fold Lines -->
    <path d="M3.5 7.5 L12 12.5 L20.5 7.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Domain Badge -->
    <rect x="7" y="13.5" width="10" height="3" rx="1.5" fill="${TOKENS.card}" stroke="${TOKENS.cyan}" stroke-width="${STROKE.detail}"/>
    <text x="12" y="15.8" font-family="monospace" font-size="2.8" fill="${TOKENS.cyan}" text-anchor="middle" font-weight="900">@</text>
    <!-- Decorative Grid Marks -->
    <line x1="6" y1="14" x2="11" y2="14" stroke="${TOKENS.cream}" stroke-width="${STROKE.detail}" opacity="0.4" stroke-linecap="round"/>
    <line x1="6" y1="11" x2="9" y2="11" stroke="${TOKENS.cream}" stroke-width="${STROKE.detail}" opacity="0.4" stroke-linecap="round"/>
  </svg>`,

  /**
   * PASSWORD — Cyber-Key
   * Cybernetic key with concentric gear core, shaft teeth, and accent sparks.
   */
  password: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-pass-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${TOKENS.magenta}"/>
        <stop offset="100%" stop-color="${TOKENS.cyan}"/>
      </linearGradient>
      <filter id="gf-pass-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- Key Ring Core -->
    <circle cx="8.5" cy="15.5" r="5" 
            fill="url(#gf-pass-grad)" 
            stroke="${TOKENS.ink}" 
            stroke-width="${STROKE.primary}"
            filter="url(#gf-pass-glow)"/>
    <circle cx="8.5" cy="15.5" r="1.5" fill="${TOKENS.ink}"/>
    <!-- Gear teeth detail -->
    <path d="M8.5 9 L8.5 10.5 M8.5 20.5 L8.5 22 M3 15.5 L4.5 15.5 M12.5 15.5 L14 15.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <!-- Key Shaft -->
    <path d="M12 12 L19.5 4.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <!-- Teeth -->
    <path d="M15.5 8.5 L18 11 M17.5 6.5 L20 9" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <!-- Memphis Sparkle (Top-Left) -->
    <path d="M4 6 L4.4 6.8 L5.2 7 L4.4 7.2 L4 8 L3.6 7.2 L2.8 7 L3.6 6.8 Z" fill="${TOKENS.yellow}" filter="url(#gf-pass-glow)"/>
    <!-- Accent Dots -->
    <circle cx="21" cy="15" r="1.2" fill="${TOKENS.magenta}"/>
  </svg>`,

  /**
   * OTP — Biometric Lock Shield
   * Lock shackle and shield body utilizing yellow/coral neon gradients.
   */
  otp: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-otp-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${TOKENS.yellow}"/>
        <stop offset="100%" stop-color="${TOKENS.coral}"/>
      </linearGradient>
      <filter id="gf-otp-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- Shackle -->
    <path d="M7.5 10.5 V6.5 C7.5 4.01 9.51 2 12 2 C14.49 2 16.5 4.01 16.5 6.5 V10.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round" fill="none"/>
    <!-- Shield Body -->
    <path d="M5 10.5 H19 V16.5 L12 21.5 L5 16.5 Z" 
          fill="url(#gf-otp-grad)" 
          stroke="${TOKENS.ink}" 
          stroke-width="${STROKE.primary}" 
          stroke-linejoin="round"
          filter="url(#gf-otp-glow)"/>
    <!-- Tech Grid Lines -->
    <line x1="8" y1="12.5" x2="16" y2="12.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.detail}" opacity="0.3"/>
    <line x1="8" y1="18.5" x2="16" y2="18.5" stroke="${TOKENS.ink}" stroke-width="${STROKE.detail}" opacity="0.3"/>
    <!-- Dial Core -->
    <circle cx="12" cy="15" r="2.8" fill="${TOKENS.ink}"/>
    <circle cx="12" cy="15" r="1" fill="${TOKENS.yellow}"/>
  </svg>`,

  /**
   * USER — Cybernetic Avatar
   * Avatar silhouette inside HUD concentric targeting rings.
   */
  user: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-user-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${TOKENS.violet}"/>
        <stop offset="100%" stop-color="#7B2FBE"/>
      </linearGradient>
      <filter id="gf-user-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- HUD Ring -->
    <circle cx="12" cy="12" r="10" stroke="${TOKENS.violet}" stroke-width="${STROKE.detail}" opacity="0.3" stroke-dasharray="2 2"/>
    <circle cx="12" cy="12" r="8.5" stroke="${TOKENS.violet}" stroke-width="${STROKE.detail}" opacity="0.4"/>
    <!-- Head -->
    <circle cx="12" cy="8.5" r="3.5" 
            fill="url(#gf-user-grad)" 
            stroke="${TOKENS.ink}" 
            stroke-width="${STROKE.primary}"
            filter="url(#gf-user-glow)"/>
    <!-- Body -->
    <path d="M5.5 19.5 C5.5 16.2 8.41 13.5 12 13.5 C15.59 13.5 18.5 16.2 18.5 19.5 Z" 
          fill="url(#gf-user-grad)" 
          stroke="${TOKENS.ink}" 
          stroke-width="${STROKE.primary}"
          filter="url(#gf-user-glow)"/>
    <!-- Crosshairs -->
    <path d="M12 1.5 V3.5 M12 20.5 V22.5 M1.5 12 H3.5 M20.5 12 H22.5" stroke="${TOKENS.magenta}" stroke-width="${STROKE.detail}"/>
    <!-- Memphis Sparkles -->
    <circle cx="21" cy="15.5" r="1" fill="${TOKENS.cyan}"/>
    <circle cx="3" cy="8.5" r="1" fill="${TOKENS.magenta}"/>
  </svg>`,

  /**
   * FORM — Technical Checklist
   * Fillable form sheet with completion checkmark badge and line details.
   */
  form: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="presentation" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="gf-form-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${TOKENS.cyan}"/>
        <stop offset="100%" stop-color="#00B8D4"/>
      </linearGradient>
      <filter id="gf-form-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="0.6" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>
    <!-- Paper Sheet -->
    <rect x="5.5" y="3.5" width="13" height="17" rx="1.5" 
          fill="url(#gf-form-grad)" 
          stroke="${TOKENS.ink}" 
          stroke-width="${STROKE.primary}"
          filter="url(#gf-form-glow)"/>
    <!-- Writing Lines -->
    <line x1="8" y1="8" x2="13" y2="8" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <line x1="8" y1="12" x2="16" y2="12" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <line x1="8" y1="16" x2="14" y2="16" stroke="${TOKENS.ink}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    <!-- Checkmark Badge -->
    <circle cx="16.5" cy="6.5" r="2.8" fill="${TOKENS.mint}" stroke="${TOKENS.ink}" stroke-width="${STROKE.detail}"/>
    <path d="M15.5 6.5 L16.2 7.2 L17.5 5.8" stroke="${TOKENS.ink}" stroke-width="${STROKE.detail}" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Background element -->
    <circle cx="21.5" cy="14.5" r="1.2" fill="${TOKENS.yellow}"/>
  </svg>`,
};

// ═══════════════════════════════════════════════════════════
// ICON SYSTEM CLASS — WITH ACCESSIBILITY & PERFORMANCE
// ═══════════════════════════════════════════════════════════
export class IconSystem {
  static get(mode: ButtonMode): string {
    const icon = ICONS[mode] ?? ICONS.magic;
    return icon.replace('<svg ', '<svg role="presentation" ');
  }

  static getSpinner(): string {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="status" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="${TOKENS.magenta}" stroke-width="${STROKE.primary}" stroke-dasharray="2 2" opacity="${TOKENS.glowMedium}"/>
      <circle cx="12" cy="12" r="9" stroke="${TOKENS.cyan}" stroke-width="${STROKE.primary}" stroke-dasharray="2 2" stroke-dashoffset="25" transform="rotate(-90 12 12)">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
      </circle>
    </svg>`;
  }

  static getSuccess(): string {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="none" stroke="${TOKENS.mint}" stroke-width="${STROKE.primary}"/>
      <path d="M7.5 12.5l3 3 6-6" stroke="${TOKENS.mint}" stroke-width="${STROKE.primary}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  static getError(): string {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="none" stroke="${TOKENS.coral}" stroke-width="${STROKE.primary}"/>
      <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="${TOKENS.coral}" stroke-width="${STROKE.primary}" stroke-linecap="round"/>
    </svg>`;
  }
}
