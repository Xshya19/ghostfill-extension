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

import {
  classifyField,
  shouldDecorateField,
  getFieldTooltip,
  PageContext,
  FieldType,
} from '../shared/fieldClassifier';
import { generateHostTokens } from '../shared/tokens';
import { GenerateEmailResponse, GeneratePasswordResponse, GetLastOTPResponse } from '../types';
import { TIMING } from '../utils/constants';
import { debounce } from '../utils/debounce';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { setHTML, clearHTML } from '../utils/setHTML';
import { AutoFiller } from './autoFiller';
import { FieldAnalyzer } from './fieldAnalyzer';
import { pageStatus } from './pageStatus';
import { IconSystem } from './utils/fab-icons';
import { menuIcon } from './utils/fab-menu-icons';
import { collectFieldDiagnostics } from './utils/fieldDiagnosticsHarvester';
import { PageAnalyzer, PageType, PageAnalysis } from './utils/pageAnalyzer';

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
  mini: 24,
  normal: 32,
  expanded: 44,
};

/** Viewport margin to prevent edge clipping */
const VIEWPORT_MARGIN = 8;

/** Off-screen sentinel position */
const OFF_SCREEN = -9999;

/** z-index safety margin */
const Z_INDEX_BOOST = 100;
const ABSOLUTE_MAX_Z = 2147483647;

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
  otp?: string;
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

function isFormInputElement(el: unknown): el is HTMLElement {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }
  if (el instanceof HTMLElement) {
    return el.isContentEditable || el.getAttribute('role') === 'textbox';
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  §2  P A G E   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  §3  F I E L D   C O N T E X T   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

// FieldContext removed and unified into src/shared/fieldClassifier.ts

// ═══════════════════════════════════════════════════════════════
//  §4  S M A R T   P O S I T I O N E R
// ═══════════════════════════════════════════════════════════════

class SmartPositioner {
  static calculate(field: HTMLElement, buttonSize: number): PositionConfig {
    const rect = field.getBoundingClientRect();

    // Use visualViewport for more accurate dimensions on zoomed/mobile pages
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const m = VIEWPORT_MARGIN;

    // Off-screen: field scrolled out of view
    // Note: rect is relative to the viewport
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

  /**
   * Probing logic to "see" if the button would be obscured by site elements.
   * If blocked, it suggests an alternative placement.
   */
  static checkObstructions(left: number, top: number, size: number): boolean {
    if (left === OFF_SCREEN) {
      return false;
    }

    const points = [
      [left + 2, top + 2],
      [left + size - 2, top + 2],
      [left + 2, top + size - 2],
      [left + size - 2, top + size - 2],
      [left + size / 2, top + size / 2],
    ];

    for (const [x, y] of points) {
      try {
        const el = document.elementFromPoint(x!, y!);
        if (el) {
          // Ignore our own container
          if (el.closest('#ghostfill-fab') || el.closest('.gf-fab')) {
            continue;
          }

          // If the element at this point is not the input field we're targeting,
          // and it's not a transparent container, it's an obstruction.
          const style = window.getComputedStyle(el);
          if (style.opacity === '0' || style.pointerEvents === 'none') {
            continue;
          }

          // If it's a "Top Layer" element like a sticky header, we are obscured.
          const zIndex = parseInt(style.zIndex, 10) || 0;
          if (zIndex > 1000) {
            return true;
          }
        }
      } catch {
        /* ignore points outside viewport */
      }
    }
    return false;
  }

  /** H10: Cached z-index to avoid 500-element scan on every position update */
  private static _cachedMaxZ = 0;
  private static _cachedMaxZTs = 0;
  private static readonly Z_CACHE_TTL_MS = 15000;

  static getMaxZIndex(): number {
    const now = Date.now();
    if (this._cachedMaxZ > 0 && now - this._cachedMaxZTs < this.Z_CACHE_TTL_MS) {
      return this._cachedMaxZ;
    }
    try {
      let max = 10000; // Safe baseline
      const elements = document.body.children;
      for (let i = 0, len = elements.length; i < len; i++) {
        const el = elements[i] as HTMLElement;
        const style = window.getComputedStyle(el);
        const z = parseInt(style.zIndex, 10);
        if (!isNaN(z) && z > max && z < ABSOLUTE_MAX_Z) {
          max = z;
        }
      }
      const result = Math.min(max + Z_INDEX_BOOST, ABSOLUTE_MAX_Z);
      this._cachedMaxZ = result;
      this._cachedMaxZTs = now;
      return result;
    } catch {
      return ABSOLUTE_MAX_Z;
    }
  }

  /** Invalidate the z-index cache (call on DOM mutation or new field focus) */
  static invalidateZCache(): void {
    this._cachedMaxZTs = 0;
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
      analysis.hasEmailField || analysis.pageType === 'signup' || analysis.pageType === 'login';

    const showPassword =
      analysis.hasPasswordField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'password-reset';

    // Extract and sanitize context name from page title
    const siteTitleMatch = document.title.match(/^([^-|]+)/);
    const rawName = siteTitleMatch ? siteTitleMatch[1]!.trim() : 'Account';
    const contextName = escapeHTML(rawName);

    const actions: MenuAction[] = [
      {
        id: 'smart-fill',
        icon: menuIcon('spark'),
        label: `Auto-fill ${contextName}`,
        shortcut: 'Ctrl+Shift+G',
        visible: true,
        handler: noop,
      },
      {
        id: 'paste-otp',
        icon: menuIcon('key'),
        label: hasOTPReady ? 'Paste Found Code' : 'Paste Code',
        visible: showOTP,
        handler: noop,
      },
      {
        id: 'generate-email',
        icon: menuIcon('mail'),
        label: 'Use Hidden Email',
        visible: showEmail,
        handler: noop,
      },
      {
        id: 'generate-password',
        icon: menuIcon('lock'),
        label: 'Generate Secure Password',
        visible: showPassword,
        handler: noop,
      },
      {
        id: 'fill-firstname',
        icon: menuIcon('user'),
        label: 'Inject First Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-lastname',
        icon: menuIcon('users'),
        label: 'Inject Last Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-fullname',
        icon: menuIcon('edit'),
        label: 'Inject Full Name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-username',
        icon: menuIcon('mask'),
        label: 'Inject Username',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'clear-fields',
        icon: menuIcon('clear'),
        label: 'Clear All Fields',
        visible: true,
        handler: noop,
      },
      {
        id: 'copy-field-diagnostics',
        icon: menuIcon('chart'),
        label: 'Copy Field Diagnostics',
        shortcut: 'Alt+Shift+H',
        visible: true,
        handler: noop,
      },
      { id: 'divider', icon: '', label: '', visible: true, handler: noop },
      {
        id: 'settings',
        icon: menuIcon('settings'),
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
//  Colors: exact hex from popup.css :root tokens
//  Strokes: 1.5 primary | 0.8 detail (Memphis 2-weight system)
//  All SVGs: xmlns present, role="presentation", aria-hidden="true"
// ═══════════════════════════════════════════════════════════════

// NOTE: IconSystem is imported from './utils/fab-icons' instead of defined here locally.

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
  private isWaitingForOTP = false;
  private pageAnalysis: PageAnalysis | null = null;
  private destroyed = false;

  // ── OTP Waiting Indicator ────────────────────────────────
  private otpWaitingIndicator: HTMLDivElement | null = null;
  private otpWaitingInterval: ReturnType<typeof setInterval> | null = null;

  // ── Timers ───────────────────────────────────────────────
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateResetTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Scroll & Resize ──────────────────────────────────────
  private scrollRafId: number | null = null;
  private isScrolling = false;
  private fieldResizeObserver: ResizeObserver | null = null;
  private fieldIntersectionObserver: IntersectionObserver | null = null;

  // ── Event cleanup ────────────────────────────────────────
  private readonly cleanupFns: Array<() => void> = [];
  private messageListener: ((msg: FloatingButtonRuntimeMessage) => void) | null = null;
  private listenerRegistered = false;
  private menuKeyboardHandler: ((e: KeyboardEvent) => void) | null = null;

  // ── Dependencies ─────────────────────────────────────────
  private readonly autoFiller: AutoFiller;
  private readonly fieldAnalyzer = FieldAnalyzer.getInstance();

  // ── Ghost Scanning ───────────────────────────────────────
  private readonly ghostObservers = new Map<HTMLElement, IntersectionObserver>();

  // ── Keyboard ─────────────────────────────────────────────
  private static readonly SHORTCUT_KEY = 'g';

  constructor(autoFiller: AutoFiller) {
    this.autoFiller = autoFiller;
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.1  L I F E C Y C L E
  // ═══════════════════════════════════════════════════════════

  async init(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.createContainer();
    this.setupEventListeners();
    this.setupKeyboardShortcut();
    log.debug('FloatingButton initialised');
    void this.loadSettingsAsync();
    void this.checkOTPAvailability();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.cancelAllTimers();
    this.cancelAllAnimationFrames();

    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
      this.fieldResizeObserver = null;
    }

    if (this.fieldIntersectionObserver) {
      this.fieldIntersectionObserver.disconnect();
      this.fieldIntersectionObserver = null;
    }

    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    this.cleanupFns.length = 0;

    for (const obs of this.ghostObservers.values()) {
      obs.disconnect();
    }
    this.ghostObservers.clear();

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
        if (!this.isEnabled) {
          this.setState('hidden');
        }
      }
    } catch {
      log.debug('Settings fetch failed — defaulting to enabled');
    }

    this.registerRuntimeListener();
  }

  private registerRuntimeListener(): void {
    if (this.listenerRegistered || this.destroyed) {
      return;
    }
    if (!chrome?.runtime?.onMessage) {
      return;
    }

    this.messageListener = (msg: FloatingButtonRuntimeMessage) => {
      if (this.destroyed) {
        return;
      }

      if (msg.action === 'SETTINGS_CHANGED' && msg.settings) {
        this.isEnabled = msg.settings.showFloatingButton ?? this.isEnabled;
        if (!this.isEnabled) {
          this.setState('hidden');
        }
      }
      if (msg.action === 'OTP_RECEIVED' && msg.otp) {
        this.hasOTPReady = true;
        this.isWaitingForOTP = false;
        this.hideOTPWaitingIndicator();
        this.updateBadge();
        if (this.isEnabled) {
          log.info('🚀 OTP received, triggering Auto-Fill Sentinel');
          void this.startAutoFillOTPSequence(msg.otp);
        }
      }

      if (msg.action === 'OTP_PAGE_DETECTED') {
        this.isWaitingForOTP = true;
        this.showOTPWaitingIndicator();
      }

      if (msg.action === 'OTP_PAGE_LEFT') {
        this.isWaitingForOTP = false;
        this.hideOTPWaitingIndicator();
        if (!this.hasOTPReady) {
          this.updateBadge();
        }
      }

      // Reset all session state when the user generates a new email address.
      // Clears OTP badge, closes menu, and returns button to clean idle state.
      if (msg.action === 'RESET_STATE') {
        this.hasOTPReady = false;
        this.updateBadge();
        if (this.state === 'menu-open') {
          this.closeMenuSilent();
        }
        if (this.state !== 'hidden') {
          this.setState('idle');
        }
        log.debug('🔄 FAB state reset on email change');
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
    if (this.destroyed) {
      return;
    }
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
    if (this.destroyed && newState !== 'hidden') {
      return;
    }
    if (this.state === newState) {
      return;
    }

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

    this.currentField = null;
    this.currentFieldRef = null;
    this.currentFieldRect = null;
  }

  private applyIdle(): void {
    if (!this.container || !this.button) {
      return;
    }
    this.container.style.setProperty('display', 'block', 'important');
    setHTML(this.button, IconSystem.get(this.mode));
    this.button.classList.remove('gf-loading', 'gf-success', 'gf-error');
    const tooltipMode = this.mode === 'magic' ? 'generic' : (this.mode as FieldType);
    this.button.setAttribute('aria-label', getFieldTooltip(tooltipMode));
    this.updateBadge();
    this.scheduleAutoHide();
  }

  private applyHovering(): void {
    this.cancelAllTimers();
    this.showTooltip();
  }

  private applyLoading(): void {
    if (!this.button) {
      return;
    }
    this.cancelAllTimers();
    this.button.classList.add('gf-loading');
    setHTML(this.button, IconSystem.getSpinner());
    this.hideTooltip();
  }

  private applySuccess(message?: string): void {
    if (!this.button) {
      return;
    }
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
    if (!this.button) {
      return;
    }
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
    const zIndex = SmartPositioner.getMaxZIndex();
    this.container.style.cssText = `position:fixed;z-index:${zIndex};display:none;pointer-events:auto;`;

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
    if (!this.button) {
      return;
    }

    // ── Click ─────────────────────────────────────────────
    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === 'loading') {
        return;
      }

      // Intelligence 2.0: Trigger Intelligence Pulse on click
      const rect = this.button!.getBoundingClientRect();
      this.fieldAnalyzer.setAttentiveRegion(rect.left + rect.width / 2, rect.top + rect.height / 2);

      if (this.state === 'menu-open') {
        this.setState('idle');
        return;
      }
      void this.handlePrimaryAction().catch((e) => {
        /* handled internally by handlePrimaryAction */
        log.error('Unexpected error in primary action', e);
      });
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
      if (this.state === 'idle') {
        this.setState('hovering');
      }
      // Intelligence 2.0: Intelligence Pulse on hover
      const rect = this.button!.getBoundingClientRect();
      this.fieldAnalyzer.setAttentiveRegion(rect.left + rect.width / 2, rect.top + rect.height / 2);
    });
    this.button.addEventListener('mouseleave', () => {
      if (this.state === 'hovering') {
        this.setState('idle');
      }
      // Reset magnetic transform
      this.button!.style.transform = '';
    });

    // Magnetic hover effect
    this.button.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.button) {
        return;
      }
      const rect = this.button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) / rect.width;
      const deltaY = (e.clientY - centerY) / rect.height;
      const magnetStrength = 4;
      const moveX = deltaX * magnetStrength;
      const moveY = deltaY * magnetStrength;
      this.button.style.transform = `translate(${-2 + moveX}px, ${-2 + moveY}px) scale(1.02)`;
    });

    // ── Keyboard Navigation ───────────────────────────────
    this.button.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          void this.handlePrimaryAction().catch((e) => {
            /* handled internally by handlePrimaryAction */
            log.error('Unexpected error in primary action', e);
          });
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
    if (this.destroyed) {
      return;
    }

    this.setState('loading');

    try {
      if (this.mode === 'otp') {
        pageStatus.show('Filling verification code...', 'loading');
        await this.actionPasteOTP();
        return;
      }

      pageStatus.show('Analyzing form...', 'loading');
      const result = await this.autoFiller.smartFill();

      if (this.destroyed) {
        return;
      }

      if (result.success && result.filledCount > 0) {
        const msg = `Filled ${result.filledCount} field(s)!`;
        pageStatus.success(msg, TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', msg);
      } else if (result.message?.includes('disabled on login pages')) {
        // Show user-friendly message for blocked login pages
        pageStatus.error(
          'Smart Fill blocked on login pages.\nTry the OTP button if you have a verification code.',
          4000
        );
        this.setState('idle');
      } else if (result.message?.includes('No identity or OTP available')) {
        // Show helpful message when no identity/OTP is available
        pageStatus.error(
          'Open the popup first to generate an email, or wait for an OTP to arrive.',
          4000
        );
        this.setState('idle');
      } else {
        pageStatus.hide();
        this.setState('idle');
        log.debug('No fields filled — silent dismiss');
      }
    } catch (error) {
      if (this.destroyed) {
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Don't show error for expected extension context invalidation
      if (errorMsg.toLowerCase().includes('context invalidated')) {
        log.debug('Extension context invalidated during smart fill');
        this.setState('idle');
        return;
      }
      log.error('Smart fill error:', error);
      const msg = errorMsg || 'Failed to fill';
      pageStatus.error(msg, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', msg);
    }
  }

  // ── Auto-Fill Sentinel Sequence ───────────────────────

  public async startAutoFillOTPSequence(otp: string): Promise<void> {
    if (this.destroyed || !this.isEnabled) {
      return;
    }

    const analysis = this.getPageAnalysis();
    const useFullScreen =
      analysis.pageType === 'verification' || analysis.pageType === '2fa' || analysis.hasOTPField;

    // 1. Show Premium Sentinel Overlay
    this.showAutoFillSentinel(useFullScreen);

    // 2. Perform the fill with the full recovery pipeline.
    try {
      const result = await this.autoFiller.fillOTP(otp); // Use full OTP for discover, it handles cleaning

      if (this.destroyed) {
        return;
      }

      if (result) {
        this.setSentinelMessage('Code secured successfully!');
        this.setState('success');
        setTimeout(() => this.hideAutoFillSentinel(), 2000);
      } else {
        this.setSentinelMessage('Something went wrong. Tap to try manually.');
        this.setState('idle');
        setTimeout(() => this.hideAutoFillSentinel(), 3000);
      }
    } catch (err) {
      log.error('Sentinel fill failed', err);
      this.hideAutoFillSentinel();
    }
  }

  private sentinelOverlay: HTMLDivElement | null = null;

  private showAutoFillSentinel(_fullScreen: boolean): void {
    if (!this.shadowRoot || this.destroyed) {
      return;
    }

    if (!this.sentinelOverlay) {
      this.sentinelOverlay = document.createElement('div');
      this.sentinelOverlay.className = 'gf-sentinel-toast';
      this.shadowRoot.appendChild(this.sentinelOverlay);
    }

    setHTML(
      this.sentinelOverlay,
      `
      <div class="gf-sentinel-toast-inner">
        <div class="gf-sentinel-toast-icon">
          ${IconSystem.get('otp')}
        </div>
        <div class="gf-sentinel-toast-text">
          <div class="gf-sentinel-toast-title">Filling code...</div>
          <div class="gf-sentinel-toast-subtitle">GhostFill is securing your session</div>
        </div>
      </div>
    `
    );

    if (this.button) {
      const btnRect = this.button.getBoundingClientRect();
      this.sentinelOverlay.style.left = `${btnRect.left - 180}px`;
      this.sentinelOverlay.style.top = `${btnRect.top - 10}px`;
    }

    requestAnimationFrame(() => {
      this.sentinelOverlay?.classList.add('gf-sentinel-toast-visible');
    });
  }

  private setSentinelMessage(msg: string): void {
    const title = this.sentinelOverlay?.querySelector('.gf-sentinel-toast-title');
    if (title) {
      title.textContent = msg;
    }
    const subtitle = this.sentinelOverlay?.querySelector('.gf-sentinel-toast-subtitle');
    if (subtitle) {
      (subtitle as HTMLElement).style.opacity = '0';
    }
  }

  private hideAutoFillSentinel(): void {
    if (!this.sentinelOverlay) {
      return;
    }
    this.sentinelOverlay.classList.remove('gf-sentinel-toast-visible');
    setTimeout(() => {
      this.sentinelOverlay?.remove();
      this.sentinelOverlay = null;
    }, 500);
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.6  M E N U
  // ═══════════════════════════════════════════════════════════

  private openMenuInternal(): void {
    if (!this.menu || !this.shadowRoot || this.destroyed) {
      return;
    }

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
    if (!this.menu) {
      return;
    }

    const handler = (e: KeyboardEvent): void => {
      if (!this.menu) {
        return;
      }
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

    this.menuKeyboardHandler = handler;
    this.menu.addEventListener('keydown', handler);
  }

  private closeMenuSilent(): void {
    if (this.menu) {
      if (this.menuKeyboardHandler) {
        this.menu.removeEventListener('keydown', this.menuKeyboardHandler);
        this.menuKeyboardHandler = null;
      }
      this.menu.classList.remove('gf-menu-open');
      clearHTML(this.menu);
    }
  }

  private async handleMenuAction(actionId: string): Promise<void> {
    if (this.destroyed) {
      return;
    }
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

        case 'copy-field-diagnostics':
          await collectFieldDiagnostics();
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
      if (this.destroyed) {
        return;
      }
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
      const code = resp.lastOTP.code;
      const isSuspicious = /^(\d)\1{3,}$/.test(code.replace(/[-\s]/g, ''));

      if (isSuspicious) {
        pageStatus.error('OTP looks invalid (repeated digits)', TIMING_MS.ERROR_DISPLAY);
        this.setState('error', 'OTP looks invalid');
        log.warn('FAB blocked suspicious OTP fill', { code: code.substring(0, 2) + '••••' });
        return;
      }

      const masked = code.length > 2 ? code.substring(0, 2) + '•'.repeat(code.length - 2) : code;
      this.showStatusTooltip(`Filling ${masked}`, 'var(--brand)');

      const filled = await this.autoFiller.fillOTP(code);
      if (this.destroyed) {
        return;
      }

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
    const resp = (await safeSendMessage({
      action: 'GENERATE_EMAIL',
    })) as GenerateEmailResponse | null;

    if (this.destroyed) {
      return;
    }

    if (resp?.success && resp.email?.fullEmail && this.currentField) {
      const filled = await this.fillResolvedField(this.currentField, resp.email.fullEmail, 'email');
      if (filled) {
        pageStatus.success('Email filled!', TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', 'Email filled!');
      } else {
        pageStatus.error('Could not fill email field', TIMING_MS.ERROR_DISPLAY);
        this.setState('error', 'Could not fill email field');
      }
    } else {
      const msg =
        resp && 'error' in resp && typeof resp.error === 'string'
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

    if (this.destroyed) {
      return;
    }

    if (resp?.result?.password && this.currentField) {
      const filled = await this.fillResolvedField(
        this.currentField,
        resp.result.password,
        'password'
      );
      if (filled) {
        pageStatus.success('Password filled!', TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', 'Password filled!');
      } else {
        pageStatus.error('Could not fill password field', TIMING_MS.ERROR_DISPLAY);
        this.setState('error', 'Could not fill password field');
      }
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

    if (this.destroyed) {
      return;
    }

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
      const filled = await this.fillResolvedField(this.currentField, value);
      if (filled) {
        pageStatus.success(`${mapping.label} filled!`, TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', `${mapping.label} filled!`);
      } else {
        pageStatus.error(`Could not fill ${mapping.label}`, TIMING_MS.ERROR_DISPLAY);
        this.setState('error', `Could not fill ${mapping.label}`);
      }
    } else {
      pageStatus.error(`No ${mapping.label} available`, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', `No ${mapping.label} available`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.7  T O O L T I P
  // ═══════════════════════════════════════════════════════════

  private showTooltip(): void {
    if (!this.tooltip) {
      return;
    }
    const tooltipMode = this.mode === 'magic' ? 'generic' : (this.mode as FieldType);
    this.tooltip.textContent = getFieldTooltip(tooltipMode);
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
    if (!this.tooltip) {
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.backgroundColor = bgColor;
    this.tooltip.style.color = 'white';
    this.tooltip.classList.add('gf-tooltip-visible');
  }

  private clearStatusTooltip(): void {
    if (!this.tooltip) {
      return;
    }
    this.tooltip.classList.remove('gf-tooltip-visible');
    this.tooltip.style.backgroundColor = '';
    this.tooltip.style.color = '';
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.8  B A D G E
  // ═══════════════════════════════════════════════════════════

  private updateBadge(): void {
    if (!this.button || !this.shadowRoot) {
      return;
    }

    // Remove existing badge
    const existing = this.button.querySelector('.gf-badge');
    if (existing) {
      existing.remove();
    }

    if (this.hasOTPReady) {
      const badge = document.createElement('span');
      badge.className = 'gf-badge gf-badge-otp-ready';
      badge.textContent = '!';
      badge.setAttribute('aria-label', 'OTP code ready');
      this.button.appendChild(badge);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.8.1  O T P   W A I T I N G   I N D I C A T O R
  // ═══════════════════════════════════════════════════════════

  private showOTPWaitingIndicator(): void {
    if (!this.button || !this.shadowRoot || this.destroyed) {
      return;
    }

    if (!this.otpWaitingIndicator) {
      this.otpWaitingIndicator = document.createElement('div');
      this.otpWaitingIndicator.className = 'gf-otp-waiting-indicator';
      this.button.appendChild(this.otpWaitingIndicator);
    }

    this.otpWaitingIndicator.classList.add('gf-otp-waiting-visible');

    // Periodic re-discovery: scan for OTP fields every 2s while waiting
    // This catches fields that appear after SPA transitions or lazy loading
    if (!this.otpWaitingInterval) {
      this.otpWaitingInterval = setInterval(() => {
        if (this.destroyed || !this.isWaitingForOTP) {
          return;
        }
        const analysis = this.getPageAnalysis();
        if (
          analysis.pageType === 'verification' ||
          analysis.pageType === '2fa' ||
          analysis.hasOTPField
        ) {
          void this.autoFiller.refreshContext();
        }
      }, 2000);
    }
  }

  private hideOTPWaitingIndicator(): void {
    if (this.otpWaitingIndicator) {
      this.otpWaitingIndicator.classList.remove('gf-otp-waiting-visible');
      setTimeout(() => {
        this.otpWaitingIndicator?.remove();
        this.otpWaitingIndicator = null;
      }, 400);
    }

    if (this.otpWaitingInterval) {
      clearInterval(this.otpWaitingInterval);
      this.otpWaitingInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.9  E V E N T   L I S T E N E R S
  // ═══════════════════════════════════════════════════════════

  private setupEventListeners(): void {
    // ── Focus Tracking ────────────────────────────────────

    const onFocusIn = (e: FocusEvent): void => {
      const path = e.composedPath?.();
      const target = (path?.[0] ?? e.target) as EventTarget | null;
      this.handleFocusChange(target);
    };
    document.addEventListener('focusin', onFocusIn, true);
    this.cleanupFns.push(() => document.removeEventListener('focusin', onFocusIn, true));

    // ── Focus Out ─────────────────────────────────────────
    const onFocusOut = (e: FocusEvent): void => {
      if (this.destroyed) {
        return;
      }
      const related = e.relatedTarget as HTMLElement | null;

      // Don't hide if focus moved to our container or we have menu open
      if (this.container?.contains(related)) {
        return;
      }
      if (this.state === 'menu-open') {
        return;
      }

      this.scheduleAutoHide();
    };
    document.addEventListener('focusout', onFocusOut, true);
    this.cleanupFns.push(() => document.removeEventListener('focusout', onFocusOut, true));

    // ── Click Outside → Close Menu ────────────────────────
    const onDocClick = (e: MouseEvent): void => {
      if (this.state !== 'menu-open') {
        return;
      }
      const path = e.composedPath?.() ?? [];
      if (path.some((el) => el === this.container)) {
        return;
      }
      this.setState('idle');
    };
    document.addEventListener('click', onDocClick, true);
    this.cleanupFns.push(() => document.removeEventListener('click', onDocClick, true));

    // ── Scroll Following ──────────────────────────────────
    const onScroll = (): void => {
      if (this.destroyed || this.state === 'hidden' || !this.currentField) {
        return;
      }
      if (!this.isScrolling) {
        this.isScrolling = true;
        this.followFieldOnScroll();
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    this.cleanupFns.push(() => window.removeEventListener('scroll', onScroll, true));

    // ── Resize ────────────────────────────────────────────
    const onResize = debounce(() => {
      if (this.destroyed) {
        return;
      }
      const field = this.currentFieldRef?.deref();
      if (this.state !== 'hidden' && field) {
        this.positionNearField(field);
      }
    }, TIMING_MS.RESIZE_DEBOUNCE);
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));
  }

  private readonly handleFocusChange = debounce((...args: unknown[]): void => {
    const target = args[0] as EventTarget | null;
    if (this.destroyed) {
      return;
    }
    if (!target || !(target instanceof HTMLElement)) {
      return;
    }

    // Invalidate page analysis cache on focus to detect SPA changes
    this.pageAnalysis = null;

    if (isFormInputElement(target) && shouldDecorateField(target as HTMLInputElement)) {
      this.showNearField(target);
    }
  }, TIMING_MS.FOCUS_DEBOUNCE) as any;

  // ═══════════════════════════════════════════════════════════
  //  §7.10  K E Y B O A R D   S H O R T C U T
  // ═══════════════════════════════════════════════════════════

  private setupKeyboardShortcut(): void {
    const onKeydown = (e: KeyboardEvent): void => {
      if (this.destroyed) {
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === FloatingButton.SHORTCUT_KEY
      ) {
        e.preventDefault();
        e.stopPropagation();
        log.info('⌨️ Keyboard shortcut triggered');
        void this.handlePrimaryAction().catch((e) => {
          /* handled internally by handlePrimaryAction */
          log.error('Unexpected error in primary action', e);
        });
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeydown, true));
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.12  P O S I T I O N I N G
  // ═══════════════════════════════════════════════════════════

  showNearField(field: HTMLElement): void {
    if (!this.isEnabled || this.destroyed) {
      return;
    }

    // Re-attach container if SPA removed it
    if (this.container && !this.container.isConnected) {
      const target = document.documentElement ?? document.body;
      if (target) {
        target.appendChild(this.container);
      }
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
    let pageContext: PageContext = 'default';
    if (analysis.pageType === 'signup') {
      pageContext = 'signup';
    } else if (analysis.pageType === 'login') {
      pageContext = 'login';
    } else if (analysis.pageType === 'verification') {
      pageContext = 'verification';
    } else if (analysis.pageType === '2fa') {
      pageContext = '2fa';
    } else if (analysis.pageType === 'password-reset') {
      pageContext = 'password-reset';
    }
    const classified = classifyField(field as HTMLInputElement, pageContext);
    this.mode = classified === 'generic' ? 'magic' : classified;

    // Observe field resize
    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
    }
    this.fieldResizeObserver = new ResizeObserver(
      debounce(() => {
        if (!this.destroyed && this.state !== 'hidden') {
          const f = this.currentFieldRef?.deref();
          if (f) {
            this.positionNearField(f);
          }
        }
      }, TIMING_MS.FIELD_RESIZE_DEBOUNCE)
    );
    this.fieldResizeObserver.observe(field);

    // Observe field visibility (Intersection)
    if (this.fieldIntersectionObserver) {
      this.fieldIntersectionObserver.disconnect();
    }
    this.fieldIntersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!this.destroyed && this.state !== 'hidden' && entry) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.1) {
            this.container?.style.setProperty('visibility', 'hidden', 'important');
          } else {
            this.container?.style.setProperty('visibility', 'visible', 'important');
            this.positionNearField(field);
          }
        }
      },
      { threshold: [0, 0.1, 0.5, 1.0] }
    );
    this.fieldIntersectionObserver.observe(field);

    this.positionNearField(field);
    this.setState('idle');
  }

  private positionNearField(field: HTMLElement): void {
    if (!this.container || this.destroyed) {
      return;
    }

    const btnSize = BUTTON_SIZE_PX[this.size];
    let pos = SmartPositioner.calculate(field, btnSize);

    if (pos.left === OFF_SCREEN) {
      this.setState('hidden');
      return;
    }

    // Smart Obstruction Check: if blocked, try "Outside Left" or "Below"
    if (
      pos.placement === 'inside-right' &&
      SmartPositioner.checkObstructions(pos.left, pos.top, btnSize)
    ) {
      const rect = field.getBoundingClientRect();
      const m = VIEWPORT_MARGIN;

      // Try Below
      const belowTop = rect.bottom + m;
      if (!SmartPositioner.checkObstructions(rect.left, belowTop, btnSize)) {
        pos = { left: rect.left, top: belowTop, placement: 'below' };
      } else {
        // Try Outside Left
        const leftX = rect.left - btnSize - m;
        if (leftX > m && !SmartPositioner.checkObstructions(leftX, pos.top, btnSize)) {
          pos = { left: leftX, top: pos.top, placement: 'outside-left' };
        }
      }
    }

    this.container.style.setProperty('left', `${pos.left}px`, 'important');
    this.container.style.setProperty('top', `${pos.top}px`, 'important');
    this.container.style.setProperty('transform', 'none', 'important');

    // Z-Index calculation is expensive, only do it once
    if (!this.container.style.zIndex) {
      this.container.style.setProperty(
        'z-index',
        SmartPositioner.getMaxZIndex().toString(),
        'important'
      );
    }
  }

  private followFieldOnScroll(): void {
    if (this.scrollRafId !== null) {
      cancelAnimationFrame(this.scrollRafId);
    }

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
    if (this.state === 'menu-open' || this.state === 'loading') {
      return;
    }
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
    if (input.id) {
      return `#${escapeCSS(input.id)}`;
    }
    if (input.name) {
      return `input[name="${escapeCSS(input.name)}"]`;
    }
    if (input.type && input.type !== 'text') {
      return `input[type="${escapeCSS(input.type)}"]`;
    }
    return 'input';
  }

  private async fillResolvedField(
    field: HTMLElement,
    value: string,
    fieldType?: FieldType
  ): Promise<boolean> {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      const directFill = await this.autoFiller.fillElement(field, value);
      if (directFill) {
        return true;
      }
    }

    const refreshedField = this.currentFieldRef?.deref();
    if (
      refreshedField &&
      refreshedField !== field &&
      (refreshedField instanceof HTMLInputElement || refreshedField instanceof HTMLTextAreaElement)
    ) {
      const refreshedFill = await this.autoFiller.fillElement(refreshedField, value);
      if (refreshedFill) {
        return true;
      }
    }

    if (fieldType) {
      const currentFieldFill = await this.autoFiller.fillCurrentField(value, fieldType as any);
      if (currentFieldFill) {
        return true;
      }
    }

    return this.autoFiller.fillField(this.buildFieldSelector(field), value);
  }

  // ── Public API ──────────────────────────────────────────

  show(): void {
    if (!this.destroyed && this.state === 'hidden') {
      this.setState('idle');
    }
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
   GhostFill 3.0 — Memphis Neon Archive — FAB Shadow DOM
   Solid surfaces · Neon accents · Sharp geometry · Dark mode
   ══════════════════════════════════════════════════════════════ */

:host {
  all: initial;
  font-family: "Space Grotesk", "Inter", sans-serif;
  isolation: isolate;

  /* Memphis Neon Palette mapped to FAB */
  ${generateHostTokens()}

  --brand: var(--gf-magenta);
  --brand-dark: var(--xxx-violet-400);
  --brand-rgb: var(--gf-magenta-rgb);
  --brand-glow: rgba(var(--gf-magenta-rgb), 0.24);

  --neon-cyan: var(--gf-cyan);
  --neon-cyan-rgb: var(--gf-cyan-rgb);
  --neon-green: var(--gf-mint);
  --neon-green-rgb: var(--gf-mint-rgb);
  --neon-amber: var(--gf-yellow);
  --neon-violet: var(--gf-violet);
  --neon-violet-rgb: var(--gf-violet-rgb);

  --success: var(--gf-mint);
  --success-rgb: var(--gf-mint-rgb);
  --success-glow: rgba(var(--gf-mint-rgb), 0.25);
  --error: var(--gf-coral);
  --error-rgb: var(--gf-coral-rgb);
  --error-glow: rgba(var(--gf-coral-rgb), 0.25);

  --fab-bg: var(--xxx-yellow-200);
  --fab-bg-hover: var(--xxx-cyan-200);
  --fab-border: var(--gf-ink);
  --text: var(--gf-ink);
  --text-secondary: var(--gf-text-muted);
  --text-tertiary: var(--gf-text-dim);

  /* Memphis Hard Shadows (No soft blurs!) */
  --shadow-rest: 3px 3px 0 var(--gf-ink);
  --shadow-hover: 5px 5px 0 var(--gf-ink);
  --shadow-active: 0px 0px 0 var(--gf-ink);
  --panel-shadow: 5px 5px 0 var(--gf-ink);

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
  --perspective: 600px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── FAB Button — Memphis Sticker Physics ── */
.gf-fab {
  width: 38px; height: 38px; border-radius: 7px;
  background:
    linear-gradient(135deg, var(--xxx-yellow-300), var(--xxx-lime-300), var(--xxx-cyan-300)),
    var(--fab-bg);
  border: 2.5px solid var(--fab-border);
  box-shadow: var(--shadow-rest);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  outline: none; position: relative; overflow: visible;
  transition: transform 0.15s var(--ease-spring), box-shadow 0.15s var(--ease-spring), border-color 0.15s var(--ease-smooth);
}
.gf-fab::before {
  content: "";
  position: absolute;
  inset: 5px;
  border: 1px dashed rgba(var(--gf-ink-rgb), 0.34);
  border-radius: 4px;
  pointer-events: none;
  z-index: 1;
}
.gf-fab::after {
  content: "";
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 12px;
  height: 12px;
  background: var(--xxx-violet-300);
  border: 2px solid var(--gf-ink);
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
}

.gf-fab:hover {
  /* 2D Memphis Lift: Moves Up/Left, Shadow grows Down/Right */
  transform: translate(-2px, -2px) scale(1.02); 
  background:
    linear-gradient(135deg, var(--xxx-pink-300), var(--xxx-yellow-300), var(--xxx-cyan-300)),
    var(--fab-bg-hover);
  box-shadow: 5px 5px 0 var(--gf-ink); /* Hard shadow grows */
  border-color: var(--gf-cyan);
}

.gf-fab:active {
  /* 2D Memphis Slam: Slams Down/Right into the page, Shadow disappears */
  transform: translate(3px, 3px) scale(0.98);
  box-shadow: 0px 0px 0 var(--gf-ink);
  transition-duration: 0.05s;
}

.gf-fab:focus-visible {
  outline: 3px solid var(--gf-cyan);
  outline-offset: 3px;
}

/* Icon */
.gf-fab svg {
  width: 20px; height: 20px; position: relative; z-index: 3;
  transition: transform 0.3s var(--ease-spring);
}
.gf-fab:hover svg {
  transform: scale(1.1) rotate(-2deg);
}
.gf-fab:active svg { transform: scale(0.92); transition-duration: 0.06s; }

/* Loading */
.gf-fab.gf-loading {
  cursor: wait; animation: none;
  border-color: var(--gf-cyan);
}
.gf-spinner {
  width: 20px; height: 20px;
  border: 2.5px solid rgba(var(--gf-cyan-rgb), 0.15);
  border-radius: 50%; border-top-color: var(--gf-cyan);
  animation: gfSpin 0.6s cubic-bezier(0.4,0,0.2,1) infinite;
  position: relative; z-index: 3;
}
@keyframes gfSpin { to { transform: rotate(360deg); } }

/* Success — Neon mint check (outline style) */
.gf-fab.gf-success {
  animation: none;
  border-color: var(--gf-mint);
  background: var(--xxx-lime-200);
}
.gf-success-check {
  animation: gfCheckPop 0.4s var(--ease-spring);
  position: relative; z-index: 3;
}
/* SVG is now stroked — remove fill overrides so fill="none" is respected */
.gf-success-check circle {
  fill: none;
  stroke: var(--gf-mint);
}
.gf-success-check path {
  stroke: var(--gf-mint);
}
@keyframes gfCheckPop {
  0%   { transform: scale(0) rotate(-60deg); opacity: 0; }
  50%  { transform: scale(1.2) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}

/* Error — Red shake */
.gf-fab.gf-error {
  animation: gfShake 0.4s ease;
  border-color: var(--gf-coral);
  background: var(--xxx-red-300);
}
@keyframes gfShake {
  0%,100% { transform: translateX(0); }
  15%  { transform: translateX(-5px); }
  30%  { transform: translateX(4px); }
  45%  { transform: translateX(-3px); }
  60%  { transform: translateX(2px); }
  75%  { transform: translateX(-1px); }
}

/* Badge — Neon Yellow with Ink Border */
.gf-badge {
  position: absolute; top: -6px; right: -6px;
  min-width: 18px; height: 18px; border-radius: 50%;
  background: var(--gf-yellow); /* Memphis Yellow */
  color: var(--gf-ink); 
  font-size: 10px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--gf-ink); z-index: 10; padding: 0 3px;
  box-shadow: 2px 2px 0 var(--gf-ink);
  animation: gfBadgePop 0.3s var(--ease-spring);
}
@keyframes gfBadgePop {
  0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
  60%  { transform: scale(1.15) rotate(5deg); }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

.gf-badge.gf-badge-otp-ready {
  background: var(--gf-magenta);
  color: white;
  animation: gfBadgePulse 2s ease-in-out infinite;
}

@keyframes gfBadgePulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}

/* OTP Waiting Indicator — Neon magenta pulse */
.gf-otp-waiting-indicator {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--gf-magenta);
  opacity: 0;
  transform: scale(0);
  transition: opacity 0.4s ease, transform 0.4s var(--ease-spring);
  pointer-events: none;
  z-index: 10;
}

.gf-otp-waiting-indicator.gf-otp-waiting-visible {
  opacity: 1;
  transform: scale(1);
  animation: gfOTPWaitingPulse 1.5s ease-in-out infinite;
}

.gf-otp-waiting-indicator::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid var(--gf-magenta);
  opacity: 0;
  animation: gfOTPWaitingRing 1.5s ease-out infinite;
}

@keyframes gfOTPWaitingPulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 1; }
}

@keyframes gfOTPWaitingRing {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* Tooltip — Solid Dark, Neon Accent */
.gf-tooltip {
  position: absolute; bottom: calc(100% + 12px); left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 8px 14px;
  background: var(--gf-bg);
  color: var(--gf-cream); 
  font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  border-radius: 6px; white-space: nowrap; pointer-events: none;
  border: 2px solid var(--gf-ink);
  box-shadow: 3px 3px 0 var(--gf-ink);
  opacity: 0; transition: all 0.2s var(--ease-out-expo);
  z-index: 1001;
}
.gf-tooltip::after {
  content: ''; position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 6px solid transparent; border-top-color: var(--gf-ink);
}
.gf-tooltip-visible { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Menu — Solid surface, neon top accent bar */
.gf-menu {
  position: absolute; top: calc(100% + 10px); right: 0;
  min-width: 254px;
  background: var(--gf-card);
  border-radius: 8px;
  border: 2.5px solid var(--gf-ink);
  box-shadow: var(--panel-shadow);
  padding: 6px; z-index: 999; overflow: hidden;
  opacity: 0; visibility: hidden;
  transform: translateY(-6px) scale(0.96);
  transform-origin: top right;
  transition:
    opacity 0.25s var(--ease-out-expo), visibility 0.25s var(--ease-out-expo),
    transform 0.3s var(--ease-spring);
}
/* Neon top accent bar */
.gf-menu::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5px;
  background: linear-gradient(90deg, var(--gf-magenta) 0%, var(--gf-yellow) 36%, var(--gf-cyan) 70%, var(--gf-violet) 100%);
  border-bottom: 2px solid var(--gf-ink);
  border-radius: 0; z-index: 3;
}
.gf-menu::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(90deg, rgba(var(--gf-ink-rgb), 0.035) 1px, transparent 1px),
    linear-gradient(rgba(var(--gf-ink-rgb), 0.035) 1px, transparent 1px);
  background-size: 10px 10px;
  pointer-events: none;
  z-index: 1;
}
.gf-menu-open {
  opacity: 1; visibility: visible;
  transform: translateY(0) scale(1);
  animation: gfMenuSpring 0.35s var(--ease-spring);
}

@keyframes gfMenuSpring {
  0% { transform: translateY(-10px) scale(0.92); opacity: 0; }
  60% { transform: translateY(2px) scale(1.01); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}

.gf-menu-item {
  display: flex; align-items: center; gap: 11px;
  padding: 9px 11px; width: 100%;
  cursor: pointer; border-radius: 5px; border: 2px solid transparent; background: transparent;
  font: inherit; font-size: 12.5px; font-weight: 800; letter-spacing: 0;
  color: var(--text); text-align: left; outline: none;
  position: relative; z-index: 2;
  transition: background 0.15s var(--ease-smooth), transform 0.15s var(--ease-out-expo);
  transform-origin: center center;
}
.gf-menu-item:hover, .gf-menu-item:focus-visible {
  background: var(--gf-surface);
  border-color: var(--gf-ink);
  transform: translate(-2px, -2px);
  box-shadow: 3px 3px 0 var(--gf-ink);
  color: var(--gf-ink);
}
.gf-menu-item:active {
  transform: translate(2px, 2px);
  box-shadow: none;
  background: rgba(var(--gf-yellow-rgb), 0.28); transition-duration: 0.05s;
}
.gf-menu-item:focus-visible { outline: 2px solid var(--gf-cyan); outline-offset: -2px; }

.gf-menu-icon {
  flex-shrink: 0; width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 5px;
  background: var(--gf-sunken);
  border: 1.5px solid var(--gf-ink);
  box-shadow: 2px 2px 0 var(--gf-ink);
  transition: transform 0.15s var(--ease-spring), background 0.15s ease;
}
.gf-menu-symbol {
  width: 22px;
  height: 22px;
  display: block;
}
.gf-menu-item:hover .gf-menu-icon {
  background: var(--gf-card-elevated);
  transform: rotate(-2deg);
}
.gf-menu-label {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.gf-menu-shortcut {
  font-size: 10px; color: var(--text-tertiary); font-weight: 600;
  letter-spacing: 0; opacity: 0.85;
  display: inline-flex; align-items: center;
  padding: 2px 5px; background: var(--gf-bg);
  border-radius: 3px; border: 1px solid var(--gf-ink);
  transition: opacity 0.15s ease;
}
.gf-menu-item:hover .gf-menu-shortcut { opacity: 1; }

.gf-menu-divider {
  height: 2px; margin: 5px 10px;
  background: var(--gf-ink);
  position: relative; z-index: 2;
}

/* Staggered entry */
.gf-menu-open .gf-menu-item { animation: gfMIE 0.3s var(--ease-out-expo) both; }
.gf-menu-open .gf-menu-item:nth-child(1) { animation-delay: 0.02s; }
.gf-menu-open .gf-menu-item:nth-child(2) { animation-delay: 0.04s; }
.gf-menu-open .gf-menu-item:nth-child(3) { animation-delay: 0.06s; }
.gf-menu-open .gf-menu-item:nth-child(4) { animation-delay: 0.08s; }
.gf-menu-open .gf-menu-item:nth-child(5) { animation-delay: 0.10s; }
.gf-menu-open .gf-menu-item:nth-child(6) { animation-delay: 0.12s; }
.gf-menu-open .gf-menu-item:nth-child(7) { animation-delay: 0.14s; }
.gf-menu-open .gf-menu-item:nth-child(8) { animation-delay: 0.16s; }
@keyframes gfMIE {
  from { opacity: 0; transform: translateX(-5px) translateY(3px); }
  to   { opacity: 1; transform: translateX(0) translateY(0); }
}
.gf-menu-open .gf-menu-divider { animation: gfDF 0.35s var(--ease-out-expo) 0.08s both; }
@keyframes gfDF {
  from { opacity: 0; transform: scaleX(0.3); }
  to   { opacity: 1; transform: scaleX(1); }
}

/* ── Sentinel Toast ── */
.gf-sentinel-toast {
  position: fixed;
  z-index: 2147483645;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-10px) scale(0.95);
  transition: opacity 0.3s var(--ease-out-expo), transform 0.3s var(--ease-spring);
  will-change: opacity, transform;
}

.gf-sentinel-toast-visible {
  opacity: 1;
  transform: translateX(0) scale(1);
  pointer-events: auto;
}

.gf-sentinel-toast-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--gf-card);
  border: 2px solid var(--gf-ink);
  border-radius: 8px;
  box-shadow: var(--shadow-hover);
  white-space: nowrap;
}

.gf-sentinel-toast-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.gf-sentinel-toast-icon svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 8px var(--gf-magenta));
  animation: gf-toast-icon-float 2s ease-in-out infinite;
}

@keyframes gf-toast-icon-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.gf-sentinel-toast-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gf-sentinel-toast-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--gf-cream);
  letter-spacing: 0;
}

.gf-sentinel-toast-subtitle {
  font-size: 11px;
  color: var(--gf-text-muted);
  transition: opacity 0.3s ease;
}

/* ── Reduced Motion — respect user OS preference ── */
@media (prefers-reduced-motion: reduce) {
  .gf-fab,
  .gf-fab *,
  .gf-menu,
  .gf-menu-item,
  .gf-tooltip {
    animation: none !important;
    transition: none !important;
  }
  .gf-spinner {
    animation: none !important;
    border-top-color: var(--gf-cyan);
  }
  .gf-badge.gf-badge-otp-ready,
  .gf-otp-waiting-indicator,
  .gf-otp-waiting-indicator::before {
    animation: none !important;
  }
  .gf-sentinel-toast-icon svg {
    animation: none !important;
  }
  /* Keep visibility transitions for menu open/close (accessibility needs it) */
  .gf-menu {
    transition: opacity 0.1s ease, visibility 0.1s ease !important;
  }
  .gf-fab svg circle[animate],
  .gf-fab svg path[animate],
  .gf-fab svg animate,
  .gf-fab svg animateTransform {
    animation: none !important;
    transform: none !important;
    opacity: 1 !important;
  }
}
`;
  }
}
