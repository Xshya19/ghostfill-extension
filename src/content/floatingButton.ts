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

import { PageAnalyzer, type PageAnalysis, type PageType } from '../intelligence/pageAnalyzer';
import {
  classifyField,
  getFieldTooltip,
  FieldType as ClassifierFieldType,
} from '../shared/fieldClassifier';
import { IconSystem, menuIcon, type MenuIconName as _MenuIconName } from '../shared/icons';
import { generateHostThemeStyles, resolveTheme, type ThemeMode } from '../shared/theme';
import {
  FieldType,
  GenerateEmailResponse,
  GeneratePasswordResponse,
  GetLastOTPResponse,
} from '../types';
import { DEFAULT_SETTINGS, STORAGE_KEYS } from '../types/storage.types';
import { getDeepActiveElement, TIMING } from '../utils/core';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { setHTML, clearHTML } from '../utils/sanitization.core';
import { AutoFiller } from './autoFiller';
import { SmartFabPresenter } from './fab';
import type { FabMode, FabPresence, PlacementResult, PageSignals } from './fab';
import fabStyles from './floatingButton.shadow.css';
import { FieldAnalyzer } from './formDetector';
import { glassIconMap } from './glassLensMap';
import { pageStatus } from './ui/pageStatus';

const log = createLogger('FloatingButton');

// ═══════════════════════════════════════════════════════════════
//  §0  C O N S T A N T S
// ═══════════════════════════════════════════════════════════════

/** Timing constants (milliseconds) */
const TIMING_MS = {
  TOOLTIP_SHOW_DELAY: 350,
  SUCCESS_DISPLAY: 1600,
  ERROR_DISPLAY: 5000,
  LONG_PRESS: 450,
  // Only used after focus leaves the field — never while the input is active
  AUTO_HIDE: (TIMING?.FLOATING_BUTTON_HIDE_MS as number | undefined) ?? 6000,
  FOCUS_DEBOUNCE: 40,
  RESIZE_DEBOUNCE: 80,
  FIELD_RESIZE_DEBOUNCE: 40,
  POSITION_DRIFT_THRESHOLD: 0.5,
  PAGE_TEXT_SCAN_LIMIT: 3000,
} as const;

/** Size presets — must match `.gf-fab` in floatingButton.shadow.css (44px normal) */
const BUTTON_SIZE_PX: Readonly<Record<ButtonSize, number>> = {
  mini: 32,
  normal: 44,
  expanded: 52,
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

export type ButtonMode = 'magic' | 'email' | 'password' | 'otp' | 'user' | 'form';

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
    darkMode?: ThemeMode;
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

function _escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
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

    // A trailing reveal button or password-manager control can be painted on
    // top of the input without contributing to its computed padding. Probe
    // the FAB footprint and dock outside the field when it overlaps a control.
    const probePoints = [
      [left + 4, top + buttonSize / 2],
      [left + buttonSize / 2, top + buttonSize / 2],
      [left + buttonSize - 4, top + buttonSize / 2],
    ];
    const overlapsControl = probePoints.some(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!);
      if (!hit || hit === field || hit.closest('#ghostfill-fab')) {
        return false;
      }
      return Boolean(
        hit.closest(
          'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
        )
      );
    });
    if (overlapsControl) {
      const rightCandidate = rect.right + m;
      const leftCandidate = rect.left - buttonSize - m;
      top = rect.top + (rect.height - buttonSize) / 2;
      if (rightCandidate + buttonSize <= vw - m) {
        left = rightCandidate;
        placement = 'outside-right';
      } else if (leftCandidate >= m) {
        left = leftCandidate;
        placement = 'outside-left';
      } else {
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
  private static readonly Z_CACHE_TTL_MS = 8000;

  static invalidateZCache(): void {
    this._cachedMaxZ = 0;
    this._cachedMaxZTs = 0;
  }

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
  static buildActions(analysis: PageAnalysis, currentMode: ButtonMode): MenuAction[] {
    const noop = async (): Promise<void> => {};

    const isIdentityCtx =
      currentMode === 'user' || analysis.hasNameFields || analysis.pageType === 'signup';

    const showOTP = currentMode === 'otp' || analysis.hasOTPField;

    const showEmail =
      analysis.hasEmailField || analysis.pageType === 'signup' || analysis.pageType === 'login';

    const showPassword =
      analysis.hasPasswordField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'password-reset';

    const actions: MenuAction[] = [
      {
        id: 'smart-fill',
        icon: menuIcon('spark'),
        label: 'Fill this form',
        visible: true,
        handler: noop,
      },
      {
        id: 'paste-otp',
        icon: menuIcon('key'),
        label: 'Fill verification code',
        visible: showOTP,
        handler: noop,
      },
      {
        id: 'generate-email',
        icon: menuIcon('mail'),
        label: 'Fill email address',
        visible: showEmail,
        handler: noop,
      },
      {
        id: 'generate-password',
        icon: menuIcon('lock'),
        label: 'Generate and fill password',
        visible: showPassword,
        handler: noop,
      },
      {
        id: 'fill-firstname',
        icon: menuIcon('user'),
        label: 'Fill first name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-lastname',
        icon: menuIcon('users'),
        label: 'Fill last name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-fullname',
        icon: menuIcon('edit'),
        label: 'Fill full name',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'fill-username',
        icon: menuIcon('mask'),
        label: 'Fill username',
        visible: isIdentityCtx,
        handler: noop,
      },
      {
        id: 'clear-fields',
        icon: menuIcon('clear'),
        label: 'Clear form fields…',
        visible: true,
        handler: noop,
      },
      {
        id: 'hide-here',
        icon: menuIcon('eye-off'),
        label: 'Hide on this site',
        visible: true,
        handler: noop,
      },
      { id: 'divider', icon: '', label: '', visible: true, handler: noop },
      {
        id: 'settings',
        icon: menuIcon('settings'),
        label: 'GhostFill settings',
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
//  Strokes: 1.5 primary | 0.8 detail (two-weight system)
//  All SVGs: xmlns present, role="presentation", aria-hidden="true"
// ═══════════════════════════════════════════════════════════════

// NOTE: IconSystem is imported from '../shared/icons' instead of defined here locally.

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
  private presence: FabPresence = 'active';
  private readonly size: ButtonSize = 'normal';
  private currentField: HTMLElement | null = null;
  private currentFieldRef: WeakRef<HTMLElement> | null = null;
  private currentFieldRect: DOMRect | null = null;
  private isEnabled = true;
  private themeMode: ThemeMode = DEFAULT_SETTINGS.darkMode;
  private settingsReadGeneration = 0;
  private hasOTPReady = false;
  private isWaitingForOTP = false;
  private pageAnalysis: PageAnalysis | null = null;
  private pageAnalysisHref = '';
  private destroyed = false;
  private primaryActionInFlight = false;
  private presenter: SmartFabPresenter | null = null;

  // ── Cache ────────────────────────────────────────────────
  private static readonly IDENTITY_CACHE_TTL_MS = 500;
  private identityCache: {
    response: any;
    ts: number;
  } | null = null;

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
    this.subscribeThemeChanges();

    this.presenter = new SmartFabPresenter({
      host: this.container!,
      size: BUTTON_SIZE_PX.normal,
      gateOptions: () => ({
        enabled: this.isEnabled,
        pageSignals: this.getCachedPageAnalysis(),
        classify: (el) => {
          const type = classifyField(el as HTMLInputElement);
          return type === 'generic' ? 'generic' : (type as FabMode);
        },
      }),
      onShow: (field, decision) => {
        this.setPresence(decision.presence); // 'quiet' → dot, 'active' → full FAB
        this.showNearField(field);
        this.setMode(decision.mode);
      },
      onPlace: (placement) => this.applyPlacement(placement),
      onHide: () => this.setState('hidden'),
      onDecision: (decision, field) => {
        log.debug('[fab-gate]', {
          presence: decision.presence,
          score: decision.score,
          reasons: decision.reasons,
          field,
        });
      },
    });

    this.setupEventListeners();
    log.debug('FloatingButton initialised');
    void this.loadSettingsAsync();
    void this.checkOTPAvailability();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    this.presenter?.destroy();
    this.presenter = null;

    this.cancelAllTimers();
    this.cancelAllAnimationFrames();
    this.hideOTPWaitingIndicator();

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
    this.currentField?.removeAttribute('data-ghostfill-fab-active');
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
    const generation = ++this.settingsReadGeneration;
    try {
      const resp = (await safeSendMessage({ action: 'GET_SETTINGS' })) as {
        settings?: { showFloatingButton: boolean; darkMode?: ThemeMode };
      } | null;
      if (this.destroyed || generation !== this.settingsReadGeneration) {
        return;
      }
      if (resp?.settings) {
        this.isEnabled = resp.settings.showFloatingButton;
        this.applyThemeMode(resp.settings.darkMode ?? DEFAULT_SETTINGS.darkMode);
        if (!this.isEnabled) {
          this.setState('hidden');
        }
        this.presenter?.reevaluate();
      }
    } catch {
      log.debug('Settings fetch failed — defaulting to enabled');
    }

    this.registerRuntimeListener();
  }

  private applyThemeMode(mode: ThemeMode): void {
    this.themeMode = mode;
    this.container?.setAttribute('data-theme', resolveTheme(mode));
  }

  private subscribeThemeChanges(): void {
    const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemThemeChange = () => {
      if (this.themeMode === 'system') {
        this.applyThemeMode('system');
      }
    };
    systemTheme?.addEventListener?.('change', onSystemThemeChange);
    this.cleanupFns.push(() => systemTheme?.removeEventListener?.('change', onSystemThemeChange));

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      const onSettingsChange = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
      ) => {
        if (areaName === 'local' && STORAGE_KEYS.SETTINGS in changes) {
          void this.loadSettingsAsync();
        }
      };
      chrome.storage.onChanged.addListener(onSettingsChange);
      this.cleanupFns.push(() => chrome.storage.onChanged.removeListener(onSettingsChange));
    }
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
        if (msg.settings.darkMode !== undefined) {
          this.applyThemeMode(msg.settings.darkMode);
        }
        if (!this.isEnabled) {
          this.setState('hidden');
        }
        this.presenter?.reevaluate();
      }
      if (msg.action === 'OTP_RECEIVED' && msg.otp) {
        this.hasOTPReady = true;
        this.isWaitingForOTP = false;
        this.hideOTPWaitingIndicator();
        this.applyModeChrome();
        if (this.isEnabled) {
          log.info('🚀 OTP received, triggering Auto-Fill Sentinel');
          void this.startAutoFillOTPSequence(msg.otp);
        }
      }

      if (msg.action === 'OTP_PAGE_DETECTED') {
        this.isWaitingForOTP = true;
        this.applyModeChrome();
      }

      if (msg.action === 'OTP_PAGE_LEFT') {
        this.isWaitingForOTP = false;
        this.applyModeChrome();
      }

      // Reset all session state when the user generates a new email address.
      // Clears OTP readiness, closes menu, and returns button to clean idle state.
      if (msg.action === 'RESET_STATE') {
        this.hasOTPReady = false;
        this.applyModeChrome();
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
      this.hasOTPReady = Boolean(resp?.success && resp.lastOTP?.code);
      this.applyModeChrome();
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
    this.button?.setAttribute('aria-busy', String(newState === 'loading'));
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
    this.cancelAllTimers();
    this.clearStatusTooltip();
    this.hideOTPWaitingIndicator();
    this.currentField?.removeAttribute('data-ghostfill-fab-active');
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
    this.hideTooltip();
    this.clearStatusTooltip();
    this.closeMenuSilent();
    if (!this.isCurrentFieldFocused()) {
      return;
    }
    this.ensureContainerAttached();
    this.container.style.setProperty('display', 'block', 'important');
    this.container.style.setProperty('visibility', 'visible', 'important');
    this.container.style.setProperty('pointer-events', 'auto', 'important');
    this.currentField?.setAttribute('data-ghostfill-fab-active', '');
    this.refreshZIndex();
    setHTML(this.button, IconSystem.get(this.mode));
    this.button.classList.remove('gf-loading', 'gf-success', 'gf-error');
    this.applyModeChrome();
    this.cancelHideTimer();
  }

  /** Match the glyph, label, and code readiness to the focused field. */
  private applyModeChrome(): void {
    if (!this.button) {
      return;
    }
    this.button.classList.remove(
      'gf-mode-otp',
      'gf-mode-email',
      'gf-mode-password',
      'gf-mode-user',
      'gf-otp-armed'
    );
    if (this.mode === 'otp') {
      this.button.classList.add('gf-mode-otp');
    } else if (this.mode === 'email') {
      this.button.classList.add('gf-mode-email');
    } else if (this.mode === 'password') {
      this.button.classList.add('gf-mode-password');
    } else if (this.mode === 'user') {
      this.button.classList.add('gf-mode-user');
    }

    const isOTPField = this.mode === 'otp';
    if (isOTPField && (this.hasOTPReady || this.isWaitingForOTP)) {
      this.button.classList.add('gf-otp-armed');
    }
    const readiness = !isOTPField
      ? ''
      : this.hasOTPReady
        ? ' · OTP ready'
        : this.isWaitingForOTP
          ? ' · waiting for code'
          : '';
    this.button.setAttribute(
      'aria-label',
      `${this.getActionLabel()}${readiness} · Press Arrow Down for actions`
    );
    if (isOTPField && this.isWaitingForOTP && this.state !== 'hidden') {
      this.showOTPWaitingIndicator();
    } else {
      this.hideOTPWaitingIndicator();
    }
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
    if (this.isCurrentFieldFocused()) {
      this.ensureContainerAttached();
      this.container?.style.setProperty('display', 'block', 'important');
      this.container?.style.setProperty('visibility', 'visible', 'important');
    }
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-success');
    setHTML(this.button, IconSystem.getSuccess());

    if (pageStatus.getIsVisible()) {
      this.hideTooltip();
    } else if (message && this.tooltip) {
      this.showStatusTooltip(message, 'var(--success)');
    } else {
      this.hideTooltip();
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      // Keep FAB visible if the user is still in the form field
      if (this.isCurrentFieldFocused()) {
        this.setState('idle');
      } else {
        this.setState('hidden');
      }
    }, TIMING_MS.SUCCESS_DISPLAY);
  }

  private applyError(message?: string): void {
    if (!this.button) {
      return;
    }
    if (this.isCurrentFieldFocused()) {
      this.ensureContainerAttached();
      this.container?.style.setProperty('display', 'block', 'important');
      this.container?.style.setProperty('visibility', 'visible', 'important');
    }
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-error');
    setHTML(this.button, IconSystem.getError());

    if (this.tooltip && !pageStatus.getIsVisible()) {
      this.showStatusTooltip(message ?? 'Action failed', 'var(--error)', 'alert');
    } else {
      this.hideTooltip();
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      if (this.isCurrentFieldFocused()) {
        this.setState('idle');
      } else {
        this.setState('hidden');
      }
    }, TIMING_MS.ERROR_DISPLAY);
  }

  private applyMenuOpen(): void {
    this.cancelAllTimers();
    this.ensureContainerAttached();
    this.container?.style.setProperty('display', 'block', 'important');
    this.container?.style.setProperty('visibility', 'visible', 'important');
    this.openMenuInternal();
    this.button?.setAttribute('aria-expanded', 'true');
    this.hideTooltip();
  }

  /** Host.contains() is false for closed-shadow descendants — check both. */
  private isEventInsideFab(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Node)) {
      return false;
    }
    if (this.container === target || this.container?.contains(target)) {
      return true;
    }
    try {
      return Boolean(this.shadowRoot?.contains(target));
    } catch {
      return false;
    }
  }

  private isCurrentFieldFocused(): boolean {
    const field = this.currentFieldRef?.deref() ?? this.currentField;
    if (!field || !field.isConnected) {
      return false;
    }
    const active = getDeepActiveElement();
    if (!active) {
      return false;
    }
    return active === field || field.contains(active);
  }

  private ensureContainerAttached(): void {
    if (this.container && !this.container.isConnected) {
      const target = document.documentElement ?? document.body;
      if (target) {
        target.appendChild(this.container);
      }
    }
  }

  private refreshZIndex(): void {
    if (!this.container) {
      return;
    }
    this.container.style.setProperty(
      'z-index',
      SmartPositioner.getMaxZIndex().toString(),
      'important'
    );
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.4  D O M   C R E A T I O N
  // ═══════════════════════════════════════════════════════════

  private createContainer(): void {
    // Remove any stale instance
    document.getElementById('ghostfill-fab')?.remove();

    this.container = document.createElement('div');
    this.container.id = 'ghostfill-fab';
    this.container.setAttribute('data-theme', resolveTheme(this.themeMode));
    const zIndex = SmartPositioner.getMaxZIndex();
    this.container.style.cssText = `position:fixed;z-index:${zIndex};display:none;pointer-events:auto;`;

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    // Keep the SDF lens definition inside this closed shadow root. A data URI
    // avoids extra extension resource exposure and lets strict host CSPs fall
    // back to the ordinary frosted material below when images are blocked.
    const svgNs = 'http://www.w3.org/2000/svg';
    const optics = document.createElementNS(svgNs, 'svg');
    optics.setAttribute('aria-hidden', 'true');
    optics.setAttribute('width', '0');
    optics.setAttribute('height', '0');
    optics.style.cssText = 'position:absolute;pointer-events:none;overflow:hidden';
    const filter = document.createElementNS(svgNs, 'filter');
    filter.setAttribute('id', 'gf-fab-optic');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const map = document.createElementNS(svgNs, 'feImage');
    map.setAttribute('href', glassIconMap);
    map.setAttribute('preserveAspectRatio', 'none');
    map.setAttribute('width', '100%');
    map.setAttribute('height', '100%');
    map.setAttribute('result', 'shape');
    const displacement = document.createElementNS(svgNs, 'feDisplacementMap');
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'shape');
    displacement.setAttribute('scale', '-14');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');
    filter.append(map, displacement);
    optics.appendChild(filter);
    this.shadowRoot.appendChild(optics);

    // ── Button ────────────────────────────────────────────
    this.button = document.createElement('button');
    this.button.className = 'gf-fab';
    setHTML(this.button, IconSystem.get('magic'));
    this.button.setAttribute(
      'aria-label',
      'GhostFill — Auto-fill this form. Press Arrow Down for actions.'
    );
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.shadowRoot.appendChild(this.button);

    const lensImage = new Image();
    const opticalButton = this.button;
    lensImage.addEventListener('load', () => opticalButton.classList.add('gf-refractive'), {
      once: true,
    });
    lensImage.src = glassIconMap;

    // ── Tooltip ───────────────────────────────────────────
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'gf-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.setAttribute('id', 'gf-tooltip');
    this.shadowRoot.appendChild(this.tooltip);

    // ── Menu ──────────────────────────────────────────────
    this.menu = document.createElement('div');
    this.menu.className = 'gf-menu';
    this.menu.id = 'gf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'GhostFill actions');
    this.shadowRoot.appendChild(this.menu);

    // Link button to tooltip for screen readers
    this.button.setAttribute('aria-describedby', 'gf-tooltip');
    this.button.setAttribute('aria-keyshortcuts', 'ArrowDown');
    this.button.setAttribute('aria-controls', this.menu.id);

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
    // mousedown: keep focus from leaving the input before click (prevents hide race)
    this.button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.cancelHideTimer();
    });

    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cancelHideTimer();
      if (this.state === 'loading' || this.destroyed) {
        return;
      }

      // Intelligence 2.0: Trigger Intelligence Pulse on click
      const rect = this.button!.getBoundingClientRect();
      this.fieldAnalyzer.setAttentiveRegion(rect.left + rect.width / 2, rect.top + rect.height / 2);

      if (this.state === 'menu-open') {
        this.setState('idle');
        return;
      }
      void this.handlePrimaryAction().catch((err) => {
        log.error('Unexpected error in primary action', err);
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
    let touchStartX = 0;
    let touchStartY = 0;
    let longPressFired = false;

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
        const touch = e.touches[0];
        if (!touch || e.touches.length !== 1) {
          return;
        }
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        longPressFired = false;
        longPressTimer = setTimeout(() => {
          if (this.destroyed) {
            return;
          }
          longPressFired = true;
          this.setState('menu-open');
          longPressTimer = null;
        }, TIMING_MS.LONG_PRESS);
      },
      { passive: false }
    );
    this.button.addEventListener(
      'touchend',
      (e) => {
        if (longPressFired) {
          e.preventDefault();
        }
        longPressFired = false;
        clearLongPress();
      },
      { passive: false }
    );
    this.button.addEventListener(
      'touchmove',
      (e) => {
        const touch = e.touches[0];
        if (!touch || Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY) > 8) {
          clearLongPress();
        }
      },
      { passive: true }
    );
    this.button.addEventListener('touchcancel', clearLongPress);
    this.cleanupFns.push(clearLongPress);

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
    });
    this.button.addEventListener('focus', () => {
      if (this.button?.matches(':focus-visible')) {
        this.showTooltip(true);
      }
    });
    this.button.addEventListener('blur', () => this.hideTooltip());

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
    if (this.destroyed || this.primaryActionInFlight) {
      return;
    }
    this.primaryActionInFlight = true;
    this.setState('loading');

    try {
      if (this.mode === 'email' && this.currentField instanceof HTMLInputElement) {
        // Fill ACTIVE popup tab email. Disposable is only generated if Temp Mail tab is active.
        pageStatus.show('Injecting email…', 'loading');
        await this.actionFillActiveEmail({ allowGenerateDisposable: true });
        return;
      }

      if (this.mode === 'password' && this.currentField instanceof HTMLInputElement) {
        pageStatus.show('Injecting secure password…', 'loading');
        await this.actionGeneratePassword();
        return;
      }

      // The FAB acts on its focused field. A saved code or page-level wording
      // must not turn an email/password button into an OTP button.
      if (this.mode === 'otp') {
        pageStatus.show('Filling verification code…', 'loading');
        await this.actionPasteOTP();
        return;
      }

      if (this.mode === 'user' && this.currentField instanceof HTMLInputElement) {
        const { fieldType, confidence } = this.fieldAnalyzer.analyzeField(this.currentField);
        const action =
          fieldType === 'first-name'
            ? 'fill-firstname'
            : fieldType === 'last-name'
              ? 'fill-lastname'
              : fieldType === 'full-name'
                ? 'fill-fullname'
                : null;
        if (action && confidence >= 0.45) {
          await this.actionFillIdentity(action);
          return;
        }
      }

      pageStatus.show('Analyzing form…', 'loading');
      const result = await this.autoFiller.smartFill();

      if (this.destroyed) {
        return;
      }

      if (result.success && result.filledCount > 0) {
        this.presenter?.noteAccept();
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
        // Never fail silently — user clicked expecting action
        const msg =
          result.message && result.message !== 'No fields found'
            ? result.message
            : 'Could not fill fields. Open GhostFill popup to generate email/password, then try again.';
        pageStatus.error(msg, 4000);
        this.setState('idle');
        log.debug('No fields filled', { message: result.message });
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
    } finally {
      this.primaryActionInFlight = false;
    }
  }

  // ── Auto-Fill Sentinel Sequence ───────────────────────

  public async startAutoFillOTPSequence(otp: string): Promise<void> {
    if (this.destroyed || !this.isEnabled) {
      return;
    }
    pageStatus.show('Filling verification code…');
    try {
      const filled = await this.autoFiller.fillOTP(otp);
      if (this.destroyed) {
        return;
      }
      if (filled) {
        this.presenter?.noteAccept();
        this.setState('success');
        pageStatus.success('Verification code filled');
      } else {
        this.setState('idle');
        pageStatus.error('No verification code field found. Select the field and try again.');
      }
    } catch (err) {
      log.error('OTP fill failed', err);
      this.setState('idle');
      pageStatus.error('Could not fill the code. Select the verification field and try again.');
    }
  }
  private openMenuInternal(): void {
    if (!this.menu || !this.shadowRoot || this.destroyed) {
      return;
    }

    const analysis = this.getPageAnalysis();
    const actions = ContextualMenu.buildActions(analysis, this.mode);

    setHTML(
      this.menu,
      actions
        .map((a) => {
          if (a.id === 'divider') {
            return '<div class="gf-menu-divider" role="separator"></div>';
          }
          // a.icon is a trusted bundled SVG; dynamic labels and shortcuts stay escaped.
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
          if (this.menu.getAttribute('role') === 'dialog') {
            const nextIndex = e.shiftKey
              ? idx <= 0
                ? items.length - 1
                : idx - 1
              : idx >= items.length - 1
                ? 0
                : idx + 1;
            items[nextIndex]?.focus();
          } else {
            this.setState('idle');
            this.button?.focus();
          }
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
      this.menu.setAttribute('role', 'menu');
      this.menu.setAttribute('aria-label', 'GhostFill actions');
      this.menu.removeAttribute('aria-labelledby');
      this.menu.removeAttribute('aria-describedby');
      this.button?.setAttribute('aria-expanded', 'false');
      clearHTML(this.menu);
    }
  }

  private openClearFieldsConfirmation(): void {
    if (!this.menu) {
      return;
    }

    if (this.menuKeyboardHandler) {
      this.menu.removeEventListener('keydown', this.menuKeyboardHandler);
      this.menuKeyboardHandler = null;
    }

    this.menu.setAttribute('role', 'dialog');
    this.menu.removeAttribute('aria-label');
    this.menu.setAttribute('aria-labelledby', 'gf-clear-title');
    this.menu.setAttribute('aria-describedby', 'gf-clear-description');
    setHTML(
      this.menu,
      `<div class="gf-menu-confirmation">
        <strong id="gf-clear-title">Clear form fields?</strong>
        <p id="gf-clear-description">This removes values entered in this form.</p>
        <div class="gf-menu-confirmation-actions">
          <button class="gf-menu-item" data-action="cancel-clear-fields" type="button">Cancel</button>
          <button class="gf-menu-item gf-menu-item-danger" data-action="confirm-clear-fields" type="button">Clear fields</button>
        </div>
      </div>`
    );

    this.menu.querySelectorAll<HTMLButtonElement>('.gf-menu-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.handleMenuAction(item.dataset.action ?? '');
      });
    });

    this.setupMenuKeyboardNavigation();
    this.menu.querySelector<HTMLButtonElement>('[data-action="cancel-clear-fields"]')?.focus();
  }

  private async handleMenuAction(actionId: string): Promise<void> {
    if (this.destroyed) {
      return;
    }

    if (actionId === 'clear-fields') {
      this.openClearFieldsConfirmation();
      return;
    }

    if (actionId === 'cancel-clear-fields') {
      this.setState('idle');
      this.button?.focus();
      return;
    }

    this.closeMenuSilent();
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
          // Menu label may say "generate" but must still respect Gmail/Temp Mail tab
          await this.actionFillActiveEmail({ allowGenerateDisposable: true });
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

        case 'confirm-clear-fields':
          await this.autoFiller.clearForm();
          pageStatus.success('Form fields cleared', 1000);
          this.setState('idle');
          break;

        case 'hide-here':
          this.presenter?.muteHost();
          this.setState('hidden');
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
    // Do not consume a saved code while the user is still on the email/CAPTCHA
    // step. Require a current OTP field before reading the code or showing a
    // misleading "Filling" status.
    if (!PageAnalyzer.analyze().hasOTPField) {
      pageStatus.error(
        'Open the verification-code step before filling a code',
        TIMING_MS.ERROR_DISPLAY
      );
      this.setState('idle');
      return;
    }

    const resp = (await safeSendMessage({ action: 'GET_LAST_OTP' })) as GetLastOTPResponse | null;

    if (this.destroyed) {
      return;
    }

    if (resp?.success && resp.lastOTP?.code) {
      const code = resp.lastOTP.code;
      const isSuspicious = /^(\d)\1{3,}$/.test(code.replace(/[-\s]/g, ''));

      if (isSuspicious) {
        pageStatus.error(
          'Verification code looks invalid (repeated digits)',
          TIMING_MS.ERROR_DISPLAY
        );
        this.setState('error', 'Verification code looks invalid');
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
        this.presenter?.noteAccept();
        pageStatus.success('Verification code filled', TIMING_MS.SUCCESS_DISPLAY);
        this.setState('success', 'Verification code filled');
        safeSendMessage({ action: 'MARK_OTP_USED', payload: { code } }).catch((err) => {
          log.warn('Failed to mark OTP as used', err);
        });
      } else {
        pageStatus.error('No verification code field found', TIMING_MS.ERROR_DISPLAY);
        this.setState('error', 'No verification code field found');
      }
    } else {
      const message =
        resp?.error === 'Still waiting for new email...'
          ? 'Waiting for a new code'
          : resp?.error === 'Saved code belongs to a different site'
            ? 'Code found — review the email in GhostFill before using it here'
            : !resp || !resp.success
              ? 'Could not check your code — try again'
              : 'No code yet — check your inbox';
      log.info('Code fill unavailable', { reason: resp?.error || message });
      pageStatus.info(message, TIMING_MS.ERROR_DISPLAY);
      this.setState('idle');
    }
  }

  /**
   * Fill the email field with whatever the popup tab has selected:
   * - Gmail tab → Gmail alias / base (never generate disposable)
   * - Temp Mail tab → existing disposable, or generate one if allowed
   */
  private async fetchIdentityCached(): Promise<any> {
    if (
      this.identityCache &&
      Date.now() - this.identityCache.ts < FloatingButton.IDENTITY_CACHE_TTL_MS
    ) {
      return this.identityCache.response;
    }
    const resp = await safeSendMessage({ action: 'GET_IDENTITY' });
    this.identityCache = { response: resp, ts: Date.now() };
    return resp;
  }

  private async actionFillActiveEmail(
    opts: { allowGenerateDisposable?: boolean } = {}
  ): Promise<void> {
    const { allowGenerateDisposable = false } = opts;

    const target = await this.autoFiller.resolveField('email', this.currentField);
    if (this.destroyed) {
      return;
    }
    if (!target) {
      pageStatus.info('Select an email field to fill', TIMING_MS.ERROR_DISPLAY);
      this.setState('idle');
      return;
    }

    // 1) Resolve identity for the active popup tab (GET_IDENTITY is tab-aware)
    const idResp = (await this.fetchIdentityCached()) as {
      success?: boolean;
      identity?: { email?: string; preferredEmailType?: 'disposable' | 'gmail' };
      preferredEmailType?: 'disposable' | 'gmail';
      error?: string;
    } | null;

    if (this.destroyed) {
      return;
    }

    const preferred =
      idResp?.preferredEmailType || idResp?.identity?.preferredEmailType || 'disposable';
    let email = idResp?.identity?.email?.trim() || '';

    // 2) Only generate a NEW disposable when Temp Mail tab is active and empty
    if (!email && preferred === 'disposable' && allowGenerateDisposable) {
      const gen = (await safeSendMessage({
        action: 'GENERATE_EMAIL',
        payload: { originUrl: window.location.origin },
      })) as GenerateEmailResponse | null;
      if (this.destroyed) {
        return;
      }
      if (gen?.success && gen.email?.fullEmail) {
        email = gen.email.fullEmail;
      } else {
        const msg =
          gen && 'error' in gen && typeof gen.error === 'string'
            ? gen.error
            : 'Failed to generate email';
        pageStatus.error(msg, TIMING_MS.ERROR_DISPLAY);
        this.setState('error', msg);
        return;
      }
    }

    if (!email && preferred === 'gmail') {
      pageStatus.error('Gmail tab active — connect Gmail in popup first', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'Connect Gmail first');
      return;
    }

    if (!email && preferred === 'disposable') {
      pageStatus.error('No temp mail — open popup and generate one', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'No temp mail');
      return;
    }

    if (!email) {
      pageStatus.error('No email available', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'No email available');
      return;
    }

    // Block accidental disposable fill while Gmail tab is selected
    if (preferred === 'gmail' && email && !/@(gmail|googlemail)\.com$/i.test(email)) {
      log.warn('Blocked non-Gmail address while Gmail tab active', { email });
      pageStatus.error('Gmail tab active but got non-Gmail address', TIMING_MS.ERROR_DISPLAY);
      this.setState('error', 'Wrong email type');
      return;
    }

    const filled = await this.autoFiller.fillFieldIntoTarget('email', email, target.element);

    if (this.destroyed) {
      return;
    }

    if (filled) {
      this.presenter?.noteAccept();
      const tag = preferred === 'gmail' ? 'Gmail' : 'Temp Mail';
      pageStatus.success(`${tag} filled!`, TIMING_MS.SUCCESS_DISPLAY);
      this.setState('success', `${tag} filled!`);
      log.info('FAB filled email for active tab', { preferred, email });
    } else {
      const message = 'Could not fill the email. Select the email field and try again.';
      pageStatus.error(message, TIMING_MS.ERROR_DISPLAY);
      this.setState('error', message);
    }
  }

  private async actionGeneratePassword(): Promise<void> {
    const resp = (await safeSendMessage({
      action: 'GENERATE_PASSWORD',
    })) as GeneratePasswordResponse | null;

    if (this.destroyed) {
      return;
    }

    if (resp?.result?.password) {
      const filled = await this.autoFiller.fillFieldIntoTarget(
        'password',
        resp.result.password,
        this.currentField
      );
      if (this.destroyed) {
        return;
      }

      if (filled) {
        this.presenter?.noteAccept();
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
    const resp = (await this.fetchIdentityCached()) as IdentityResponse | null;

    if (this.destroyed) {
      return;
    }

    if (!resp?.success || !resp.identity) {
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
      let resolvedType: FieldType = 'unknown';
      if (actionId === 'fill-firstname') {
        resolvedType = 'first-name';
      } else if (actionId === 'fill-lastname') {
        resolvedType = 'last-name';
      } else if (actionId === 'fill-fullname') {
        resolvedType = 'full-name';
      } else if (actionId === 'fill-username') {
        resolvedType = 'username';
      }

      const filled = await this.autoFiller.fillFieldIntoTarget(
        resolvedType,
        value,
        this.currentField
      );
      if (this.destroyed) {
        return;
      }

      if (filled) {
        this.presenter?.noteAccept();
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

  private getActionLabel(): string {
    if (this.mode === 'user' && this.currentField instanceof HTMLInputElement) {
      const { fieldType } = this.fieldAnalyzer.analyzeField(this.currentField);
      const labels: Partial<Record<FieldType, string>> = {
        'first-name': 'Fill first name',
        'last-name': 'Fill last name',
        'full-name': 'Fill full name',
        username: 'Fill username',
      };
      if (labels[fieldType]) {
        return labels[fieldType]!;
      }
    }
    const type = this.mode === 'magic' ? 'generic' : (this.mode as ClassifierFieldType);
    return getFieldTooltip(type);
  }

  private showTooltip(immediate = false): void {
    this.hideTooltip();
    if (!this.tooltip || (this.state !== 'idle' && this.state !== 'hovering')) {
      return;
    }
    this.tooltip.textContent = this.getActionLabel();
    const reveal = (): void => {
      this.tooltipTimeout = null;
      if (
        !this.destroyed &&
        (this.state === 'hovering' || this.button?.matches(':focus-visible'))
      ) {
        this.positionTooltip();
        this.tooltip?.classList.add('gf-tooltip-visible');
      }
    };
    if (immediate) {
      reveal();
    } else {
      this.tooltipTimeout = setTimeout(reveal, TIMING_MS.TOOLTIP_SHOW_DELAY);
    }
  }

  private positionTooltip(): void {
    if (!this.tooltip) {
      return;
    }
    this.tooltip.style.setProperty('--gf-tooltip-shift', '0px');
    this.tooltip.style.top = '';
    this.tooltip.style.bottom = '';
    const rect = this.tooltip.getBoundingClientRect();
    const shift = Math.max(8 - rect.left, Math.min(0, window.innerWidth - 8 - rect.right));
    this.tooltip.style.setProperty('--gf-tooltip-shift', `${shift}px`);
    if (rect.top < 8) {
      this.tooltip.style.top = 'calc(100% + 12px)';
      this.tooltip.style.bottom = 'auto';
    }
  }

  private hideTooltip(): void {
    if (this.tooltipTimeout !== null) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    this.tooltip?.classList.remove('gf-tooltip-visible');
  }

  private showStatusTooltip(
    text: string,
    accentColor: string,
    role: 'status' | 'alert' = 'status'
  ): void {
    this.hideTooltip();
    if (!this.tooltip) {
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.setAttribute('role', role);
    this.tooltip.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
    this.tooltip.setAttribute('aria-atomic', 'true');
    this.tooltip.style.borderColor = accentColor;
    this.positionTooltip();
    this.tooltip.classList.add('gf-tooltip-visible');
  }

  private clearStatusTooltip(): void {
    if (!this.tooltip) {
      return;
    }
    this.tooltip.classList.remove('gf-tooltip-visible');
    this.tooltip.setAttribute('role', 'tooltip');
    this.tooltip.removeAttribute('aria-live');
    this.tooltip.removeAttribute('aria-atomic');
    this.tooltip.style.borderColor = '';
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
      this.otpWaitingIndicator.remove();
      this.otpWaitingIndicator = null;
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
    // ── Click Outside → Close Menu ────────────────────────
    const onDocClick = (e: MouseEvent): void => {
      if (this.state !== 'menu-open') {
        return;
      }
      const path = e.composedPath?.() ?? [];
      if (path.some((el) => el === this.container || el === this.menu || el === this.button)) {
        return;
      }
      if (this.isEventInsideFab(e.target)) {
        return;
      }
      this.setState('idle');
    };
    document.addEventListener('click', onDocClick, true);
    this.cleanupFns.push(() => document.removeEventListener('click', onDocClick, true));

    const dismissTooltip = (): void => this.hideTooltip();
    window.addEventListener('scroll', dismissTooltip, { passive: true, capture: true });
    window.addEventListener('resize', dismissTooltip);
    this.cleanupFns.push(() => {
      window.removeEventListener('scroll', dismissTooltip, true);
      window.removeEventListener('resize', dismissTooltip);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.15  S H A D O W - D O M   S T Y L E S
  // ═══════════════════════════════════════════════════════════

  private getStyles(): string {
    return `${generateHostThemeStyles()}
${fabStyles}`;
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.12  P O S I T I O N I N G
  // ═══════════════════════════════════════════════════════════

  private setPresence(presence: FabPresence): void {
    this.presence = presence;
    if (!this.button) {
      return;
    }
    if (presence === 'quiet') {
      this.button.classList.add('gf-quiet');
    } else {
      this.button.classList.remove('gf-quiet');
    }
  }

  private setMode(mode: ButtonMode): void {
    this.mode = mode;
    if (
      this.button &&
      this.state !== 'loading' &&
      this.state !== 'success' &&
      this.state !== 'error'
    ) {
      setHTML(this.button, IconSystem.get(this.mode));
    }
    this.applyModeChrome();
  }

  private applyPlacement(placement: PlacementResult): void {
    if (!this.container) {
      return;
    }
    this.container.style.left = `${placement.left}px`;
    this.container.style.top = `${placement.top}px`;
    this.container.style.zIndex = String(placement.zIndex);
    this.container.dataset.placement = placement.placement;
  }

  showNearField(field: HTMLElement): void {
    if (!this.isEnabled || this.destroyed) {
      return;
    }

    this.ensureContainerAttached();
    this.cancelHideTimer();

    if (this.currentField !== field) {
      this.currentField?.removeAttribute('data-ghostfill-fab-active');
    }
    this.currentField = field;
    this.currentFieldRef = new WeakRef(field);
    this.currentFieldRect = null;

    if (this.state === 'idle') {
      this.applyIdle();
    } else {
      this.setState('idle');
    }
  }

  private positionNearField(_field: HTMLElement): void {
    // Placement managed continuously by SmartFabPresenter & FabAnchor
    this.presenter?.reevaluate();
  }

  private followFieldOnScroll(): void {
    // Handled by FabAnchor
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.13  T I M E R S
  // ═══════════════════════════════════════════════════════════

  private scheduleAutoHide(): void {
    // Retired: SmartFabPresenter manages blur grace (180ms)
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
    if (!this.pageAnalysis || this.pageAnalysisHref !== location.href) {
      this.pageAnalysisHref = location.href;
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

  private getCachedPageAnalysis(): PageSignals {
    return this.getPageAnalysis();
  }

  private getPageType(): PageType {
    return this.getPageAnalysis().pageType;
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
}
