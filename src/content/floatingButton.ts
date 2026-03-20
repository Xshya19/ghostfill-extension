// ═══════════════════════════════════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🌌  G H O S T F I L L   3 . 0  —  F L O A T I N G   B U T T O N    ║
// ║  Spatial FAB · Context-Aware · Accessible · Framework-Smart           ║
// ║  World-class immersive micro-interaction system                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Architecture:
// ┌────────────────────────────────────────────────────────────────────────┐
// │  PageAnalyzer     — Deep page intelligence (type, provider, framework)│
// │  FieldContext     — Per-field mode detection & filtering              │
// │  SmartPositioner  — Collision-aware spatial placement engine          │
// │  ContextualMenu   — Dynamic action builder based on page context     │
// │  IconSystem       — SVG icon library with gradient support           │
// │  FloatingButton   — State machine, DOM, events, lifecycle (exported) │
// └────────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import { GenerateEmailResponse, GeneratePasswordResponse, GetLastOTPResponse } from '../types';
import { TIMING } from '../utils/constants';
import { debounce } from '../utils/debounce';
import { deepQuerySelectorAll } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { setHTML, clearHTML } from '../utils/setHTML';
import { AutoFiller } from './autoFiller';
import { pageStatus } from './pageStatus';
import { PageAnalyzer, PageType, PageAnalysis, safeQuerySelector } from './utils/pageAnalyzer';

const log = createLogger('FloatingButton');

// ═══════════════════════════════════════════════════════════════
//  §0  C O N S T A N T S
// ═══════════════════════════════════════════════════════════════

/** Timing constants (milliseconds) */
const TIMING_MS = {
  TOOLTIP_SHOW_DELAY: 600,
  SUCCESS_DISPLAY: 1500,
  ERROR_DISPLAY: 2000,
  LONG_PRESS: 500,
  AUTO_HIDE: (TIMING?.FLOATING_BUTTON_HIDE_MS as number | undefined) ?? 4000,
  FOCUS_DEBOUNCE: 100,
  RESIZE_DEBOUNCE: 100,
  FIELD_RESIZE_DEBOUNCE: 50,
  POSITION_DRIFT_THRESHOLD: 0.5,
  PAGE_TEXT_SCAN_LIMIT: 3000,
} as const;

/** Size presets in pixels */
const BUTTON_SIZE_PX: Readonly<Record<ButtonSize, number>> = {
  mini: 28,
  normal: 36,
  expanded: 48,
};

/** Viewport margin to prevent edge clipping */
const VIEWPORT_MARGIN = 8;

/** Minimum field dimensions to show button */
const MIN_FIELD_WIDTH = 30;
const MIN_FIELD_HEIGHT = 15;

/** Off-screen sentinel position */
const OFF_SCREEN = -9999;

/** Maximum label text length to scan from proximity */
const MAX_LABEL_SCAN_LENGTH = 60;

// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E   D E F I N I T I O N S
// ═══════════════════════════════════════════════════════════════

type ButtonState =
  | 'hidden'
  | 'idle'
  | 'hovering'
  | 'loading'
  | 'success'
  | 'error'
  | 'dragging'
  | 'menu-open';

type ButtonMode = 'magic' | 'email' | 'password' | 'otp' | 'user' | 'form';

type ButtonSize = 'mini' | 'normal' | 'expanded';

interface MenuAction {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly shortcut?: string;
  readonly visible: boolean;
  readonly handler: () => Promise<void>;
}

interface PositionConfig {
  readonly left: number;
  readonly top: number;
  readonly placement: 'inside-right' | 'outside-right' | 'outside-left' | 'below';
}

interface MenuPositionConfig {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
  readonly transformOrigin: string;
}

interface FloatingButtonRuntimeMessage {
  action?: string;
  settings?: {
    showFloatingButton?: boolean;
  };
}

interface IdentityResponse {
  success?: boolean;
  identity?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    username?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
//  §1.1  U T I L I T Y   H E L P E R S
// ═══════════════════════════════════════════════════════════════

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

function isFormInputElement(el: unknown): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

// ═══════════════════════════════════════════════════════════════
//  §2  P A G E   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  §3  F I E L D   C O N T E X T   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

class FieldContext {
  private static readonly EXCLUDED_TYPES = new Set([
    'hidden', 'submit', 'button', 'reset', 'checkbox',
    'radio', 'file', 'image', 'range', 'color',
  ]);

  private static readonly SEARCH_PATTERNS = /search|query|q$|filter|find/i;

  private static readonly TOOLTIPS: Readonly<Record<ButtonMode, string>> = {
    magic: 'GhostFill — Auto-fill this form',
    email: 'Fill email address',
    password: 'Fill password',
    otp: 'Paste verification code',
    user: 'Fill name',
    form: 'Auto-fill entire form',
  };

  // ── Mode classification patterns ────────────────────────
  private static readonly OTP_AUTOCOMPLETE = new Set(['one-time-code', 'one-time-password']);
  private static readonly OTP_COMBINED_PATTERN =
    /otp|one[-_\s]?time|verification[-_\s]?code|passcode|security[-_\s]?code|check[-_\s]?code|verify[-_\s]?code/i;
  private static readonly OTP_EXACT_NAMES = new Set([
    'code', 'pin', 'token', 'checkcode', 'verifycode',
  ]);
  private static readonly EMAIL_NAME_PATTERN = /e[-_]?mail/i;
  private static readonly PASSWORD_NAME_PATTERN = /password|passwd|pwd/i;
  private static readonly USERNAME_NAME_PATTERN = /user[-_]?name|login[-_]?name|login[-_]?id/i;
  private static readonly NAME_FIELD_PATTERN =
    /first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name/i;
  private static readonly CREDIT_CARD_PATTERN = /card[-_]?number|cvc|cvv|ccv|expiration|expiry/i;
  private static readonly CREDIT_CARD_AUTOCOMPLETE = new Set(['cc-number', 'cc-csc']);
  private static readonly ADDRESS_PATTERN = /street|address|city|country|state|zip|postal/i;

  static getMode(field: HTMLElement, pageType?: PageType): ButtonMode {
    if (!isFormInputElement(field)) {return 'magic';}

    const input = field as HTMLInputElement;
    const type = (input.type ?? '').toLowerCase();
    const name = (input.name ?? '').toLowerCase();
    const id = (input.id ?? '').toLowerCase();
    const placeholder = (input.placeholder ?? '').toLowerCase();
    const autocomplete = (input.autocomplete ?? '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
    const label = this.findLabelText(input).toLowerCase();
    const combined = `${type} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel} ${label}`;
    const nameId = name + id;

    const isVerificationPage =
      pageType === 'verification' || pageType === '2fa' || pageType === 'password-reset';

    // 1. OTP / Code (Highest Priority)
    if (this.OTP_AUTOCOMPLETE.has(autocomplete)) {return 'otp';}
    if (this.OTP_COMBINED_PATTERN.test(combined)) {return 'otp';}
    if (this.OTP_EXACT_NAMES.has(name) || this.OTP_EXACT_NAMES.has(id)) {return 'otp';}
    if (
      isVerificationPage &&
      (input.inputMode === 'numeric' || (input.maxLength >= 4 && input.maxLength <= 10))
    ) {
      return 'otp';
    }

    // 2. Email
    if (type === 'email') {return 'email';}
    if (isVerificationPage) {
      if (/@/.test(placeholder) || /enter[\s._-]*email/i.test(label)) {return 'email';}
    } else {
      if (this.EMAIL_NAME_PATTERN.test(nameId) || /email/i.test(label) || /@/.test(placeholder)) {
        return 'email';
      }
    }

    // 3. Password
    if (type === 'password' || this.PASSWORD_NAME_PATTERN.test(nameId)) {return 'password';}

    // 4. Username → email mode (unless verification page)
    if (!isVerificationPage) {
      if (this.USERNAME_NAME_PATTERN.test(nameId) || autocomplete === 'username') {return 'email';}
    }

    // 5. Credit Card Fields → generic magic
    if (this.CREDIT_CARD_PATTERN.test(combined) || this.CREDIT_CARD_AUTOCOMPLETE.has(autocomplete)) {
      return 'magic';
    }

    // 6. Search Fields → generic magic
    if (type === 'search' || this.SEARCH_PATTERNS.test(combined)) {return 'magic';}

    // 7. Name fields
    if (this.NAME_FIELD_PATTERN.test(nameId)) {return 'user';}
    if (/name/i.test(nameId) && !/user/i.test(nameId) && !/company/i.test(nameId)) {return 'user';}

    // 8. Address fields → generic magic
    if (this.ADDRESS_PATTERN.test(combined)) {return 'magic';}

    return 'magic';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getTooltip(mode: ButtonMode, _pageType: PageType): string {
    return this.TOOLTIPS[mode] ?? this.TOOLTIPS.magic;
  }

  static shouldShowButton(field: HTMLElement): boolean {
    if (!isFormInputElement(field)) {return false;}

    const input = field as HTMLInputElement;

    // Type exclusions
    if (this.EXCLUDED_TYPES.has(input.type)) {return false;}
    if (input.type === 'search') {return false;}

    // Name-based search exclusion
    const name = (input.name || input.id || input.placeholder || '').toLowerCase();
    if (this.SEARCH_PATTERNS.test(name)) {return false;}

    // Single-char split OTP fields — handled by GhostLabel, not FAB
    if (input.maxLength === 1) {return false;}

    // Disabled or readonly
    if (input.disabled || input.readOnly) {return false;}

    // Too small to be a real input
    const rect = field.getBoundingClientRect();
    if (rect.width < MIN_FIELD_WIDTH || rect.height < MIN_FIELD_HEIGHT) {return false;}

    // Hidden via CSS
    const style = window.getComputedStyle(field);
    if (style.display === 'none' || style.visibility === 'hidden') {return false;}

    return true;
  }

  static findLabelText(input: HTMLElement): string {
    // 1. Explicit label via `for` attribute
    if (input.id) {
      const label = safeQuerySelector<HTMLLabelElement>(
        document,
        `label[for="${escapeCSS(input.id)}"]`
      );
      if (label?.textContent) {return label.textContent.trim();}
    }

    // 2. Ancestor label
    const parentLabel = input.closest('label');
    if (parentLabel?.textContent) {return parentLabel.textContent.trim();}

    // 3. aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) {return ariaLabel.trim();}

    // 4. aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) {return labelEl.textContent.trim();}
    }

    // 5. Proximity: previous sibling or parent's previous sibling
    try {
      const prev = input.previousElementSibling;
      if (prev?.textContent && prev.textContent.length < MAX_LABEL_SCAN_LENGTH) {
        return prev.textContent.trim();
      }

      const parent = input.parentElement;
      if (parent) {
        const pPrev = parent.previousElementSibling;
        if (pPrev?.textContent && pPrev.textContent.length < MAX_LABEL_SCAN_LENGTH) {
          return pPrev.textContent.trim();
        }
      }
    } catch {
      /* ignore */
    }

    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  §4  S M A R T   P O S I T I O N E R
// ═══════════════════════════════════════════════════════════════

class SmartPositioner {
  static calculate(field: HTMLElement, buttonSize: number): PositionConfig {
    const rect = field.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = VIEWPORT_MARGIN;

    // Off-screen: field scrolled out of view
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      return { left: OFF_SCREEN, top: OFF_SCREEN, placement: 'inside-right' };
    }

    // Compute right-side inset, accounting for existing internal icons
    const style = window.getComputedStyle(field);
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const dynamicPadding = paddingRight > 24 ? paddingRight + 4 : 8;

    // Base: vertically centered, inside right edge
    let left = rect.right - buttonSize - dynamicPadding;
    let top = rect.top + (rect.height - buttonSize) / 2;
    let placement: PositionConfig['placement'] = 'inside-right';

    // Collision: field too narrow
    if (rect.width < buttonSize + 32) {
      left = rect.right + m;
      placement = 'outside-right';

      // Off right edge → try outside left
      if (left + buttonSize > vw - m) {
        left = rect.left - buttonSize - m;
        placement = 'outside-left';
      }

      // Off left edge → below the field
      if (left < m) {
        left = rect.left;
        top = rect.bottom + m;
        placement = 'below';
      }
    }

    // Global viewport clamping
    left = Math.max(m, Math.min(left, vw - buttonSize - m));
    top = Math.max(m, Math.min(top, vh - buttonSize - m));

    return { left, top, placement };
  }

  static calculateMenuPosition(
    buttonRect: DOMRect,
    menuWidth: number,
    menuHeight: number
  ): MenuPositionConfig {
    const vh = window.innerHeight;
    const m = VIEWPORT_MARGIN;

    let top = `${buttonRect.height + 8}px`;
    let right = '0';
    let bottom = 'auto';
    let left = 'auto';
    let transformOrigin = 'top right';

    // Not enough space below → open above
    if (buttonRect.bottom + menuHeight + m > vh) {
      top = 'auto';
      bottom = `${buttonRect.height + 8}px`;
      transformOrigin = 'bottom right';
    }

    // Not enough space to the left → open towards right
    if (buttonRect.right - menuWidth < m) {
      right = 'auto';
      left = '0';
      transformOrigin = top !== 'auto' ? 'top left' : 'bottom left';
    }

    return { top, right, bottom, left, transformOrigin };
  }
}

// ═══════════════════════════════════════════════════════════════
//  §5  C O N T E X T U A L   M E N U   B U I L D E R
// ═══════════════════════════════════════════════════════════════

class ContextualMenu {
  static buildActions(
    analysis: PageAnalysis,
    currentMode: ButtonMode,
    hasOTPReady: boolean
  ): MenuAction[] {
    const noop = async (): Promise<void> => {};

    const isIdentityCtx =
      currentMode === 'user' || analysis.hasNameFields || analysis.pageType === 'signup';

    const showOTP =
      analysis.pageType === 'verification' ||
      analysis.pageType === '2fa' ||
      analysis.hasOTPField ||
      hasOTPReady;

    const showEmail =
      analysis.hasEmailField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'login';

    const showPassword =
      analysis.hasPasswordField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'password-reset';

    // Extract and sanitize context name from page title
    const siteTitleMatch = document.title.match(/^([^-|]+)/);
    const rawName = siteTitleMatch ? siteTitleMatch[1].trim() : 'Account';
    const contextName = escapeHTML(rawName);

    const actions: MenuAction[] = [
      {
        id: 'smart-fill',
        icon: '✨',
        label: `✨ Auto-fill ${contextName}`,
        shortcut: '⌘⇧G',
        visible: true,
        handler: noop,
      },
      {
        id: 'paste-otp',
        icon: '🔑',
        label: hasOTPReady ? 'Paste Found Code' : 'Paste Code',
        visible: showOTP,
        handler: noop,
      },
      {
        id: 'generate-email',
        icon: '📧',
        label: 'Use Hidden Email',
        visible: showEmail,
        handler: noop,
      },
      {
        id: 'generate-password',
        icon: '🔐',
        label: 'Generate Secure Password',
        visible: showPassword,
        handler: noop,
      },
      {
        id: 'fill-firstname',
        icon: '👤',
        label: 'Inject First Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-lastname',
        icon: '👥',
        label: 'Inject Last Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-fullname',
        icon: '📝',
        label: 'Inject Full Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-username',
        icon: '🎭',
        label: 'Inject Username',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'clear-fields',
        icon: '🧹',
        label: 'Clear All Fields',
        visible: true,
        handler: noop,
      },
      { id: 'divider', icon: '', label: '', visible: true, handler: noop },
      {
        id: 'settings',
        icon: '⚙️',
        label: 'GhostFill Settings',
        visible: true,
        handler: noop,
      },
    ];

    return actions.filter((a) => a.visible);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §6  I C O N   S Y S T E M
// ═══════════════════════════════════════════════════════════════

class IconSystem {
  static get(mode: ButtonMode): string {
    return this.ICONS[mode] ?? this.ICONS.magic;
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

  private static readonly ICONS: Readonly<Record<ButtonMode, string>> = {
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
}

// ═══════════════════════════════════════════════════════════════
//  §7  M A I N   F L O A T I N G   B U T T O N   C L A S S
// ═══════════════════════════════════════════════════════════════

export class FloatingButton {
  // ── DOM ──────────────────────────────────────────────────
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private button: HTMLButtonElement | null = null;
  private menu: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;

  // ── State ────────────────────────────────────────────────
  private state: ButtonState = 'hidden';
  private mode: ButtonMode = 'magic';
  private readonly size: ButtonSize = 'normal';
  private currentField: HTMLElement | null = null;
  private currentFieldRef: WeakRef<HTMLElement> | null = null;
  private currentFieldRect: DOMRect | null = null;
  private isEnabled = true;
  private hasOTPReady = false;
  private pageAnalysis: PageAnalysis | null = null;
  private destroyed = false;

  // ── Timers ───────────────────────────────────────────────
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateResetTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Scroll & Resize ──────────────────────────────────────
  private scrollRafId: number | null = null;
  private trackingRafId: number | null = null;
  private isScrolling = false;
  private fieldResizeObserver: ResizeObserver | null = null;

  // ── Event cleanup ────────────────────────────────────────
  private readonly cleanupFns: Array<() => void> = [];
  private messageListener: ((msg: FloatingButtonRuntimeMessage) => void) | null = null;
  private listenerRegistered = false;

  // ── Dependencies ─────────────────────────────────────────
  private readonly autoFiller: AutoFiller;

  // ── Keyboard ─────────────────────────────────────────────
  private static readonly SHORTCUT_KEY = 'g';

  constructor(autoFiller: AutoFiller) {
    this.autoFiller = autoFiller;
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.1  L I F E C Y C L E
  // ═══════════════════════════════════════════════════════════

  async init(): Promise<void> {
    if (this.destroyed) {return;}

    this.createContainer();
    this.setupEventListeners();
    this.setupKeyboardShortcut();
    log.debug('FloatingButton initialised');
    void this.loadSettingsAsync();
    void this.checkOTPAvailability();
  }

  destroy(): void {
    if (this.destroyed) {return;}
    this.destroyed = true;

    this.cancelAllTimers();
    this.cancelAllAnimationFrames();

    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
      this.fieldResizeObserver = null;
    }

    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.cleanupFns.length = 0;

    if (this.messageListener && chrome?.runtime?.onMessage) {
      try {
        chrome.runtime.onMessage.removeListener(this.messageListener);
      } catch {
        /* extension context invalidated */
      }
      this.listenerRegistered = false;
      this.messageListener = null;
    }

    this.container?.remove();
    this.container = null;
    this.shadowRoot = null;
    this.button = null;
    this.menu = null;
    this.tooltip = null;
    this.currentField = null;
    this.currentFieldRef = null;
    this.currentFieldRect = null;
    this.pageAnalysis = null;
    this.state = 'hidden';
  }

  private cancelAllAnimationFrames(): void {
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
      this.scrollRafId = null;
    }
    if (this.trackingRafId !== null) {
      cancelAnimationFrame(this.trackingRafId);
      this.trackingRafId = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.2  S E T T I N G S   &   O T P
  // ═══════════════════════════════════════════════════════════

  private async loadSettingsAsync(): Promise<void> {
    try {
      const resp = (await safeSendMessage({ action: 'GET_SETTINGS' })) as {
        settings?: { showFloatingButton: boolean };
      } | null;
      if (resp?.settings) {
        this.isEnabled = resp.settings.showFloatingButton;
        if (!this.isEnabled) {this.setState('hidden');}
      }
    } catch {
      log.debug('Settings fetch failed — defaulting to enabled');
    }

    this.registerRuntimeListener();
  }

  private registerRuntimeListener(): void {
    if (this.listenerRegistered || this.destroyed) {return;}
    if (!chrome?.runtime?.onMessage) {return;}

    this.messageListener = (msg: FloatingButtonRuntimeMessage) => {
      if (this.destroyed) {return;}

      if (msg.action === 'SETTINGS_CHANGED' && msg.settings) {
        this.isEnabled = msg.settings.showFloatingButton ?? this.isEnabled;
        if (!this.isEnabled) {this.setState('hidden');}
      }
      if (msg.action === 'OTP_RECEIVED') {
        this.hasOTPReady = true;
        this.updateBadge();
      }
    };

    try {
      chrome.runtime.onMessage.addListener(this.messageListener);
      this.listenerRegistered = true;
    } catch {
      /* extension context invalidated */
    }
  }

  private async checkOTPAvailability(): Promise<void> {
    if (this.destroyed) {return;}
    try {
      const resp = (await safeSendMessage({ action: 'GET_LAST_OTP' })) as GetLastOTPResponse | null;
      if (resp?.lastOTP?.code) {
        this.hasOTPReady = true;
        this.updateBadge();
      }
    } catch {
      /* ignore */
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.3  S T A T E   M A C H I N E
  // ═══════════════════════════════════════════════════════════

  private setState(newState: ButtonState, message?: string): void {
    if (this.destroyed && newState !== 'hidden') {return;}
    if (this.state === newState) {return;}

    const old = this.state;
    this.state = newState;
    log.debug(`State: ${old} → ${newState}`);

    switch (newState) {
      case 'hidden':
        this.applyHidden();
        break;
      case 'idle':
        this.applyIdle();
        break;
      case 'hovering':
        this.applyHovering();
        break;
      case 'loading':
        this.applyLoading();
        break;
      case 'success':
        this.applySuccess(message);
        break;
      case 'error':
        this.applyError(message);
        break;
      case 'menu-open':
        this.applyMenuOpen();
        break;
      case 'dragging':
        // Reserved for future drag-to-reposition
        break;
    }
  }

  private applyHidden(): void {
    if (this.container) {
      this.container.style.setProperty('display', 'none', 'important');
    }
    this.closeMenuSilent();

    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
      this.fieldResizeObserver = null;
    }

    // Stop continuous tracking
    if (this.trackingRafId !== null) {
      cancelAnimationFrame(this.trackingRafId);
      this.trackingRafId = null;
    }

    this.currentField = null;
    this.currentFieldRef = null;
    this.currentFieldRect = null;
  }

  private applyIdle(): void {
    if (!this.container || !this.button) {return;}
    this.container.style.setProperty('display', 'block', 'important');
    setHTML(this.button, IconSystem.get(this.mode));
    this.button.classList.remove('gf-loading', 'gf-success', 'gf-error');
    this.button.setAttribute('aria-label', FieldContext.getTooltip(this.mode, this.getPageType()));
    this.updateBadge();
    this.scheduleAutoHide();
  }

  private applyHovering(): void {
    this.cancelAllTimers();
    this.showTooltip();
  }

  private applyLoading(): void {
    if (!this.button) {return;}
    this.cancelAllTimers();
    this.button.classList.add('gf-loading');
    setHTML(this.button, IconSystem.getSpinner());
    this.hideTooltip();
  }

  private applySuccess(message?: string): void {
    if (!this.button) {return;}
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-success');
    setHTML(this.button, IconSystem.getSuccess());

    if (message && this.tooltip) {
      this.showStatusTooltip(message, 'var(--success)');
    } else {
      this.hideTooltip();
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      this.setState('hidden');
    }, TIMING_MS.SUCCESS_DISPLAY);
  }

  private applyError(message?: string): void {
    if (!this.button) {return;}
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-error');
    setHTML(this.button, IconSystem.getError());

    if (this.tooltip) {
      this.showStatusTooltip(message ?? 'Action failed', 'var(--error)');
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      this.setState('idle');
    }, TIMING_MS.ERROR_DISPLAY);
  }

  private applyMenuOpen(): void {
    this.cancelAllTimers();
    this.openMenuInternal();
    this.hideTooltip();
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.4  D O M   C R E A T I O N
  // ═══════════════════════════════════════════════════════════

  private createContainer(): void {
    // Remove any stale instance
    document.getElementById('ghostfill-fab')?.remove();

    this.container = document.createElement('div');
    this.container.id = 'ghostfill-fab';
    this.container.style.cssText =
      'position:fixed;z-index:2147483647;display:none;pointer-events:auto;';

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    // ── Button ────────────────────────────────────────────
    this.button = document.createElement('button');
    this.button.className = 'gf-fab';
    setHTML(this.button, IconSystem.get('magic'));
    this.button.setAttribute('aria-label', 'GhostFill — Auto-fill this form');
    this.button.setAttribute('role', 'button');
    this.button.setAttribute('tabindex', '0');
    this.shadowRoot.appendChild(this.button);

    // ── Tooltip ───────────────────────────────────────────
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'gf-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.setAttribute('id', 'gf-tooltip');
    this.shadowRoot.appendChild(this.tooltip);

    // ── Menu ──────────────────────────────────────────────
    this.menu = document.createElement('div');
    this.menu.className = 'gf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'GhostFill actions');
    this.shadowRoot.appendChild(this.menu);

    // Link button to tooltip for screen readers
    this.button.setAttribute('aria-describedby', 'gf-tooltip');

    // Attach to <html> to bypass aggressive site body rules
    const attachTarget = document.documentElement ?? document.body;
    if (attachTarget) {
      attachTarget.appendChild(this.container);
    }

    this.wireButtonEvents();
  }

  private wireButtonEvents(): void {
    if (!this.button) {return;}

    // ── Click ─────────────────────────────────────────────
    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === 'loading') {return;}
      if (this.state === 'menu-open') {
        this.setState('idle');
        return;
      }
      void this.handlePrimaryAction();
    });

    // ── Context Menu → open action menu ───────────────────
    this.button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setState('menu-open');
    });

    // ── Touch Long-Press ──────────────────────────────────
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLongPress = (): void => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    this.button.addEventListener(
      'touchstart',
      (e) => {
        clearLongPress();
        longPressTimer = setTimeout(() => {
          e.preventDefault();
          this.setState('menu-open');
          longPressTimer = null;
        }, TIMING_MS.LONG_PRESS);
      },
      { passive: false }
    );
    this.button.addEventListener('touchend', clearLongPress);
    this.button.addEventListener('touchmove', clearLongPress);
    this.button.addEventListener('touchcancel', clearLongPress);

    // ── Hover ─────────────────────────────────────────────
    this.button.addEventListener('mouseenter', () => {
      if (this.state === 'idle') {this.setState('hovering');}
    });
    this.button.addEventListener('mouseleave', () => {
      if (this.state === 'hovering') {this.setState('idle');}
    });

    // ── Keyboard Navigation ───────────────────────────────
    this.button.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          void this.handlePrimaryAction();
          break;
        case 'Escape':
          this.setState('hidden');
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.setState('menu-open');
          break;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.5  P R I M A R Y   A C T I O N
  // ═══════════════════════════════════════════════════════════

  private async handlePrimaryAction(): Promise<void> {
    if (this.destroyed) {return;}

    this.setState('loading');
    pageStatus.show('Analysing form…', 'loading');

    try {
      const result = await this.autoFiller.smartFill();

      if (this.destroyed) {return;}

      if (result.success && result.filledCount > 0) {
        const msg = `Filled ${result.filledCount} field(s)!`;
        pageStatus.success(msg, TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', msg);
      } else {
        pageStatus.hide();
        this.setState('idle');
        log.debug('No fields filled — silent dismiss');
      }
    } catch (error) {
      if (this.destroyed) {return;}
      log.error('Smart fill error:', error);
      const msg = error instanceof Error ? error.message : String(error) || 'Failed to fill';
      pageStatus.error(msg, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', msg);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.6  M E N U
  // ═══════════════════════════════════════════════════════════

  private openMenuInternal(): void {
    if (!this.menu || !this.shadowRoot || this.destroyed) {return;}

    const analysis = this.getPageAnalysis();
    const actions = ContextualMenu.buildActions(analysis, this.mode, this.hasOTPReady);

    setHTML(
      this.menu,
      actions
        .map((a) => {
          if (a.id === 'divider') {
            return '<div class="gf-menu-divider" role="separator"></div>';
          }
          // a.icon is emoji (safe), a.label may contain escaped HTML from contextName
          return `<button class="gf-menu-item" data-action="${escapeHTML(a.id)}" role="menuitem" tabindex="-1">
            <span class="gf-menu-icon" aria-hidden="true">${a.icon}</span>
            <span class="gf-menu-label">${a.label}</span>
            ${a.shortcut ? `<span class="gf-menu-shortcut">${escapeHTML(a.shortcut)}</span>` : ''}
          </button>`;
        })
        .join('')
    );

    // Wire click handlers
    this.menu.querySelectorAll<HTMLButtonElement>('.gf-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const actionId = (e.currentTarget as HTMLElement).dataset.action ?? '';
        void this.handleMenuAction(actionId);
      });
    });

    // Position
    if (this.button) {
      const rect = this.button.getBoundingClientRect();
      const pos = SmartPositioner.calculateMenuPosition(rect, 240, 320);
      this.menu.style.top = pos.top;
      this.menu.style.right = pos.right;
      this.menu.style.bottom = pos.bottom;
      this.menu.style.left = pos.left;
      this.menu.style.transformOrigin = pos.transformOrigin;
    }

    this.menu.classList.add('gf-menu-open');

    // Focus first item
    const firstItem = this.menu.querySelector<HTMLButtonElement>('.gf-menu-item');
    if (firstItem) {
      requestAnimationFrame(() => firstItem.focus());
    }

    // Keyboard navigation within menu
    this.setupMenuKeyboardNavigation();
  }

  private setupMenuKeyboardNavigation(): void {
    if (!this.menu) {return;}

    const handler = (e: KeyboardEvent): void => {
      if (!this.menu) {return;}
      const items = Array.from(this.menu.querySelectorAll<HTMLButtonElement>('.gf-menu-item'));
      const focusedEl = this.shadowRoot?.activeElement;
      const idx = items.indexOf(focusedEl as HTMLButtonElement);

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          items[idx < items.length - 1 ? idx + 1 : 0]?.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          items[idx > 0 ? idx - 1 : items.length - 1]?.focus();
          break;
        case 'Escape':
          e.preventDefault();
          this.setState('idle');
          this.button?.focus();
          break;
        case 'Home':
          e.preventDefault();
          items[0]?.focus();
          break;
        case 'End':
          e.preventDefault();
          items[items.length - 1]?.focus();
          break;
        case 'Tab':
          e.preventDefault();
          this.setState('idle');
          break;
      }
    };

    this.menu.addEventListener('keydown', handler);
  }

  private closeMenuSilent(): void {
    if (this.menu) {
      this.menu.classList.remove('gf-menu-open');
      clearHTML(this.menu);
    }
  }

  private async handleMenuAction(actionId: string): Promise<void> {
    if (this.destroyed) {return;}
    this.setState('loading');

    try {
      switch (actionId) {
        case 'smart-fill':
          await this.handlePrimaryAction();
          return; // handlePrimaryAction manages its own state

        case 'paste-otp':
          await this.actionPasteOTP();
          break;

        case 'generate-email':
          await this.actionGenerateEmail();
          break;

        case 'generate-password':
          await this.actionGeneratePassword();
          break;

        case 'fill-firstname':
        case 'fill-lastname':
        case 'fill-fullname':
        case 'fill-username':
          await this.actionFillIdentity(actionId);
          break;

        case 'clear-fields':
          await this.autoFiller.clearForm();
          pageStatus.success('Fields cleared', 1000);
          this.setState('idle');
          break;

        case 'settings':
          safeSendMessage({ action: 'OPEN_OPTIONS' }).catch((error) => {
            log.warn('Failed to open options', error);
          });
          this.setState('hidden');
          break;

        default:
          this.setState('idle');
      }
    } catch (error) {
      if (this.destroyed) {return;}
      const errorMessage = error instanceof Error ? error.message : String(error);
      const msg = `Action failed: ${errorMessage}`;
      pageStatus.error(msg, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', msg);
      log.error('Menu action failed', error);
    }
  }

  // ── Individual Action Handlers ──────────────────────────

  private async actionPasteOTP(): Promise<void> {
    const resp = (await safeSendMessage({ action: 'GET_LAST_OTP' })) as GetLastOTPResponse | null;

    if (resp?.lastOTP?.code) {
      const filled = await this.autoFiller.fillOTP(resp.lastOTP.code);
      if (this.destroyed) {return;}

      if (filled) {
        pageStatus.success('Code filled!', TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', 'Code filled!');
        safeSendMessage({ action: 'MARK_OTP_USED' }).catch((err) => {
          log.warn('Failed to mark OTP as used', err);
        });
      } else {
        pageStatus.error('No OTP field found', TIMING_MS.ERROR_DISPLAY);
        this.setState('error', 'No OTP field found');
      }
    } else {
      pageStatus.error('No OTP available', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'No OTP available');
    }
  }

  private async actionGenerateEmail(): Promise<void> {
    const resp = (await safeSendMessage({ action: 'GENERATE_EMAIL' })) as GenerateEmailResponse | null;

    if (this.destroyed) {return;}

    if (resp?.success && resp.email?.fullEmail && this.currentField) {
      await this.autoFiller.fillField(
        this.buildFieldSelector(this.currentField),
        resp.email.fullEmail
      );
      pageStatus.success('Email filled!', TIMING_MS.SUCCESS_DISPLAY);
      this.setState('success', 'Email filled!');
    } else {
      const msg = (resp && 'error' in resp && typeof resp.error === 'string')
        ? resp.error
        : 'Failed to generate email';
      pageStatus.error(msg, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', msg);
    }
  }

  private async actionGeneratePassword(): Promise<void> {
    const resp = (await safeSendMessage({
      action: 'GENERATE_PASSWORD',
    })) as GeneratePasswordResponse | null;

    if (this.destroyed) {return;}

    if (resp?.result?.password && this.currentField) {
      await this.autoFiller.fillField(
        this.buildFieldSelector(this.currentField),
        resp.result.password
      );
      pageStatus.success('Password filled!', TIMING_MS.SUCCESS_DISPLAY);
      this.setState('success', 'Password filled!');
    } else {
      pageStatus.error('Failed to generate password', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'Failed to generate password');
    }
  }

  private static readonly IDENTITY_FIELD_MAP: Readonly<
    Record<string, { key: string; label: string }>
  > = {
    'fill-firstname': { key: 'firstName', label: 'First Name' },
    'fill-lastname': { key: 'lastName', label: 'Last Name' },
    'fill-fullname': { key: 'fullName', label: 'Full Name' },
    'fill-username': { key: 'username', label: 'Username' },
  };

  private async actionFillIdentity(actionId: string): Promise<void> {
    const resp = (await safeSendMessage({ action: 'GET_IDENTITY' })) as IdentityResponse | null;

    if (this.destroyed) {return;}

    if (!resp?.success || !resp.identity || !this.currentField) {
      pageStatus.error('Failed to get identity', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'Failed to get identity');
      return;
    }

    const mapping = FloatingButton.IDENTITY_FIELD_MAP[actionId];
    if (!mapping) {
      this.setState('idle');
      return;
    }

    const value = (resp.identity as Record<string, string | undefined>)[mapping.key];

    if (value) {
      await this.autoFiller.fillField(this.buildFieldSelector(this.currentField), value);
      pageStatus.success(`${mapping.label} filled!`, TIMING_MS.SUCCESS_DISPLAY);
      this.setState('success', `${mapping.label} filled!`);
    } else {
      pageStatus.error(`No ${mapping.label} available`, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', `No ${mapping.label} available`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.7  T O O L T I P
  // ═══════════════════════════════════════════════════════════

  private showTooltip(): void {
    if (!this.tooltip) {return;}
    this.tooltip.textContent = FieldContext.getTooltip(this.mode, this.getPageType());
    this.tooltipTimeout = setTimeout(() => {
      if (!this.destroyed) {
        this.tooltip?.classList.add('gf-tooltip-visible');
      }
    }, TIMING_MS.TOOLTIP_SHOW_DELAY);
  }

  private hideTooltip(): void {
    if (this.tooltipTimeout !== null) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    this.tooltip?.classList.remove('gf-tooltip-visible');
  }

  private showStatusTooltip(text: string, bgColor: string): void {
    if (!this.tooltip) {return;}
    this.tooltip.textContent = text;
    this.tooltip.style.backgroundColor = bgColor;
    this.tooltip.style.color = 'white';
    this.tooltip.classList.add('gf-tooltip-visible');
  }

  private clearStatusTooltip(): void {
    if (!this.tooltip) {return;}
    this.tooltip.classList.remove('gf-tooltip-visible');
    this.tooltip.style.backgroundColor = '';
    this.tooltip.style.color = '';
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.8  B A D G E
  // ═══════════════════════════════════════════════════════════

  private updateBadge(): void {
    if (!this.button || !this.shadowRoot) {return;}

    // Remove existing badge
    const existing = this.button.querySelector('.gf-badge');
    if (existing) {existing.remove();}

    if (this.hasOTPReady) {
      const badge = document.createElement('span');
      badge.className = 'gf-badge';
      badge.textContent = '!';
      badge.setAttribute('aria-label', 'OTP code ready');
      this.button.appendChild(badge);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.9  E V E N T   L I S T E N E R S
  // ═══════════════════════════════════════════════════════════

  private setupEventListeners(): void {
    // ── Focus Tracking ────────────────────────────────────
    const handleFocus = debounce((target: unknown) => {
      if (this.destroyed || !this.isEnabled) {return;}
      if (!target || !(target instanceof HTMLElement)) {return;}

      // Invalidate page analysis cache on focus to detect SPA changes
      this.pageAnalysis = null;

      if (isFormInputElement(target) && FieldContext.shouldShowButton(target)) {
        this.showNearField(target);
      }
    }, TIMING_MS.FOCUS_DEBOUNCE);

    const onFocusIn = (e: FocusEvent): void => {
      const path = e.composedPath?.();
      const target = (path?.[0] ?? e.target) as EventTarget | null;
      handleFocus(target);
    };
    document.addEventListener('focusin', onFocusIn, true);
    this.cleanupFns.push(() => document.removeEventListener('focusin', onFocusIn, true));

    // ── Focus Out ─────────────────────────────────────────
    const onFocusOut = (e: FocusEvent): void => {
      if (this.destroyed) {return;}
      const related = e.relatedTarget as HTMLElement | null;

      // Don't hide if focus moved to our container or we have menu open
      if (this.container?.contains(related)) {return;}
      if (this.state === 'menu-open') {return;}

      this.scheduleAutoHide();
    };
    document.addEventListener('focusout', onFocusOut, true);
    this.cleanupFns.push(() => document.removeEventListener('focusout', onFocusOut, true));

    // ── Click Outside → Close Menu ────────────────────────
    const onDocClick = (e: MouseEvent): void => {
      if (this.state !== 'menu-open') {return;}
      const path = e.composedPath?.() ?? [];
      if (path.some((el) => el === this.container)) {return;}
      this.setState('idle');
    };
    document.addEventListener('click', onDocClick, true);
    this.cleanupFns.push(() => document.removeEventListener('click', onDocClick, true));

    // ── Scroll Following ──────────────────────────────────
    const onScroll = (): void => {
      if (this.destroyed || this.state === 'hidden' || !this.currentField) {return;}
      if (!this.isScrolling) {
        this.isScrolling = true;
        this.followFieldOnScroll();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    this.cleanupFns.push(() => window.removeEventListener('scroll', onScroll, true));

    // ── Resize ────────────────────────────────────────────
    const onResize = debounce(() => {
      if (this.destroyed) {return;}
      const field = this.currentFieldRef?.deref();
      if (this.state !== 'hidden' && field) {
        this.positionNearField(field);
      }
    }, TIMING_MS.RESIZE_DEBOUNCE);
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.10  K E Y B O A R D   S H O R T C U T
  // ═══════════════════════════════════════════════════════════

  private setupKeyboardShortcut(): void {
    const onKeydown = (e: KeyboardEvent): void => {
      if (this.destroyed) {return;}
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === FloatingButton.SHORTCUT_KEY
      ) {
        e.preventDefault();
        e.stopPropagation();
        log.info('⌨️ Keyboard shortcut triggered');
        void this.handlePrimaryAction();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeydown, true));
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.12  P O S I T I O N I N G
  // ═══════════════════════════════════════════════════════════

  showNearField(field: HTMLElement): void {
    if (!this.isEnabled || this.destroyed) {return;}

    // Re-attach container if SPA removed it
    if (this.container && !this.container.isConnected) {
      const target = document.documentElement ?? document.body;
      if (target) {target.appendChild(this.container);}
    }

    // Check if page has auth-relevant content
    const analysis = this.getPageAnalysis();
    if (
      !analysis.isAuthRelated &&
      !analysis.hasOTPField &&
      !analysis.hasEmailField &&
      !analysis.hasPasswordField &&
      analysis.inputCount < 1
    ) {
      return;
    }

    this.currentField = field;
    this.currentFieldRef = new WeakRef(field);
    this.currentFieldRect = null;
    this.mode = FieldContext.getMode(field, analysis.pageType);

    // Observe field resize
    if (this.fieldResizeObserver) {this.fieldResizeObserver.disconnect();}
    this.fieldResizeObserver = new ResizeObserver(
      debounce(() => {
        if (!this.destroyed && this.state !== 'hidden') {
          const f = this.currentFieldRef?.deref();
          if (f) {this.positionNearField(f);}
        }
      }, TIMING_MS.FIELD_RESIZE_DEBOUNCE)
    );
    this.fieldResizeObserver.observe(field);

    this.positionNearField(field);
    this.setState('idle');
    this.startContinuousTracking();
  }

  /**
   * Continuous rAF tracking loop: detects field position drift
   * from SPA transitions, animations, or layout shifts.
   */
  private startContinuousTracking(): void {
    if (this.trackingRafId !== null) {
      cancelAnimationFrame(this.trackingRafId);
      this.trackingRafId = null;
    }

    const track = (): void => {
      if (this.destroyed || this.state === 'hidden') {
        this.trackingRafId = null;
        return;
      }

      const field = this.currentFieldRef?.deref();
      if (!field || !field.isConnected) {
        this.setState('hidden');
        this.trackingRafId = null;
        return;
      }

      const rect = field.getBoundingClientRect();
      const last = this.currentFieldRect;
      const threshold = TIMING_MS.POSITION_DRIFT_THRESHOLD;

      if (
        !last ||
        Math.abs(last.x - rect.x) > threshold ||
        Math.abs(last.y - rect.y) > threshold ||
        Math.abs(last.width - rect.width) > threshold ||
        Math.abs(last.height - rect.height) > threshold
      ) {
        this.currentFieldRect = rect;
        this.positionNearField(field);
      }

      this.trackingRafId = requestAnimationFrame(track);
    };

    this.trackingRafId = requestAnimationFrame(track);
  }

  private positionNearField(field: HTMLElement): void {
    if (!this.container || this.destroyed) {return;}

    const btnSize = BUTTON_SIZE_PX[this.size];
    const pos = SmartPositioner.calculate(field, btnSize);

    if (pos.left === OFF_SCREEN) {
      this.setState('hidden');
      return;
    }

    this.container.style.setProperty('left', `${pos.left}px`, 'important');
    this.container.style.setProperty('top', `${pos.top}px`, 'important');
    this.container.style.setProperty('transform', 'none', 'important');
  }

  private followFieldOnScroll(): void {
    if (this.scrollRafId !== null) {cancelAnimationFrame(this.scrollRafId);}

    this.scrollRafId = requestAnimationFrame(() => {
      this.isScrolling = false;
      this.scrollRafId = null;
      // Primary tracking is via startContinuousTracking, this is a safety net
      const field = this.currentFieldRef?.deref();
      if (!this.destroyed && field && this.state !== 'hidden') {
        this.positionNearField(field);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.13  T I M E R S
  // ═══════════════════════════════════════════════════════════

  private scheduleAutoHide(): void {
    if (this.state === 'menu-open' || this.state === 'loading') {return;}
    this.cancelHideTimer();
    this.hideTimeout = setTimeout(() => {
      if (!this.destroyed && this.state !== 'menu-open' && this.state !== 'loading') {
        this.setState('hidden');
      }
    }, TIMING_MS.AUTO_HIDE);
  }

  private cancelHideTimer(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private cancelAllTimers(): void {
    this.cancelHideTimer();
    if (this.tooltipTimeout !== null) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    if (this.stateResetTimeout !== null) {
      clearTimeout(this.stateResetTimeout);
      this.stateResetTimeout = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.14  H E L P E R S
  // ═══════════════════════════════════════════════════════════

  private getPageAnalysis(): PageAnalysis {
    if (!this.pageAnalysis) {
      this.pageAnalysis = PageAnalyzer.analyze();
      log.debug('Page analysed:', {
        type: this.pageAnalysis.pageType,
        provider: this.pageAnalysis.provider,
        framework: this.pageAnalysis.framework,
        inputs: this.pageAnalysis.inputCount,
      });
    }
    return this.pageAnalysis;
  }

  private getPageType(): PageType {
    return this.getPageAnalysis().pageType;
  }

  private buildFieldSelector(field: HTMLElement): string {
    const input = field as HTMLInputElement;
    if (input.id) {return `#${escapeCSS(input.id)}`;}
    if (input.name) {return `input[name="${escapeCSS(input.name)}"]`;}
    if (input.type && input.type !== 'text') {return `input[type="${escapeCSS(input.type)}"]`;}
    return 'input';
  }

  // ── Public API ──────────────────────────────────────────

  show(): void {
    if (!this.destroyed && this.state === 'hidden') {this.setState('idle');}
  }

  hide(): void {
    this.setState('hidden');
  }

  isVisible(): boolean {
    return this.state !== 'hidden';
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.15  S H A D O W - D O M   S T Y L E S
  // ═══════════════════════════════════════════════════════════

  private getStyles(): string {
    return `
/* ══════════════════════════════════════════════════════════════
   GhostFill 3.0 — Spatial FAB Shadow DOM Styles
   3D depth · Glass materials · Staggered menu · Dark mode
   ══════════════════════════════════════════════════════════════ */

:host {
  all: initial;
  font-family: "Inter", -apple-system, BlinkMacSystemFont,
    "SF Pro Display", "Segoe UI", Roboto, sans-serif;

  --brand: #7c5cfc;
  --brand-light: #a78bfa;
  --brand-rgb: 124, 92, 252;
  --brand-glow: rgba(124, 92, 252, 0.25);

  --success: #22c55e;
  --success-rgb: 34, 197, 94;
  --success-glow: rgba(34, 197, 94, 0.25);
  --error: #ef4444;
  --error-rgb: 239, 68, 68;
  --error-glow: rgba(239, 68, 68, 0.25);

  --glass-bg: linear-gradient(135deg,
    rgba(255,255,255,0.88) 0%, rgba(248,250,252,0.82) 100%);
  --glass-bg-hover: linear-gradient(135deg,
    rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.90) 100%);
  --glass-border: rgba(255,255,255,0.55);
  --glass-border-hover: rgba(var(--brand-rgb), 0.2);

  --text: #0f172a;
  --text-secondary: #64748b;
  --text-tertiary: #94a3b8;

  --shadow-rest:
    0 1px 2px rgba(0,0,0,0.03), 0 2px 4px rgba(0,0,0,0.03),
    0 4px 8px rgba(0,0,0,0.04), 0 8px 16px rgba(0,0,0,0.04);
  --shadow-hover:
    0 2px 4px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.04),
    0 8px 16px rgba(0,0,0,0.05), 0 16px 32px rgba(0,0,0,0.06),
    0 0 0 1px rgba(var(--brand-rgb),0.06), 0 0 30px var(--brand-glow);
  --shadow-active:
    0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-immersive:
    0 8px 16px rgba(0,0,0,0.03), 0 16px 32px rgba(0,0,0,0.06),
    0 32px 64px rgba(0,0,0,0.09), 0 48px 96px rgba(0,0,0,0.10);

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --ease-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
  --perspective: 600px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── FAB ── */
.gf-fab {
  width: 36px; height: 36px; border-radius: 8px;
  background: var(--glass-bg);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-rest);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  outline: none; position: relative; overflow: visible;
  transition:
    transform 0.2s var(--ease-out-expo),
    box-shadow 0.2s var(--ease-out-expo),
    border-color 0.2s var(--ease-smooth),
    background 0.2s var(--ease-smooth);
  will-change: transform, box-shadow;
}

.gf-fab:hover {
  transform: translateY(-2px) scale(1.05);
  background: var(--glass-bg-hover);
  box-shadow: var(--shadow-hover);
  border-color: var(--glass-border-hover);
}

.gf-fab:active {
  transform: translateY(1px) scale(0.95);
  box-shadow: var(--shadow-active);
  transition-duration: 0.1s;
}

.gf-fab:focus-visible { outline: 2.5px solid var(--brand); outline-offset: 3px; }

/* Icon */
.gf-fab svg {
  width: 22px; height: 22px; position: relative; z-index: 3;
  filter: drop-shadow(0 1px 3px rgba(var(--brand-rgb),0.18));
  transition: transform 0.35s var(--ease-spring), filter 0.3s ease;
}
.gf-fab:hover svg {
  transform: scale(1.1) rotate(-2deg);
  filter: drop-shadow(0 2px 6px rgba(var(--brand-rgb),0.25));
}
.gf-fab:active svg { transform: scale(0.92); transition-duration: 0.08s; }

/* Loading */
.gf-fab.gf-loading { cursor: wait; animation: none; border-color: rgba(var(--brand-rgb),0.15); }
.gf-spinner {
  width: 18px; height: 18px;
  border: 2.5px solid rgba(var(--brand-rgb),0.12);
  border-radius: 50%; border-top-color: var(--brand);
  animation: gfSpin 0.65s cubic-bezier(0.4,0,0.2,1) infinite;
  position: relative; z-index: 3;
}
@keyframes gfSpin { to { transform: rotate(360deg); } }

/* Success */
.gf-fab.gf-success {
  animation: none; border-color: rgba(var(--success-rgb),0.35);
  box-shadow: 0 0 20px var(--success-glow), 0 0 40px rgba(var(--success-rgb),0.1), var(--shadow-rest);
}
.gf-success-check { animation: gfCheckPop 0.45s var(--ease-spring); position: relative; z-index: 3; }
@keyframes gfCheckPop {
  0%   { transform: scale(0) rotate(-60deg); opacity: 0; }
  50%  { transform: scale(1.25) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}

/* Error */
.gf-fab.gf-error {
  animation: gfShake 0.45s ease;
  border-color: rgba(var(--error-rgb),0.35);
  box-shadow: 0 0 16px var(--error-glow), var(--shadow-rest);
}
@keyframes gfShake {
  0%,100% { transform: perspective(var(--perspective)) translateX(0); }
  15%  { transform: perspective(var(--perspective)) translateX(-5px) translateZ(2px); }
  30%  { transform: perspective(var(--perspective)) translateX(4px) translateZ(2px); }
  45%  { transform: perspective(var(--perspective)) translateX(-3px) translateZ(1px); }
  60%  { transform: perspective(var(--perspective)) translateX(2px) translateZ(1px); }
  75%  { transform: perspective(var(--perspective)) translateX(-1px); }
}

/* Badge */
.gf-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 17px; height: 17px; border-radius: 50%;
  background: linear-gradient(135deg, var(--error) 0%, #f87171 100%);
  color: white; font-size: 9px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid white; z-index: 10; padding: 0 3px;
  animation: gfBadgePop 0.35s var(--ease-spring);
  box-shadow: 0 2px 6px rgba(var(--error-rgb),0.3), 0 4px 12px rgba(var(--error-rgb),0.15);
}
@keyframes gfBadgePop {
  0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
  60%  { transform: scale(1.2) rotate(5deg); }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

/* Tooltip */
.gf-tooltip {
  position: absolute; bottom: calc(100% + 10px); left: 50%;
  transform: translateX(-50%) translateY(6px);
  padding: 7px 12px;
  background: rgba(15,23,42,0.92);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  color: white; font-size: 11px; font-weight: 550; letter-spacing: -0.01em;
  border-radius: 8px; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: all 0.25s var(--ease-out-expo);
  z-index: 1001; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
.gf-tooltip::after {
  content: ''; position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: rgba(15,23,42,0.92);
}
.gf-tooltip-visible { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Menu */
.gf-menu {
  position: absolute; top: calc(100% + 10px); right: 0;
  min-width: 232px;
  background: linear-gradient(160deg,
    rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.90) 100%);
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);
  border-radius: 16px; border: 1px solid rgba(255,255,255,0.65);
  box-shadow: var(--shadow-immersive);
  padding: 6px; z-index: 999; overflow: hidden;
  opacity: 0; visibility: hidden;
  transform: perspective(var(--perspective)) translateY(-8px) rotateX(4deg) scale(0.95);
  transform-origin: top right;
  transition:
    opacity 0.3s var(--ease-out-expo), visibility 0.3s var(--ease-out-expo),
    transform 0.35s var(--ease-spring);
}
.gf-menu::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 40%;
  background: linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%);
  border-radius: 16px 16px 0 0; pointer-events: none; z-index: 0;
}
.gf-menu::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(145deg,
    rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.1) 30%,
    rgba(var(--brand-rgb),0.06) 60%, rgba(255,255,255,0.3) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none; z-index: 1;
}
.gf-menu-open {
  opacity: 1; visibility: visible;
  transform: perspective(var(--perspective)) translateY(0) rotateX(0) scale(1);
}

.gf-menu-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 13px; width: 100%;
  cursor: pointer; border-radius: 10px; border: none; background: transparent;
  font: inherit; font-size: 13px; font-weight: 550; letter-spacing: -0.01em;
  color: var(--text); text-align: left; outline: none;
  position: relative; z-index: 2;
  transition: background 0.2s var(--ease-smooth), transform 0.2s var(--ease-out-expo);
}
.gf-menu-item:hover, .gf-menu-item:focus-visible {
  background: rgba(var(--brand-rgb),0.06); transform: translateX(3px);
}
.gf-menu-item:active {
  transform: translateX(3px) scale(0.98);
  background: rgba(var(--brand-rgb),0.1); transition-duration: 0.06s;
}
.gf-menu-item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

.gf-menu-icon {
  font-size: 16px; flex-shrink: 0; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px; background: rgba(var(--brand-rgb),0.06);
  transition: background 0.2s ease;
}
.gf-menu-item:hover .gf-menu-icon { background: rgba(var(--brand-rgb),0.1); }
.gf-menu-label { flex: 1; }
.gf-menu-shortcut {
  font-size: 10px; color: var(--text-tertiary); font-weight: 500;
  letter-spacing: 0.02em; opacity: 0.7;
  display: inline-flex; align-items: center;
  padding: 2px 5px; background: rgba(0,0,0,0.04);
  border-radius: 4px; border: 1px solid rgba(0,0,0,0.06);
  transition: opacity 0.2s ease;
}
.gf-menu-item:hover .gf-menu-shortcut { opacity: 1; }

.gf-menu-divider {
  height: 1px; margin: 5px 10px;
  background: linear-gradient(90deg,
    transparent 0%, rgba(0,0,0,0.06) 20%, rgba(0,0,0,0.06) 80%, transparent 100%);
  position: relative; z-index: 2;
}

/* Staggered entry */
.gf-menu-open .gf-menu-item { animation: gfMIE 0.35s var(--ease-out-expo) both; }
.gf-menu-open .gf-menu-item:nth-child(1) { animation-delay: 0.03s; }
.gf-menu-open .gf-menu-item:nth-child(2) { animation-delay: 0.06s; }
.gf-menu-open .gf-menu-item:nth-child(3) { animation-delay: 0.09s; }
.gf-menu-open .gf-menu-item:nth-child(4) { animation-delay: 0.12s; }
.gf-menu-open .gf-menu-item:nth-child(5) { animation-delay: 0.15s; }
.gf-menu-open .gf-menu-item:nth-child(6) { animation-delay: 0.18s; }
.gf-menu-open .gf-menu-item:nth-child(7) { animation-delay: 0.21s; }
.gf-menu-open .gf-menu-item:nth-child(8) { animation-delay: 0.24s; }
@keyframes gfMIE {
  from { opacity: 0; transform: translateX(-6px) translateY(4px); }
  to   { opacity: 1; transform: translateX(0) translateY(0); }
}
.gf-menu-open .gf-menu-divider { animation: gfDF 0.4s var(--ease-out-expo) 0.1s both; }
@keyframes gfDF {
  from { opacity: 0; transform: scaleX(0.3); }
  to   { opacity: 1; transform: scaleX(1); }
}

/* ── Dark Mode ── */
@media (prefers-color-scheme: dark) {
  :host {
    --glass-bg: linear-gradient(135deg, rgba(22,30,52,0.92) 0%, rgba(12,18,36,0.88) 100%);
    --glass-bg-hover: linear-gradient(135deg, rgba(28,36,60,0.95) 0%, rgba(18,24,44,0.92) 100%);
    --glass-border: rgba(255,255,255,0.08);
    --glass-border-hover: rgba(var(--brand-rgb),0.3);
    --text: #f1f5f9; --text-secondary: #94a3b8; --text-tertiary: #64748b;
    --brand-glow: rgba(167,139,250,0.25);
    --shadow-rest: 0 2px 4px rgba(0,0,0,0.20), 0 4px 8px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.10);
    --shadow-hover: 0 4px 8px rgba(0,0,0,0.20), 0 8px 16px rgba(0,0,0,0.18),
      0 16px 32px rgba(0,0,0,0.15), 0 0 36px var(--brand-glow);
    --shadow-active: 0 1px 2px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2);
    --shadow-immersive: 0 8px 16px rgba(0,0,0,0.25), 0 24px 48px rgba(0,0,0,0.25), 0 48px 96px rgba(0,0,0,0.20);
  }
  .gf-fab {
    background: var(--glass-bg); border-color: var(--glass-border);
    box-shadow: var(--shadow-rest);
  }
  .gf-fab:hover {
    background: var(--glass-bg-hover); border-color: var(--glass-border-hover);
    box-shadow: var(--shadow-hover);
  }
  .gf-fab:active { box-shadow: var(--shadow-active); }
  .gf-fab.gf-success {
    border-color: rgba(var(--success-rgb),0.4);
    box-shadow: 0 0 24px var(--success-glow), 0 0 48px rgba(var(--success-rgb),0.08), var(--shadow-rest);
  }
  .gf-fab.gf-error {
    border-color: rgba(var(--error-rgb),0.4);
    box-shadow: 0 0 20px var(--error-glow), var(--shadow-rest);
  }
  .gf-spinner { border-color: rgba(var(--brand-rgb),0.15); border-top-color: var(--brand-light); }
  .gf-badge { border-color: rgba(12,18,36,1); }
  .gf-tooltip {
    background: rgba(30,41,59,0.95); border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 4px 20px rgba(0,0,0,0.35);
  }
  .gf-tooltip::after { border-top-color: rgba(30,41,59,0.95); }
  .gf-menu {
    background: linear-gradient(160deg, rgba(22,30,52,0.96) 0%, rgba(12,18,36,0.94) 100%);
    border-color: rgba(255,255,255,0.06);
  }
  .gf-menu::before { background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%); }
  .gf-menu::after {
    background: linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.01) 30%,
      rgba(var(--brand-rgb),0.04) 60%, rgba(255,255,255,0.05) 100%);
  }
  .gf-menu-item { color: var(--text); }
  .gf-menu-item:hover, .gf-menu-item:focus-visible { background: rgba(var(--brand-rgb),0.10); }
  .gf-menu-item:active { background: rgba(var(--brand-rgb),0.15); }
  .gf-menu-icon { background: rgba(255,255,255,0.05); }
  .gf-menu-item:hover .gf-menu-icon { background: rgba(var(--brand-rgb),0.12); }
  .gf-menu-shortcut {
    background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); color: var(--text-tertiary);
  }
  .gf-menu-divider {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 20%,
      rgba(255,255,255,0.06) 80%, transparent 100%);
  }
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  .gf-fab, .gf-fab::before, .gf-fab::after, .gf-fab svg,
  .gf-menu, .gf-menu-item, .gf-tooltip, .gf-badge, .gf-spinner, .gf-success-check {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .gf-fab:hover, .gf-fab:active { transform: none !important; }
  .gf-menu-open { transform: none !important; }
  .gf-menu-open .gf-menu-item {
    animation: none !important; opacity: 1 !important; transform: none !important;
  }
}
    `;
  }
}
