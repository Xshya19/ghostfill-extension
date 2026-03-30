// ═══════════════════════════════════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🏷️  G H O S T   L A B E L   3 . 0  —  I N L I N E   F I E L D      ║
// ║  Spatial Glass Icon · Context-Adaptive · Smart Positioning            ║
// ║  Inline field indicator for individual input elements                 ║
// ╚══════════════════════════════════════════════════════════════════════════╝
// ═══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// §1  D E S I G N   T O K E N S   &   S T Y L E S
// ─────────────────────────────────────────────────────────────────────────────

import { setHTML } from '../../utils/setHTML';

const STYLES = `
/* ═══════════════════════════════════════════════════
   GhostLabel 3.0 — Spatial Glass Inline Icon
   ═══════════════════════════════════════════════════ */

:host {
  display: block;
  position: absolute;
  z-index: 2147483647;
  cursor: pointer;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  pointer-events: auto;
  width: 28px;
  height: 28px;
  padding: 8px;
  margin: -8px;

  /* Premium Spatial Tokens */
  --brand:           #7c5cfc;
  --brand-rgb:       124, 92, 252;
  --brand-light:     #a78bfa;
  --success:         #22c55e;
  --success-rgb:     34, 197, 94;
  --error:           #ef4444;
  --error-rgb:       239, 68, 68;
  
  --glass-bg:        rgba(255, 255, 255, 0.45);
  --glass-bg-hover:  rgba(255, 255, 255, 0.85);
  --glass-border:    rgba(255, 255, 255, 0.55);
  --perspective:     800px;
  
  --shadow-raised:   0 2px 8px rgba(0, 0, 0, 0.06), 0 4px 16px rgba(0, 0, 0, 0.04);
  --shadow-hover:    0 8px 24px rgba(124, 92, 252, 0.2), 0 0 0 1px rgba(255,255,255,0.7);

  --ease-out-expo:   cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring:     cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --ease-bounce:     cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

/* ── Container: Spatial Glass Pill ── */
.ghost-icon-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 9px;

  /* Liquid glass */
  background: var(--glass-bg);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-raised);

  overflow: hidden;
  opacity: 0.55;
  position: relative;

  /* 3D spatial */
  transform: perspective(var(--perspective)) translateZ(0);
  transform-style: preserve-3d;
  transition:
    transform 0.35s var(--ease-out-expo),
    opacity   0.3s  var(--ease-out-expo),
    box-shadow 0.35s var(--ease-out-expo),
    background 0.25s ease,
    border-color 0.25s ease;
  will-change: transform, opacity, box-shadow;
}

/* Top specular highlight */
.ghost-icon-container::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 50%;
  border-radius: 9px 9px 50% 50%;
  background: linear-gradient(180deg,
    rgba(255, 255, 255, 0.5) 0%,
    rgba(255, 255, 255, 0.08) 60%,
    transparent 100%);
  pointer-events: none;
  z-index: 1;
  opacity: 0.7;
  transition: opacity 0.3s ease;
}

/* Prismatic edge */
.ghost-icon-container::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg,
    rgba(255, 255, 255, 0.5) 0%,
    rgba(255, 255, 255, 0.1) 30%,
    rgba(var(--brand-rgb), 0.06) 55%,
    rgba(255, 255, 255, 0.08) 75%,
    rgba(255, 255, 255, 0.35) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask:         linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  z-index: 2;
  opacity: 0.6;
  transition: opacity 0.3s ease;
}

/* ── Hover: Lift & illuminate ── */
.ghost-icon-container:hover {
  transform: perspective(var(--perspective)) translateY(-3px) translateZ(8px) scale(1.08);
  opacity: 1;
  background: var(--glass-bg-hover);
  border-color: rgba(255, 255, 255, 0.9);
  box-shadow: var(--shadow-hover);
}

.ghost-icon-container:hover::before { opacity: 1; }
.ghost-icon-container:hover::after  { opacity: 1; }

/* ── Active: Press into surface ── */
.ghost-icon-container:active {
  transform: perspective(var(--perspective)) translateY(1px) translateZ(-2px) scale(0.92);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.06),
    0 1px 2px rgba(0, 0, 0, 0.04);
  transition-duration: 0.08s;
}

/* ── Focus visible ── */
:host(:focus-visible) .ghost-icon-container {
  outline: 2.5px solid var(--brand);
  outline-offset: 2px;
}

/* ── Icon ── */
.ghost-svg {
  width: 17px;
  height: 17px;
  position: relative;
  z-index: 3;
  filter: drop-shadow(0 1px 2px rgba(var(--brand-rgb), 0.15));
  transition: transform 0.35s var(--ease-spring), filter 0.3s ease;
}

.ghost-icon-container:hover .ghost-svg {
  transform: rotate(8deg) scale(1.1);
  filter: drop-shadow(0 2px 5px rgba(var(--brand-rgb), 0.25));
}

.ghost-icon-container:active .ghost-svg {
  transform: scale(0.9);
  transition-duration: 0.08s;
}

/* ── GPU-Accelerated Glow Layers ── */
:host::before {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 12px;
  background: radial-gradient(circle, rgba(var(--brand-rgb), 0.4) 0%, transparent 60%);
  opacity: 0;
  z-index: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
  will-change: opacity, transform;
}

@keyframes gl-breathe-glow {
  0%, 100% { opacity: 0; transform: scale(0.9); }
  50% { opacity: 0.15; transform: scale(1.1); }
}

.ghost-icon-container:not(:hover):not(:active):not(.gl-loading):not(.gl-success):not(.gl-error) {
  /* Keep shadow static to prevent paints */
  box-shadow: 
    inset 0 0.5px 0 rgba(255, 255, 255, 0.6),
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 2px 6px rgba(0, 0, 0, 0.04);
}

:host(:not(:hover):not(:active):not(.gl-entering))::before {
  animation: gl-breathe-glow 4s ease-in-out infinite;
}

/* ── State: Loading ── */
.ghost-icon-container.gl-loading {
  animation: none;
  cursor: wait;
  opacity: 0.8;
}

.gl-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(var(--brand-rgb), 0.15);
  border-radius: 50%;
  border-top-color: var(--brand);
  animation: gl-spin 0.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
  position: relative; z-index: 3;
}
@keyframes gl-spin { to { transform: rotate(360deg); } }

/* ── State: Success ── */
.ghost-icon-container.gl-success {
  animation: none;
  border-color: rgba(var(--success-rgb), 0.3);
  opacity: 1;
  box-shadow:
    0 0 12px rgba(var(--success-rgb), 0.2),
    0 0 24px rgba(var(--success-rgb), 0.08),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.6);
}

.gl-success-icon {
  animation: gl-check-pop 0.4s var(--ease-spring);
  position: relative; z-index: 3;
}

@keyframes gl-check-pop {
  0%   { transform: scale(0) rotate(-45deg); opacity: 0; }
  50%  { transform: scale(1.2) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}

/* ── State: Error ── */
.ghost-icon-container.gl-error {
  animation: gl-shake 0.4s ease;
  border-color: rgba(var(--error-rgb), 0.3);
  opacity: 1;
  box-shadow:
    0 0 10px rgba(var(--error-rgb), 0.15),
    inset 0 0.5px 0 rgba(255, 255, 255, 0.6);
}

@keyframes gl-shake {
  0%, 100% { transform: perspective(var(--perspective)) translateX(0); }
  15%  { transform: perspective(var(--perspective)) translateX(-3px) translateZ(1px); }
  30%  { transform: perspective(var(--perspective)) translateX(3px) translateZ(1px); }
  45%  { transform: perspective(var(--perspective)) translateX(-2px); }
  60%  { transform: perspective(var(--perspective)) translateX(2px); }
  75%  { transform: perspective(var(--perspective)) translateX(-1px); }
}

/* ── State: OTP Ready (purple ambient) ── */
.ghost-icon-container.gl-otp-ready {
  border-color: rgba(168, 85, 247, 0.3);
  opacity: 0.85;
  box-shadow:
    inset 0 0.5px 0 rgba(255, 255, 255, 0.6),
    0 0 8px rgba(168, 85, 247, 0.1);
}

@keyframes gl-otp-glow {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.2); }
}

:host(.has-otp-ready)::before {
  background: radial-gradient(circle, rgba(168, 85, 247, 0.5) 0%, transparent 60%);
  animation: gl-otp-glow 2.5s ease-in-out infinite;
}

/* ── Entry animation ── */
@keyframes gl-enter {
  from {
    opacity: 0;
    transform: perspective(var(--perspective)) scale(0.6) translateZ(-10px);
  }
  to {
    opacity: 0.55;
    transform: perspective(var(--perspective)) scale(1) translateZ(0);
  }
}

:host(.gl-entering) .ghost-icon-container {
  animation: gl-enter 0.35s var(--ease-spring) forwards;
}

/* ── Exit animation ── */
@keyframes gl-exit {
  from {
    opacity: 0.55;
    transform: perspective(var(--perspective)) scale(1) translateZ(0);
  }
  to {
    opacity: 0;
    transform: perspective(var(--perspective)) scale(0.5) translateZ(-8px);
  }
}

:host(.gl-exiting) .ghost-icon-container {
  animation: gl-exit 0.2s var(--ease-out-expo) forwards;
  pointer-events: none;
}

/* ── Tooltip ── */
.gl-tooltip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 5px 9px;
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: white;
  font-size: 10px;
  font-weight: 550;
  letter-spacing: -0.01em;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: all 0.2s var(--ease-out-expo);
  z-index: 10;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.15);
}

.gl-tooltip::after {
  content: '';
  position: absolute;
  top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 4px solid transparent;
  border-top-color: rgba(15, 23, 42, 0.92);
}

.ghost-icon-container:hover + .gl-tooltip,
:host(:focus-visible) .gl-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* ── Dark mode ── */
@media (prefers-color-scheme: dark) {
  :host {
    --glass-bg:       rgba(22, 30, 52, 0.55);
    --glass-bg-hover: rgba(28, 36, 60, 0.88);
    --glass-border:   rgba(255, 255, 255, 0.08);
  }

  .ghost-icon-container {
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.06),
      0 1px 3px rgba(0, 0, 0, 0.15),
      0 2px 6px rgba(0, 0, 0, 0.1);
  }

  .ghost-icon-container::before {
    background: linear-gradient(180deg,
      rgba(255, 255, 255, 0.06) 0%, transparent 60%);
  }

  .ghost-icon-container::after {
    background: linear-gradient(135deg,
      rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.01) 30%,
      rgba(var(--brand-rgb), 0.04) 55%, rgba(255, 255, 255, 0.05) 100%);
    opacity: 0.4;
  }

  .ghost-icon-container:hover {
    border-color: rgba(var(--brand-rgb), 0.3);
    box-shadow:
      inset 0 0.5px 0 rgba(255, 255, 255, 0.08),
      0 4px 12px rgba(var(--brand-rgb), 0.15),
      0 8px 24px rgba(0, 0, 0, 0.25),
      0 0 0 2px rgba(var(--brand-rgb), 0.1);
  }

  .gl-tooltip {
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .gl-tooltip::after {
    border-top-color: rgba(30, 41, 59, 0.95);
  }
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  .ghost-icon-container,
  .ghost-svg,
  .gl-spinner,
  .gl-success-icon,
  :host(.gl-entering) .ghost-icon-container,
  :host(.gl-exiting) .ghost-icon-container {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
  .ghost-icon-container:hover { transform: none !important; }
  .ghost-icon-container:active { transform: none !important; }
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// §2  I C O N   S V G   L I B R A R Y
// ─────────────────────────────────────────────────────────────────────────────

type FieldType = 'email' | 'password' | 'otp' | 'user' | 'generic';

class GhostLabelIcons {
  static readonly GHOST = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gf-brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7c5cfc"/><stop offset="100%" stop-color="#a78bfa"/>
      </linearGradient></defs>
      <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z"
            fill="url(#gf-brand-gradient)"/>
      <circle cx="9" cy="10" r="1.5" fill="white"/>
      <circle cx="15" cy="10" r="1.5" fill="white"/>
    </svg>`;

  static readonly EMAIL = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glEG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient></defs>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="url(#glEG)"/>
      <path d="M3 8l9 5 9-5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

  static readonly PASSWORD = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glKG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#7c5cfc"/>
      </linearGradient></defs>
      <circle cx="8" cy="15" r="5" fill="url(#glKG)"/>
      <path d="M12 12l8-8M18 6l2 2M20 4l2 2" stroke="url(#glKG)"
            stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="8" cy="15" r="2" fill="white" fill-opacity="0.35"/>
    </svg>`;

  static readonly OTP = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glOG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#7c3aed"/>
      </linearGradient></defs>
      <rect x="3" y="11" width="18" height="11" rx="3" fill="url(#glOG)"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#glOG)"
            stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="12" cy="16" r="1.5" fill="white"/>
    </svg>`;

  static readonly USER = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glUG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#7c3aed"/>
      </linearGradient></defs>
      <circle cx="12" cy="8" r="5" fill="url(#glUG)"/>
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="url(#glUG)"/>
    </svg>`;

  static readonly SUCCESS = `
    <svg class="gl-success-icon ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#22c55e"/>
      <path d="M8 12.5l2.5 2.5 5-5" stroke="white" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  static readonly ERROR = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#ef4444"/>
      <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2"
            stroke-linecap="round"/>
    </svg>`;

  static readonly SPINNER = `<div class="gl-spinner" role="status" aria-label="Loading"></div>`;

  static forFieldType(fieldType: FieldType): string {
    switch (fieldType) {
      case 'email':
        return this.EMAIL;
      case 'password':
        return this.PASSWORD;
      case 'otp':
        return this.OTP;
      case 'user':
        return this.USER;
      default:
        return this.GHOST;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §3  F I E L D   I N T E L L I G E N C E
// ─────────────────────────────────────────────────────────────────────────────

class FieldIntelligence {
  /**
   * Classify what kind of field this input is.
   */
  static classify(input: HTMLInputElement): FieldType {
    const type = (input.type || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const autocomplete = (input.autocomplete || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const label = this.findLabel(input).toLowerCase();
    const combined = `${type} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel} ${label}`;
    const nameId = name + id;

    // OTP / verification code
    if (autocomplete === 'one-time-code') {
      return 'otp';
    }
    if (/otp|one[-_]?time|verification[-_]?code|passcode|security[-_]?code/.test(combined)) {
      return 'otp';
    }
    if (/^(code|pin|token)$/.test(name) || /^(code|pin|token)$/.test(id)) {
      return 'otp';
    }
    if (input.inputMode === 'numeric' && input.maxLength >= 4 && input.maxLength <= 8) {
      return 'otp';
    }

    // Email
    if (type === 'email') {
      return 'email';
    }
    if (/e[-_]?mail/.test(nameId)) {
      return 'email';
    }
    if (/@/.test(placeholder)) {
      return 'email';
    }
    if (autocomplete === 'username') {
      return 'email';
    }
    if (/user[-_]?name|login[-_]?name|login[-_]?id/.test(nameId)) {
      return 'email';
    }

    // Password — check AFTER OTP/email so `type="password"` always wins
    if (type === 'password') {
      return 'password';
    }
    if (/password|passwd|pwd/.test(nameId)) {
      return 'password';
    }
    // Also catch label/aria signals for password (e.g. React Aria wrapping)
    if (/password|passwd/.test(combined)) {
      return 'password';
    }

    // Name / user
    if (
      /first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name/.test(
        nameId
      )
    ) {
      return 'user';
    }
    if (/name/.test(nameId) && !/user/.test(nameId)) {
      return 'user';
    }

    return 'generic';
  }

  /**
   * Generate a contextual tooltip based on field type.
   */
  static tooltip(fieldType: FieldType): string {
    const tips: Record<FieldType, string> = {
      email: 'Fill email',
      password: 'Fill password',
      otp: 'Paste code',
      user: 'Fill name',
      generic: 'GhostFill',
    };
    return tips[fieldType] ?? tips.generic;
  }

  /**
   * Determine if this input should get a GhostLabel.
   */
  static shouldDecorate(input: HTMLInputElement): boolean {
    const excludedTypes = new Set([
      'hidden',
      'submit',
      'button',
      'reset',
      'checkbox',
      'radio',
      'file',
      'image',
      'range',
      'color',
      'search',
    ]);

    if (excludedTypes.has(input.type)) {
      return false;
    }

    const name = (input.name || input.id || input.placeholder || '').toLowerCase();
    if (/search|query|q$|filter|find/.test(name)) {
      return false;
    }

    // Individual OTP digit boxes handled separately
    if (input.maxLength === 1) {
      return false;
    }

    if (input.disabled || input.readOnly) {
      return false;
    }

    const rect = input.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 15) {
      return false;
    }

    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    return true;
  }

  /**
   * Find the associated label text for an input.
   * Handles: explicit <label for>, ancestor <label>, aria-labelledby, aria-label.
   */
  private static findLabel(input: HTMLInputElement): string {
    // Explicit <label for="...">
    if (input.id) {
      try {
        const label = document.querySelector<HTMLLabelElement>(
          `label[for="${CSS.escape(input.id)}"]`
        );
        if (label) {
          return label.textContent?.trim() || '';
        }
      } catch {
        /* skip if id is not a valid CSS selector */
      }
    }

    // aria-labelledby (important for React Aria / Headless UI patterns)
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/).map((id) => {
        try {
          return document.getElementById(id)?.textContent?.trim() || '';
        } catch {
          return '';
        }
      });
      const text = parts.filter(Boolean).join(' ');
      if (text) {
        return text;
      }
    }

    // Ancestor <label>
    const parent = input.closest('label');
    if (parent) {
      return parent.textContent?.trim() || '';
    }

    // aria-label attribute
    return input.getAttribute('aria-label') || '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §4  S M A R T   P O S I T I O N   E N G I N E
// ─────────────────────────────────────────────────────────────────────────────

class PositionEngine {
  private static readonly ICON_SIZE = 28;
  private static readonly INSET = 6; // px from field's inner right edge
  private static readonly MIN_FIELD_W = 50; // don't show if field is too narrow

  /**
   * Calculate absolute page coordinates to position the GhostLabel
   * inside the input field, right-aligned, vertically centred.
   */
  static calculate(input: HTMLInputElement): { top: number; left: number; visible: boolean } {
    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);

    // Visibility gate — do NOT check opacity so React Aria hidden inputs still work
    if (
      rect.width === 0 ||
      rect.height === 0 ||
      style.display === 'none' ||
      style.visibility === 'hidden'
    ) {
      return { top: 0, left: 0, visible: false };
    }

    // Field too narrow
    if (rect.width < this.MIN_FIELD_W) {
      return { top: 0, left: 0, visible: false };
    }

    // Off-screen check
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      return { top: 0, left: 0, visible: false };
    }

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    // Account for field padding on the right to stay inside the "content" area
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const borderRight = parseFloat(style.borderRightWidth) || 0;

    // Place icon inside the field, inset from the right
    const left = rect.right + scrollX - this.ICON_SIZE - this.INSET - paddingRight - borderRight;
    const top = rect.top + scrollY + (rect.height - this.ICON_SIZE) / 2;

    return { top, left, visible: true };
  }

  /**
   * Check if the input's value is obscuring where the icon would sit.
   * If text is long enough to reach under the icon, nudge opacity.
   */
  static isTextOverlapping(input: HTMLInputElement): boolean {
    if (!input.value) {
      return false;
    }
    if (input.type === 'password') {
      return false;
    } // password dots are narrow

    const style = window.getComputedStyle(input);
    const fontSize = parseFloat(style.fontSize) || 14;
    const fieldWidth = input.getBoundingClientRect().width;
    const approxCharWidth = fontSize * 0.6;
    const maxCharsBeforeOverlap = Math.floor(
      (fieldWidth - this.ICON_SIZE - this.INSET * 2) / approxCharWidth
    );

    return input.value.length > maxCharsBeforeOverlap;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §5  G H O S T   L A B E L   W E B   C O M P O N E N T
// ─────────────────────────────────────────────────────────────────────────────

type LabelState = 'idle' | 'loading' | 'success' | 'error' | 'otp-ready';
const ghostLabelObserveMap = new WeakMap<Element, () => void>();
let sharedResizeObserver: ResizeObserver | null = null;

// Export the interface so autoFiller.ts can type-check
export interface GhostLabelElement extends HTMLElement {
  attachToAttribute(input: HTMLInputElement, onClick: () => void): void;
  setState(state: LabelState, autoResetMs?: number): void;
  getFieldType(): FieldType;
  animateExit(): void;
}

export class GhostLabel extends HTMLElement implements GhostLabelElement {
  // ── DOM ──────────────────────────────────────────────────
  private root: ShadowRoot;
  private container: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;

  // ── State ────────────────────────────────────────────────
  private inputElement: HTMLInputElement | null = null;
  private fieldType: FieldType = 'generic';
  private currentState: LabelState = 'idle';
  private isAttached = false;

  // ── Observers & timers ───────────────────────────────────
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private inputObserver: MutationObserver | null = null;
  private positionRafId: number | null = null;
  private stateResetTimer: ReturnType<typeof setTimeout> | null = null;
  private _scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private _inputChangeTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Bound methods ────────────────────────────────────────
  private _onScroll: () => void;
  private _onInputChange: () => void;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });

    // Pre-bind for efficient listener add/remove
    this._onScroll = this.schedulePositionUpdateThrottled.bind(this);
    this._onInputChange = this.handleInputValueChange.bind(this);
  }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  connectedCallback(): void {
    this.render();

    // Entry animation
    this.classList.add('gl-entering');
    requestAnimationFrame(() => {
      setTimeout(() => this.classList.remove('gl-entering'), 350);
    });

    this.updatePosition();
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Attach this label to an input element with a click handler.
   */
  attachToAttribute(input: HTMLInputElement, onClick: () => void): void {
    if (this.isAttached) {
      return;
    }
    this.isAttached = true;
    this.inputElement = input;
    this.fieldType = FieldIntelligence.classify(input);

    // Set appropriate icon based on field type
    this.updateIcon();
    this.updateTooltip();

    // ── Click handler ─────────────────────────────────────
    this.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.currentState === 'loading') {
        return;
      }
      onClick();
    });

    // Keyboard support
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'button');
    this.setAttribute('aria-label', FieldIntelligence.tooltip(this.fieldType));

    this.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.currentState !== 'loading') {
          onClick();
        }
      }
    });

    // ── Observers ─────────────────────────────────────────

    // Resize observer on the input (Shared)
    if (!sharedResizeObserver) {
      sharedResizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
           const updateFn = ghostLabelObserveMap.get(entry.target);
           if (updateFn) { updateFn(); }
        }
      });
    }
    ghostLabelObserveMap.set(input, () => this.schedulePositionUpdate());
    sharedResizeObserver.observe(input);

    // Intersection observer — only update when input is visible in viewport
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const visible = entry?.isIntersecting ?? true;
        if (visible) {
          this.style.display = 'block';
          this.schedulePositionUpdate();
        } else {
          this.style.display = 'none';
        }
      },
      { threshold: 0.1 }
    );
    this.intersectionObserver.observe(input);

    // Mutation observer on the input — detect type/disabled/style changes
    this.inputObserver = new MutationObserver(() => {
      if (!input.isConnected || !FieldIntelligence.shouldDecorate(input)) {
        this.animateExit();
      } else {
        const newType = FieldIntelligence.classify(input);
        if (newType !== this.fieldType) {
          this.fieldType = newType;
          this.updateIcon();
          this.updateTooltip();
        }
        this.schedulePositionUpdate();
      }
    });
    this.inputObserver.observe(input, {
      attributes: true,
      attributeFilter: ['type', 'disabled', 'readonly', 'style', 'class', 'hidden'],
    });

    // Listen for value changes to adjust opacity
    input.addEventListener('input', this._onInputChange);

    // Window listeners
    window.addEventListener('scroll', this._onScroll, { capture: true, passive: true });

    // Initial position
    this.updatePosition();
  }

  /**
   * Set visual state (loading / success / error / otp-ready / idle).
   */
  setState(state: LabelState, autoResetMs?: number): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;

    if (this.stateResetTimer) {
      clearTimeout(this.stateResetTimer);
      this.stateResetTimer = null;
    }

    if (!this.container) {
      return;
    }

    // Clear previous state classes
    this.container.classList.remove('gl-loading', 'gl-success', 'gl-error', 'gl-otp-ready');

    switch (state) {
      case 'loading':
        this.container.classList.add('gl-loading');
        setHTML(this.container, GhostLabelIcons.SPINNER);
        break;

      case 'success':
        this.container.classList.add('gl-success');
        setHTML(this.container, GhostLabelIcons.SUCCESS);
        break;

      case 'error':
        this.container.classList.add('gl-error');
        setHTML(this.container, GhostLabelIcons.ERROR);
        break;

      case 'otp-ready':
        this.container.classList.add('gl-otp-ready');
        setHTML(this.container, GhostLabelIcons.OTP);
        break;

      case 'idle':
      default:
        this.updateIcon();
        break;
    }

    // Auto-reset to idle
    if (autoResetMs && state !== 'idle') {
      this.stateResetTimer = setTimeout(() => {
        this.setState('idle');
      }, autoResetMs);
    }
  }

  /**
   * Get the detected field type.
   */
  getFieldType(): FieldType {
    return this.fieldType;
  }

  /**
   * Trigger graceful exit animation then remove from DOM.
   */
  animateExit(): void {
    this.classList.add('gl-exiting');
    setTimeout(() => this.remove(), 200);
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDERING
  // ═══════════════════════════════════════════════════════════

  private render(): void {
    // Apply styles via adoptedStyleSheets where possible (CSP-safe)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ('adoptedStyleSheets' in (document as any)) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      this.root.adoptedStyleSheets = [sheet];
    } else {
      const style = document.createElement('style');
      style.textContent = STYLES;
      this.root.appendChild(style);
    }

    // Container
    this.container = document.createElement('div');
    this.container.className = 'ghost-icon-container';
    setHTML(this.container, GhostLabelIcons.GHOST);
    this.root.appendChild(this.container);

    // Tooltip
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'gl-tooltip';
    this.tooltipEl.textContent = 'GhostFill';
    this.root.appendChild(this.tooltipEl);
  }

  private updateIcon(): void {
    if (!this.container || this.currentState !== 'idle') {
      return;
    }
    setHTML(this.container, GhostLabelIcons.forFieldType(this.fieldType));
  }

  private updateTooltip(): void {
    if (!this.tooltipEl) {
      return;
    }
    this.tooltipEl.textContent = FieldIntelligence.tooltip(this.fieldType);
    this.setAttribute('aria-label', FieldIntelligence.tooltip(this.fieldType));
  }

  // ═══════════════════════════════════════════════════════════
  //  POSITIONING
  // ═══════════════════════════════════════════════════════════

  private schedulePositionUpdate(): void {
    if (this.positionRafId) {
      return;
    }
    this.positionRafId = window.requestAnimationFrame(() => {
      this.positionRafId = null;
      this.updatePosition();
    });
  }

  private schedulePositionUpdateThrottled(): void {
    if (this._scrollTimeout) {
      return;
    }
    this._scrollTimeout = setTimeout(() => {
      this._scrollTimeout = null;
      this.schedulePositionUpdate();
    }, 50);
  }

  private updatePosition(): void {
    if (!this.inputElement) {
      return;
    }

    if (!this.inputElement.isConnected) {
      this.animateExit();
      return;
    }

    const pos = PositionEngine.calculate(this.inputElement);

    if (!pos.visible) {
      this.style.setProperty('display', 'none', 'important');
      return;
    }

    this.style.setProperty('display', 'block', 'important');
    this.style.setProperty('position', 'absolute', 'important');
    this.style.setProperty('z-index', '2147483647', 'important');
    this.style.setProperty('top', `${pos.top}px`, 'important');
    this.style.setProperty('left', `${pos.left}px`, 'important');

    // Adjust opacity if user's text would overlap the icon
    if (this.container && this.currentState === 'idle') {
      const overlapping = PositionEngine.isTextOverlapping(this.inputElement);
      this.container.style.opacity = overlapping ? '0.25' : '';
    }
  }

  private handleInputValueChange(): void {
    if (this._inputChangeTimeout) {
      clearTimeout(this._inputChangeTimeout);
    }
    this._inputChangeTimeout = setTimeout(() => {
      this._inputChangeTimeout = null;
      if (!this.inputElement || !this.container || this.currentState !== 'idle') {
        return;
      }
      const overlapping = PositionEngine.isTextOverlapping(this.inputElement);
      this.container.style.opacity = overlapping ? '0.25' : '';
    }, 150);
  }

  // ═══════════════════════════════════════════════════════════
  //  CLEANUP
  // ═══════════════════════════════════════════════════════════

  private cleanup(): void {
    if (this.inputElement && sharedResizeObserver) {
      sharedResizeObserver.unobserve(this.inputElement);
      ghostLabelObserveMap.delete(this.inputElement);
    }

    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.inputObserver) {
      this.inputObserver.disconnect();
      this.inputObserver = null;
    }

    if (this.positionRafId) {
      cancelAnimationFrame(this.positionRafId);
      this.positionRafId = null;
    }

    if (this.stateResetTimer) {
      clearTimeout(this.stateResetTimer);
      this.stateResetTimer = null;
    }

    if (this._inputChangeTimeout) {
      clearTimeout(this._inputChangeTimeout);
      this._inputChangeTimeout = null;
    }

    if (this.inputElement) {
      this.inputElement.removeEventListener('input', this._onInputChange);
    }

    window.removeEventListener('scroll', this._onScroll, true);

    this.inputElement = null;
    this.container = null;
    this.tooltipEl = null;
    this.isAttached = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  C U S T O M   E L E M E N T   R E G I S T R A T I O N
// ─────────────────────────────────────────────────────────────────────────────

if (typeof customElements !== 'undefined' && customElements && !customElements.get('ghost-label')) {
  try {
    customElements.define('ghost-label', GhostLabel);
  } catch (e) {
    // Silently ignore if already defined in another context
    // eslint-disable-next-line no-console
    console.debug('[GhostFill] GhostLabel registration skipped:', e);
  }
}
