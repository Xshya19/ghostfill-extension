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

import { classifyField, shouldDecorateField, getFieldTooltip, FieldType } from '../../shared/fieldClassifier';
import { generateHostTokens } from '../../shared/tokens';
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
  ${generateHostTokens()}

  --brand:           var(--gf-violet);
  --brand-rgb:       var(--gf-violet-rgb);
  --brand-light:     var(--gf-magenta);
  --success:         var(--gf-mint);
  --success-rgb:     var(--gf-mint-rgb);
  --error:           var(--gf-coral);
  --error-rgb:       var(--gf-coral-rgb);
  
  --glass-bg:        rgba(var(--gf-card-rgb), 0.45);
  --glass-bg-hover:  rgba(var(--gf-card-rgb), 0.85);
  --glass-border:    rgba(var(--gf-magenta-rgb), 0.2);
  --perspective:     800px;
  
  --shadow-raised:   0 2px 8px rgba(0, 0, 0, 0.25), 0 4px 16px rgba(0, 0, 0, 0.15);
  --shadow-hover:    0 8px 24px rgba(var(--gf-violet-rgb), 0.2), 0 0 0 1px rgba(var(--gf-magenta-rgb), 0.3);

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

.ghost-icon-container:hover {
  opacity: 0.95;
  background: var(--glass-bg-hover);
  border-color: rgba(var(--brand-rgb), 0.45);
  box-shadow: var(--shadow-hover);
  transform: perspective(var(--perspective)) translateZ(2px) scale(1.05);
}

.ghost-icon-container:hover::before {
  opacity: 0.95;
}

.ghost-icon-container:active {
  transform: perspective(var(--perspective)) translateZ(-1px) scale(0.96);
  opacity: 0.85;
  transition: transform 0.08s ease;
}

/* ── SVG Icons ── */
.ghost-svg {
  width: 14px;
  height: 14px;
  position: relative;
  z-index: 2;
  transition: transform 0.3s var(--ease-spring);
  will-change: transform;
}

.ghost-icon-container:hover .ghost-svg {
  transform: scale(1.15);
}

.ghost-icon-container:active .ghost-svg {
  transform: scale(0.92);
}

/* ── Spinner ── */
.gl-spinner {
  width: 13px;
  height: 13px;
  border: 1.5px solid rgba(var(--brand-rgb), 0.15);
  border-radius: 50%;
  border-top-color: var(--brand);
  animation: glSpin 0.7s linear infinite;
  z-index: 2;
}

@keyframes glSpin {
  to { transform: rotate(360deg); }
}

/* ── Success Animation ── */
.gl-success-icon {
  animation: glPop 0.3s var(--ease-spring);
}

@keyframes glPop {
  0% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

/* ── Spatial Tooltip (Cyberpunk styled) ── */
.gl-tooltip {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%) translateY(4px) scale(0.85);
  transform-origin: bottom center;
  background: var(--gf-bg);
  border: 1.5px solid var(--gf-ink);
  color: var(--gf-cream);
  font-size: 10px;
  font-weight: 700;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 2px 2px 0 var(--gf-ink);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  z-index: 1000;
  transition:
    opacity 0.25s var(--ease-out-expo),
    transform 0.25s var(--ease-out-expo);
  will-change: opacity, transform;
}

.gl-tooltip::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -4px;
  border-width: 4px;
  border-style: solid;
  border-color: var(--gf-ink) transparent transparent transparent;
}

:host(:hover) .gl-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(-6px) scale(1);
}

/* State Modifiers */
.ghost-icon-container.gl-loading {
  background: var(--glass-bg-hover);
  border-color: rgba(var(--brand-rgb), 0.3);
  cursor: wait;
}

.ghost-icon-container.gl-success {
  background: rgba(var(--success-rgb), 0.15);
  border-color: var(--success);
  box-shadow: 0 0 12px rgba(var(--success-rgb), 0.35);
  opacity: 0.95;
}

.ghost-icon-container.gl-error {
  background: rgba(var(--error-rgb), 0.15);
  border-color: var(--error);
  box-shadow: 0 0 12px rgba(var(--error-rgb), 0.35);
  opacity: 0.95;
  animation: glShake 0.35s ease;
}

.ghost-icon-container.gl-otp-ready {
  background: rgba(var(--brand-rgb), 0.18);
  border-color: var(--brand);
  box-shadow: 0 0 12px rgba(var(--brand-rgb), 0.35);
  opacity: 0.95;
  animation: glPulse 2s ease-in-out infinite;
}

@keyframes glPulse {
  0%, 100% { transform: perspective(var(--perspective)) translateZ(0) scale(1); }
  50% { transform: perspective(var(--perspective)) translateZ(1px) scale(1.05); }
}

@keyframes glShake {
  0%, 100% { transform: perspective(var(--perspective)) translateX(0); }
  20%, 60% { transform: perspective(var(--perspective)) translateX(-3px); }
  40%, 80% { transform: perspective(var(--perspective)) translateX(3px); }
}

/* ── Entrance/Exit ── */
:host {
  transition: opacity 0.25s var(--ease-out-expo), transform 0.25s var(--ease-out-expo);
}
:host(.gl-entering) {
  opacity: 0;
  transform: scale(0.7) rotate(-5deg);
}
:host(.gl-exiting) {
  opacity: 0;
  transform: scale(0.8) translateY(2px);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .ghost-icon-container, .ghost-svg, .gl-tooltip, :host {
    transition: none !important;
    animation: none !important;
  }
  .ghost-icon-container:hover {
    transform: none !important;
  }
  .ghost-icon-container:active {
    transform: none !important;
  }
}
`;

class GhostLabelIcons {
  static readonly GHOST = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gf-brand-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--gf-violet)"/><stop offset="100%" stop-color="var(--gf-magenta)"/>
      </linearGradient></defs>
      <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z"
            fill="url(#gf-brand-gradient)"/>
      <circle cx="9" cy="10" r="1.5" fill="white"/>
      <circle cx="15" cy="10" r="1.5" fill="white"/>
    </svg>`;

  static readonly EMAIL = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glEG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--gf-cyan)"/><stop offset="100%" stop-color="var(--gf-violet)"/>
      </linearGradient></defs>
      <rect x="3" y="5" width="18" height="14" rx="3" fill="url(#glEG)"/>
      <path d="M3 8l9 5 9-5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;

  static readonly PASSWORD = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glKG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--gf-yellow)"/><stop offset="50%" stop-color="var(--gf-coral)"/>
        <stop offset="100%" stop-color="var(--gf-magenta)"/>
      </linearGradient></defs>
      <circle cx="8" cy="15" r="5" fill="url(#glKG)"/>
      <path d="M12 12l8-8M18 6l2 2M20 4l2 2" stroke="url(#glKG)"
            stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="8" cy="15" r="2" fill="white" fill-opacity="0.35"/>
    </svg>`;

  static readonly OTP = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glOG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--gf-mint)"/><stop offset="100%" stop-color="var(--gf-cyan)"/>
      </linearGradient></defs>
      <rect x="3" y="11" width="18" height="11" rx="3" fill="url(#glOG)"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#glOG)"
            stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="12" cy="16" r="1.5" fill="white"/>
    </svg>`;

  static readonly USER = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="glUG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="var(--gf-violet)"/><stop offset="100%" stop-color="var(--gf-magenta)"/>
      </linearGradient></defs>
      <circle cx="12" cy="8" r="5" fill="url(#glUG)"/>
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="url(#glUG)"/>
    </svg>`;

  static readonly SUCCESS = `
    <svg class="gl-success-icon ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--gf-mint)"/>
      <path d="M8 12.5l2.5 2.5 5-5" stroke="var(--gf-ink)" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  static readonly ERROR = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="var(--gf-coral)"/>
      <path d="M15 9l-6 6M9 9l6 6" stroke="var(--gf-ink)" stroke-width="2"
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

// FieldIntelligence removed and unified into src/shared/fieldClassifier.ts

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
  private ariaLiveEl: HTMLElement | null = null;

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
    this.fieldType = classifyField(input);

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
    this.setAttribute('aria-label', getFieldTooltip(this.fieldType));

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
          if (updateFn) {
            updateFn();
          }
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
      if (!input.isConnected || !shouldDecorateField(input)) {
        this.animateExit();
      } else {
        const newType = classifyField(input);
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

    if (this.ariaLiveEl) {
      this.ariaLiveEl.textContent = `GhostFill state changed to ${state}`;
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

    // Aria Live Region
    this.ariaLiveEl = document.createElement('div');
    this.ariaLiveEl.className = 'gl-aria-live';
    this.ariaLiveEl.setAttribute('aria-live', 'polite');
    this.ariaLiveEl.setAttribute('role', 'status');
    this.ariaLiveEl.style.cssText = 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0;';
    this.root.appendChild(this.ariaLiveEl);
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
    this.tooltipEl.textContent = getFieldTooltip(this.fieldType);
    this.setAttribute('aria-label', getFieldTooltip(this.fieldType));
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
