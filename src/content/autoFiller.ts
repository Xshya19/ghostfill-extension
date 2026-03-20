import type { IdentityProfile } from '../services/identityService';
import { DetectedField } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { FieldAnalyzer } from './fieldAnalyzer';
import { pageStatus } from './pageStatus';
import { PhantomTyper } from './phantomTyper';

const log = createLogger('AutoFiller');

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_OTP_LENGTH = 8;
const MIN_OTP_LENGTH = 4;
const MIN_SPLIT_FIELDS = 4;
const MAX_SPLIT_FIELDS = 8;
const SHADOW_ROOT_SCAN_INTERVAL_MS = 2000;
const SPLIT_DIGIT_INTER_CHAR_DELAY_MS = 80;
const SPLIT_DIGIT_FINAL_BLUR_DELAY_MS = 50;
const AUTO_SUBMIT_DETECTION_DELAY_MS = 1000;
const FIELD_WATCHER_DEFAULT_TIMEOUT_MS = 10_000;
const FIELD_WATCHER_POLL_INTERVAL_MS = 1000;
const FIELD_WATCHER_DEBOUNCE_MS = 300;
const DYNAMIC_WATCH_TIMEOUT_MS = 15000;
const SUBMIT_BUTTON_HIGHLIGHT_DURATION_MS = 3000;
const PAGE_TEXT_SCAN_LIMIT = 3000;
const TEXT_PROXIMITY_MAX_DEPTH = 5;
const SPLIT_GROUP_EXPAND_MAX_DEPTH = 4;
const SMART_FILL_RETRY_DELAYS_MS = [0, 500, 1200] as const;

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface GhostLabelElement extends HTMLElement {
  attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

interface OTPFieldGroup {
  fields: HTMLInputElement[];
  score: number;
  strategy: string;
  isSplit: boolean;
  expectedLength: number;
  signals: string[];
}

interface FillResult {
  success: boolean;
  filledCount: number;
  message: string;
  details: FillDetail[];
  timingMs: number;
}

interface FillDetail {
  fieldType: string;
  selector: string;
  strategy: string;
  success: boolean;
  reason?: string;
}

interface OTPFillOutcome {
  success: boolean;
  filledCount: number;
  strategy: string;
}

type FrameworkType = 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'vanilla' | 'unknown';

type FieldType =
  | 'email'
  | 'password'
  | 'confirm-password'
  | 'username'
  | 'first-name'
  | 'last-name'
  | 'full-name'
  | 'phone'
  | 'otp'
  | 'text'
  | 'unknown';

interface PageContext {
  readonly isVerificationPage: boolean;
  readonly isLoginPage: boolean;
  readonly isSignupPage: boolean;
  readonly isPasswordResetPage: boolean;
  readonly is2FAPage: boolean;
  readonly framework: FrameworkType;
  readonly hasOTPLanguage: boolean;
  readonly expectedOTPLength: number | null;
  readonly provider: string | null;
  readonly pageSignals: readonly string[];
}

type FormInputElement = HTMLInputElement | HTMLTextAreaElement;

interface IdentityWithCredentials extends IdentityProfile {
  email?: string;
  password?: string;
}

interface VueEnhancedDocument extends Document {
  __vue_app__?: unknown;
}

interface AngularEnhancedWindow extends Window {
  ng?: unknown;
}

interface SolidEnhancedWindow extends Window {
  _$HY?: unknown;
}

// ═══════════════════════════════════════════════════════════════
//  UTILITY: Defensive helpers
// ═══════════════════════════════════════════════════════════════

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function safeQuerySelector<T extends Element>(
  root: ParentNode,
  selector: string
): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

function safeQuerySelectorAll<T extends Element>(
  root: ParentNode,
  selector: string
): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

function escapeCSS(value: string): string {
  try {
    return CSS.escape(value);
  } catch {
    return value.replace(/([^\w-])/g, '\\$1');
  }
}

function combineStrings(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// ═══════════════════════════════════════════════════════════════
//  PAGE INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

class PageIntelligence {
  private static readonly PAGE_TYPE_PATTERNS: ReadonlyArray<{
    key: keyof Pick<
      PageContext,
      'isVerificationPage' | 'isLoginPage' | 'isSignupPage' | 'isPasswordResetPage' | 'is2FAPage'
    >;
    patterns: readonly RegExp[];
    signalName: string;
  }> = [
    {
      key: 'isVerificationPage',
      patterns: [
        /verify|verification|confirm[\s._-]*email|activate[\s._-]*account/i,
        /enter[\s._-]*(your\s+)?code|enter[\s._-]*otp|one[-_\s]?time/i,
        /self[-_\s]?service[\s._-]*verification/i,
        /check[\s._-]*inbox|code[\s._-]*sent|we[\s._-]*sent[\s._-]*code/i,
      ],
      signalName: 'page:verification',
    },
    {
      key: 'isLoginPage',
      patterns: [/sign\s*in|log\s*in|login|authenticate/i],
      signalName: 'page:login',
    },
    {
      key: 'isSignupPage',
      patterns: [/sign\s*up|register|create\s*account|get\s*started|join/i],
      signalName: 'page:signup',
    },
    {
      key: 'isPasswordResetPage',
      patterns: [/reset[\s._-]*password|forgot[\s._-]*password|recover[\s._-]*account|new[\s._-]*password/i],
      signalName: 'page:password-reset',
    },
    {
      key: 'is2FAPage',
      patterns: [
        /two[- ]?factor|2fa|multi[- ]?factor|mfa|authenticat[\w]*[\s._-]*code/i,
        /security[\s._-]*code|backup[\s._-]*code/i,
      ],
      signalName: 'page:2fa',
    },
  ] as const;

  private static readonly OTP_LANGUAGE_PATTERNS: readonly RegExp[] = [
    /otp|one[-_\s]?time|verification[-_\s]?code|security[-_\s]?code|pin[-_\s]?code/i,
    /\d[- ]?digit\s*code|enter\s*code|paste\s*code/i,
  ];

  private static readonly OTP_LENGTH_PATTERN = /(\d)[- ]?digit\s*(code|otp|pin|number)/i;

  private static readonly PROVIDER_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/clerk\.(dev|com)/i, 'Clerk'],
    [/auth0\.com/i, 'Auth0'],
    [/supabase/i, 'Supabase'],
    [/firebase/i, 'Firebase'],
    [/cognito|amazonaws/i, 'AWS Cognito'],
    [/okta\.com/i, 'Okta'],
    [/ory\.|kratos/i, 'Ory Kratos'],
    [/stytch\.com/i, 'Stytch'],
    [/workos\.com/i, 'WorkOS'],
    [/keycloak/i, 'Keycloak'],
    [/linear\.app/i, 'Linear'],
    [/notion\.so/i, 'Notion'],
    [/github\.com/i, 'GitHub'],
    [/gitlab\.com/i, 'GitLab'],
    [/slack\.com/i, 'Slack'],
    [/discord\.com/i, 'Discord'],
    [/vercel\.com/i, 'Vercel'],
    [/stripe\.com/i, 'Stripe'],
    [/mistral\.ai/i, 'Mistral'],
    [/aliyun\.com|alibaba/i, 'Alibaba'],
    [/microsoft\.com|login\.live/i, 'Microsoft'],
    [/google\.com[\w./]*accounts/i, 'Google'],
    [/apple\.com[\w./]*appleid/i, 'Apple'],
  ] as const;

  static analyze(): PageContext {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.textContent ?? '').slice(0, PAGE_TEXT_SCAN_LIMIT).toLowerCase();
    const metaContent = safeQuerySelectorAll<HTMLMetaElement>(document, 'meta')
      .map((m) => (m.getAttribute('content') ?? '').toLowerCase())
      .join(' ');

    const combinedText = `${url} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];

    // ── Page Type Detection ────────────────────────────────
    const pageTypes = {} as Record<string, boolean>;
    for (const { key, patterns, signalName } of this.PAGE_TYPE_PATTERNS) {
      pageTypes[key] = this.testSignals(combinedText, patterns, signals, signalName);
    }

    // ── OTP Language Detection ─────────────────────────────
    const hasOTPLanguage = this.testSignals(
      combinedText,
      this.OTP_LANGUAGE_PATTERNS,
      signals,
      'page:otp-language'
    );

    // ── Expected OTP Length Detection ──────────────────────
    let expectedOTPLength: number | null = null;
    const lengthMatch = bodyText.match(this.OTP_LENGTH_PATTERN);
    if (lengthMatch) {
      const parsed = parseInt(lengthMatch[1], 10);
      if (parsed >= MIN_OTP_LENGTH && parsed <= MAX_OTP_LENGTH) {
        expectedOTPLength = parsed;
        signals.push(`page:expected-length-${expectedOTPLength}`);
      }
    }

    // ── Framework Detection ───────────────────────────────
    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);

    // ── Provider Detection ────────────────────────────────
    const provider = this.detectProvider(url, bodyText);
    if (provider) {
      signals.push(`provider:${provider}`);
    }

    return Object.freeze({
      isVerificationPage: pageTypes['isVerificationPage'] ?? false,
      isLoginPage: pageTypes['isLoginPage'] ?? false,
      isSignupPage: pageTypes['isSignupPage'] ?? false,
      isPasswordResetPage: pageTypes['isPasswordResetPage'] ?? false,
      is2FAPage: pageTypes['is2FAPage'] ?? false,
      framework,
      hasOTPLanguage,
      expectedOTPLength,
      provider,
      pageSignals: Object.freeze(signals),
    });
  }

  private static testSignals(
    text: string,
    patterns: readonly RegExp[],
    signals: string[],
    signalName: string
  ): boolean {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        signals.push(signalName);
        return true;
      }
    }
    return false;
  }

  static detectFramework(): FrameworkType {
    // ── React Detection ───────────────────────────────────
    try {
      const rootEl = document.getElementById('root') ?? document.getElementById('__next');
      if (rootEl) {
        const keys = Object.keys(rootEl);
        if (keys.some((k) => k.startsWith('__react'))) {
          return 'react';
        }
      }

      if (safeQuerySelector(document, '[data-reactroot]')) {
        return 'react';
      }

      // Check any element for React fiber keys
      const probeEl = safeQuerySelector<HTMLElement>(document, 'input') ??
        safeQuerySelector<HTMLElement>(document, 'div');
      if (probeEl) {
        const keys = Object.keys(probeEl);
        const reactPrefixes = [
          '__reactFiber$',
          '__reactInternalInstance$',
          '__reactProps$',
          '__reactEventHandlers$',
        ] as const;
        if (keys.some((k) => reactPrefixes.some((prefix) => k.startsWith(prefix)))) {
          return 'react';
        }
      }
    } catch {
      /* detection failed, continue */
    }

    // ── Vue Detection ─────────────────────────────────────
    try {
      const vueDoc = document as VueEnhancedDocument;
      if (vueDoc.__vue_app__) {return 'vue';}
      // Check for Vue scoped style attributes (data-v-*)
      const allEls = document.body?.querySelectorAll('*') ?? [];
      for (let i = 0, len = Math.min(allEls.length, 100); i < len; i++) {
        const attrs = allEls[i].getAttributeNames();
        if (attrs.some((a) => /^data-v-[a-f0-9]+$/.test(a))) {
          return 'vue';
        }
      }
    } catch {
      /* detection failed, continue */
    }

    // ── Angular Detection ─────────────────────────────────
    try {
      const angularWin = window as unknown as AngularEnhancedWindow;
      if (
        angularWin.ng ??
        safeQuerySelector(document, '[ng-version]') ??
        safeQuerySelector(document, '[_nghost]') ??
        safeQuerySelector(document, '[ng-app]')
      ) {
        // Check attributes starting with _ng
        const allEls = document.body?.querySelectorAll('*') ?? [];
        for (let i = 0, len = Math.min(allEls.length, 100); i < len; i++) {
          if (allEls[i].getAttributeNames().some((a) => a.startsWith('_ng'))) {
            return 'angular';
          }
        }
        if (angularWin.ng) {return 'angular';}
      }
    } catch {
      /* detection failed, continue */
    }

    // ── Svelte Detection ──────────────────────────────────
    try {
      if (safeQuerySelector(document, '[class*="svelte-"]')) {
        return 'svelte';
      }
    } catch {
      /* detection failed, continue */
    }

    // ── Solid Detection ───────────────────────────────────
    try {
      const solidWin = window as unknown as SolidEnhancedWindow;
      if (solidWin._$HY ?? safeQuerySelector(document, '[data-hk]')) {
        return 'solid';
      }
    } catch {
      /* detection failed, continue */
    }

    return 'unknown';
  }

  private static detectProvider(url: string, text: string): string | null {
    for (const [pattern, name] of this.PROVIDER_PATTERNS) {
      if (pattern.test(url) || pattern.test(text)) {
        return name;
      }
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  VISIBILITY ENGINE
// ═══════════════════════════════════════════════════════════════

class VisibilityEngine {
  /**
   * Strict visibility check: element must have non-zero dimensions,
   * not be display:none, not be visibility:hidden, and not be opacity:0.
   */
  static isVisible(element: HTMLElement): boolean {
    // Fast bailout: if element isn't connected to DOM
    if (!element.isConnected) {return false;}

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return false;}

    const style = window.getComputedStyle(element);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  /**
   * Relaxed visibility: allows opacity:0 and tiny elements.
   * Used for verification page fallback (Mistral-style hidden inputs).
   */
  static isVisibleRelaxed(element: HTMLElement): boolean {
    if (!element.isConnected) {return false;}
    const style = window.getComputedStyle(element);
    return style.display !== 'none';
  }

  /**
   * Check if an input is fillable (visible + enabled + writable).
   */
  static isFillable(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisible(element) && !element.disabled && !element.readOnly;
  }

  /**
   * Check if an input is fillable with relaxed visibility.
   */
  static isFillableRelaxed(element: HTMLInputElement | HTMLTextAreaElement): boolean {
    return this.isVisibleRelaxed(element) && !element.disabled && !element.readOnly;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FRAMEWORK-AWARE FIELD SETTER
// ═══════════════════════════════════════════════════════════════

class FieldSetter {
  private static readonly SETTABLE_INPUT_TYPES = new Set([
    'text', 'tel', 'number', 'password', 'email', 'url', 'search', '',
  ]);

  /**
   * Set value with full framework compatibility.
   * Tries multiple strategies in priority order until one works.
   * Each strategy is isolated — failure in one never blocks the next.
   */
  static async setValue(
    element: FormInputElement,
    value: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _framework: FrameworkType = 'unknown'
  ): Promise<boolean> {
    // Validate element is in DOM
    if (!element.isConnected) {
      log.debug('Element not connected to DOM, cannot set value');
      return false;
    }

    const strategies: Array<{
      name: string;
      fn: () => Promise<boolean> | boolean;
    }> = [
      {
        name: 'PhantomTyper',
        fn: async () => {
          await PhantomTyper.typeSimulatedString(element, value);
          return element.value === value;
        },
      },
      {
        name: 'NativeSetter',
        fn: () => this.setViaNativeSetter(element, value),
      },
      {
        name: 'InputEventSequence',
        fn: () => {
          this.setViaInputEvent(element, value);
          return element.value === value;
        },
      },
      {
        name: 'DirectAssignment',
        fn: () => {
          element.value = value;
          this.dispatchFullEventChain(element, value);
          return element.value === value;
        },
      },
    ];

    for (const strategy of strategies) {
      try {
        const success = await strategy.fn();
        if (success) {
          log.debug(`Field set via ${strategy.name}`);
          return true;
        }
      } catch (error) {
        log.debug(`Strategy ${strategy.name} failed:`, error);
      }
    }

    log.warn('All field-setting strategies exhausted', {
      id: element.id,
      name: (element as HTMLInputElement).name,
      type: (element as HTMLInputElement).type,
    });
    return false;
  }

  /**
   * Set a single character (optimized for split OTP fields).
   * Uses PhantomTyper for human-like behavior, with native setter fallback.
   */
  static async setChar(
    element: HTMLInputElement,
    char: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _framework: FrameworkType = 'unknown'
  ): Promise<boolean> {
    if (!element.isConnected) {return false;}

    const attemptSet = async () => {
      try {
        await PhantomTyper.typeSimulatedString(element, char);
        // Split fields may auto-format/skip — accept if not empty or contains our char
        return element.value.includes(char) || element.value.length > 0;
      } catch {
        // Fallback: native setter
        try {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          )?.set;

          if (nativeSetter) {
            nativeSetter.call(element, char);
          } else {
            element.value = char;
          }

          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return element.value === char || element.value.includes(char) || element.value.length > 0;
        } catch {
          return false;
        }
      }
    };

    let success = await attemptSet();
    if (!success) {
      log.debug('setChar failed first attempt, retrying...');
      await new Promise(r => setTimeout(r, 100)); // 100ms rendering delay
      success = await attemptSet();
    }
    return success;
  }

  private static setViaNativeSetter(
    element: FormInputElement,
    value: string
  ): boolean {
    const proto =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;

    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (!nativeSetter) {return false;}

    element.focus();
    nativeSetter.call(element, value);

    // React requires synthetic input event to trigger state update
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return element.value === value;
  }

  private static setViaInputEvent(
    element: FormInputElement,
    value: string
  ): void {
    element.focus();

    // Clear first
    const nativeSetter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype,
      'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(element, '');
    } else {
      element.value = '';
    }

    // Type each character with proper InputEvent sequence
    for (const char of value) {
      element.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: char,
        })
      );

      // Append character
      if (nativeSetter) {
        nativeSetter.call(element, element.value + char);
      } else {
        element.value += char;
      }

      element.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          inputType: 'insertText',
          data: char,
        })
      );
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private static dispatchFullEventChain(
    element: FormInputElement,
    value: string
  ): void {
    element.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: value,
      })
    );

    element.dispatchEvent(new Event('change', { bubbles: true }));

    element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
}

// ═══════════════════════════════════════════════════════════════
//  NEGATIVE PATTERN MATCHER (Anti-false-positive)
// ═══════════════════════════════════════════════════════════════

class NegativePatternMatcher {
  private static readonly NON_OTP_PATTERNS: readonly RegExp[] = [
    /email|mail/i,
    /search/i,
    /address|street|city|state|country|zip|postal/i,
    /name|first|last|full|middle/i,
    /card|cvv|ccv|cvc|expir|credit|debit/i,
    /promo|coupon|discount|gift|voucher|referral/i,
    /comment|message|note|description|bio/i,
    /url|website|link|domain/i,
    /company|organization|org/i,
    /quantity|amount|price|total|subtotal/i,
    /date|month|year|day/i,
    /ssn|social|tax|national/i,
    /routing|account.*number|iban|swift|bic/i,
  ];

  private static readonly NON_OTP_INPUT_TYPES = new Set([
    'email', 'search', 'url', 'date', 'datetime-local', 'month', 'week', 'color',
  ]);

  static isLikelyNotOTP(input: HTMLInputElement): boolean {
    const name = (input.name ?? '').toLowerCase();
    const id = (input.id ?? '').toLowerCase();
    const placeholder = (input.placeholder ?? '').toLowerCase();
    const autocomplete = (input.autocomplete ?? '').toLowerCase();
    const combined = `${name} ${id} ${placeholder} ${autocomplete}`;

    if (this.NON_OTP_INPUT_TYPES.has(input.type.toLowerCase())) {return true;}

    // Phone fields with maxLength > 1 are usually phone number inputs, not OTP
    if (/phone|tel|mobile/.test(combined) && input.maxLength !== 1) {return true;}

    for (const pattern of this.NON_OTP_PATTERNS) {
      if (pattern.test(combined)) {return true;}
    }

    return false;
  }

  private static readonly FILLABLE_OTP_INPUT_TYPES = new Set([
    'text', 'tel', 'number', 'password', '',
  ]);

  static isOTPCompatibleType(input: HTMLInputElement): boolean {
    return this.FILLABLE_OTP_INPUT_TYPES.has(input.type.toLowerCase());
  }
}

// ═══════════════════════════════════════════════════════════════
//  OTP FIELD DISCOVERY ENGINE (14 Strategies)
// ═══════════════════════════════════════════════════════════════

class OTPFieldDiscovery {
  // ── Shadow Root Cache ───────────────────────────────────
  private static knownShadowRoots = new Set<ShadowRoot>();
  private static lastShadowRootScan = 0;

  private static readonly STRATEGIES: ReadonlyArray<{
    name: string;
    fn: (context: PageContext) => OTPFieldGroup | null;
    baseScore: number;
  }> = [
    // ── Tier 1: Explicit OTP Attributes (highest confidence) ──
    {
      name: 'S1:autocomplete-one-time-code',
      fn: () =>
        OTPFieldDiscovery.findBySelector('input[autocomplete="one-time-code"]', 'autocomplete-otc', 100),
      baseScore: 100,
    },
    {
      name: 'S2:explicit-otp-names',
      fn: () =>
        OTPFieldDiscovery.findBySelector(
          [
            'input[name="otp"]', 'input[name="otc"]',
            'input[name="one-time-code"]', 'input[name="oneTimeCode"]',
            'input[name*="checkCode" i]', 'input[id*="checkCode" i]',
            'input[name*="verifyCode" i]',
          ].join(','),
          'explicit-name',
          95
        ),
      baseScore: 95,
    },

    // ── Tier 2: Split-Digit Detection ────────────────────
    {
      name: 'S3:split-digit-maxlength1',
      fn: () => OTPFieldDiscovery.findSplitDigitFields(),
      baseScore: 90,
    },

    // ── Tier 3: Semantic Containers ──────────────────────
    {
      name: 'S4:otp-container-class',
      fn: () => OTPFieldDiscovery.findInSemanticContainers(),
      baseScore: 85,
    },

    // ── Tier 4: ARIA & Accessibility ─────────────────────
    {
      name: 'S5:aria-labels',
      fn: () =>
        OTPFieldDiscovery.findBySelector(
          [
            'input[aria-label*="otp" i]',
            'input[aria-label*="verification" i]',
            'input[aria-label*="code" i]:not([aria-label*="postal" i]):not([aria-label*="zip" i]):not([aria-label*="country" i])',
            'input[aria-label*="digit" i]',
            'input[aria-label*="pin" i]',
          ].join(','),
          'aria-label',
          80
        ),
      baseScore: 80,
    },

    // ── Tier 5: Name/ID Pattern Matching ─────────────────
    {
      name: 'S6:name-id-patterns',
      fn: () =>
        OTPFieldDiscovery.findBySelector(
          [
            'input[name*="otp" i]', 'input[id*="otp" i]',
            'input[name*="verification" i][name*="code" i]',
            'input[name="code"]', 'input[name="pin"]',
            'input[name*="passcode" i]',
            'input[id*="verification" i][id*="code" i]',
            'input[id*="pin-input" i]',
            'input[id*="checkCode" i]',
          ].join(','),
          'name-id-pattern',
          75
        ),
      baseScore: 75,
    },

    // ── Tier 6: Placeholder Patterns ─────────────────────
    {
      name: 'S7:placeholder-patterns',
      fn: () =>
        OTPFieldDiscovery.findBySelector(
          [
            'input[placeholder*="code" i]:not([placeholder*="postal" i]):not([placeholder*="zip" i]):not([placeholder*="promo" i]):not([placeholder*="coupon" i]):not([placeholder*="discount" i])',
            'input[placeholder*="otp" i]',
            'input[placeholder*="verification" i]',
            'input[placeholder*="digit" i]',
            'input[placeholder*="pin" i]:not([placeholder*="zip" i])',
            'input[placeholder*="000000"]',
            'input[placeholder*="------"]',
            'input[placeholder*="● ● ●"]',
            'input[placeholder*="• • •"]',
          ].join(','),
          'placeholder-pattern',
          70
        ),
      baseScore: 70,
    },

    // ── Tier 7: Data-TestID (Developer conventions) ──────
    {
      name: 'S8:data-testid',
      fn: () =>
        OTPFieldDiscovery.findBySelector(
          [
            'input[data-testid*="otp" i]', 'input[data-testid*="code" i]',
            'input[data-testid*="verify" i]', 'input[data-testid*="pin" i]',
            'input[data-cy*="otp" i]', 'input[data-cy*="code" i]',
          ].join(','),
          'data-testid',
          75
        ),
      baseScore: 75,
    },

    // ── Tier 8: Maxlength-Based Single Field ─────────────
    {
      name: 'S9:maxlength-single',
      fn: (ctx) => OTPFieldDiscovery.findMaxlengthFields(ctx),
      baseScore: 60,
    },

    // ── Tier 9: InputMode Numeric ────────────────────────
    {
      name: 'S10:inputmode-numeric',
      fn: (ctx) => OTPFieldDiscovery.findInputModeNumeric(ctx),
      baseScore: 55,
    },

    // ── Tier 10: Contextual Text Proximity ───────────────
    {
      name: 'S11:text-proximity',
      fn: () => OTPFieldDiscovery.findByTextProximity(),
      baseScore: 50,
    },

    // ── Tier 11: Shadow DOM Piercing ─────────────────────
    {
      name: 'S12:shadow-dom',
      fn: () => OTPFieldDiscovery.findInShadowDOM(),
      baseScore: 65,
    },

    // ── Tier 12: Brute Force (page context required) ─────
    {
      name: 'S13:brute-force-context',
      fn: (ctx) => OTPFieldDiscovery.bruteForceWithContext(ctx),
      baseScore: 35,
    },

    // ── Tier 13: Verification Page Any-Input ─────────────
    {
      name: 'S14:verification-page-any-input',
      fn: (ctx) => OTPFieldDiscovery.verificationPageFallback(ctx),
      baseScore: 25,
    },
  ];

  /**
   * Main entry: execute all strategies in priority order,
   * apply context-based score adjustments, return best match.
   */
  static discover(context: PageContext): OTPFieldGroup | null {
    for (const strategy of this.STRATEGIES) {
      try {
        const result = strategy.fn(context);
        if (!result || result.fields.length === 0) {continue;}

        result.strategy = strategy.name;
        result.score = strategy.baseScore;
        result.signals.push(`matched:${strategy.name}`);

        // ── Context-based score adjustments ────────────────
        this.applyContextBonuses(result, context);

        log.info(`✅ OTP fields found via ${strategy.name}`, {
          count: result.fields.length,
          score: result.score,
          isSplit: result.isSplit,
          signals: result.signals,
        });

        return result;
      } catch (e) {
        log.debug(`Strategy ${strategy.name} threw:`, e);
      }
    }

    log.warn('❌ No OTP fields found after all strategies');
    return null;
  }

  private static applyContextBonuses(result: OTPFieldGroup, context: PageContext): void {
    if (context.isVerificationPage || context.is2FAPage) {
      result.score += 15;
      result.signals.push('bonus:verification-page');
    }
    if (context.hasOTPLanguage) {
      result.score += 10;
      result.signals.push('bonus:otp-language');
    }
    if (context.provider) {
      result.score += 5;
      result.signals.push(`bonus:provider-${context.provider}`);
    }

    // Validate expected length match for split fields
    if (context.expectedOTPLength !== null && result.isSplit) {
      if (result.fields.length !== context.expectedOTPLength) {
        result.score -= 10;
        result.signals.push(
          `penalty:length-mismatch(expected=${context.expectedOTPLength},got=${result.fields.length})`
        );
      } else {
        result.score += 10;
        result.signals.push('bonus:length-match');
      }
    }
  }

  // ── Strategy Implementations ────────────────────────────────

  private static findBySelector(
    selector: string,
    strategyName: string,
    score: number
  ): OTPFieldGroup | null {
    const fields = this.queryVisible(selector);
    if (fields.length === 0) {return null;}

    const isSplit = fields.every((f) => f.maxLength === 1) && fields.length >= MIN_SPLIT_FIELDS;

    return {
      fields: this.sortByPosition(fields),
      score,
      strategy: strategyName,
      isSplit,
      expectedLength: isSplit ? fields.length : (fields[0]?.maxLength > 0 ? fields[0].maxLength : 6),
      signals: [`found:${fields.length}-fields`],
    };
  }

  private static findSplitDigitFields(): OTPFieldGroup | null {
    const singleInputs = this.queryVisible('input[maxlength="1"]').filter((f) =>
      NegativePatternMatcher.isOTPCompatibleType(f)
    );

    if (singleInputs.length < MIN_SPLIT_FIELDS) {return null;}

    // Group by common parent container
    const groups = this.groupByCommonAncestor(singleInputs);

    // Find the best group: prefer largest valid group
    let bestGroup: HTMLInputElement[] = [];
    for (const group of groups) {
      if (
        group.length >= MIN_SPLIT_FIELDS &&
        group.length <= MAX_SPLIT_FIELDS &&
        group.length > bestGroup.length
      ) {
        bestGroup = group;
      }
    }

    // Fallback: use all if count is in valid range
    if (bestGroup.length < MIN_SPLIT_FIELDS) {
      if (singleInputs.length >= MIN_SPLIT_FIELDS && singleInputs.length <= MAX_SPLIT_FIELDS) {
        bestGroup = singleInputs;
      } else {
        return null;
      }
    }

    return {
      fields: this.sortByPosition(bestGroup),
      score: 90,
      strategy: 'split-digit',
      isSplit: true,
      expectedLength: bestGroup.length,
      signals: [`split-group:${bestGroup.length}-inputs`],
    };
  }

  private static readonly SEMANTIC_CONTAINER_SELECTORS: readonly string[] = [
    '[class*="otp" i]',
    '[class*="pin-input" i]',
    '[class*="code-input" i]',
    '[class*="verification" i]',
    '[class*="passcode" i]',
    '[class*="digit-input" i]',
    '[class*="code-field" i]',
    '[data-testid*="otp" i]',
    '[data-testid*="code-input" i]',
    '[id*="otp" i]',
    '[id*="pin-input" i]',
    '[role="group"][aria-label*="code" i]',
    '[role="group"][aria-label*="otp" i]',
    '[role="group"][aria-label*="verification" i]',
  ];

  private static findInSemanticContainers(): OTPFieldGroup | null {
    for (const selector of this.SEMANTIC_CONTAINER_SELECTORS) {
      const containers = safeQuerySelectorAll(document, selector);
      for (const container of containers) {
        const inputs = this.queryVisibleWithin(container, 'input');

        if (inputs.length >= 1 && inputs.length <= 12) {
          const isSplit = inputs.length >= MIN_SPLIT_FIELDS && inputs.every((f) => f.maxLength === 1);
          return {
            fields: this.sortByPosition(inputs),
            score: 85,
            strategy: `container:${selector.slice(0, 30)}`,
            isSplit,
            expectedLength: isSplit ? inputs.length : (inputs[0]?.maxLength > 0 ? inputs[0].maxLength : 6),
            signals: [`container:${selector}`, `inputs:${inputs.length}`],
          };
        }
      }
    }

    return null;
  }

  private static findMaxlengthFields(context: PageContext): OTPFieldGroup | null {
    const lengths = context.expectedOTPLength
      ? [context.expectedOTPLength]
      : [6, 4, 8, 5, 7];

    for (const len of lengths) {
      const fields = this.queryVisible(`input[maxlength="${len}"]`)
        .filter((f) => {
          const type = f.type.toLowerCase();
          return type !== 'password' && type !== 'email' && type !== 'search';
        })
        .filter((f) => !NegativePatternMatcher.isLikelyNotOTP(f));

      if (fields.length > 0) {
        return {
          fields: [fields[0]],
          score: 60,
          strategy: `maxlength-${len}`,
          isSplit: false,
          expectedLength: len,
          signals: [`maxlength:${len}`, `candidates:${fields.length}`],
        };
      }
    }

    return null;
  }

  private static findInputModeNumeric(context: PageContext): OTPFieldGroup | null {
    // Only use this strategy on verification/2FA/OTP pages
    if (!context.isVerificationPage && !context.is2FAPage && !context.hasOTPLanguage) {
      return null;
    }

    const fields = this.queryVisible('input[inputmode="numeric"]')
      .filter((f) => {
        const type = f.type.toLowerCase();
        return type !== 'password' && type !== 'email' && type !== 'search';
      })
      .filter((f) => !NegativePatternMatcher.isLikelyNotOTP(f));

    if (fields.length === 0) {return null;}

    const isSplit = fields.length >= MIN_SPLIT_FIELDS && fields.every((f) => f.maxLength === 1);

    return {
      fields: isSplit ? this.sortByPosition(fields) : [fields[0]],
      score: 55,
      strategy: 'inputmode-numeric',
      isSplit,
      expectedLength: isSplit ? fields.length : (fields[0]?.maxLength > 0 ? fields[0].maxLength : 6),
      signals: [`inputmode-numeric:${fields.length}-fields`],
    };
  }

  private static readonly TEXT_PROXIMITY_PATTERNS: readonly RegExp[] = [
    /enter\s*(your|the)?\s*(code|otp|pin)/i,
    /verification\s*code/i,
    /one[- ]?time\s*(code|password|passcode)/i,
    /security\s*code/i,
    /we[\s\w]*sent[\s\w]*code/i,
    /code[\s\w]*sent[\s\w]*to/i,
    /\d[- ]?digit\s*code/i,
  ];

  private static findByTextProximity(): OTPFieldGroup | null {
    if (!document.body) {return null;}

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent ?? '';
      const matchesCode = this.TEXT_PROXIMITY_PATTERNS.some((p) => p.test(text));
      if (!matchesCode) {continue;}

      // Walk up to find nearby inputs
      let parent: Element | null = walker.currentNode.parentElement;
      for (let depth = 0; depth < TEXT_PROXIMITY_MAX_DEPTH && parent; depth++) {
        const inputs = this.queryVisibleWithin(parent, 'input');
        const filtered = inputs
          .filter((f) => {
            const type = f.type.toLowerCase();
            return type !== 'email' && type !== 'password' && type !== 'search' && type !== 'hidden';
          })
          .filter((f) => !NegativePatternMatcher.isLikelyNotOTP(f));

        if (filtered.length >= 1 && filtered.length <= MAX_SPLIT_FIELDS) {
          const isSplit = filtered.length >= MIN_SPLIT_FIELDS && filtered.every((f) => f.maxLength === 1);
          return {
            fields: isSplit ? this.sortByPosition(filtered) : [filtered[0]],
            score: 50,
            strategy: 'text-proximity',
            isSplit,
            expectedLength: isSplit ? filtered.length : (filtered[0]?.maxLength > 0 ? filtered[0].maxLength : 6),
            signals: [`proximity:"${text.trim().slice(0, 40)}"`],
          };
        }
        parent = parent.parentElement;
      }
    }

    return null;
  }

  private static findInShadowDOM(): OTPFieldGroup | null {
    this.refreshShadowRootCache();

    for (const shadowRoot of this.knownShadowRoots) {
      try {
        const inputs = Array.from(
          shadowRoot.querySelectorAll<HTMLInputElement>('input')
        ).filter((f) => VisibilityEngine.isFillable(f));

        const otpInputs = inputs.filter((f) => {
          const combined = combineStrings(
            f.name, f.id, f.placeholder, f.autocomplete, f.getAttribute('aria-label')
          );
          return (
            f.autocomplete === 'one-time-code' ||
            /otp|code|pin|verification/.test(combined)
          );
        });

        if (otpInputs.length > 0) {
          const isSplit = otpInputs.length >= MIN_SPLIT_FIELDS && otpInputs.every((f) => f.maxLength === 1);
          return {
            fields: this.sortByPosition(otpInputs),
            score: 65,
            strategy: 'shadow-dom',
            isSplit,
            expectedLength: isSplit ? otpInputs.length : (otpInputs[0]?.maxLength > 0 ? otpInputs[0].maxLength : 6),
            signals: ['shadow-dom:found'],
          };
        }
      } catch {
        /* shadow root may have been removed */
      }
    }

    return null;
  }

  private static bruteForceWithContext(context: PageContext): OTPFieldGroup | null {
    if (!context.isVerificationPage && !context.is2FAPage && !context.hasOTPLanguage) {
      return null;
    }

    const allInputs = this.queryVisible(
      'input[type="text"], input[type="tel"], input[type="number"], input:not([type])'
    ).filter((f) => !f.disabled && !f.readOnly && !NegativePatternMatcher.isLikelyNotOTP(f));

    const validCounts = new Set([4, 5, 6, 7, 8]);
    if (!validCounts.has(allInputs.length)) {return null;}

    const firstMaxLength = allInputs[0].maxLength;
    const allSameMaxLength = allInputs.every((f) => f.maxLength === firstMaxLength);
    if (!allSameMaxLength) {return null;}

    const isSplit = firstMaxLength === 1;
    return {
      fields: this.sortByPosition(allInputs),
      score: 35,
      strategy: 'brute-force',
      isSplit,
      expectedLength: isSplit ? allInputs.length : (firstMaxLength > 0 ? firstMaxLength : 6),
      signals: [`brute-force:${allInputs.length}-inputs`, 'page-context-match'],
    };
  }

  private static verificationPageFallback(context: PageContext): OTPFieldGroup | null {
    if (!context.isVerificationPage && !context.is2FAPage) {return null;}

    // Relaxed visibility for hidden-but-functional inputs (Mistral pattern)
    const allInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="tel"], input[type="number"], input:not([type])'
      )
    ).filter((f) => VisibilityEngine.isFillableRelaxed(f) && f.type !== 'hidden');

    if (allInputs.length === 0) {return null;}

    // Score each candidate
    let bestInput: HTMLInputElement | null = null;
    let bestScore = -Infinity;

    for (const input of allInputs) {
      const score = this.scoreOTPCandidate(input);
      if (score > bestScore) {
        bestScore = score;
        bestInput = input;
      }
    }

    if (!bestInput || bestScore < 0) {return null;}

    return {
      fields: [bestInput],
      score: 25,
      strategy: 'verification-page-fallback',
      isSplit: false,
      expectedLength: bestInput.maxLength > 0 ? bestInput.maxLength : 6,
      signals: ['verification-page', `candidate-score:${bestScore}`],
    };
  }

  private static scoreOTPCandidate(input: HTMLInputElement): number {
    let score = 0;
    const combined = combineStrings(
      input.name, input.id, input.placeholder, input.autocomplete,
      input.getAttribute('aria-label')
    );

    if (input.autocomplete === 'one-time-code') {score += 50;}
    if (/otp|code|pin|verification|token/.test(combined)) {score += 30;}
    if (/code|otp|pin|digit|verification/.test(input.placeholder?.toLowerCase() ?? '')) {score += 25;}
    if (input.inputMode === 'numeric') {score += 15;}
    if (input.maxLength >= MIN_OTP_LENGTH && input.maxLength <= MAX_OTP_LENGTH) {score += 20;}
    if (input.type === 'tel') {score += 10;}
    if (input.pattern && /\\d/.test(input.pattern)) {score += 10;}

    // Penalties for non-OTP indicators
    if (/email|name|address|phone|search|url|zip|postal/.test(combined)) {score -= 40;}
    if (input.type === 'email' || input.type === 'password' || input.type === 'search') {score -= 50;}

    return score;
  }

  // ── DOM Query Utilities ─────────────────────────────────────

  private static refreshShadowRootCache(): void {
    const now = Date.now();
    if (now - this.lastShadowRootScan < SHADOW_ROOT_SCAN_INTERVAL_MS) {return;}

    this.lastShadowRootScan = now;
    const allNodes = document.getElementsByTagName('*');
    for (let i = 0; i < allNodes.length; i++) {
      const sr = allNodes[i].shadowRoot;
      if (sr) {this.knownShadowRoots.add(sr);}
    }
  }

  private static queryVisible(
    selector: string,
    root: Document | DocumentFragment = document
  ): HTMLInputElement[] {
    const inputs = safeQuerySelectorAll<HTMLInputElement>(root, selector).filter((f) =>
      VisibilityEngine.isFillable(f)
    );

    // Cross-frame penetration (same-origin only)
    if (root === document) {
      const iframes = document.getElementsByTagName('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          const doc = iframes[i].contentDocument;
          if (doc) {inputs.push(...this.queryVisible(selector, doc));}
        } catch {
          /* cross-origin, skip */
        }
      }

      // Shadow DOM penetration
      this.refreshShadowRootCache();
      for (const shadowRoot of this.knownShadowRoots) {
        try {
          inputs.push(...this.queryVisible(selector, shadowRoot));
        } catch {
          /* shadow root detached, skip */
        }
      }
    }

    return inputs;
  }

  private static queryVisibleWithin(container: Element, selector: string): HTMLInputElement[] {
    return safeQuerySelectorAll<HTMLInputElement>(container, selector).filter((f) =>
      VisibilityEngine.isFillable(f)
    );
  }

  private static groupByCommonAncestor(inputs: HTMLInputElement[]): HTMLInputElement[][] {
    const groups = new Map<Element, HTMLInputElement[]>();

    for (const input of inputs) {
      let container: Element | null = input.parentElement;
      for (let depth = 0; depth < 3 && container; depth++) {
        const siblings = Array.from(
          container.querySelectorAll<HTMLInputElement>('input[maxlength="1"]')
        ).filter((f) => VisibilityEngine.isFillable(f));

        if (siblings.length >= MIN_SPLIT_FIELDS && siblings.length <= MAX_SPLIT_FIELDS) {
          if (!groups.has(container)) {
            groups.set(container, siblings);
          }
          break;
        }
        container = container.parentElement;
      }
    }

    return Array.from(groups.values());
  }

  /**
   * Sort inputs by visual position (top-to-bottom, left-to-right)
   * with row tolerance of 10px.
   */
  static sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
    return [...inputs].sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      if (Math.abs(rectA.top - rectB.top) > 10) {return rectA.top - rectB.top;}
      return rectA.left - rectB.left;
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  OTP FILLER ENGINE
// ═══════════════════════════════════════════════════════════════

class OTPFiller {
  static async fill(
    otp: string,
    group: OTPFieldGroup,
    framework: FrameworkType
  ): Promise<OTPFillOutcome> {
    const cleanOTP = otp.replace(/[-\s]/g, '');

    if (cleanOTP.length === 0) {
      log.warn('OTP is empty after cleaning');
      return { success: false, filledCount: 0, strategy: 'none' };
    }

    return group.isSplit
      ? this.fillSplit(cleanOTP, group.fields, framework)
      : this.fillSingle(otp, group.fields[0], framework);
  }

  private static async fillSingle(
    otp: string,
    field: HTMLInputElement,
    framework: FrameworkType
  ): Promise<OTPFillOutcome> {
    if (!field) {
      return { success: false, filledCount: 0, strategy: 'single-field' };
    }

    const success = await FieldSetter.setValue(field, otp, framework);
    if (success) {
      log.info('✅ Filled single OTP field', { length: otp.length });
    } else {
      log.warn('⚠️ Single OTP fill may have issues');
    }
    return { success, filledCount: success ? 1 : 0, strategy: 'single-field' };
  }

  private static async fillSplit(
    digits: string,
    fields: HTMLInputElement[],
    framework: FrameworkType
  ): Promise<OTPFillOutcome> {
    const total = Math.min(digits.length, fields.length);
    let filledCount = 0;

    log.info(`Filling ${total} split OTP fields...`);

    for (let i = 0; i < total; i++) {
      const field = fields[i];
      const char = digits[i];

      // Wait for next animation frame to sync with React render cycles (fallback to timeout)
      await new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(resolve);
        } else {
          setTimeout(resolve, 16);
        }
      });

      // Blur previous field (enables auto-tab behavior)
      if (i > 0) {
        const prevField = fields[i - 1];
        prevField.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
        prevField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await delay(SPLIT_DIGIT_INTER_CHAR_DELAY_MS);
      }

      // Focus this field
      field.focus();
      field.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Clear existing value if present
      if (field.value) {
        field.value = '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const success = await FieldSetter.setChar(field, char, framework);
      if (success) {
        filledCount++;
      } else {
        log.warn(`Failed to fill digit ${i + 1}`, { char: '●', fieldIndex: i });
      }
    }

    // Blur last field to trigger validation/auto-submit
    if (total > 0) {
      const lastField = fields[total - 1];
      await delay(SPLIT_DIGIT_FINAL_BLUR_DELAY_MS);
      lastField.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
      lastField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }

    const success = filledCount === total;
    log.info(`Split OTP fill: ${filledCount}/${total} digits`, { success });
    return { success, filledCount, strategy: 'split-field' };
  }
}

// ═══════════════════════════════════════════════════════════════
//  AUTO-SUBMIT DETECTION
// ═══════════════════════════════════════════════════════════════

class AutoSubmitDetector {
  private static readonly SUBMIT_BUTTON_SELECTORS: readonly string[] = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:not([type="button"]):not([type="reset"])',
    'button[class*="submit" i]',
    'button[class*="verify" i]',
    'button[class*="confirm" i]',
    'button[class*="continue" i]',
    'a[class*="submit" i]',
    'a[class*="verify" i]',
  ];

  private static readonly SUBMIT_TEXT_PATTERN =
    /verify|confirm|submit|continue|next|send|done|log\s*in|sign\s*in/i;

  /**
   * After filling OTP, highlight (but NOT click) any nearby submit button.
   * Auto-clicking is intentionally disabled — users should control form submission.
   */
  static async checkAndHighlight(group: OTPFieldGroup): Promise<boolean> {
    await delay(AUTO_SUBMIT_DETECTION_DELAY_MS);

    const submitButton = this.findSubmitButton(group);
    if (submitButton) {
      log.info('Found submit button — highlighting (not auto-clicking)');
      this.highlightButton(submitButton);
    }

    return false;
  }

  private static findSubmitButton(group: OTPFieldGroup): HTMLElement | null {
    const field = group.fields[0];
    if (!field) {return null;}

    const form = field.closest('form');
    const container =
      form ??
      field.closest('[class*="otp"]') ??
      field.closest('[class*="verify"]') ??
      field.parentElement?.parentElement?.parentElement;

    if (!container) {return null;}

    for (const selector of this.SUBMIT_BUTTON_SELECTORS) {
      const button = safeQuerySelector<HTMLElement>(container, selector);
      if (button && VisibilityEngine.isVisible(button)) {
        const text = (button.textContent ?? '').toLowerCase().trim();
        if (this.SUBMIT_TEXT_PATTERN.test(text)) {
          return button;
        }
      }
    }

    return null;
  }

  private static highlightButton(button: HTMLElement): void {
    const originalOutline = button.style.outline;
    const originalOutlineOffset = button.style.outlineOffset;

    button.style.outline = '2px solid #4CAF50';
    button.style.outlineOffset = '2px';

    setTimeout(() => {
      button.style.outline = originalOutline;
      button.style.outlineOffset = originalOutlineOffset;
    }, SUBMIT_BUTTON_HIGHLIGHT_DURATION_MS);
  }
}

// ═══════════════════════════════════════════════════════════════
//  DYNAMIC FIELD WATCHER (MutationObserver + Polling)
// ═══════════════════════════════════════════════════════════════

class FieldWatcher {
  private observer: MutationObserver | null = null;
  private pendingOTP: string | null = null;
  private pendingContext: PageContext | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private isActive = false;

  /**
   * Watch for dynamically-rendered OTP fields.
   * Resolves `true` if OTP was filled, `false` on timeout.
   */
  watch(
    otp: string,
    context: PageContext,
    timeoutMs: number = FIELD_WATCHER_DEFAULT_TIMEOUT_MS
  ): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isActive) {
        this.stop();
      }

      this.isActive = true;
      this.pendingOTP = otp;
      this.pendingContext = context;

      let resolved = false;

      const resolveOnce = (result: boolean): void => {
        if (resolved) {return;}
        resolved = true;
        this.stop();
        resolve(result);
      };

      const checkFields = async (): Promise<void> => {
        if (!this.pendingOTP || !this.pendingContext || resolved) {return;}

        const group = OTPFieldDiscovery.discover(this.pendingContext);
        if (!group) {return;}

        const otpToFill = this.pendingOTP;
        const framework = this.pendingContext.framework;

        const result = await OTPFiller.fill(otpToFill, group, framework);
        resolveOnce(result.success);
      };

      // MutationObserver for DOM changes
      this.observer = new MutationObserver(() => {
        if (this.debounceTimeout) {clearTimeout(this.debounceTimeout);}
        this.debounceTimeout = setTimeout(() => {
          void checkFields();
        }, FIELD_WATCHER_DEBOUNCE_MS);
      });

      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden', 'disabled'],
        });
      }

      // Polling fallback for static pages or frameworks that batch mutations
      this.pollingInterval = setInterval(() => {
        void checkFields();
      }, FIELD_WATCHER_POLL_INTERVAL_MS);

      // Safety timeout
      this.safetyTimeout = setTimeout(() => {
        resolveOnce(false);
      }, timeoutMs);
    });
  }

  stop(): void {
    this.isActive = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.safetyTimeout) {
      clearTimeout(this.safetyTimeout);
      this.safetyTimeout = null;
    }

    this.pendingOTP = null;
    this.pendingContext = null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FIELD TYPE CLASSIFIER
// ═══════════════════════════════════════════════════════════════

class FieldClassifier {
  private static readonly AUTOCOMPLETE_MAP: ReadonlyMap<string, FieldType> = new Map([
    ['one-time-code', 'otp'],
    ['one-time-password', 'otp'],
    ['email', 'email'],
    ['new-password', 'password'],
    ['current-password', 'password'],
    ['username', 'username'],
    ['given-name', 'first-name'],
    ['family-name', 'last-name'],
    ['name', 'full-name'],
    ['tel', 'phone'],
  ]);

  private static readonly OTP_EXACT_NAMES = new Set([
    'code', 'pin', 'token', 'verifycode', 'verify-code', 'verify_code',
    'otp', 'otc', 'one-time-code', 'oneTimeCode',
  ]);

  static classify(input: FormInputElement): FieldType {
    const type = (input.type ?? '').toLowerCase();
    const name = ((input as HTMLInputElement).name ?? '').toLowerCase();
    const id = (input.id ?? '').toLowerCase();
    const placeholder = ((input as HTMLInputElement).placeholder ?? '').toLowerCase();
    const autocomplete = ((input as HTMLInputElement).autocomplete ?? '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
    const label = this.findLabelText(input).toLowerCase();

    const all = `${type}|${name}|${id}|${placeholder}|${autocomplete}|${ariaLabel}|${label}`;

    // ── Priority 0: Highest Confidence OTP ────────────────
    if (this.AUTOCOMPLETE_MAP.get(autocomplete) === 'otp') {return 'otp';}
    if (/otp|one[-_]?time|verification[-\s_]?code|passcode|security[-_]?code/i.test(all)) {return 'otp';}
    if (this.OTP_EXACT_NAMES.has(name) || this.OTP_EXACT_NAMES.has(id)) {return 'otp';}

    // ── Priority 1: HTML type attribute ───────────────────
    if (type === 'email') {return 'email';}
    if (type === 'password') {
      return /confirm|repeat|retype|re-enter|again|match/i.test(all) ? 'confirm-password' : 'password';
    }

    // ── Priority 2: autocomplete attribute ────────────────
    const autoType = this.AUTOCOMPLETE_MAP.get(autocomplete);
    if (autoType) {return autoType;}

    // ── Priority 3: Name/ID/Label keyword matching ────────
    if (/e[-_]?mail|email/i.test(name + id) || /email/i.test(label)) {return 'email';}

    if (/password|passwd|pwd|pass[-_]?word/i.test(name + id)) {
      return /confirm|repeat|retype|re-enter|again/i.test(all) ? 'confirm-password' : 'password';
    }

    if (/first[-_]?name|given[-_]?name|fname/i.test(name + id) || /first\s*name/i.test(label)) {
      return 'first-name';
    }
    if (/last[-_]?name|family[-_]?name|surname|lname/i.test(name + id) || /last\s*name|surname/i.test(label)) {
      return 'last-name';
    }
    if (/full[-_]?name|your[-_]?name|display[-_]?name/i.test(name + id) || /full\s*name|your\s*name/i.test(label)) {
      return 'full-name';
    }
    if (/user[-_]?name|login[-_]?name|login[-_]?id|user[-_]?id/i.test(name + id) || /username/i.test(label)) {
      return 'username';
    }
    if (/phone|mobile|tel(?:ephone)?|cell/i.test(name + id) || /phone/i.test(label)) {
      return 'phone';
    }

    // ── Priority 4: Placeholder patterns ──────────────────
    if (/@/.test(placeholder) || /email|e-mail/i.test(placeholder)) {return 'email';}
    if (/password/i.test(placeholder)) {return 'password';}
    if (/username/i.test(placeholder)) {return 'username';}
    if (/code|otp|pin|digit/i.test(placeholder)) {return 'otp';}

    return 'unknown';
  }

  private static findLabelText(input: HTMLElement): string {
    // 1. Explicit label via `for` attribute
    if (input.id) {
      const label = safeQuerySelector<HTMLLabelElement>(document, `label[for="${escapeCSS(input.id)}"]`);
      if (label?.textContent) {return label.textContent.trim();}
    }

    // 2. Ancestor label
    const parentLabel = input.closest('label');
    if (parentLabel?.textContent) {return parentLabel.textContent.trim();}

    // 3. aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) {return labelEl.textContent.trim();}
    }

    // 4. aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) {return ariaLabel;}

    // 5. Previous sibling text
    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.tagName !== 'INPUT' && prevSibling.textContent) {
      return prevSibling.textContent.trim();
    }

    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN AUTOFILLER CLASS
// ═══════════════════════════════════════════════════════════════

export class AutoFiller {
  private fieldWatcher = new FieldWatcher();
  private pageContext: PageContext | null = null;
  private destroyed = false;

  // ── Page Context (cached with manual refresh) ───────────

  private getContext(): PageContext {
    if (!this.pageContext) {
      this.pageContext = PageIntelligence.analyze();
      log.info('📊 Page Analysis:', {
        verification: this.pageContext.isVerificationPage,
        login: this.pageContext.isLoginPage,
        signup: this.pageContext.isSignupPage,
        '2fa': this.pageContext.is2FAPage,
        framework: this.pageContext.framework,
        provider: this.pageContext.provider,
        otpLanguage: this.pageContext.hasOTPLanguage,
        expectedLength: this.pageContext.expectedOTPLength,
      });
    }
    return this.pageContext;
  }

  refreshContext(): void {
    this.pageContext = null;
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: OTP FILLING
  // ═══════════════════════════════════════════════════════════

  /**
   * Fill OTP code with full intelligence pipeline.
   *
   * Pipeline:
   * 1. Analyze page context
   * 2. Try provided selectors first (highest priority)
   * 3. Discover OTP fields (14 strategies)
   * 4. If not found, watch for dynamic rendering
   * 5. Fill with framework-aware setter
   * 6. Highlight (NOT click) submit button
   */
  async fillOTP(otp: string, fieldSelectors?: string[]): Promise<boolean> {
    if (this.destroyed) {return false;}

    const context = this.getContext();
    const cleanOTP = otp.replace(/[-\s]/g, '');

    if (cleanOTP.length === 0) {
      log.warn('OTP is empty');
      return false;
    }

    log.info('🔑 OTP Fill Pipeline Started', {
      length: cleanOTP.length,
      hasSelectors: !!fieldSelectors?.length,
      page: context.isVerificationPage ? 'verification' : context.is2FAPage ? '2fa' : 'other',
    });

    // ── Step 1: Try provided selectors ────────────────────
    if (fieldSelectors?.length) {
      const result = await this.fillOTPWithSelectors(cleanOTP, fieldSelectors, context);
      if (result) {return true;}
    }

    // ── Step 2: Discover and fill OTP fields ──────────────
    const group = OTPFieldDiscovery.discover(context);

    if (group) {
      this.maybeExpandSplitGroup(group, cleanOTP);

      const result = await OTPFiller.fill(cleanOTP, group, context.framework);
      if (result.success) {
        log.info('✅ OTP filled successfully', {
          strategy: group.strategy,
          isSplit: group.isSplit,
          filledCount: result.filledCount,
        });
        void AutoSubmitDetector.checkAndHighlight(group);
        this.markOTPUsed();
        return true;
      }
    }

    // ── Step 3: Watch for dynamic fields ──────────────────
    log.info('⏳ No OTP fields found yet. Watching for dynamic rendering...');
    const watchResult = await this.fieldWatcher.watch(cleanOTP, context, DYNAMIC_WATCH_TIMEOUT_MS);

    if (watchResult) {
      log.info('✅ OTP filled via dynamic field watcher');
      this.markOTPUsed();
      return true;
    }

    log.warn('OTP fill pipeline exhausted — no fields found');
    return false;
  }

  private async fillOTPWithSelectors(
    cleanOTP: string,
    fieldSelectors: string[],
    context: PageContext
  ): Promise<boolean> {
    const validFields: HTMLInputElement[] = [];

    for (const sel of fieldSelectors) {
      const el = safeQuerySelector<HTMLInputElement>(document, sel);
      if (el && !el.disabled && !el.readOnly) {
        validFields.push(el);
      }
    }

    if (validFields.length === 0) {return false;}

    const isSplit = validFields.length >= MIN_SPLIT_FIELDS && validFields.every((f) => f.maxLength === 1);
    const group: OTPFieldGroup = {
      fields: OTPFieldDiscovery.sortByPosition(validFields),
      score: 100,
      strategy: 'provided-selectors',
      isSplit,
      expectedLength: isSplit ? validFields.length : (validFields[0]?.maxLength > 0 ? validFields[0].maxLength : 6),
      signals: ['provided-selectors'],
    };

    const result = await OTPFiller.fill(cleanOTP, group, context.framework);
    if (result.success) {
      void AutoSubmitDetector.checkAndHighlight(group);
      this.markOTPUsed();
      return true;
    }

    return false;
  }

  /**
   * If a single maxlength=1 field was found for a multi-digit OTP,
   * expand to its sibling fields.
   */
  private maybeExpandSplitGroup(group: OTPFieldGroup, cleanOTP: string): void {
    if (group.isSplit || group.fields.length !== 1 || cleanOTP.length <= 1) {return;}

    const field = group.fields[0];
    if (field.maxLength !== 1) {return;}

    log.info('Single maxlength=1 field detected for multi-digit code. Expanding siblings...');
    const expanded = this.expandSplitGroup(field);

    if (expanded.length >= cleanOTP.length) {
      group.fields = expanded;
      group.isSplit = true;
      group.expectedLength = expanded.length;
      group.signals.push('expanded-split-group');
    }
  }

  private expandSplitGroup(field: HTMLInputElement): HTMLInputElement[] {
    for (let depth = 1; depth <= SPLIT_GROUP_EXPAND_MAX_DEPTH; depth++) {
      let container: Element | null = field;
      for (let i = 0; i < depth && container; i++) {
        container = container.parentElement;
      }
      if (!container) {continue;}

      const inputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('input')
      ).filter(
        (f) =>
          VisibilityEngine.isFillable(f) &&
          NegativePatternMatcher.isOTPCompatibleType(f)
      );

      if (inputs.length >= MIN_SPLIT_FIELDS && inputs.length <= MAX_SPLIT_FIELDS) {
        return OTPFieldDiscovery.sortByPosition(inputs);
      }
    }

    return [field];
  }

  private markOTPUsed(): void {
    safeSendMessage({ action: 'MARK_OTP_USED' }).catch((error) => {
      log.warn('Failed to mark OTP as used', error);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: FIELD FILLING
  // ═══════════════════════════════════════════════════════════

  async fillField(selector: string, value: string): Promise<boolean> {
    if (this.destroyed) {return false;}

    const element = safeQuerySelector<FormInputElement>(document, selector);
    if (!element) {
      log.warn('Field not found', { selector });
      return false;
    }

    return FieldSetter.setValue(element, value, this.getContext().framework);
  }

  async fillCurrentField(value: string, fieldType?: string): Promise<boolean> {
    if (this.destroyed) {return false;}

    const activeElement = document.activeElement;
    const framework = this.getContext().framework;

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      return FieldSetter.setValue(activeElement, value, framework);
    }

    // If no field focused, try to find appropriate field by type
    if (fieldType) {
      const selector = this.getSelectorForFieldType(fieldType);
      const element = safeQuerySelector<HTMLInputElement>(document, selector);
      if (element) {
        return FieldSetter.setValue(element, value, framework);
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: SMART FILL (Full Form Intelligence)
  // ═══════════════════════════════════════════════════════════

  /**
   * Intelligent form fill with adaptive retry and dynamic field detection.
   *
   * Pipeline:
   * 1. Analyze page context & framework
   * 2. Fetch identity + OTP from background
   * 3. Phase 1: AI-detected fields (FieldAnalyzer)
   * 4. Phase 2: Direct field classification
   * 5. Phase 3: Broad selector fallbacks
   * 6. Phase 4: OTP fallback discovery
   * 7. Adaptive retry with exponential backoff
   */
  async smartFill(): Promise<FillResult> {
    if (this.destroyed) {
      return {
        success: false,
        filledCount: 0,
        message: 'AutoFiller destroyed',
        details: [],
        timingMs: 0,
      };
    }

    const startTime = performance.now();
    const context = this.getContext();
    const details: FillDetail[] = [];

    log.info('🧠 Smart Fill Starting', {
      framework: context.framework,
      page: context.isLoginPage
        ? 'login'
        : context.isSignupPage
          ? 'signup'
          : context.isVerificationPage
            ? 'verification'
            : 'other',
      provider: context.provider,
    });

    for (let attempt = 0; attempt < SMART_FILL_RETRY_DELAYS_MS.length; attempt++) {
      const waitMs = SMART_FILL_RETRY_DELAYS_MS[attempt];
      if (waitMs > 0) {
        log.debug(`Smart fill retry ${attempt + 1}, waiting ${waitMs}ms...`);
        await delay(waitMs);
      }

      const filledCount = await this.performSmartFillAttempt(context, details);

      if (filledCount > 0) {
        const timingMs = performance.now() - startTime;
        log.info('✅ Smart Fill Complete', { filledCount, attempt, timingMs: Math.round(timingMs) });
        return {
          success: true,
          filledCount,
          message: `Filled ${filledCount} field(s)`,
          details,
          timingMs,
        };
      }
    }

    const timingMs = performance.now() - startTime;
    log.debug('Smart Fill: No fields filled after all attempts');
    return {
      success: false,
      filledCount: 0,
      message: 'No fillable fields found',
      details,
      timingMs,
    };
  }

  private async performSmartFillAttempt(
    context: PageContext,
    details: FillDetail[]
  ): Promise<number> {
    try {
      // ── Fetch identity + OTP ────────────────────────────
      const { identity, otpCode } = await this.fetchIdentityAndOTP();

      if (!identity && !otpCode) {
        log.warn('No identity or OTP available');
        try {
          pageStatus.error('Open popup first to generate identity, or wait for an OTP', 3000);
        } catch {
          /* pageStatus may not be initialized */
        }
        return 0;
      }

      const filledElements = new Set<HTMLElement>();

      // ── Phase 1: AI-Detected Fields ─────────────────────
      await this.fillAIDetectedFields(context, identity, otpCode, filledElements, details);

      // ── Phase 2: Direct Field Classification ────────────
      await this.fillDirectClassifiedFields(context, identity, otpCode, filledElements, details);

      // ── Phase 3: Broad Selector Fallbacks ───────────────
      if (identity) {
        await this.fillBroadSelectorFallbacks(identity, context.framework, filledElements, details);
      }

      // ── Phase 4: OTP Fallback ───────────────────────────
      if (otpCode) {
        await this.fillOTPFallback(context, otpCode, filledElements, details);
      }

      return filledElements.size;
    } catch (error) {
      log.error('Smart fill attempt failed', error);
      return 0;
    }
  }

  private async fetchIdentityAndOTP(): Promise<{
    identity: IdentityWithCredentials | null;
    otpCode: string | null;
  }> {
    const [identityResponse, otpResponse] = await Promise.allSettled([
      safeSendMessage({ action: 'GET_IDENTITY' }),
      safeSendMessage({ action: 'GET_LAST_OTP' }),
    ]);

    const identity =
      identityResponse.status === 'fulfilled' &&
      identityResponse.value &&
      'success' in identityResponse.value &&
      identityResponse.value.success &&
      'identity' in identityResponse.value
        ? (identityResponse.value.identity as unknown as IdentityWithCredentials)
        : null;

    const otpCode =
      otpResponse.status === 'fulfilled' &&
      otpResponse.value &&
      'lastOTP' in otpResponse.value &&
      otpResponse.value.lastOTP
        ? (otpResponse.value.lastOTP as { code: string }).code
        : null;

    return { identity, otpCode };
  }

  private async fillAIDetectedFields(
    context: PageContext,
    identity: IdentityWithCredentials | null,
    otpCode: string | null,
    filledElements: Set<HTMLElement>,
    details: FillDetail[]
  ): Promise<void> {
    try {
      const analyzer = new FieldAnalyzer();
      const result = await analyzer.getAllFieldsWithAI();
      const detectedFields: DetectedField[] = result.fields ?? [];

      for (const field of detectedFields) {
        if (filledElements.has(field.element)) {continue;}
        if (field.element.disabled || (field.element as HTMLInputElement).readOnly) {continue;}

        const value = this.getValueForFieldType(field.fieldType, identity, otpCode);
        if (!value) {continue;}

        let success = false;
        if (field.fieldType === 'otp' && otpCode) {
          success = await this.fillOTP(otpCode);
        } else {
          success = await FieldSetter.setValue(
            field.element as HTMLInputElement,
            value,
            context.framework
          );
        }

        if (success) {
          filledElements.add(field.element);
          details.push({
            fieldType: field.fieldType,
            selector: field.selector,
            strategy: 'ai-detected',
            success: true,
          });
        }
      }
    } catch {
      log.debug('AI field analysis unavailable, using direct classification');
    }
  }

  private static readonly EXCLUDED_INPUT_TYPES = new Set([
    'hidden', 'submit', 'button', 'reset', 'checkbox',
    'radio', 'file', 'image', 'range', 'color',
  ]);

  private async fillDirectClassifiedFields(
    context: PageContext,
    identity: IdentityWithCredentials | null,
    otpCode: string | null,
    filledElements: Set<HTMLElement>,
    details: FillDetail[]
  ): Promise<void> {
    const allInputs = safeQuerySelectorAll<HTMLInputElement>(document, 'input, textarea').filter(
      (f) =>
        VisibilityEngine.isFillable(f) &&
        !AutoFiller.EXCLUDED_INPUT_TYPES.has(f.type?.toLowerCase() ?? '') &&
        !filledElements.has(f)
    );

    for (const input of allInputs) {
      const fieldType = FieldClassifier.classify(input);
      if (fieldType === 'unknown') {continue;}

      const value = this.getValueForFieldType(fieldType, identity, otpCode);
      if (!value) {continue;}

      let success = false;
      if (fieldType === 'otp' && otpCode) {
        success = await this.fillOTP(otpCode);
      } else {
        success = await FieldSetter.setValue(input, value, context.framework);
      }

      if (success) {
        filledElements.add(input);
        details.push({
          fieldType,
          selector: this.buildSelector(input),
          strategy: 'direct-classification',
          success: true,
        });
      }
    }
  }

  private static readonly BROAD_FALLBACK_DEFINITIONS: ReadonlyArray<{
    identityKey: keyof IdentityWithCredentials;
    selectors: readonly string[];
    fieldType: string;
  }> = [
    {
      identityKey: 'email',
      selectors: [
        'input[type="email"]',
        'input[name*="email" i]', 'input[id*="email" i]',
        'input[autocomplete*="email"]',
        'input[placeholder*="email" i]', 'input[placeholder*="@" i]',
      ],
      fieldType: 'email',
    },
    {
      identityKey: 'password',
      selectors: [
        'input[type="password"]',
        'input[name*="password" i]', 'input[id*="password" i]',
        'input[autocomplete*="password"]',
        'input[autocomplete="new-password"]',
        'input[autocomplete="current-password"]',
      ],
      fieldType: 'password',
    },
    {
      identityKey: 'username',
      selectors: [
        'input[name*="user" i]:not([type="email"]):not([type="password"])',
        'input[id*="user" i]:not([type="email"]):not([type="password"])',
        'input[name*="login" i]:not([type="password"])',
        'input[autocomplete="username"]:not([type="email"])',
      ],
      fieldType: 'username',
    },
    {
      identityKey: 'firstName',
      selectors: [
        'input[name*="first" i][name*="name" i]',
        'input[id*="first" i][id*="name" i]',
        'input[autocomplete="given-name"]',
        'input[placeholder*="first name" i]',
      ],
      fieldType: 'first-name',
    },
    {
      identityKey: 'lastName',
      selectors: [
        'input[name*="last" i][name*="name" i]',
        'input[id*="last" i][id*="name" i]',
        'input[autocomplete="family-name"]',
        'input[placeholder*="last name" i]',
      ],
      fieldType: 'last-name',
    },
    {
      identityKey: 'fullName',
      selectors: [
        'input[name*="full" i][name*="name" i]',
        'input[name="name"]',
        'input[autocomplete="name"]',
        'input[placeholder*="full name" i]',
        'input[placeholder*="your name" i]',
      ],
      fieldType: 'full-name',
    },
  ];

  private async fillBroadSelectorFallbacks(
    identity: IdentityWithCredentials,
    framework: FrameworkType,
    filledElements: Set<HTMLElement>,
    details: FillDetail[]
  ): Promise<void> {
    for (const def of AutoFiller.BROAD_FALLBACK_DEFINITIONS) {
      const value = identity[def.identityKey];
      if (typeof value !== 'string' || !value) {continue;}

      for (const selector of def.selectors) {
        const fields = safeQuerySelectorAll<HTMLInputElement>(document, selector);
        for (const field of fields) {
          if (!VisibilityEngine.isFillable(field) || filledElements.has(field)) {continue;}

          const success = await FieldSetter.setValue(field, value, framework);
          if (success) {
            filledElements.add(field);
            details.push({
              fieldType: def.fieldType,
              selector: selector.slice(0, 60),
              strategy: 'broad-selector',
              success: true,
            });
            log.info(`Filled ${def.fieldType} (broad)`, {
              selector: selector.slice(0, 50),
              id: field.id,
              name: field.name,
            });
          }
        }
      }
    }
  }

  private async fillOTPFallback(
    context: PageContext,
    otpCode: string,
    filledElements: Set<HTMLElement>,
    details: FillDetail[]
  ): Promise<void> {
    const otpGroup = OTPFieldDiscovery.discover(context);
    if (!otpGroup) {return;}

    const alreadyFilled = otpGroup.fields.some((f) => filledElements.has(f));
    if (alreadyFilled) {return;}

    const result = await OTPFiller.fill(otpCode, otpGroup, context.framework);
    if (result.success) {
      otpGroup.fields.forEach((f) => filledElements.add(f));
      details.push({
        fieldType: 'otp',
        selector: 'auto-discovered',
        strategy: `otp-fallback:${otpGroup.strategy}`,
        success: true,
      });
    }
  }

  private getValueForFieldType(
    fieldType: string,
    identity: IdentityWithCredentials | null,
    otpCode: string | null
  ): string | undefined {
    if (fieldType === 'otp') {return otpCode ?? undefined;}
    if (!identity) {return undefined;}

    const fieldMap: Record<string, string | undefined> = {
      'email': identity.email,
      'password': identity.password,
      'confirm-password': identity.password,
      'username': identity.username,
      'first-name': identity.firstName,
      'last-name': identity.lastName,
      'full-name': identity.fullName,
    };

    return fieldMap[fieldType];
  }

  // ═══════════════════════════════════════════════════════════
  //  FORM FILLING
  // ═══════════════════════════════════════════════════════════

  async fillForm(formSelector?: string, data?: Record<string, string>): Promise<boolean> {
    if (this.destroyed) {return false;}

    const form = formSelector
      ? safeQuerySelector<HTMLFormElement>(document, formSelector)
      : safeQuerySelector<HTMLFormElement>(document, 'form');

    if (!form) {
      log.warn('Form not found');
      return false;
    }

    if (data) {
      const framework = this.getContext().framework;
      for (const [field, value] of Object.entries(data)) {
        const input = safeQuerySelector<HTMLInputElement>(
          form,
          `input[name="${escapeCSS(field)}"], input[id="${escapeCSS(field)}"], textarea[name="${escapeCSS(field)}"]`
        );
        if (input) {
          await FieldSetter.setValue(input, value, framework);
        }
      }
    } else {
      await this.smartFill();
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════
  //  CHAMELEON UI: Ghost Icons
  // ═══════════════════════════════════════════════════════════

  private static readonly RELEVANT_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
    'email', 'password', 'confirm-password', 'username',
    'first-name', 'last-name', 'full-name',
  ]);

  private static readonly IDENTITY_FIELD_HINT_PATTERN = /user|login|name|email|phone|address/i;

  async injectIcons(): Promise<void> {
    if (this.destroyed) {return;}
    if (document.body.getAttribute('data-ghost-injected') === 'true') {return;}

    const inputs = document.querySelectorAll<HTMLInputElement>('input');

    for (const input of inputs) {
      if (!VisibilityEngine.isVisible(input) || input.hasAttribute('data-ghost-attached')) {continue;}
      if (input.type === 'hidden' || input.disabled || input.readOnly) {continue;}

      const fieldType = FieldClassifier.classify(input);

      // Only attach icons to identity-relevant fields
      if (
        !AutoFiller.RELEVANT_FIELD_TYPES.has(fieldType) &&
        fieldType !== 'unknown'
      ) {
        continue;
      }

      // For unknown type, check if it looks like an identity field
      if (fieldType === 'unknown' && !this.isLikelyIdentityField(input)) {continue;}

      this.attachGhostIcon(input, fieldType);
    }

    document.body.setAttribute('data-ghost-injected', 'true');
  }

  private isLikelyIdentityField(input: HTMLInputElement): boolean {
    const combined = combineStrings(
      input.name, input.id, input.placeholder, input.getAttribute('aria-label')
    );
    return AutoFiller.IDENTITY_FIELD_HINT_PATTERN.test(combined);
  }

  private attachGhostIcon(input: HTMLInputElement, type: FieldType): void {
    const ghost = document.createElement('ghost-label') as GhostLabelElement;
    document.body.appendChild(ghost);

    if (typeof ghost.attachToAttribute === 'function') {
      ghost.attachToAttribute(input, () => {
        void this.handleGhostIconClick(input, type);
      });
    }

    input.setAttribute('data-ghost-attached', 'true');
  }

  private async handleGhostIconClick(input: HTMLInputElement, type: FieldType): Promise<void> {
    if (this.destroyed) {return;}

    log.info('Ghost Icon Clicked', { type });

    const context = this.getContext();

    try {
      const identityResponse = await safeSendMessage({ action: 'GET_IDENTITY' });

      if (
        identityResponse &&
        'success' in identityResponse &&
        identityResponse.success &&
        'identity' in identityResponse
      ) {
        const identity = identityResponse.identity as unknown as IdentityWithCredentials;
        const value = this.getValueForFieldType(type, identity, null);

        if (value) {
          await FieldSetter.setValue(input, value, context.framework);
          // Also trigger smart fill for the rest of the form
          await this.smartFill();
        }
      }
    } catch (error) {
      log.error('Ghost icon click handler failed', error);
    }
  }

  removeIcons(): void {
    document.querySelectorAll('ghost-label').forEach((icon) => icon.remove());
    document
      .querySelectorAll('[data-ghost-attached]')
      .forEach((el) => el.removeAttribute('data-ghost-attached'));
    document.body?.removeAttribute('data-ghost-injected');
  }

  async clearForm(): Promise<void> {
    if (this.destroyed) {return;}

    const framework = this.pageContext?.framework ?? 'unknown';
    const inputs = safeQuerySelectorAll<HTMLInputElement>(
      document,
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"])'
    );

    for (const input of inputs) {
      if (input.value && VisibilityEngine.isFillable(input)) {
        await FieldSetter.setValue(input, '', framework);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════

  private static readonly FIELD_TYPE_SELECTORS: Readonly<Record<string, string>> = {
    email:
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete*="email"], input[placeholder*="email" i]',
    password:
      'input[type="password"], input[autocomplete*="password"], input[name*="password" i], input[id*="password" i]',
    otp:
      'input[autocomplete="one-time-code"], input[name="code"], input[name="otp"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i]',
    username:
      'input[name*="user" i], input[name*="login" i], input[id*="user" i], input[autocomplete="username"]',
  };

  private getSelectorForFieldType(fieldType: string): string {
    return AutoFiller.FIELD_TYPE_SELECTORS[fieldType] ?? 'input';
  }

  private buildSelector(input: HTMLInputElement): string {
    if (input.id) {return `#${escapeCSS(input.id)}`;}
    if (input.name) {return `input[name="${escapeCSS(input.name)}"]`;}
    if (input.type && input.type !== 'text') {return `input[type="${escapeCSS(input.type)}"]`;}
    return 'input';
  }

  /**
   * Full cleanup — call when extension is being deactivated.
   * After calling destroy(), all methods become no-ops.
   */
  destroy(): void {
    this.destroyed = true;
    this.fieldWatcher.stop();
    this.removeIcons();
    this.pageContext = null;
  }
}
