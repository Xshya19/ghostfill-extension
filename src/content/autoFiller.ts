import type { IdentityProfile } from '../services/identityService';
import { DetectedField } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { FieldAnalyzer } from './fieldAnalyzer';
import { pageStatus } from './pageStatus';
import { PhantomTyper } from './phantomTyper';

const log = createLogger('AutoFiller');

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

type FrameworkType = 'react' | 'vue' | 'angular' | 'svelte' | 'solid' | 'vanilla' | 'unknown';

type FieldType =
  | 'email' | 'password' | 'confirm-password'
  | 'username' | 'first-name' | 'last-name'
  | 'full-name' | 'phone' | 'otp'
  | 'text' | 'unknown';

interface PageContext {
  isVerificationPage: boolean;
  isLoginPage: boolean;
  isSignupPage: boolean;
  isPasswordResetPage: boolean;
  is2FAPage: boolean;
  framework: FrameworkType;
  hasOTPLanguage: boolean;
  expectedOTPLength: number | null;
  provider: string | null;
  pageSignals: string[];
}


// ═══════════════════════════════════════════════════════════════
//  PAGE INTELLIGENCE ENGINE
// ═══════════════════════════════════════════════════════════════

class PageIntelligence {

  static analyze(): PageContext {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.innerText || '').toLowerCase().slice(0, 3000);
    const metaContent = Array.from(document.querySelectorAll('meta'))
      .map(m => (m.getAttribute('content') || '').toLowerCase())
      .join(' ');

    const combinedText = `${url} ${title} ${bodyText} ${metaContent} `;
    const signals: string[] = [];

    // ── Page Type Detection ────────────────────────────────
    const isVerificationPage = this.testSignals(combinedText, [
      /verify|verification|confirm.*email|activate.*account/,
      /enter.*code|enter.*otp|one[- ]?time/,
      /self[- ]?service.*verification/,
      /check.*inbox|code.*sent|we.*sent.*code/,
    ], signals, 'page:verification');

    const isLoginPage = this.testSignals(combinedText, [
      /sign\s*in|log\s*in|login|authenticate/,
    ], signals, 'page:login');

    const isSignupPage = this.testSignals(combinedText, [
      /sign\s*up|register|create\s*account|get\s*started|join/,
    ], signals, 'page:signup');

    const isPasswordResetPage = this.testSignals(combinedText, [
      /reset.*password|forgot.*password|recover.*account|new.*password/,
    ], signals, 'page:password-reset');

    const is2FAPage = this.testSignals(combinedText, [
      /two[- ]?factor|2fa|multi[- ]?factor|mfa|authenticat.*code/,
      /security.*code|backup.*code/,
    ], signals, 'page:2fa');

    const hasOTPLanguage = this.testSignals(combinedText, [
      /otp|one[- ]?time|verification\s*code|security\s*code|pin\s*code/,
      /\d[- ]?digit\s*code|enter\s*code|paste\s*code/,
    ], signals, 'page:otp-language');

    // ── Expected OTP Length Detection ──────────────────────
    let expectedOTPLength: number | null = null;
    const lengthMatch = bodyText.match(/(\d)[- ]?digit\s*(code|otp|pin|number)/i);
    if (lengthMatch) {
      expectedOTPLength = parseInt(lengthMatch[1]);
      signals.push(`page: expected - length - ${expectedOTPLength} `);
    }

    // ── Framework Detection ───────────────────────────────
    const framework = this.detectFramework();
    signals.push(`framework:${framework} `);

    // ── Provider Detection ────────────────────────────────
    const provider = this.detectProvider(url, bodyText);
    if (provider) { signals.push(`provider:${provider} `); }

    return {
      isVerificationPage,
      isLoginPage,
      isSignupPage,
      isPasswordResetPage,
      is2FAPage,
      framework,
      hasOTPLanguage,
      expectedOTPLength,
      provider,
      pageSignals: signals,
    };
  }

  private static testSignals(
    text: string,
    patterns: RegExp[],
    signals: string[],
    signalName: string,
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
    // React
    if (document.querySelector('[data-reactroot]') ||
      document.querySelector('#root') &&
      Object.getPrototypeOf(document.querySelector('#root') || {})?.constructor?.name === 'HTMLDivElement' &&
      Object.keys(document.querySelector('#root') || {}).some(k => k.startsWith('__react'))) {
      return 'react';
    }

    // Check any element for React fiber
    const anyEl = document.querySelector('input') || document.querySelector('div') as HTMLElement | null;
    if (anyEl) {
      const elementKeys = Object.getOwnPropertyNames(anyEl);
      if (elementKeys.some(k =>
        k.startsWith('__reactFiber$') ||
        k.startsWith('__reactInternalInstance$') ||
        k.startsWith('__reactProps$')
      )) {
        return 'react';
      }
    }

    // Vue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((document as any).__vue_app__ ||
      document.querySelector('[data-v-]')) {
      return 'vue';
    }

    // Angular
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).ng ||
      document.querySelector('[ng-version]') ||
      document.querySelector('[_nghost]') ||
      document.querySelector('[ng-app]')) {
      return 'angular';
    }

    // Svelte
    if (document.querySelector('[class*="svelte-"]')) {
      return 'svelte';
    }

    // Solid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any)._$HY || document.querySelector('[data-hk]')) {
      return 'solid';
    }

    return 'unknown';
  }

  private static detectProvider(url: string, text: string): string | null {
    const providers: Array<[RegExp, string]> = [
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
      [/auth\..*\.com/i, 'Custom Auth'],
      [/linear\.app/i, 'Linear'],
      [/notion\.so/i, 'Notion'],
      [/github\.com/i, 'GitHub'],
      [/gitlab\.com/i, 'GitLab'],
      [/slack\.com/i, 'Slack'],
      [/discord\.com/i, 'Discord'],
      [/vercel\.com/i, 'Vercel'],
      [/stripe\.com/i, 'Stripe'],
      [/mistral\.ai/i, 'Mistral'],
      [/microsoft\.com|login\.live/i, 'Microsoft'],
      [/google\.com.*accounts/i, 'Google'],
      [/apple\.com.*appleid/i, 'Apple'],
    ];

    for (const [pattern, name] of providers) {
      if (pattern.test(url) || pattern.test(text)) { return name; }
    }
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════
//  FRAMEWORK-AWARE FIELD SETTER
// ═══════════════════════════════════════════════════════════════

class FieldSetter {

  /**
   * Set value with full framework compatibility.
   * Tries multiple strategies in order until one works.
   */
  static async setValue(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _framework: FrameworkType = 'unknown',
  ): Promise<boolean> {
    // Strategy 1: PhantomTyper (handles most frameworks via event simulation)
    try {
      await PhantomTyper.typeSimulatedString(element, value);
      if (element.value === value) { return true; }
    } catch { /* fall through */ }

    // Strategy 2: Native setter + synthetic events (React-optimized)
    try {
      const success = this.setViaNativeSetter(element, value);
      if (success && element.value === value) { return true; }
    } catch { /* fall through */ }

    // Strategy 3: InputEvent with data property (modern frameworks)
    try {
      this.setViaInputEvent(element, value);
      if (element.value === value) { return true; }
    } catch { /* fall through */ }

    // Strategy 4: execCommand insertText (works in contenteditable and some frameworks)
    try {
      element.focus();
      element.select();
      document.execCommand('insertText', false, value);
      if (element.value === value) { return true; }
    } catch { /* fall through */ }

    // Strategy 5: Direct assignment + full event chain
    try {
      element.value = value;
      this.dispatchFullEventChain(element, value);
      return element.value === value;
    } catch {
      return false;
    }
  }

  /**
   * Set single character (for split OTP fields)
   */
  static async setChar(
    element: HTMLInputElement,
    char: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _framework: FrameworkType = 'unknown',
  ): Promise<boolean> {
    try {
      // Use the exact same PhantomTyper engine as email/password to ensure human-like typing
      await PhantomTyper.typeSimulatedString(element, char);

      // Some split fields auto-skip or format, so we just check if it's not empty 
      // or if it includes our character.
      return element.value.includes(char) || element.value.length > 0;
    } catch {
      // Fallback to legacy assignment if PhantomTyper crashes
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(element, char);
      } else {
        element.value = char;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return element.value === char;
    }
  }

  private static setViaNativeSetter(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): boolean {
    const proto = element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;

    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    if (!nativeSetter) { return false; }

    element.focus();
    nativeSetter.call(element, value);

    // React-compatible event
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  private static setViaInputEvent(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void {
    element.focus();
    element.value = '';

    // Type each character with InputEvent
    for (const char of value) {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: char,
      }));

      element.value += char;

      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: false,
        inputType: 'insertText',
        data: char,
      }));
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private static dispatchFullEventChain(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void {
    // Focus events
    element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

    // Input event
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertText',
      data: value,
    }));

    // Change event
    element.dispatchEvent(new Event('change', { bubbles: true }));

    // Blur events
    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }


}


// ═══════════════════════════════════════════════════════════════
//  OTP FIELD DISCOVERY ENGINE (14 Strategies)
// ═══════════════════════════════════════════════════════════════

class OTPFieldDiscovery {

  static discover(context: PageContext): OTPFieldGroup | null {
    const strategies: Array<{
      name: string;
      fn: () => OTPFieldGroup | null;
      baseScore: number;
    }> = [
        // ── Tier 1: Explicit OTP Attributes (highest confidence) ──
        {
          name: 'S1:autocomplete-one-time-code',
          fn: () => this.findBySelector(
            'input[autocomplete="one-time-code"]',
            'autocomplete-otc', 100
          ),
          baseScore: 100,
        },
        {
          name: 'S2:explicit-otp-names',
          fn: () => this.findBySelector(
            'input[name="otp"], input[name="otc"], input[name="one-time-code"], input[name="oneTimeCode"]',
            'explicit-name', 95
          ),
          baseScore: 95,
        },

        // ── Tier 2: Split-Digit Detection ──────────────────────
        {
          name: 'S3:split-digit-maxlength1',
          fn: () => this.findSplitDigitFields(context),
          baseScore: 90,
        },

        // ── Tier 3: Semantic Containers ────────────────────────
        {
          name: 'S4:otp-container-class',
          fn: () => this.findInSemanticContainers(context),
          baseScore: 85,
        },

        // ── Tier 4: ARIA & Accessibility ───────────────────────
        {
          name: 'S5:aria-labels',
          fn: () => this.findBySelector(
            [
              'input[aria-label*="otp" i]',
              'input[aria-label*="verification" i]',
              'input[aria-label*="code" i]:not([aria-label*="postal" i]):not([aria-label*="zip" i]):not([aria-label*="country" i])',
              'input[aria-label*="digit" i]',
              'input[aria-label*="pin" i]',
            ].join(','),
            'aria-label', 80
          ),
          baseScore: 80,
        },

        // ── Tier 5: Name/ID Pattern Matching ───────────────────
        {
          name: 'S6:name-id-patterns',
          fn: () => this.findBySelector(
            [
              'input[name*="otp" i]',
              'input[id*="otp" i]',
              'input[name*="verification" i][name*="code" i]',
              'input[name="code"]',
              'input[name="pin"]',
              'input[name*="passcode" i]',
              'input[id*="verification" i][id*="code" i]',
              'input[id*="pin-input" i]',
            ].join(','),
            'name-id-pattern', 75
          ),
          baseScore: 75,
        },

        // ── Tier 6: Placeholder Patterns ───────────────────────
        {
          name: 'S7:placeholder-patterns',
          fn: () => this.findBySelector(
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
            'placeholder-pattern', 70
          ),
          baseScore: 70,
        },

        // ── Tier 7: Data-TestID (Developer conventions) ────────
        {
          name: 'S8:data-testid',
          fn: () => this.findBySelector(
            [
              'input[data-testid*="otp" i]',
              'input[data-testid*="code" i]',
              'input[data-testid*="verify" i]',
              'input[data-testid*="pin" i]',
              'input[data-cy*="otp" i]',
              'input[data-cy*="code" i]',
            ].join(','),
            'data-testid', 75
          ),
          baseScore: 75,
        },

        // ── Tier 8: Maxlength-Based Single Field ───────────────
        {
          name: 'S9:maxlength-single',
          fn: () => this.findMaxlengthFields(context),
          baseScore: 60,
        },

        // ── Tier 9: InputMode Numeric ──────────────────────────
        {
          name: 'S10:inputmode-numeric',
          fn: () => this.findInputModeNumeric(context),
          baseScore: 55,
        },

        // ── Tier 10: Contextual Text Proximity ─────────────────
        {
          name: 'S11:text-proximity',
          fn: () => this.findByTextProximity(context),
          baseScore: 50,
        },

        // ── Tier 11: Shadow DOM Piercing ───────────────────────
        {
          name: 'S12:shadow-dom',
          fn: () => this.findInShadowDOM(context),
          baseScore: 65,
        },

        // ── Tier 12: Brute Force (page context required) ───────
        {
          name: 'S13:brute-force-context',
          fn: () => this.bruteForceWithContext(context),
          baseScore: 35,
        },

        // ── Tier 13: Verification Page Any-Input ───────────────
        {
          name: 'S14:verification-page-any-input',
          fn: () => this.verificationPageFallback(context),
          baseScore: 25,
        },
      ];

    // Execute strategies in order until one succeeds
    for (const strategy of strategies) {
      try {
        const result = strategy.fn();
        if (result && result.fields.length > 0) {
          result.strategy = strategy.name;
          result.score = strategy.baseScore;
          result.signals.push(`matched:${strategy.name} `);

          // Apply context bonuses
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
            result.signals.push(`bonus: provider - ${context.provider} `);
          }

          // Validate expected length match
          if (context.expectedOTPLength && result.isSplit) {
            if (result.fields.length !== context.expectedOTPLength) {
              result.score -= 10;
              result.signals.push(`penalty: length - mismatch(expected = ${context.expectedOTPLength}, got = ${result.fields.length})`);
            } else {
              result.score += 10;
              result.signals.push('bonus:length-match');
            }
          }

          log.info(`✅ OTP fields found via ${strategy.name} `, {
            count: result.fields.length,
            score: result.score,
            isSplit: result.isSplit,
            signals: result.signals,
          });

          return result;
        }
      } catch (e) {
        log.debug(`Strategy ${strategy.name} threw: `, e);
      }
    }

    log.warn('❌ No OTP fields found after all 14 strategies');
    return null;
  }

  // ── Strategy Implementations ────────────────────────────────

  private static findBySelector(
    selector: string,
    strategyName: string,
    score: number,
  ): OTPFieldGroup | null {
    const fields = this.queryVisible(selector);
    if (fields.length === 0) { return null; }

    const isSplit = fields.every(f => f.maxLength === 1) && fields.length >= 4;

    return {
      fields: this.sortByPosition(fields),
      score,
      strategy: strategyName,
      isSplit,
      expectedLength: isSplit ? fields.length : (fields[0]?.maxLength || 6),
      signals: [`found:${fields.length} -fields`],
    };
  }

  private static findSplitDigitFields(_context: PageContext): OTPFieldGroup | null {
    // Find all single-char inputs
    const singleInputs = this.queryVisible(
      'input[maxlength="1"]'
    ).filter(f => {
      const type = f.type.toLowerCase();
      return type === 'text' || type === 'tel' || type === 'number' || type === 'password' || type === '';
    });

    if (singleInputs.length < 4) { return null; }

    // Group by common parent container
    const groups = this.groupByCommonAncestor(singleInputs);

    // Find the best group (4-8 inputs in a single container)
    let bestGroup: HTMLInputElement[] = [];
    for (const group of groups) {
      if (group.length >= 4 && group.length <= 8 && group.length > bestGroup.length) {
        bestGroup = group;
      }
    }

    if (bestGroup.length < 4) {
      // Fallback: if all single inputs are 4-8, use them all
      if (singleInputs.length >= 4 && singleInputs.length <= 8) {
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
      signals: [`split - group:${bestGroup.length} -inputs`],
    };
  }

  private static findInSemanticContainers(_context: PageContext): OTPFieldGroup | null {
    const containerSelectors = [
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

    for (const selector of containerSelectors) {
      try {
        const containers = document.querySelectorAll(selector);
        for (const container of containers) {
          const inputs = this.queryVisibleWithin(container, 'input');

          if (inputs.length >= 1 && inputs.length <= 12) {
            const isSplit = inputs.length >= 4 && inputs.every(f => f.maxLength === 1);
            return {
              fields: this.sortByPosition(inputs),
              score: 85,
              strategy: `container:${selector.slice(0, 30)} `,
              isSplit,
              expectedLength: isSplit ? inputs.length : (inputs[0]?.maxLength || 6),
              signals: [`container:${selector} `, `inputs:${inputs.length} `],
            };
          }
        }
      } catch { /* invalid selector, skip */ }
    }

    return null;
  }

  private static findMaxlengthFields(context: PageContext): OTPFieldGroup | null {
    // Standard OTP lengths
    const lengths = context.expectedOTPLength
      ? [context.expectedOTPLength]
      : [6, 4, 8, 5, 7];

    for (const len of lengths) {
      const fields = this.queryVisible(`input[maxlength = "${len}"]`)
        .filter(f => {
          const type = f.type.toLowerCase();
          return type !== 'password' && type !== 'email' && type !== 'search';
        })
        .filter(f => !this.isLikelyNotOTP(f));

      if (fields.length > 0) {
        return {
          fields: [fields[0]], // Take the first matching field
          score: 60,
          strategy: `maxlength - ${len} `,
          isSplit: false,
          expectedLength: len,
          signals: [`maxlength:${len} `, `fields:${fields.length} `],
        };
      }
    }

    return null;
  }

  private static findInputModeNumeric(context: PageContext): OTPFieldGroup | null {
    if (!context.isVerificationPage && !context.is2FAPage && !context.hasOTPLanguage) {
      return null; // Only use this strategy on verification pages
    }

    const fields = this.queryVisible('input[inputmode="numeric"]')
      .filter(f => {
        const type = f.type.toLowerCase();
        return type !== 'password' && type !== 'email' && type !== 'search';
      })
      .filter(f => !this.isLikelyNotOTP(f));

    if (fields.length === 0) { return null; }

    // Check if split or single
    const isSplit = fields.length >= 4 && fields.every(f => f.maxLength === 1);

    return {
      fields: isSplit ? this.sortByPosition(fields) : [fields[0]],
      score: 55,
      strategy: 'inputmode-numeric',
      isSplit,
      expectedLength: isSplit ? fields.length : (fields[0]?.maxLength || 6),
      signals: [`inputmode - numeric:${fields.length} -fields`],
    };
  }

  private static findByTextProximity(_context: PageContext): OTPFieldGroup | null {
    // Find text nodes that mention codes, then find nearby inputs
    const codePatterns = [
      /enter\s*(your|the)?\s*(code|otp|pin)/i,
      /verification\s*code/i,
      /one[- ]?time\s*(code|password|passcode)/i,
      /security\s*code/i,
      /we.*sent.*code/i,
      /code.*sent.*to/i,
      /\d[- ]?digit\s*code/i,
    ];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );

    while (walker.nextNode()) {
      const text = walker.currentNode.textContent || '';
      const matchesCode = codePatterns.some(p => p.test(text));

      if (!matchesCode) { continue; }

      // Found code-related text. Look for nearby inputs.
      let parent: Element | null = walker.currentNode.parentElement;
      for (let depth = 0; depth < 5 && parent; depth++) {
        const inputs = this.queryVisibleWithin(parent, 'input');
        const filtered = inputs.filter(f => {
          const type = f.type.toLowerCase();
          return type !== 'email' && type !== 'password' && type !== 'search' && type !== 'hidden';
        }).filter(f => !this.isLikelyNotOTP(f));

        if (filtered.length >= 1 && filtered.length <= 8) {
          const isSplit = filtered.length >= 4 && filtered.every(f => f.maxLength === 1);
          return {
            fields: isSplit ? this.sortByPosition(filtered) : [filtered[0]],
            score: 50,
            strategy: 'text-proximity',
            isSplit,
            expectedLength: isSplit ? filtered.length : (filtered[0]?.maxLength || 6),
            signals: [`proximity:${text.trim().slice(0, 40)} `],
          };
        }
        parent = parent.parentElement;
      }
    }

    return null;
  }

  private static findInShadowDOM(_context: PageContext): OTPFieldGroup | null {
    const shadowHosts = document.querySelectorAll('*');
    for (const host of shadowHosts) {
      if (!host.shadowRoot) { continue; }

      const inputs = Array.from(
        host.shadowRoot.querySelectorAll<HTMLInputElement>('input')
      ).filter(f => this.isVisibleElement(f) && !f.disabled && !f.readOnly);

      const otpInputs = inputs.filter(f => {
        const name = (f.name || '').toLowerCase();
        const id = (f.id || '').toLowerCase();
        const placeholder = (f.placeholder || '').toLowerCase();
        const autocomplete = (f.autocomplete || '').toLowerCase();

        return autocomplete === 'one-time-code' ||
          /otp|code|pin|verification/.test(name + id + placeholder);
      });

      if (otpInputs.length > 0) {
        const isSplit = otpInputs.length >= 4 && otpInputs.every(f => f.maxLength === 1);
        return {
          fields: this.sortByPosition(otpInputs),
          score: 65,
          strategy: 'shadow-dom',
          isSplit,
          expectedLength: isSplit ? otpInputs.length : (otpInputs[0]?.maxLength || 6),
          signals: ['shadow-dom:found'],
        };
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
    ).filter(f => !f.disabled && !f.readOnly && !this.isLikelyNotOTP(f));

    // If exactly 4, 5, 6, 7, or 8 inputs visible and page has code context
    const validCounts = [4, 5, 6, 7, 8];
    if (validCounts.includes(allInputs.length)) {
      const allSameMaxLength = allInputs.every(f =>
        f.maxLength === allInputs[0].maxLength
      );

      if (allSameMaxLength) {
        const isSplit = allInputs[0].maxLength === 1;
        return {
          fields: this.sortByPosition(allInputs),
          score: 35,
          strategy: 'brute-force',
          isSplit,
          expectedLength: isSplit ? allInputs.length : (allInputs[0].maxLength || 6),
          signals: [`brute - force:${allInputs.length} -inputs`, 'page-context-match'],
        };
      }
    }

    return null;
  }

  private static verificationPageFallback(context: PageContext): OTPFieldGroup | null {
    if (!context.isVerificationPage && !context.is2FAPage) { return null; }

    // Relaxed visibility: include opacity:0 and tiny inputs (Mistral pattern)
    const allInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(
        'input[type="text"], input[type="tel"], input[type="number"], input:not([type])'
      )
    ).filter(f => {
      if (f.disabled || f.readOnly || f.type === 'hidden') { return false; }
      const style = window.getComputedStyle(f);
      return style.display !== 'none';
      // NOTE: We do NOT check opacity or size here — intentionally relaxed
    });

    if (allInputs.length === 0) { return null; }

    // Pick the most "code-like" input
    let bestInput: HTMLInputElement | null = null;
    let bestScore = -Infinity;

    for (const input of allInputs) {
      let score = 0;
      const name = (input.name || '').toLowerCase();
      const id = (input.id || '').toLowerCase();
      const placeholder = (input.placeholder || '').toLowerCase();
      const autocomplete = (input.autocomplete || '').toLowerCase();

      if (autocomplete === 'one-time-code') { score += 50; }
      if (/otp|code|pin|verification|token/.test(name + id)) { score += 30; }
      if (/code|otp|pin|digit|verification/.test(placeholder)) { score += 25; }
      if (input.inputMode === 'numeric') { score += 15; }
      if (input.maxLength >= 4 && input.maxLength <= 8) { score += 20; }
      if (input.type === 'tel') { score += 10; }
      if (input.pattern && /\\d/.test(input.pattern)) { score += 10; }

      // Penalize fields that look like other things
      if (/email|name|address|phone|search|url|zip|postal/.test(name + id + placeholder)) { score -= 40; }
      if (input.type === 'email' || input.type === 'password' || input.type === 'search') { score -= 50; }

      if (score > bestScore) {
        bestScore = score;
        bestInput = input;
      }
    }

    if (!bestInput || bestScore < 0) { return null; }

    return {
      fields: [bestInput],
      score: 25,
      strategy: 'verification-page-fallback',
      isSplit: false,
      expectedLength: bestInput.maxLength > 0 ? bestInput.maxLength : 6,
      signals: ['verification-page', `best - score:${bestScore} `],
    };
  }

  // ── Utility Methods ─────────────────────────────────────────

  private static queryVisible(selector: string): HTMLInputElement[] {
    try {
      return Array.from(
        document.querySelectorAll<HTMLInputElement>(selector)
      ).filter(f => this.isVisibleElement(f) && !f.disabled && !f.readOnly);
    } catch {
      return [];
    }
  }

  private static queryVisibleWithin(container: Element, selector: string): HTMLInputElement[] {
    return Array.from(
      container.querySelectorAll<HTMLInputElement>(selector)
    ).filter(f => this.isVisibleElement(f) && !f.disabled && !f.readOnly);
  }

  private static groupByCommonAncestor(inputs: HTMLInputElement[]): HTMLInputElement[][] {
    const groups = new Map<Element, HTMLInputElement[]>();

    for (const input of inputs) {
      // Try parent, grandparent, great-grandparent
      let container: Element | null = input.parentElement;
      for (let depth = 0; depth < 3 && container; depth++) {
        const siblings = Array.from(
          container.querySelectorAll<HTMLInputElement>('input[maxlength="1"]')
        ).filter(f => this.isVisibleElement(f) && !f.disabled && !f.readOnly);

        if (siblings.length >= 4 && siblings.length <= 8) {
          const key = container;
          if (!groups.has(key)) {
            groups.set(key, siblings);
          }
          break;
        }
        container = container.parentElement;
      }
    }

    return Array.from(groups.values());
  }

  private static isLikelyNotOTP(input: HTMLInputElement): boolean {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const autocomplete = (input.autocomplete || '').toLowerCase();
    const combined = name + id + placeholder + autocomplete;

    // Definite non-OTP patterns
    if (/email|mail/.test(combined)) { return true; }
    if (/search/.test(combined)) { return true; }
    if (/phone|tel|mobile/.test(combined) && input.maxLength !== 1) { return true; }
    if (/address|street|city|state|country|zip|postal/.test(combined)) { return true; }
    if (/name|first|last|full|middle/.test(combined)) { return true; }
    if (/card|cvv|ccv|cvc|expir|credit|debit/.test(combined)) { return true; }
    if (/promo|coupon|discount|gift|voucher|referral/.test(combined)) { return true; }
    if (/comment|message|note|description|bio/.test(combined)) { return true; }
    if (/url|website|link|domain/.test(combined)) { return true; }
    if (/company|organization|org/.test(combined)) { return true; }
    if (input.type === 'email' || input.type === 'search' || input.type === 'url') { return true; }

    return false;
  }

  static isVisibleElement(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }

  static sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
    return [...inputs].sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      // Row first (with 10px tolerance), then column
      if (Math.abs(rectA.top - rectB.top) > 10) { return rectA.top - rectB.top; }
      return rectA.left - rectB.left;
    });
  }
}


// ═══════════════════════════════════════════════════════════════
//  OTP FILLER ENGINE
// ═══════════════════════════════════════════════════════════════

class OTPFiller {

  /**
   * Fill OTP into discovered fields with full intelligence
   */
  static async fill(
    otp: string,
    group: OTPFieldGroup,
    framework: FrameworkType,
  ): Promise<{ success: boolean; filledCount: number; strategy: string }> {

    const cleanOTP = otp.replace(/[-\s]/g, '');

    if (group.isSplit) {
      return this.fillSplit(cleanOTP, group.fields, framework);
    } else {
      return this.fillSingle(otp, group.fields[0], framework);
    }
  }

  private static async fillSingle(
    otp: string,
    field: HTMLInputElement,
    framework: FrameworkType,
  ): Promise<{ success: boolean; filledCount: number; strategy: string }> {

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
    framework: FrameworkType,
  ): Promise<{ success: boolean; filledCount: number; strategy: string }> {

    let filledCount = 0;
    const total = Math.min(digits.length, fields.length);

    log.info(`Filling ${total} split OTP fields...`);

    for (let i = 0; i < total; i++) {
      const field = fields[i];
      const char = digits[i];

      // Blur previous field
      if (i > 0 && fields[i - 1]) {
        fields[i - 1].dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        fields[i - 1].dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }

      // Small delay between digits (allows auto-tab to work)
      if (i > 0) {
        await this.delay(40);
      }

      // Focus this field
      field.focus();
      field.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Clear existing value
      if (field.value) {
        field.value = '';
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Set the character
      const success = await FieldSetter.setChar(field, char, framework);

      if (success) {
        filledCount++;
      } else {
        log.warn(`Failed to fill digit ${i + 1} `, { char, fieldIndex: i });
      }
    }

    // Blur last field to trigger validation/auto-submit
    if (fields.length > 0) {
      const lastField = fields[Math.min(total - 1, fields.length - 1)];
      await this.delay(50);
      lastField.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      lastField.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }

    const success = filledCount === total;
    log.info(`Split OTP fill: ${filledCount}/${total} digits`, { success });

    return { success, filledCount, strategy: 'split-field' };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}


// ═══════════════════════════════════════════════════════════════
//  AUTO-SUBMIT DETECTION
// ═══════════════════════════════════════════════════════════════

class AutoSubmitDetector {

  /**
   * After filling OTP, check if we should auto-submit
   */
  static async checkAndSubmit(group: OTPFieldGroup): Promise<boolean> {
    // Wait for any auto-submit triggered by the fill itself
    await new Promise(r => setTimeout(r, 1000));

    // Check if page already navigated or form was submitted
    if (this.hasPageChanged()) { return true; }

    // Look for submit buttons near the OTP fields
    const submitButton = this.findSubmitButton(group);
    if (submitButton) {
      log.info('Found submit button, but NOT auto-clicking (user should control submission)');
      // We intentionally do NOT auto-submit. Just highlight the button.
      submitButton.style.outline = '2px solid #4CAF50';
      submitButton.style.outlineOffset = '2px';
      setTimeout(() => {
        submitButton.style.outline = '';
        submitButton.style.outlineOffset = '';
      }, 3000);
    }

    return false;
  }

  private static hasPageChanged(): boolean {
    // Check if a navigation or redirect happened
    return false; // Can't easily detect this synchronously
  }

  private static findSubmitButton(group: OTPFieldGroup): HTMLElement | null {
    const field = group.fields[0];
    if (!field) { return null; }

    // Walk up to find the form or container
    const form = field.closest('form');
    const container = form || field.closest('[class*="otp"]') || field.closest('[class*="verify"]') || field.parentElement?.parentElement?.parentElement;

    if (!container) { return null; }

    // Look for submit-like buttons
    const buttonSelectors = [
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

    for (const selector of buttonSelectors) {
      const button = container.querySelector<HTMLElement>(selector);
      if (button && OTPFieldDiscovery.isVisibleElement(button)) {
        // Verify it's a real submit button by checking text
        const text = (button.textContent || '').toLowerCase().trim();
        if (/verify|confirm|submit|continue|next|send|done|log\s*in|sign\s*in/.test(text)) {
          return button;
        }
      }
    }

    return null;
  }
}


// ═══════════════════════════════════════════════════════════════
//  DYNAMIC FIELD WATCHER (MutationObserver)
// ═══════════════════════════════════════════════════════════════

class FieldWatcher {
  private observer: MutationObserver | null = null;
  private pendingOTP: string | null = null;
  private pendingContext: PageContext | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  watch(otp: string, context: PageContext, timeoutMs: number = 10000): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingOTP = otp;
      this.pendingContext = context;

      const checkFields = async () => {
        if (!this.pendingOTP || !this.pendingContext) { return; }

        const group = OTPFieldDiscovery.discover(this.pendingContext);
        if (group) {
          // Save values before stop() clears them
          const otpToFill = this.pendingOTP;
          const frameworkToUse = this.pendingContext?.framework || 'unknown';
          this.stop();

          if (otpToFill) {
            const result = await OTPFiller.fill(
              otpToFill,
              group,
              frameworkToUse,
            );
            resolve(result.success);
          } else {
            resolve(false);
          }
        }
      };

      this.observer = new MutationObserver(() => {
        // Debounce: DOM changes come in bursts
        if (this.timeout) { clearTimeout(this.timeout); }
        this.timeout = setTimeout(checkFields, 300);
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'disabled'],
      });

      // Polling fallback every 1s for static pages
      const pollingInterval = setInterval(checkFields, 1000) as unknown as number;

      // Safety timeout
      setTimeout(() => {
        clearInterval(pollingInterval);
        this.stop();
        resolve(false);
      }, timeoutMs);

      // Patch stop method to clearly remove pollingInterval
      const originalStop = this.stop.bind(this);
      this.stop = () => {
        clearInterval(pollingInterval);
        originalStop();
      };
    });
  }

  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.pendingOTP = null;
    this.pendingContext = null;
  }
}


// ═══════════════════════════════════════════════════════════════
//  FIELD TYPE CLASSIFIER
// ═══════════════════════════════════════════════════════════════

class FieldClassifier {

  static classify(input: HTMLInputElement | HTMLTextAreaElement): FieldType {
    const type = (input.type || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const autocomplete = (input.autocomplete || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const label = this.findLabelText(input).toLowerCase();

    const all = `${type}|${name}|${id}|${placeholder}|${autocomplete}|${ariaLabel}|${label}`;

    // ── Priority 1: HTML type attribute ───────────────────
    if (type === 'email') { return 'email'; }
    if (type === 'password') {
      // Check if it's confirm password
      if (/confirm|repeat|retype|re-enter|again|match/.test(all)) {
        return 'confirm-password';
      }
      return 'password';
    }

    // ── Priority 2: autocomplete attribute ────────────────
    if (autocomplete === 'one-time-code') { return 'otp'; }
    if (autocomplete === 'email') { return 'email'; }
    if (/^(new-password|current-password)$/.test(autocomplete)) { return 'password'; }
    if (autocomplete === 'username') { return 'username'; }
    if (autocomplete === 'given-name') { return 'first-name'; }
    if (autocomplete === 'family-name') { return 'last-name'; }
    if (autocomplete === 'name') { return 'full-name'; }
    if (autocomplete === 'tel') { return 'phone'; }

    // ── Priority 3: Name/ID/Label keyword matching ────────
    if (/e[-_]?mail|email/.test(name + id) || /email/.test(label)) { return 'email'; }

    // OTP
    if (/otp|one[-_]?time|verification[-_]?code|passcode/.test(all)) { return 'otp'; }
    if (/^code$|^pin$|^token$/.test(name) || /^code$|^pin$/.test(id)) { return 'otp'; }

    // Password
    if (/password|passwd|pwd|pass[-_]?word/.test(name + id)) {
      if (/confirm|repeat|retype|re-enter|again/.test(all)) { return 'confirm-password'; }
      return 'password';
    }

    // Name fields
    if (/first[-_]?name|given[-_]?name|fname/.test(name + id) || /first\s*name/.test(label)) { return 'first-name'; }
    if (/last[-_]?name|family[-_]?name|surname|lname/.test(name + id) || /last\s*name|surname/.test(label)) { return 'last-name'; }
    if (/full[-_]?name|your[-_]?name|display[-_]?name/.test(name + id) || /full\s*name|your\s*name/.test(label)) { return 'full-name'; }

    // Username
    if (/user[-_]?name|login[-_]?name|login[-_]?id|user[-_]?id/.test(name + id) || /username/.test(label)) { return 'username'; }

    // Phone
    if (/phone|mobile|tel(?:ephone)?|cell/.test(name + id) || /phone/.test(label)) { return 'phone'; }

    // ── Priority 4: Placeholder patterns ──────────────────
    if (/@/.test(placeholder) || /email|e-mail/.test(placeholder)) { return 'email'; }
    if (/password/.test(placeholder)) { return 'password'; }
    if (/username/.test(placeholder)) { return 'username'; }
    if (/code|otp|pin|digit/.test(placeholder)) { return 'otp'; }

    return 'unknown';
  }

  private static findLabelText(input: HTMLElement): string {
    // Explicit label via for attribute
    if (input.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
      if (label) { return label.textContent?.trim() || ''; }
    }

    // Parent label
    const parentLabel = input.closest('label');
    if (parentLabel) { return parentLabel.textContent?.trim() || ''; }

    // aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) { return labelEl.textContent?.trim() || ''; }
    }

    // aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) { return ariaLabel; }

    // Previous sibling or parent text
    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.tagName !== 'INPUT') {
      return prevSibling.textContent?.trim() || '';
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

  // ── Page Context (cached with refresh) ──────────────────

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
   * 2. Discover OTP fields (14 strategies)
   * 3. If not found, watch for dynamic rendering
   * 4. Fill with framework-aware setter
   * 5. Detect auto-submit opportunity
   */
  async fillOTP(otp: string, fieldSelectors?: string[]): Promise<boolean> {
    const context = this.getContext();
    const cleanOTP = otp.replace(/[-\s]/g, '');

    log.info('🔑 OTP Fill Pipeline Started', {
      length: cleanOTP.length,
      hasSelectors: !!fieldSelectors?.length,
      page: context.isVerificationPage ? 'verification' : context.is2FAPage ? '2fa' : 'other',
    });

    // ── Step 1: Try provided selectors first ──────────────
    if (fieldSelectors?.length) {
      const validFields: HTMLInputElement[] = [];
      for (const sel of fieldSelectors) {
        try {
          const el = document.querySelector<HTMLInputElement>(sel);
          if (el && !el.disabled && !el.readOnly) { validFields.push(el); }
        } catch {
          log.debug('Invalid selector, skipping:', sel);
        }
      }

      if (validFields.length > 0) {
        const isSplit = validFields.length >= 4 && validFields.every(f => f.maxLength === 1);
        const group: OTPFieldGroup = {
          fields: OTPFieldDiscovery.sortByPosition(validFields),
          score: 100,
          strategy: 'provided-selectors',
          isSplit,
          expectedLength: isSplit ? validFields.length : (validFields[0]?.maxLength || 6),
          signals: ['provided-selectors'],
        };

        const result = await OTPFiller.fill(cleanOTP, group, context.framework);
        if (result.success) {
          AutoSubmitDetector.checkAndSubmit(group);
          return true;
        }
      }
    }

    // ── Step 2: Discover OTP fields ───────────────────────
    const group = OTPFieldDiscovery.discover(context);

    if (group) {
      // Check for split-field expansion
      if (!group.isSplit && group.fields.length === 1 && cleanOTP.length > 1) {
        const field = group.fields[0];
        if (field.maxLength === 1) {
          log.info('Single maxlength=1 field detected for multi-digit code. Expanding siblings...');
          const expanded = this.expandSplitGroup(field);
          if (expanded.length >= cleanOTP.length) {
            group.fields = expanded;
            group.isSplit = true;
            group.expectedLength = expanded.length;
            group.signals.push('expanded-split-group');
          }
        }
      }

      const result = await OTPFiller.fill(cleanOTP, group, context.framework);

      if (result.success) {
        log.info('✅ OTP filled successfully', {
          strategy: group.strategy,
          isSplit: group.isSplit,
          filledCount: result.filledCount,
        });
        AutoSubmitDetector.checkAndSubmit(group);
        return true;
      }
    }

    // ── Step 3: Watch for dynamic fields ──────────────────
    log.info('⏳ No OTP fields found yet. Watching for dynamic rendering...');
    const watchResult = await this.fieldWatcher.watch(cleanOTP, context, 8000);

    if (watchResult) {
      log.info('✅ OTP filled via dynamic field watcher');
      return true;
    }

    return false;
  }

  /**
   * Expand a single-char field into its sibling group
   */
  private expandSplitGroup(field: HTMLInputElement): HTMLInputElement[] {
    // Try progressively wider parent searches
    const searchDepths = [1, 2, 3, 4];

    for (const depth of searchDepths) {
      let container: Element | null = field;
      for (let i = 0; i < depth && container; i++) {
        container = container.parentElement;
      }
      if (!container) { continue; }

      const inputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('input')
      ).filter(f =>
        OTPFieldDiscovery.isVisibleElement(f) &&
        !f.disabled &&
        !f.readOnly &&
        (f.type === 'text' || f.type === 'tel' || f.type === 'number' || f.type === 'password' || f.type === '')
      );

      if (inputs.length >= 4 && inputs.length <= 8) {
        return OTPFieldDiscovery.sortByPosition(inputs);
      }
    }

    return [field];
  }


  // ═══════════════════════════════════════════════════════════
  //  CORE: FIELD FILLING
  // ═══════════════════════════════════════════════════════════

  /**
   * Fill a specific field by selector
   */
  async fillField(selector: string, value: string): Promise<boolean> {
    try {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (!element) {
        log.warn('Field not found', { selector });
        return false;
      }

      const context = this.getContext();
      return await FieldSetter.setValue(element, value, context.framework);
    } catch (error) {
      log.error('Failed to fill field', error);
      return false;
    }
  }

  /**
   * Fill the currently focused field
   */
  async fillCurrentField(value: string, fieldType?: string): Promise<boolean> {
    const activeElement = document.activeElement;
    const context = this.getContext();

    if (
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement
    ) {
      return FieldSetter.setValue(activeElement, value, context.framework);
    }

    // If no field focused, try to find appropriate field
    if (fieldType) {
      const selector = this.getSelectorForFieldType(fieldType);
      const element = document.querySelector<HTMLInputElement>(selector);
      if (element) {
        return FieldSetter.setValue(element, value, context.framework);
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
   * 3. Classify all visible fields
   * 4. Fill with framework-aware setters
   * 5. Retry with exponential backoff for dynamic forms
   * 6. Apply broad selector fallbacks
   */
  async smartFill(): Promise<FillResult> {
    const startTime = performance.now();
    const context = this.getContext();
    const details: FillDetail[] = [];

    log.info('🧠 Smart Fill Starting', {
      framework: context.framework,
      page: context.isLoginPage ? 'login' : context.isSignupPage ? 'signup' : context.isVerificationPage ? 'verification' : 'other',
      provider: context.provider,
    });

    // Adaptive retry: 3 attempts with increasing delays
    const retryDelays = [0, 500, 1200];

    for (let attempt = 0; attempt < retryDelays.length; attempt++) {
      if (retryDelays[attempt] > 0) {
        log.debug(`Smart fill retry ${attempt + 1}, waiting ${retryDelays[attempt]}ms...`);
        await this.delay(retryDelays[attempt]);
      }

      const filledCount = await this.performSmartFillAttempt(context, details);

      if (filledCount > 0) {
        const timingMs = performance.now() - startTime;
        log.info('✅ Smart Fill Complete', { filledCount, attempt, timingMs });
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
    details: FillDetail[],
  ): Promise<number> {
    try {
      // ── Fetch identity + OTP ────────────────────────────
      const [identityResponse, otpResponse] = await Promise.allSettled([
        safeSendMessage({ action: 'GET_IDENTITY' }),
        safeSendMessage({ action: 'GET_LAST_OTP' }),
      ]);

      const identity = identityResponse.status === 'fulfilled' &&
        identityResponse.value &&
        'success' in identityResponse.value &&
        identityResponse.value.success &&
        'identity' in identityResponse.value
        ? (identityResponse.value.identity as unknown as IdentityProfile & { email?: string; password?: string })
        : null;

      const otpCode = otpResponse.status === 'fulfilled' &&
        otpResponse.value &&
        'lastOTP' in otpResponse.value &&
        otpResponse.value.lastOTP
        ? (otpResponse.value.lastOTP as { code: string }).code
        : null;

      if (!identity && !otpCode) {
        log.warn('No identity or OTP available');
        try {
          pageStatus.error('Open popup first to generate identity, or wait for an OTP', 3000);
        } catch { /* ignore */ }
        return 0;
      }

      const filledElements = new Set<HTMLElement>();

      // ── Phase 1: AI-Detected Fields ─────────────────────
      try {
        const analyzer = new FieldAnalyzer();
        const result = await analyzer.getAllFieldsWithAI();
        const detectedFields: DetectedField[] = result.fields || [];

        for (const field of detectedFields) {
          if (filledElements.has(field.element)) { continue; }
          if (field.element.disabled || (field.element as HTMLInputElement).readOnly) { continue; }

          const value = this.getValueForFieldType(field.fieldType, identity, otpCode);

          if (value) {
            if (field.fieldType === 'otp' && otpCode) {
              const otpFilled = await this.fillOTP(otpCode);
              if (otpFilled) {
                filledElements.add(field.element);
                details.push({
                  fieldType: field.fieldType,
                  selector: field.selector,
                  strategy: 'ai-detected',
                  success: true,
                });
              }
            } else {
              const success = await FieldSetter.setValue(
                field.element as HTMLInputElement,
                value,
                context.framework,
              );
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
          }
        }
      } catch (e) {
        log.debug('AI field analysis unavailable, using direct classification');
      }

      // ── Phase 2: Direct Field Classification ────────────
      const allInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input, textarea')
      ).filter(f =>
        OTPFieldDiscovery.isVisibleElement(f) &&
        !f.disabled &&
        !f.readOnly &&
        f.type !== 'hidden' &&
        f.type !== 'submit' &&
        f.type !== 'button' &&
        f.type !== 'reset' &&
        f.type !== 'checkbox' &&
        f.type !== 'radio' &&
        f.type !== 'file' &&
        f.type !== 'image' &&
        f.type !== 'range' &&
        f.type !== 'color' &&
        !filledElements.has(f)
      );

      for (const input of allInputs) {
        const fieldType = FieldClassifier.classify(input);
        if (fieldType === 'unknown') { continue; }

        const value = this.getValueForFieldType(fieldType, identity, otpCode);
        if (!value) { continue; }

        if (fieldType === 'otp' && otpCode) {
          const otpFilled = await this.fillOTP(otpCode);
          if (otpFilled) {
            filledElements.add(input);
            details.push({
              fieldType,
              selector: this.buildSelector(input),
              strategy: 'direct-classification',
              success: true,
            });
          }
        } else {
          const success = await FieldSetter.setValue(input, value, context.framework);
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

      // ── Phase 3: Broad Selector Fallbacks ───────────────
      if (identity) {
        const fallbacks: Array<{
          value: string | undefined;
          selectors: string[];
          fieldType: string;
        }> = [
            {
              value: identity.email,
              selectors: [
                'input[type="email"]',
                'input[name*="email" i]', 'input[id*="email" i]',
                'input[autocomplete*="email"]',
                'input[placeholder*="email" i]', 'input[placeholder*="@" i]',
              ],
              fieldType: 'email',
            },
            {
              value: identity.password,
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
              value: identity.username,
              selectors: [
                'input[name*="user" i]:not([type="email"]):not([type="password"])',
                'input[id*="user" i]:not([type="email"]):not([type="password"])',
                'input[name*="login" i]:not([type="password"])',
                'input[autocomplete="username"]:not([type="email"])',
              ],
              fieldType: 'username',
            },
            {
              value: identity.firstName,
              selectors: [
                'input[name*="first" i][name*="name" i]',
                'input[id*="first" i][id*="name" i]',
                'input[autocomplete="given-name"]',
                'input[placeholder*="first name" i]',
              ],
              fieldType: 'first-name',
            },
            {
              value: identity.lastName,
              selectors: [
                'input[name*="last" i][name*="name" i]',
                'input[id*="last" i][id*="name" i]',
                'input[autocomplete="family-name"]',
                'input[placeholder*="last name" i]',
              ],
              fieldType: 'last-name',
            },
            {
              value: identity.fullName,
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

        for (const fallback of fallbacks) {
          if (!fallback.value) { continue; }
          this.fillWithBroadSelectors(
            filledElements, fallback.value,
            fallback.selectors, fallback.fieldType,
            context.framework, details,
          );
        }
      }

      // ── Phase 4: OTP Fallback ───────────────────────────
      if (otpCode) {
        const otpGroup = OTPFieldDiscovery.discover(context);
        if (otpGroup && !otpGroup.fields.some(f => filledElements.has(f))) {
          const result = await OTPFiller.fill(otpCode, otpGroup, context.framework);
          if (result.success) {
            otpGroup.fields.forEach(f => filledElements.add(f));
            details.push({
              fieldType: 'otp',
              selector: 'auto-discovered',
              strategy: `otp-fallback:${otpGroup.strategy}`,
              success: true,
            });
          }
        }
      }

      return filledElements.size;
    } catch (error) {
      log.error('Smart fill attempt failed', error);
      return 0;
    }
  }

  private getValueForFieldType(
    fieldType: string,
    identity: (IdentityProfile & { email?: string; password?: string; }) | null,
    otpCode: string | null,
  ): string | undefined {
    if (!identity && fieldType !== 'otp') { return undefined; }

    switch (fieldType) {
      case 'email': return identity?.email;
      case 'password':
      case 'confirm-password': return identity?.password;
      case 'username': return identity?.username;
      case 'first-name': return identity?.firstName;
      case 'last-name': return identity?.lastName;
      case 'full-name': return identity?.fullName;
      case 'phone': return undefined;
      case 'otp': return otpCode || undefined;
      default: return undefined;
    }
  }

  private async fillWithBroadSelectors(
    filledElements: Set<HTMLElement>,
    value: string,
    selectors: string[],
    fieldType: string,
    framework: FrameworkType,
    details: FillDetail[],
  ): Promise<void> {
    for (const selector of selectors) {
      try {
        const fields = document.querySelectorAll<HTMLInputElement>(selector);
        for (const field of fields) {
          if (
            OTPFieldDiscovery.isVisibleElement(field) &&
            !filledElements.has(field) &&
            !field.disabled &&
            !field.readOnly
          ) {
            const success = await FieldSetter.setValue(field, value, framework);
            if (success) {
              filledElements.add(field);
              details.push({
                fieldType,
                selector: selector.slice(0, 60),
                strategy: 'broad-selector',
                success: true,
              });
              log.info(`Filled ${fieldType} (broad)`, {
                selector: selector.slice(0, 50),
                id: field.id,
                name: field.name,
              });
            }
          }
        }
      } catch { /* invalid selector */ }
    }
  }


  // ═══════════════════════════════════════════════════════════
  //  FORM FILLING
  // ═══════════════════════════════════════════════════════════

  async fillForm(formSelector?: string, data?: Record<string, string>): Promise<boolean> {
    const form = formSelector
      ? document.querySelector<HTMLFormElement>(formSelector)
      : document.querySelector<HTMLFormElement>('form');

    if (!form) {
      log.warn('Form not found');
      return false;
    }

    const context = this.getContext();

    if (data) {
      for (const [field, value] of Object.entries(data)) {
        const input = form.querySelector<HTMLInputElement>(
          `input[name="${field}"], input[id="${field}"], textarea[name="${field}"]`
        );
        if (input) {
          await FieldSetter.setValue(input, value, context.framework);
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

  async injectIcons(): Promise<void> {
    if (document.body.getAttribute('data-ghost-injected') === 'true') { return; }

    const inputs = document.querySelectorAll<HTMLInputElement>('input');

    for (const input of inputs) {
      if (!OTPFieldDiscovery.isVisibleElement(input) || input.hasAttribute('data-ghost-attached')) { continue; }
      if (input.type === 'hidden' || input.disabled || input.readOnly) { continue; }

      const fieldType = FieldClassifier.classify(input);

      // Only attach icons to identity-relevant fields
      const relevantTypes: FieldType[] = ['email', 'password', 'confirm-password', 'username', 'first-name', 'last-name', 'full-name'];
      if (!relevantTypes.includes(fieldType) && fieldType !== 'unknown') { continue; }

      // For unknown type, check if it looks like an identity field
      if (fieldType === 'unknown' && !this.isLikelyIdentityField(input)) { continue; }

      this.attachGhostIcon(input, fieldType);
    }

    document.body.setAttribute('data-ghost-injected', 'true');
  }

  private isLikelyIdentityField(input: HTMLInputElement): boolean {
    const combined = [
      input.name, input.id, input.placeholder,
      input.getAttribute('aria-label') || '',
    ].join(' ').toLowerCase();

    return /user|login|name|email|phone|address/.test(combined);
  }

  private attachGhostIcon(input: HTMLInputElement, type: FieldType): void {
    const ghost = document.createElement('ghost-label') as GhostLabelElement;
    document.body.appendChild(ghost);

    if (ghost.attachToAttribute) {
      ghost.attachToAttribute(input, async () => {
        log.info('Ghost Icon Clicked', { type });

        const context = this.getContext();
        const identityResponse = await safeSendMessage({ action: 'GET_IDENTITY' });

        if (
          identityResponse &&
          'success' in identityResponse &&
          identityResponse.success &&
          'identity' in identityResponse
        ) {
          const identity = identityResponse.identity as unknown as IdentityProfile & { email?: string; password?: string };
          const value = this.getValueForFieldType(type, identity, null);

          if (value) {
            await FieldSetter.setValue(input, value, context.framework);
            // Also trigger smart fill for the rest of the form
            this.smartFill();
          }
        }
      });
    }

    input.setAttribute('data-ghost-attached', 'true');
  }

  removeIcons(): void {
    document.querySelectorAll('ghost-label').forEach(icon => icon.remove());
    document.querySelectorAll('[data-ghost-attached]').forEach(el =>
      el.removeAttribute('data-ghost-attached')
    );
    document.body.removeAttribute('data-ghost-injected');
  }

  /**
   * Clears all common form fields on the page.
   */
  async clearForm(): Promise<void> {
    const inputs = document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    for (const input of Array.from(inputs)) {
      if (input.value) {
        await FieldSetter.setValue(input, '', this.pageContext?.framework || 'unknown');
      }
    }
  }


  // ═══════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════

  private getSelectorForFieldType(fieldType: string): string {
    const selectors: Record<string, string> = {
      email: 'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete*="email"], input[placeholder*="email" i]',
      password: 'input[type="password"], input[autocomplete*="password"], input[name*="password" i], input[id*="password" i]',
      otp: 'input[autocomplete="one-time-code"], input[name="code"], input[name="otp"], input[name*="otp" i], input[name*="code" i], input[id*="otp" i], input[id*="code" i]',
      username: 'input[name*="user" i], input[name*="login" i], input[id*="user" i], input[autocomplete="username"]',
    };
    return selectors[fieldType] || 'input';
  }

  private buildSelector(input: HTMLInputElement): string {
    if (input.id) { return `#${CSS.escape(input.id)}`; }
    if (input.name) { return `input[name="${CSS.escape(input.name)}"]`; }
    if (input.type && input.type !== 'text') { return `input[type="${input.type}"]`; }
    return 'input';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup — call when extension is being deactivated
   */
  destroy(): void {
    this.fieldWatcher.stop();
    this.removeIcons();
    this.pageContext = null;
  }
}