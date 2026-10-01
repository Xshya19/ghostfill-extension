import { detectHardNegative, looksLikeOtpField, verifyFill } from '../../intelligence/IntelligenceCore';
import { extractFieldRecord, OTP_PATTERNS, OTP_CONSTANTS, PageAnalyzer } from '../../intelligence/pageAnalyzer';
import { FrameworkType, PageContext } from '../../types/form.types';
import { deepQuerySelectorAll, getDeepActiveElement } from '../../utils/core';
import { createLogger } from '../../utils/logger';
import { OTPFieldGroup, OTPFillOutcome , FieldSetter, PhantomTyper, delay, VisibilityEngine, EventFactory } from './formFiller';


const log = createLogger('AutofillOTPEngine');

// ─────────────────────────────────────────────────────────────
//  DOM/Selector Helpers
// ─────────────────────────────────────────────────────────────

function safeQuerySelector<T extends Element>(root: ParentNode, selector: string): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

function safeQuerySelectorAll<T extends Element>(root: ParentNode, selector: string): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
//  NegativePatternMatcher
// ─────────────────────────────────────────────────────────────

export class NegativePatternMatcher {
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
    /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i,
  ];

  static isLikelyNotOTP(input: HTMLInputElement): boolean {
    const record = extractFieldRecord(input);
    if (detectHardNegative(record)) {return true;}
    const nameId = `${record.name} ${record.id}`.toLowerCase();
    const combined = [nameId, record.placeholder, record.autocomplete, record.ariaLabel,
      record.labelText, ...Object.values(record.dataAttributes ?? {})].join(' ').toLowerCase();
    const type = record.type;
    const hasOTPSignal = looksLikeOtpField(record);

    if (['email', 'search', 'url', 'date', 'month'].includes(type)) {
      return true;
    }

    if (
      (/phone|tel|mobile/i.test(nameId) || type === 'tel') &&
      (record.maxLength > 4 || record.maxLength === -1) && !hasOTPSignal
    ) {
      return true;
    }

    if (
      /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i.test(combined)
    ) {
      return true;
    }

    for (const pattern of this.NON_OTP_PATTERNS) {
      if (pattern.test(combined)) {
        if (hasOTPSignal || (/otp|code/i.test(nameId) && !/card|cvv|promo/i.test(nameId))) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  static isOTPCompatibleType(input: HTMLInputElement): boolean {
    const type = input.type.toLowerCase();
    return ['text', 'tel', 'number', 'password', ''].includes(type);
  }
}

// ─────────────────────────────────────────────────────────────
//  PageIntelligence
// ─────────────────────────────────────────────────────────────

export class PageIntelligence {
  private static readonly SCAN_LIMIT = 3000;
  private static readonly OTP_LANGUAGE_PATTERNS: readonly RegExp[] = [
    /otp|one[-_\s]?time|verification[-_\s]?code|security[-_\s]?code|pin[-_\s]?code/i,
    /\d[- ]?digit\s*code|enter\s*code|paste\s*code/i,
  ];

  static analyze(): PageContext {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.textContent ?? '').slice(0, this.SCAN_LIMIT).toLowerCase();
    const metaContent = safeQuerySelectorAll<HTMLMetaElement>(document, 'meta')
      .map((m) => (m.getAttribute('content') ?? '').toLowerCase())
      .join(' ');

    const combinedText = `${url} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];
    const pageAnalysis = PageAnalyzer.analyze();
    signals.push(...pageAnalysis.signals.filter((signal) => signal.startsWith('page:')));

    let hasOTPLanguage = false;
    for (const pattern of this.OTP_LANGUAGE_PATTERNS) {
      if (pattern.test(combinedText)) {
        hasOTPLanguage = true;
        signals.push('page:otp-language');
        break;
      }
    }

    let expectedOTPLength: number | null = null;
    const lengthMatch = bodyText.match(/(\d)[- ]?digit\s*(code|otp|pin|number)/i);
    if (lengthMatch?.[1]) {
      const parsed = parseInt(lengthMatch[1], 10);
      if (parsed >= OTP_CONSTANTS.MIN_OTP_LENGTH && parsed <= OTP_CONSTANTS.MAX_OTP_LENGTH) {
        expectedOTPLength = parsed;
        signals.push(`page:expected-length-${expectedOTPLength}`);
      }
    }

    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);
    const provider = this.detectProvider(url, bodyText);
    if (provider) {
      signals.push(`provider:${provider}`);
    }

    return Object.freeze({
      isVerificationPage: pageAnalysis.pageType === 'verification',
      isLoginPage: pageAnalysis.pageType === 'login',
      isSignupPage: pageAnalysis.pageType === 'signup',
      isPasswordResetPage: pageAnalysis.pageType === 'password-reset',
      is2FAPage: pageAnalysis.pageType === '2fa',
      framework,
      hasOTPLanguage,
      expectedOTPLength,
      provider,
      pageSignals: Object.freeze(signals),
    });
  }

  static detectFramework(): FrameworkType {
    try {
      if (safeQuerySelector(document, '[data-reactroot]')) {
        return 'react';
      }
      const rootEl = document.getElementById('root');
      if (
        rootEl &&
        Object.keys(rootEl).some(
          (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternals')
        )
      ) {
        return 'react';
      }
      if (document.getElementById('__NEXT_DATA__')) {
        return 'react';
      }
      if (safeQuerySelector(document, '[data-nextjs-scroll-focus-boundary]')) {
        return 'react';
      }
      if (
        document.getElementById('root') ||
        document.getElementById('__next') ||
        document.getElementById('app')
      ) {
        const root =
          document.getElementById('root') ??
          document.getElementById('__next') ??
          document.getElementById('app');
        if (
          root &&
          Object.keys(root).some(
            (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
          )
        ) {
          return 'react';
        }
      }

      if (
        safeQuerySelector(document, '[__vue_app__]') ||
        safeQuerySelector(document, '[data-v-app]')
      ) {
        return 'vue';
      }
      const vueEl = safeQuerySelector(document, '#app, #vue-app, [id^="vue"]');
      if (vueEl && ('__vue__' in vueEl || '__vue_app__' in vueEl)) {
        return 'vue';
      }

      if (
        safeQuerySelector(document, '[ng-version]') ||
        safeQuerySelector(document, '[_nghost-ng-c]') ||
        safeQuerySelector(document, '[ng-app]') ||
        safeQuerySelector(document, 'app-root, [_nghost]')
      ) {
        return 'angular';
      }

      if (safeQuerySelector(document, '[data-svelte-h]') || '__svelte' in window) {
        return 'svelte';
      }
    } catch {
      /* ignore */
    }
    return 'unknown';
  }

  private static detectProvider(url: string, text: string): string | null {
    for (const [pattern, name] of (OTP_PATTERNS as any).PROVIDERS ?? []) {
      if (pattern.test(url) || pattern.test(text)) {
        return name;
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  OTPFieldDiscovery
// ─────────────────────────────────────────────────────────────

export class OTPFieldDiscovery {
  private static readonly MIN_SPLIT_FIELDS = 4;
  private static readonly MAX_SPLIT_FIELDS = 8;
  private static readonly OTP_EXACT_FIELD_NAMES = new Set([
    'otp', 'otc', 'code', 'pin', 'token', 'passcode', 'verifycode', 'verify-code',
    'verify_code', 'verificationcode', 'verification-code', 'verification_code',
    'authcode', 'auth-code', 'auth_code', 'one-time-code', 'one_time_code', 'onetimecode',
  ]);

  private static readonly STRONG_OTP_DESCRIPTOR_PATTERN =
    /otp|one[-_\s]?time|verification[-_\s]?code|verify[-_\s]?code|security[-_\s]?code|auth(?:entication)?[-_\s]?code|confirmation[-_\s]?code|passcode|2fa|mfa|totp/i;

  static discover(context: PageContext): OTPFieldGroup | null {
    const active = getDeepActiveElement();
    if (active instanceof HTMLInputElement && active.maxLength === 1) {
      const split = this.findSplitDigitFields();
      if (split?.fields.includes(active)) {return split;}
    }
    const strategies = [
      {
        name: 'S1:autocomplete-one-time-code',
        sel: 'input[autocomplete~="one-time-code" i]',
        score: 100,
      },
      {
        name: 'S2:keyworded-identity',
        sel: [
          'input[name="otp"]', 'input[id="otp"]', 'input[name="otc"]', 'input[name*="otp" i]',
          'input[id*="otp" i]', 'input[name*="verification" i]', 'input[id*="verification" i]',
          'input[name*="passcode" i]', 'input[id*="passcode" i]', 'input[name*="token" i]',
          'input[id*="token" i]', 'input[name*="2fa" i]', 'input[id*="2fa" i]',
          'input[name*="mfa" i]', 'input[id*="mfa" i]',
        ].join(', '),
        score: 95,
      },
      {
        name: 'S3:pattern-digit-otp',
        sel: [
          'input[pattern="\\d{4}"]', 'input[pattern="\\d{5}"]', 'input[pattern="\\d{6}"]',
          'input[pattern="\\d{7}"]', 'input[pattern="\\d{8}"]', 'input[pattern="[0-9]{4}"]',
          'input[pattern="[0-9]{5}"]', 'input[pattern="[0-9]{6}"]', 'input[pattern="[0-9]{7}"]',
          'input[pattern="[0-9]{8}"]',
        ].join(', '),
        score: 92,
      },
      {
        name: 'S4:inputmode-numeric-short',
        sel: 'input[inputmode="numeric"], input[inputmode="decimal"]',
        score: 70,
      },
      {
        name: 'S5:labels-and-placeholders',
        sel: [
          'input[aria-label*="otp" i]', 'input[aria-label*="code" i]', 'input[placeholder*="otp" i]',
          'input[placeholder*="verification" i]', 'input[placeholder*="passcode" i]',
          'input[placeholder*="enter code" i]', 'input[placeholder*="6-digit" i]',
          'input[placeholder*="4-digit" i]', 'input[data-testid*="otp" i]', 'input[data-testid*="code" i]',
          'input[data-testid*="verification" i]', 'input[aria-describedby*="otp" i]',
          'input[aria-describedby*="code" i]', 'input[placeholder="code" i]', 'input[name="code"]', 'input[id="code"]'
        ].join(', '),
        score: 80,
      },
      {
        name: 'S6:contenteditable-otp',
        sel: '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="code" i], [contenteditable="true"][aria-label*="otp" i]',
        score: 75,
      },
    ];
    strategies.sort((a, b) => Number(active?.matches(b.sel) ?? false) - Number(active?.matches(a.sel) ?? false));

    for (const strategy of strategies) {
      const fields = this.queryVisible(strategy.sel);

      if (strategy.name === 'S4:inputmode-numeric-short') {
        const filtered = fields.filter((f) => {
          if (this.hasStrongOTPSignal(f, context)) {return true;}

          const hasVerificationContext = context.isVerificationPage || context.is2FAPage || context.hasOTPLanguage;
          if (!hasVerificationContext) {return false;}

          if (f.maxLength >= 4 && f.maxLength <= 8) {return true;}

          const width = f.offsetWidth;
          const numericish =
            f.inputMode === 'numeric' ||
            f.getAttribute('inputmode') === 'numeric' ||
            f.type === 'number' ||
            f.type === 'tel';
          if (numericish && width > 0 && width < 140) {return true;}

          return false;
        });
        if (filtered.length > 0 && filtered.length <= this.MAX_SPLIT_FIELDS) {
          const group = this.wrap(filtered, strategy.score, strategy.name);
          if (group) {return group;}
        }
        continue;
      }

      if (strategy.name === 'S6:contenteditable-otp') {
        const otpFields = fields.filter((field) => looksLikeOtpField(extractFieldRecord(field)));
        if (otpFields.length > 0) {
          return this.wrapEditable(otpFields, strategy.score, strategy.name);
        }
        continue;
      }

      if (fields.length > 0) {
        const group = this.wrap(fields, strategy.score, strategy.name);
        if (group) {return group;}
      }
    }

    const split = this.findSplitDigitFields();
    if (split) {return split;}

    const singleInputSplit = this.findSingleInputSplitOTP();
    if (singleInputSplit) {return singleInputSplit;}

    return null;
  }

  static queryVisible(selector: string, root: Document | Element | ShadowRoot = document): HTMLInputElement[] {
    return deepQuerySelectorAll<HTMLInputElement>(selector, root)
      .filter((f) => VisibilityEngine.isFillable(f))
      .filter((f) => !NegativePatternMatcher.isLikelyNotOTP(f));
  }

  static sortByPosition(inputs: HTMLInputElement[]): HTMLInputElement[] {
    return [...inputs].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return Math.abs(rA.top - rB.top) > 10 ? rA.top - rB.top : rA.left - rB.left;
    });
  }

  private static wrap(fields: HTMLInputElement[], score: number, strategy: string): OTPFieldGroup | null {
    const active = getDeepActiveElement();
    const seed = fields.find((field) => field === active) ?? fields[0]!;
    let selected = [seed];
    const isSplit = seed.maxLength === 1;
    if (isSplit) {
      const candidates = fields.filter((field) => field.maxLength === 1 &&
        field.form === seed.form && field.getRootNode() === seed.getRootNode());
      let container: Node | null = seed.parentNode;
      while (container) {
        const scoped = candidates.filter((field) => container!.contains(field));
        if (scoped.length >= this.MIN_SPLIT_FIELDS) {
          if (scoped.length > this.MAX_SPLIT_FIELDS) {return null;}
          selected = scoped;
          break;
        }
        container = container.parentNode;
      }
      if (selected.length < this.MIN_SPLIT_FIELDS) {return null;}
    }
    const sorted = this.sortByPosition(selected);
    return {
      fields: sorted,
      score,
      strategy,
      isSplit,
      expectedLength: isSplit ? sorted.length : (sorted[0]?.maxLength ?? 0) > 0 ? (sorted[0]?.maxLength ?? 6) : 6,
      signals: [`strategy:${strategy}`],
    };
  }

  private static findSplitDigitFields(): OTPFieldGroup | null {
    const candidates = this.queryVisible('input[maxlength="1"]');
    if (candidates.length < this.MIN_SPLIT_FIELDS) {return null;}
    
    const sortedWithRects = candidates
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

    const groups: { el: HTMLInputElement; rect: DOMRect }[][] = [];
    for (const item of sortedWithRects) {
      const rectEl = item.rect;
      let added = false;
      for (const group of groups) {
        const lead = group[0]!;
        const rectLead = lead.rect;
        const yDiff = Math.abs(rectEl.top - rectLead.top);
        const xDiff = Math.abs(rectEl.left - group[group.length - 1]!.rect.right);
        if (item.el.form === lead.el.form && item.el.getRootNode() === lead.el.getRootNode() &&
          yDiff <= 50 && xDiff <= 300) {
          group.push(item);
          added = true;
          break;
        }
      }
      if (!added) {
        groups.push([item]);
      }
    }

    const active = getDeepActiveElement();
    const validGroups = groups.filter(g => g.length >= this.MIN_SPLIT_FIELDS && g.length <= this.MAX_SPLIT_FIELDS);
    const validGroup = validGroups.find(g => g.some(item => item.el === active)) ?? validGroups[0];
    if (validGroup) {
      return this.wrap(validGroup.map(g => g.el), 90, 'S3:split-digit');
    }

    return null;
  }

  private static findSingleInputSplitOTP(): OTPFieldGroup | null {
    const candidates = this.queryVisible(
      'input[maxlength="4"], input[maxlength="5"], input[maxlength="6"], input[maxlength="7"], input[maxlength="8"]'
    );

    for (const input of candidates) {
      if (NegativePatternMatcher.isLikelyNotOTP(input)) {continue;}

      const style = window.getComputedStyle(input);
      const hasSplitStyling =
        parseFloat(style.letterSpacing) > 4 ||
        style.fontFamily?.includes('monospace') ||
        style.textAlign === 'center';

      const isShortWide = input.offsetWidth > 150 && input.maxLength >= 4;

      const hasOTPSignal = /otp|code|verification|passcode|2fa|mfa/i.test(
        input.placeholder + ' ' + input.name + ' ' + input.id + ' ' + (input.getAttribute('aria-label') || '')
      );

      if ((hasSplitStyling && isShortWide) || hasOTPSignal) {
        return this.wrap([input], hasOTPSignal ? 85 : 65, 'S7:single-input-split');
      }
    }
    return null;
  }

  private static hasStrongOTPSignal(input: HTMLInputElement, context: PageContext): boolean {
    const descriptor = [
      input.type, input.name, input.id, input.placeholder, input.autocomplete, input.inputMode,
      input.getAttribute('aria-label'), input.getAttribute('aria-describedby'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const name = input.name.toLowerCase();
    const id = input.id.toLowerCase();

    if (input.matches('[autocomplete~="one-time-code" i]')) {return true;}
    if (this.OTP_EXACT_FIELD_NAMES.has(name) || this.OTP_EXACT_FIELD_NAMES.has(id)) {return true;}
    if (this.STRONG_OTP_DESCRIPTOR_PATTERN.test(descriptor)) {return true;}

    const numericish =
      input.inputMode === 'numeric' ||
      input.getAttribute('inputmode') === 'numeric' ||
      input.type === 'number' ||
      input.type === 'tel' ||
      input.type === 'password';

    return (
      numericish &&
      input.maxLength >= 4 &&
      input.maxLength <= 10 &&
      (context.isVerificationPage || context.is2FAPage || context.hasOTPLanguage)
    );
  }

  private static wrapEditable(fields: HTMLElement[], score: number, strategy: string): OTPFieldGroup | null {
    const sorted = [...fields].sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return Math.abs(rA.top - rB.top) > 10 ? rA.top - rB.top : rA.left - rB.left;
    });

    return {
      fields: sorted as unknown as HTMLInputElement[],
      score,
      strategy,
      isSplit: sorted.length >= this.MIN_SPLIT_FIELDS,
      expectedLength: sorted.length >= this.MIN_SPLIT_FIELDS ? sorted.length : 6,
      signals: [`strategy:${strategy}`, 'contenteditable'],
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  OTPFiller
// ─────────────────────────────────────────────────────────────

export class OTPFiller {
  static async fill(
    otp: string,
    group: OTPFieldGroup,
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    const cleanOTP = otp.replace(/[-\s]/g, '');
    if (cleanOTP.length === 0) {
      return { success: false, filledCount: 0, strategy: 'none' };
    }

    const isEditableGroup = group.signals?.includes('contenteditable');
    if (isEditableGroup) {
      return this.fillContentEditable(cleanOTP, group.fields as unknown as HTMLElement[], framework);
    }

    return group.isSplit
      ? this.fillSplit(cleanOTP, group.fields, framework, isBackgroundTab)
      : this.fillSingle(otp, group.fields[0]!, framework, isBackgroundTab);
  }

  private static async fillSingle(
    otp: string,
    field: HTMLInputElement,
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    if (!field) {return { success: false, filledCount: 0, strategy: 'single-field' };}

    const cleanOTP = otp.replace(/[-\s]/g, '');
    if (field.maxLength > 0 && field.maxLength < cleanOTP.length) {
      log.debug('Code exceeds the single field length', { codeLength: cleanOTP.length, maxLength: field.maxLength });
      return { success: false, filledCount: 0, strategy: 'single-length-mismatch' };
    }
    const valueToSet = field.type === 'number' ? cleanOTP : otp;

    const success = await FieldSetter.setValue(field, valueToSet, framework, isBackgroundTab);

    const verifyCurrentValue = () => verifyFill(valueToSet, field.value, field.type);
    let verification = verifyCurrentValue();
    if (success && verification.ok) {
      return { success: true, filledCount: 1, strategy: 'single-field' };
    }

    if (!verification.ok && !isBackgroundTab) {
      field.focus({ preventScroll: true });
      await PhantomTyper.typeSimulatedString(field, valueToSet);
      verification = verifyCurrentValue();
      if (verification.ok) {
        return { success: true, filledCount: 1, strategy: 'single-field-keystroke' };
      }
    }

    return { success: false, filledCount: 0, strategy: 'single-field' };
  }

  private static async fillSplit(
    digits: string,
    fields: HTMLInputElement[],
    framework: FrameworkType,
    isBackgroundTab: boolean = false
  ): Promise<OTPFillOutcome> {
    if (digits.length !== fields.length) {
      log.debug('Code length does not match the split widget', { codeLength: digits.length, fieldCount: fields.length });
      return { success: false, filledCount: 0, strategy: 'split-length-mismatch' };
    }
    const total = digits.length;
    let filledCount = 0;

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) {continue;}
      if (await FieldSetter.setValue(field, digits[i]!, framework, isBackgroundTab)) {filledCount++;}
    }

    const success = this.readSplitValue(fields) === digits;
    if (!success && !isBackgroundTab && await this.tryPasteDistributedCode(digits, fields)) {
      return { success: true, filledCount: total, strategy: 'split-field-paste' };
    }
    return {
      success,
      filledCount: success ? total : filledCount,
      strategy: 'split-field',
    };
  }

  private static async fillContentEditable(
    digits: string,
    fields: HTMLElement[],
    _framework: FrameworkType
  ): Promise<OTPFillOutcome> {
    const isSplit = fields.length > 1;
    if (isSplit && digits.length !== fields.length) {
      return { success: false, filledCount: 0, strategy: 'split-length-mismatch' };
    }
    const total = fields.length;
    let filledCount = 0;

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field) {continue;}

      if (i < total) {
        const char = isSplit ? digits[i]! : digits;
        field.focus({ preventScroll: true });
        
        if (!field.dispatchEvent(EventFactory.beforeInput(char))) {
          return { success: false, filledCount, strategy: 'contenteditable-cancelled' };
        }
        field.textContent = char;

        field.dispatchEvent(EventFactory.input(char));
        field.dispatchEvent(new Event('change', { bubbles: true }));

        if (field.textContent === char) {filledCount++;}
      }

      if (i < fields.length - 1) {
        await delay(10);
        if (document.activeElement === field) {
          field.blur();
          const nextField = fields[i + 1];
          if (nextField) {nextField.focus({ preventScroll: true });}
        }
      }
    }

    const finalValue = fields.map((f) => f.textContent ?? '').join('');
    const success = finalValue === digits;
    return {
      success,
      filledCount: success ? total : filledCount,
      strategy: 'contenteditable-split',
    };
  }

  private static async tryPasteDistributedCode(digits: string, fields: HTMLInputElement[]): Promise<boolean> {
    const target = fields[0];
    if (!target) {return false;}

    const originalValues = fields.map((f) => f.value);

    try {
      const activeElBefore = document.activeElement;
      target.focus({ preventScroll: true });
      target.click();

      const dataTransfer = new DataTransfer();
      dataTransfer.setData('text/plain', digits);

      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
      target.dispatchEvent(new InputEvent('beforeinput', { data: digits, inputType: 'insertFromPaste', bubbles: true, cancelable: true }));
      target.dispatchEvent(new InputEvent('input', { data: digits, inputType: 'insertFromPaste', bubbles: true }));

      await delay(80);
      const success = this.readSplitValue(fields).slice(0, digits.length) === digits;
      if (success) {
        return true;
      }

      // Rollback on failure
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field) {
          field.value = originalValues[i] ?? '';
          field.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (activeElBefore instanceof HTMLElement) {
        activeElBefore.focus({ preventScroll: true });
      }
      return false;
    } catch {
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field) {
          field.value = originalValues[i] ?? '';
        }
      }
      return false;
    }
  }

  private static readSplitValue(fields: HTMLInputElement[]): string {
    return fields.map((field) => field.value ?? '').join('');
  }
}

// ─────────────────────────────────────────────────────────────
//  FieldWatcher
// ─────────────────────────────────────────────────────────────

export class FieldWatcher {
  private observer: MutationObserver | null = null;
  private shadowObservers: MutationObserver[] = [];
  private pendingOTP: string | null = null;
  private pendingContext: PageContext | null = null;
  private pendingResolve: ((result: boolean) => void) | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private knownShadowRoots = new Set<ShadowRoot>();
  public isActive = false;

  async watch(otp: string, context: PageContext, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.isActive) {this.stop();}

      this.isActive = true;
      this.pendingOTP = otp;
      this.pendingContext = context;

      let resolved = false;
      const resolveOnce = (result: boolean): void => {
        if (resolved) {return;}
        resolved = true;
        this.pendingResolve = null;
        this.stop();
        resolve(result);
      };
      this.pendingResolve = resolveOnce;

      const checkFields = async (): Promise<void> => {
        if (!this.pendingOTP || !this.pendingContext || resolved) {return;}

        const group = OTPFieldDiscovery.discover(this.pendingContext);
        if (!group) {return;}

        const otpToFill = this.pendingOTP;
        const framework = this.pendingContext.framework;

        const result = await OTPFiller.fill(otpToFill, group, framework);
        if (result.success) {
          resolveOnce(true);
        }
      };

      this.observer = new MutationObserver(() => this.onMutation(checkFields));
      if (document.body) {
        this.observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        });
        this.scanAndObserveShadowRoots(document.body, checkFields);
      }

      void checkFields();

      this.pollingInterval = setInterval(() => {
        void checkFields();
        if (document.body) {this.scanAndObserveShadowRoots(document.body, checkFields);}
      }, 1000);

      this.safetyTimeout = setTimeout(() => {
        resolveOnce(false);
      }, timeoutMs);
    });
  }

  private onMutation(checkFields: () => Promise<void>): void {
    if (this.debounceTimeout) {clearTimeout(this.debounceTimeout);}
    this.debounceTimeout = setTimeout(() => {
      void this.handleMutationTick(checkFields);
    }, 250);
  }

  private async handleMutationTick(checkFields: () => Promise<void>): Promise<void> {
    if (!this.pendingContext || !this.pendingOTP) {return;}
    if (document.body) {this.scanAndObserveShadowRoots(document.body, checkFields);}
    void checkFields();
  }

  private scanAndObserveShadowRoots(root: ParentNode, checkFields: () => Promise<void>): void {
    // Limit shadow observation to at most 5 roots, only those inside forms or near OTP context
    // to avoid CPU avalanche on Salesforce/Angular Material pages
    let observed = 0;
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT, null);
    let node = walker.nextNode();
    while (node && observed < 5) {
      const el = node as Element;
      const shadow = el.shadowRoot;
      if (shadow && !this.knownShadowRoots.has(shadow)) {
        // Only observe shadows that look form-related
        const isFormRelated = el.closest('form, [role="form"], [class*="otp"], [class*="verify"], [class*="auth"]') !== null
          || el.tagName.toLowerCase().includes('-');
        if (!isFormRelated) { node = walker.nextNode(); continue; }
        this.knownShadowRoots.add(shadow);
        const obs = new MutationObserver(() => this.onMutation(checkFields));
        // Avoid attributes:true to reduce noise from spinner/class changes
        obs.observe(shadow, { childList: true, subtree: true, attributes: false });
        this.shadowObservers.push(obs);
        observed++;
      }
      node = walker.nextNode();
    }
  }

  stop(): void {
    this.isActive = false;
    if (this.pendingResolve) {
      const resolveFn = this.pendingResolve;
      this.pendingResolve = null;
      resolveFn(false);
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.shadowObservers.forEach((observer) => observer.disconnect());
    this.shadowObservers = [];
    this.knownShadowRoots.clear();

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
    log.debug('FieldWatcher stopped');
  }
}
