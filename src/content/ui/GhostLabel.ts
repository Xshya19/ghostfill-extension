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

import { classifyField, getFieldTooltip, FieldType } from '../../shared/fieldClassifier';
import { generateHostThemeStyles, initTheme } from '../../shared/theme';
import { setHTML } from '../../utils/sanitization.core';
import { evaluateFab } from '../fab';

const STYLES = `
${generateHostThemeStyles()}
:host {
  display: block;
  position: absolute;
  z-index: 2147483646;
  isolation: isolate;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  pointer-events: auto;
  box-sizing: content-box;
  width: 28px;
  height: 28px;
  padding: 8px;
  margin: -8px;
  border-radius: 14px;
  transition: opacity 160ms ease-out;
}
.ghost-icon-container {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border-radius: 9px;
  border: 1px solid var(--gf-glass-stroke);
  background: var(--gf-glass-solid);
  color: var(--gf-primary-text);
  box-shadow: var(--gf-glass-inner);
  transition: transform 120ms ease-out;
}
.ghost-icon-container:active { transform: scale(0.97); }
:host(:focus-visible) { outline: 2px solid var(--gf-primary); outline-offset: 2px; }
.ghost-svg { width: 15px; height: 15px; }
.gl-spinner {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--gf-glass-stroke);
  border-top-color: var(--gf-primary);
  border-radius: 50%;
  animation: glSpin 0.8s linear infinite;
}
@keyframes glSpin { to { transform: rotate(360deg); } }
.ghost-icon-container.gl-loading { cursor: wait; }
.ghost-icon-container.gl-success { color: var(--gf-mint-text); border-color: var(--gf-mint-text); }
.ghost-icon-container.gl-error { color: var(--gf-coral-text); border-color: var(--gf-coral-text); }
.ghost-icon-container.gl-otp-ready { color: var(--gf-primary-text); border-color: var(--gf-primary-text); }
.gl-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  width: max-content;
  max-width: min(280px, calc(100vw - 24px));
  transform: translateX(calc(-50% + var(--gl-tooltip-shift, 0px))) translateY(3px);
  padding: 7px 10px;
  background: var(--gf-glass-solid);
  border: 1px solid var(--gf-glass-stroke);
  border-radius: 10px;
  color: var(--gf-ink);
  box-shadow: var(--gf-glass-shadow);
  font-size: 12px;
  font-weight: 550;
  line-height: 1.4;
  overflow-wrap: anywhere;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms ease-out, transform 120ms ease-out, visibility 120ms;
}
:host(:hover) .gl-tooltip, :host(:focus-visible) .gl-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(calc(-50% + var(--gl-tooltip-shift, 0px))) translateY(0);
}
:host(.gl-entering), :host(.gl-exiting) { opacity: 0; }
:host(.gl-exiting) { pointer-events: none; }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ghost-icon-container { background: var(--gf-glass-control); -webkit-backdrop-filter: blur(4px) saturate(150%); backdrop-filter: blur(4px) saturate(150%); }
  .gl-tooltip { background: var(--gf-glass-elevated); -webkit-backdrop-filter: blur(24px) saturate(135%); backdrop-filter: blur(24px) saturate(135%); }
}
@media (prefers-reduced-motion: reduce) {
  :host, .ghost-icon-container, .gl-tooltip { transition: none; }
  .ghost-icon-container:active { transform: none; }
  .gl-spinner { animation-duration: 1.6s; }
  :host(.gl-entering) { opacity: 1; }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .ghost-icon-container, .gl-tooltip { background: var(--gf-glass-solid); border-color: var(--gf-line-2); -webkit-backdrop-filter: none; backdrop-filter: none; }
}
`;
let sharedStyleSheet: CSSStyleSheet | null = null;

class GhostLabelIcons {
  static readonly GHOST = `
    <svg class="ghost-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z"
            fill="var(--gf-primary)"/>
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
      <rect x="3.2" y="4.5" width="17.6" height="15" rx="3.2" fill="url(#glOG)"/>
      <path d="M6.2 8h11.6" stroke="white" stroke-width="1.35" stroke-linecap="round" opacity=".75"/>
      <circle cx="7.5" cy="12.2" r="1.15" fill="white"/><circle cx="12" cy="12.2" r="1.15" fill="white"/><circle cx="16.5" cy="12.2" r="1.15" fill="white"/>
      <path d="M7.5 15.8h9" stroke="white" stroke-width="1.35" stroke-linecap="round" opacity=".82"/>
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
      <circle cx="12" cy="12" r="10" fill="var(--gf-success-fill)"/>
      <path d="M8 12.5l2.5 2.5 5-5" stroke="var(--gf-on-success)" stroke-width="2"
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
  private unsubscribeTheme: (() => void) | null = null;

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
    this.addEventListener('mouseenter', () => this.positionTooltip());
    this.addEventListener('focus', () => this.positionTooltip());

    // Pre-bind for efficient listener add/remove
    this._onScroll = this.schedulePositionUpdateThrottled.bind(this);
    this._onInputChange = this.handleInputValueChange.bind(this);
  }

  // ═══════════════════════════════════════════════════════════
  //  LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  connectedCallback(): void {
    this.render();
    this.unsubscribeTheme = initTheme(this);

    // Entry animation
    this.classList.add('gl-entering');
    requestAnimationFrame(() => {
      this.classList.remove('gl-entering');
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
    if (evaluateFab(input).presence !== 'active') {
      this.remove();
      return;
    }
    this.isAttached = true;
    this.classList.add('gl-attached');
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
      if (!input.isConnected || evaluateFab(input).presence !== 'active') {
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
      attributeFilter: ['type', 'disabled', 'readonly', 'style', 'class', 'hidden', 'data-ghostfill-fab-active'],
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

    const fieldName: Record<FieldType, string> = {
      email: 'email address',
      password: 'password',
      otp: 'verification code',
      user: 'name',
      generic: 'field',
    };
    const target = fieldName[this.fieldType];
    const stateLabel: Record<Exclude<LabelState, 'idle'>, string> = {
      loading: `Filling ${target}…`,
      success: `${target[0]?.toUpperCase() ?? ''}${target.slice(1)} filled`,
      error: `Couldn’t fill ${target}. Try again`,
      'otp-ready': 'Verification code ready. Activate to fill',
    };
    const label = state === 'idle' ? getFieldTooltip(this.fieldType) : stateLabel[state];
    this.setAttribute('aria-label', label);
    this.toggleAttribute('aria-busy', state === 'loading');
    if (this.tooltipEl) {
      this.tooltipEl.textContent = label;
    }
    if (this.ariaLiveEl) {
      this.ariaLiveEl.textContent = state === 'idle' || state === 'loading' ? '' : label;
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
    this.root.replaceChildren();
    // Apply styles via adoptedStyleSheets where possible (CSP-safe)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ('adoptedStyleSheets' in (document as any)) {
      if (!sharedStyleSheet) {
        sharedStyleSheet = new CSSStyleSheet();
        sharedStyleSheet.replaceSync(STYLES);
      }
      this.root.adoptedStyleSheets = [sharedStyleSheet];
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
    this.tooltipEl.setAttribute('role', 'tooltip');
    this.tooltipEl.textContent = 'GhostFill';
    this.root.appendChild(this.tooltipEl);

    // Aria Live Region
    this.ariaLiveEl = document.createElement('div');
    this.ariaLiveEl.className = 'gl-aria-live';
    this.ariaLiveEl.setAttribute('aria-live', 'polite');
    this.ariaLiveEl.setAttribute('role', 'status');
    this.ariaLiveEl.style.cssText =
      'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0;';
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

  private positionTooltip(): void {
    if (!this.tooltipEl) {
      return;
    }
    this.tooltipEl.style.setProperty('--gl-tooltip-shift', '0px');
    this.tooltipEl.style.top = '';
    this.tooltipEl.style.bottom = '';
    const rect = this.tooltipEl.getBoundingClientRect();
    const shift = Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.right));
    this.tooltipEl.style.setProperty('--gl-tooltip-shift', `${shift}px`);
    if (rect.top < 8) {
      this.tooltipEl.style.top = 'calc(100% + 8px)';
      this.tooltipEl.style.bottom = 'auto';
    }
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

    if (!this.inputElement.isConnected || evaluateFab(this.inputElement).presence !== 'active') {
      this.animateExit();
      return;
    }

    // The focused floating control owns this field; keep its inline fallback out of the way.
    if (this.inputElement.hasAttribute('data-ghostfill-fab-active')) {
      this.style.setProperty('display', 'none', 'important');
      return;
    }

    const pos = PositionEngine.calculate(this.inputElement);

    if (!pos.visible) {
      this.style.setProperty('display', 'none', 'important');
      return;
    }

    this.style.setProperty('display', 'block', 'important');
    this.style.setProperty('position', 'absolute', 'important');
    this.style.setProperty('z-index', '2147483646', 'important');
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
    this.unsubscribeTheme?.();
    this.unsubscribeTheme = null;
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
    this.classList.remove('gl-attached');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6  C U S T O M   E L E M E N T   R E G I S T R A T I O N
// ─────────────────────────────────────────────────────────────────────────────

if (typeof customElements !== 'undefined' && customElements && !customElements.get('ghost-label')) {
  try {
    if (!customElements.get('ghost-label')) {
      customElements.define('ghost-label', GhostLabel);
    }
  } catch (e) {
    // Silently ignore if already defined in another context
    // eslint-disable-next-line no-console
    console.debug('[GhostFill] GhostLabel registration skipped:', e);
  }
}
