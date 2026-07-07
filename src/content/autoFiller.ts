import { extractFieldRecord } from '../intelligence/featureExtractor';
import { FieldClass } from '../intelligence/types';
import {
  PageContext,
  FormInputElement,
  FillResult,
  FillDetail,
  IdentityWithCredentials,
  FieldType,
} from '../types/form.types';
import { deepQuerySelectorAll } from '../utils/helpers';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import {
  PageIntelligence,
  OTPFieldDiscovery,
  OTPFiller,
  AutoSubmitDetector,
  FieldWatcher,
  FieldSetter,
  PhantomTyper,
  OTPFieldGroup,
} from './autofill/index';
import { HistoryManager } from './utils/intelligence';
import { IntelligenceCore, mapFieldClassToFieldType } from '../intelligence/IntelligenceCore';
import { UltraDetector } from './detection/UltraDetector';
import { UniversalFiller } from './filling/UniversalFiller';
import { VerificationLoop } from '../intelligence/VerificationLoop';
import { AdaptiveStrategyEngine } from '../intelligence/AdaptiveStrategyEngine';
import { ContextEngine } from './context/ContextEngine';

const log = createLogger('AutoFiller');



// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

const DYNAMIC_WATCH_TIMEOUT_MS = 7_000;
const SMART_FILL_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;
const OTP_DISCOVERY_RETRIES = 5;
const OTP_DISCOVERY_RETRY_DELAY_MS = 200;

/** Minimum number of single-character boxes for a valid split-OTP layout. */
const MIN_SPLIT_OTP_FIELDS = 4;
/** Maximum number of single-character boxes we will treat as one OTP group. */
const MAX_SPLIT_OTP_FIELDS = 8;
/** Pixel width below which a text input looks like a single-digit OTP box. */
const SPLIT_OTP_BOX_MAX_WIDTH = 90;

/** Input element `type` values that can legitimately hold an OTP value. */
const OTP_COMPATIBLE_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'tel',
  'number',
  'password',
  '',
]);

/** Hosts whose auth flows use legitimate hidden fields; skip icon injection. */
const INJECTION_EXCLUDED_HOSTS: ReadonlyArray<string> = [
  'accounts.google.com',
  'login.microsoftonline.com',
  'appleid.apple.com',
  'auth0.com',
];

const OTP_EXACT_FIELD_NAMES: ReadonlySet<string> = new Set([
  'otp',
  'otc',
  'code',
  'pin',
  'token',
  'passcode',
  'verifycode',
  'verify-code',
  'verify_code',
  'verificationcode',
  'verification-code',
  'verification_code',
  'authcode',
  'auth-code',
  'auth_code',
  'one-time-code',
  'one_time_code',
  'onetimecode',
]);

const STRONG_OTP_DESCRIPTOR_PATTERN =
  /otp|one[-_\s]?time|verification[-_\s]?code|verify[-_\s]?code|security[-_\s]?code|auth(?:entication)?[-_\s]?code|confirmation[-_\s]?code|passcode|2fa|mfa|totp/i;

const CAPTCHA_DESCRIPTOR_PATTERN =
  /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i;

const TRUSTED_SELECTOR_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'email',
  'password',
  'confirm-password',
  'otp',
  'username',
  'first-name',
  'last-name',
  'full-name',
  'phone',
  'unknown',
]);

/** Field types that should never be overwritten if they already have a value. */
function isOverwritableWhenFilled(type: FieldType): boolean {
  // OTP codes rotate, and 'unknown' fields are filled opportunistically, so
  // both may be (re)written even if they currently hold a value.
  return type === 'otp' || type === 'unknown';
}

interface GhostLabelElement extends HTMLElement {
  attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

interface PendingOTPRequest {
  readonly otp: string;
  readonly fieldSelectors?: string[];
  readonly isBackgroundTab: boolean;
  readonly resolve: (val: boolean) => void;
}

export class AutoFiller {
  private fieldWatcher = new FieldWatcher();
  private pageContext: PageContext | null = null;
  private destroyed = false;
  private fillLock = false;
  /** The most recent OTP request received while a fill was already running. */
  private latestPendingOTP: PendingOTPRequest | null = null;

  private detector = new UltraDetector();
  private filler = new UniversalFiller();
  private loop = new VerificationLoop();
  private adaptive = new AdaptiveStrategyEngine();
  private intelligence = new IntelligenceCore();
  private contextEngine = new ContextEngine(this.detector);

  constructor() {
    this.contextEngine.init().catch((e) => log.error('Failed to initialize ContextEngine', e));
  }

  // ═══════════════════════════════════════════════════════════
  //  CONTEXT
  // ═══════════════════════════════════════════════════════════

  private getContext(): PageContext {
    if (!this.pageContext) {
      this.pageContext = PageIntelligence.analyze();
      log.info('📊 Page Analysis:', this.pageContext);
    }
    return this.pageContext;
  }

  refreshContext(): void {
    this.pageContext = null;
  }

  private processNextOTPInQueue(): void {
    if (!this.latestPendingOTP || this.destroyed) {
      return;
    }
    const next = this.latestPendingOTP;
    this.latestPendingOTP = null;
    log.info('🔓 Lock released, processing queued OTP request');
    void this.fillOTP(next.otp, next.fieldSelectors, next.isBackgroundTab)
      .then(next.resolve)
      .catch((error) => {
        log.warn('Queued OTP request failed', error);
        next.resolve(false);
      });
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: OTP FILLING
  // ═══════════════════════════════════════════════════════════

  async fillOTP(otp: string, fieldSelectors?: string[], isBackgroundTab = false): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    if (this.fillLock) {
      // If the lock is held only because the passive fieldWatcher is waiting
      // for dynamically rendered fields, stop the watcher immediately. This
      // resolves the watcher's promise, releasing the lock, and lets us handle
      // the new request without waiting out the full watcher timeout.
      if (this.fieldWatcher.isActive) {
        log.info(
          '🔄 New OTP request received while passive FieldWatcher was active. Stopping current watcher to prioritize new request.'
        );
        this.fieldWatcher.stop();
      }
      log.info('🔒 Fill lock active, queuing OTP request to run after the current one completes');
      return new Promise<boolean>((resolve) => {
        // Only the newest queued request matters; supersede any older one.
        if (this.latestPendingOTP) {
          this.latestPendingOTP.resolve(false);
        }
        this.latestPendingOTP = {
          otp,
          ...(fieldSelectors ? { fieldSelectors } : {}),
          isBackgroundTab,
          resolve,
        };
      });
    }

    this.fillLock = true;
    try {
      const context = this.getContext();
      // `cleanOTP` strips separators for split fields / numeric inputs.
      const cleanOTP = otp.replace(/[-\s]/g, '');
      if (cleanOTP.length === 0) {
        log.debug('fillOTP called with an empty code, skipping');
        return false;
      }

      log.info('🔑 OTP Fill Pipeline Started', {
        length: cleanOTP.length,
        originalLength: otp.length,
      });

      if (fieldSelectors?.length) {
        if (
          await this.fillOTPWithSelectors(otp, cleanOTP, fieldSelectors, context, isBackgroundTab)
        ) {
          return true;
        }
      }

      const group = await this.discoverOTPFieldWithRetry(context, isBackgroundTab);
      if (group) {
        const safeGroup = this.normalizeOTPGroup(group, cleanOTP.length, context);
        if (!safeGroup) {
          log.debug('OTP discovery returned fields that failed safety checks', {
            strategy: group.strategy,
            fieldCount: group.fields.length,
          });
          return this.tryFallbackOTPFill(otp, cleanOTP, context, isBackgroundTab);
        }

        const finalOtp = this.resolveOtpValueForGroup(safeGroup, otp, cleanOTP);
        const result = await OTPFiller.fill(
          finalOtp,
          safeGroup,
          context.framework,
          isBackgroundTab
        );
        if (result.success) {
          void AutoSubmitDetector.checkAndHighlight(safeGroup);
          this.markOTPUsed();
          this.saveTrustedSelector('otp', this.buildFieldSelector(safeGroup.fields[0]));
          return true;
        }
      }

      return this.tryFallbackOTPFill(otp, cleanOTP, context, isBackgroundTab);
    } finally {
      this.fillLock = false;
      this.processNextOTPInQueue();
    }
  }

  /**
   * Decides which form of the code to send to a group: the cleaned (separator-
   * free) code for split fields and numeric single fields, otherwise the
   * original (which may contain a human-friendly separator).
   */
  private resolveOtpValueForGroup(
    group: OTPFieldGroup,
    originalOtp: string,
    cleanOtp: string
  ): string {
    if (group.isSplit) {
      return cleanOtp;
    }
    // number inputs reject hyphens/spaces.
    return group.fields[0]?.type === 'number' ? cleanOtp : originalOtp;
  }

  private async tryFallbackOTPFill(
    otp: string,
    cleanOTP: string,
    context: PageContext,
    isBackgroundTab: boolean
  ): Promise<boolean> {
    const focusedField =
      this.getFocusedOTPField(cleanOTP.length, context) ??
      this.findControllerOTPField([], cleanOTP.length, context);

    if (focusedField) {
      const focusedValue = focusedField.type === 'number' ? cleanOTP : otp;
      if (await this.fillFocusedOTPField(focusedField, focusedValue, context, isBackgroundTab)) {
        this.markOTPUsed();
        this.saveTrustedSelector('otp', this.buildFieldSelector(focusedField));
        return true;
      }
    }

    // ── Background tab guard ──
    // In background tabs we can't rely on DOM focus events or the fieldWatcher,
    // so bail gracefully instead of spinning on retries that need active focus.
    if (isBackgroundTab) {
      log.info('🔇 Background tab: no OTP field accepted the code, skipping fieldWatcher retry');
      return false;
    }

    return this.fieldWatcher.watch(cleanOTP, context, DYNAMIC_WATCH_TIMEOUT_MS);
  }

  private async fillOTPWithSelectors(
    originalOtp: string,
    cleanOtp: string,
    selectors: string[],
    context: PageContext,
    isBackgroundTab = false
  ): Promise<boolean> {
    const rawFields = selectors
      .map((selector) => deepQuerySelectorAll<HTMLInputElement>(selector)[0] ?? null)
      .filter(
        (field): field is HTMLInputElement => field !== null && !field.disabled && !field.readOnly
      );

    if (rawFields.length === 0) {
      return false;
    }

    const initialGroup: OTPFieldGroup = {
      fields: rawFields,
      score: 100,
      strategy: 'provided-selectors',
      isSplit: rawFields.length > 1,
      expectedLength: rawFields.length,
      signals: ['provided'],
    };

    const group = this.normalizeOTPGroup(initialGroup, cleanOtp.length, context);
    if (!group) {
      return false;
    }

    const finalOtp = this.resolveOtpValueForGroup(group, originalOtp, cleanOtp);
    const result = await OTPFiller.fill(finalOtp, group, context.framework, isBackgroundTab);
    if (result.success) {
      void AutoSubmitDetector.checkAndHighlight(group);
      this.markOTPUsed();
      this.saveTrustedSelector('otp', selectors[0] ?? this.buildFieldSelector(group.fields[0]));
      return true;
    }

    const controllerField = this.findControllerOTPField(group.fields, cleanOtp.length, context);
    if (controllerField) {
      const controllerValue = controllerField.type === 'number' ? cleanOtp : originalOtp;
      if (
        await this.fillFocusedOTPField(controllerField, controllerValue, context, isBackgroundTab)
      ) {
        this.markOTPUsed();
        this.saveTrustedSelector('otp', this.buildFieldSelector(controllerField));
        return true;
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════
  //  OTP FIELD DETECTION
  // ═══════════════════════════════════════════════════════════

  private getFocusedOTPField(
    expectedLength: number,
    context: PageContext
  ): HTMLInputElement | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || active.disabled || active.readOnly) {
      return null;
    }
    return this.isOTPFillCandidate(active, expectedLength, context) ? active : null;
  }

  private findControllerOTPField(
    ignoreFields: HTMLInputElement[],
    expectedLength: number,
    context: PageContext
  ): HTMLInputElement | null {
    const ignored = new Set(ignoreFields);
    const active =
      document.activeElement instanceof HTMLInputElement ? document.activeElement : null;

    const candidates = deepQuerySelectorAll<HTMLInputElement>('input')
      .filter((field) => !ignored.has(field))
      .filter((field) => field.isConnected && !field.disabled && !field.readOnly)
      .filter((field) => this.isOTPCompatibleInput(field));

    let bestField: HTMLInputElement | null = null;
    let bestScore = -1;

    for (const field of candidates) {
      if (!this.isOTPFillCandidate(field, expectedLength, context)) {
        continue;
      }

      let score = 0;
      if (field === active) {
        score += 5;
      }
      if (field.autocomplete.toLowerCase() === 'one-time-code') {
        score += 4;
      }
      if (
        field.inputMode === 'numeric' ||
        field.getAttribute('inputmode') === 'numeric' ||
        field.type === 'number'
      ) {
        score += 2;
      }
      if (this.hasStrongOTPSignal(field, expectedLength, context)) {
        score += 3;
      }
      // maxLength is -1 when unset, so this only rewards explicit, fitting limits.
      if (field.maxLength >= expectedLength) {
        score += 2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestField = field;
      }
    }

    return bestScore >= 4 ? bestField : null;
  }

  private normalizeOTPGroup(
    group: OTPFieldGroup,
    expectedLength: number,
    context: PageContext
  ): OTPFieldGroup | null {
    if (group.signals?.includes('contenteditable')) {
      return group;
    }

    const fillableFields = group.fields.filter(
      (field) => field?.isConnected && !field.disabled && !field.readOnly
    );
    if (fillableFields.length === 0) {
      return null;
    }

    const looksLikeSplit =
      fillableFields.length >= MIN_SPLIT_OTP_FIELDS &&
      fillableFields.length <= MAX_SPLIT_OTP_FIELDS &&
      fillableFields.every((field) => {
        const rect = field.getBoundingClientRect();
        return field.maxLength === 1 || rect.width <= SPLIT_OTP_BOX_MAX_WIDTH;
      });

    if (group.isSplit || looksLikeSplit) {
      const compatibleSplitFields = fillableFields.filter((field) =>
        this.isOTPCompatibleInput(field)
      );
      if (compatibleSplitFields.length < MIN_SPLIT_OTP_FIELDS) {
        return null;
      }
      const fields = compatibleSplitFields.slice(0, MAX_SPLIT_OTP_FIELDS);
      return {
        ...group,
        fields,
        isSplit: true,
        expectedLength: fields.length,
      };
    }

    const safeField = fillableFields.find((field) =>
      this.isOTPFillCandidate(field, expectedLength, context)
    );
    if (!safeField) {
      return null;
    }

    return {
      ...group,
      fields: [safeField],
      isSplit: false,
      expectedLength,
    };
  }

  private isOTPFillCandidate(
    field: HTMLInputElement,
    expectedLength: number,
    context: PageContext
  ): boolean {
    if (!this.isOTPCompatibleInput(field)) {
      return false;
    }

    const hasAutocompleteOTP = field.autocomplete.toLowerCase() === 'one-time-code';
    const descriptor = this.getFieldDescriptor(field);
    if (CAPTCHA_DESCRIPTOR_PATTERN.test(descriptor) && !hasAutocompleteOTP) {
      return false;
    }

    const record = extractFieldRecord(field);
    const calibrated = this.intelligence.classify(record);
    if (calibrated.decision === 'BLOCK') {
      log.warn(`Field fill blocked by safety gate: ${calibrated.safetyReason ?? ''}`);
      return false;
    }
    if (calibrated.decision === 'ABSTAIN') {
      return false;
    }

    const classified = calibrated.fieldType;
    if (classified === 'otp') {
      return true;
    }
    // A field classified as something else (or unknown) is only an OTP target
    // when accompanied by a strong, independent OTP signal.
    return this.hasStrongOTPSignal(field, expectedLength, context);
  }

  private isOTPCompatibleInput(field: HTMLInputElement): boolean {
    return OTP_COMPATIBLE_INPUT_TYPES.has(field.type);
  }

  private hasStrongOTPSignal(
    field: HTMLInputElement,
    expectedLength: number,
    context: PageContext
  ): boolean {
    if (field.autocomplete.toLowerCase() === 'one-time-code') {
      return true;
    }

    const name = field.name.toLowerCase();
    const id = field.id.toLowerCase();
    if (OTP_EXACT_FIELD_NAMES.has(name) || OTP_EXACT_FIELD_NAMES.has(id)) {
      return true;
    }

    if (STRONG_OTP_DESCRIPTOR_PATTERN.test(this.getFieldDescriptor(field))) {
      return true;
    }

    const maxLength = field.maxLength;
    const hasExpectedLength =
      (maxLength >= 4 && maxLength <= 10) ||
      (expectedLength >= 4 && expectedLength <= 10 && maxLength === expectedLength);

    const isNumericish =
      field.inputMode === 'numeric' ||
      field.inputMode === 'decimal' ||
      field.getAttribute('inputmode') === 'numeric' ||
      field.type === 'tel' ||
      field.type === 'number' ||
      field.type === 'password';

    return (
      hasExpectedLength &&
      isNumericish &&
      (context.isVerificationPage || context.is2FAPage || context.hasOTPLanguage)
    );
  }

  private getFieldDescriptor(field: HTMLInputElement): string {
    const labels = field.labels ? Array.from(field.labels, (label) => label.textContent ?? '') : [];
    const ariaLabelledBy = field
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');

    return [
      field.type,
      field.name,
      field.id,
      field.placeholder,
      field.autocomplete,
      field.inputMode,
      field.getAttribute('aria-label'),
      field.getAttribute('aria-describedby'),
      ariaLabelledBy,
      ...labels,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  private async fillFocusedOTPField(
    field: HTMLInputElement,
    value: string,
    context: PageContext,
    isBackgroundTab: boolean
  ): Promise<boolean> {
    if (await FieldSetter.setValue(field, value, context.framework, isBackgroundTab)) {
      return true;
    }

    // PhantomTyper relies on real focus, which background tabs cannot provide.
    if (isBackgroundTab) {
      return false;
    }

    field.focus({ preventScroll: true });
    field.click();
    await PhantomTyper.typeSimulatedString(field, value);

    const stripSeparators = (input: string) => input.replace(/[-\s]/g, '');
    return field.value === value || stripSeparators(field.value) === stripSeparators(value);
  }

  /**
   * Discover OTP fields with retry for SPA-injected fields.
   * Some frameworks (React, Vue, Angular) inject OTP inputs after page load, so
   * we retry discovery a few times, refreshing the page context each attempt.
   */
  private async discoverOTPFieldWithRetry(
    context: PageContext,
    isBackgroundTab: boolean
  ): Promise<OTPFieldGroup | null> {
    const initial = OTPFieldDiscovery.discover(context);
    if (initial) {
      return initial;
    }

    // Background tabs don't render reliably, so retrying wastes time.
    if (isBackgroundTab) {
      return null;
    }

    for (let attempt = 1; attempt <= OTP_DISCOVERY_RETRIES; attempt++) {
      log.debug(
        `OTP field discovery attempt ${attempt}/${OTP_DISCOVERY_RETRIES} — waiting for DOM to settle`
      );
      await this.delay(OTP_DISCOVERY_RETRY_DELAY_MS);

      this.refreshContext();
      const group = OTPFieldDiscovery.discover(this.getContext());
      if (group) {
        log.info(`✅ OTP field found on retry attempt ${attempt}/${OTP_DISCOVERY_RETRIES}`);
        return group;
      }
    }

    log.debug('OTP field not found after all retry attempts');
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: SMART FILL
  // ═══════════════════════════════════════════════════════════

  async smartFill(): Promise<FillResult> {
    const startTime = performance.now();
    const details: FillDetail[] = [];

    if (this.destroyed) {
      return { success: false, filledCount: 0, message: 'Destroyed', details, timingMs: 0 };
    }

    const context = this.getContext();
    const group = OTPFieldDiscovery.discover(context);

    const isPureLoginPage =
      context.isLoginPage &&
      !context.isVerificationPage &&
      !context.is2FAPage &&
      !context.isSignupPage &&
      !context.isPasswordResetPage;

    if (isPureLoginPage) {
      // Only proceed on a pure login page if discovery found a high-conviction
      // OTP field group; otherwise avoid touching credential fields.
      if (!group || group.score < 0.5) {
        log.warn('🚫 Smart Fill blocked on pure login page without visible OTP fields');
        return {
          success: false,
          filledCount: 0,
          message: 'disabled on login pages',
          details,
          timingMs: performance.now() - startTime,
        };
      }
      log.info('🛡️ Bypassing login block due to high-conviction OTP field discovery');
    }

    // Check if we need to auto-generate a disposable email address
    let { identity, otpCode } = await this.fetchIdentityAndOTP();
    if (identity && !identity.email && !otpCode) {
      const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
        .filter((field) => !field.disabled && !field.readOnly);
      let hasEmailOrIdentifierField = false;
      for (const input of inputs) {
        const record = extractFieldRecord(input);
        const calibrated = this.intelligence.classify(record);
        if (calibrated.decision === 'BLOCK') continue;
        const type = calibrated.fieldType;
        if (type === 'email' || type === 'username') {
          hasEmailOrIdentifierField = true;
          break;
        }
      }

      if (hasEmailOrIdentifierField) {
        log.info('✨ Smart Fill found email/identifier field but no email generated yet. Generating one...');
        try {
          const genResp = await safeSendMessage({
            action: 'GENERATE_EMAIL',
            payload: { domain: window.location.hostname },
          });
          if (genResp?.success && (genResp as any).email?.fullEmail) {
            const refetched = await this.fetchIdentityAndOTP();
            if (refetched.identity) {
              identity = refetched.identity;
            }
          }
        } catch (e) {
          log.warn('Failed to auto-generate email during Smart Fill', e);
        }
      }
    }

    for (const waitMs of SMART_FILL_RETRY_DELAYS_MS) {
      if (this.destroyed) {
        break;
      }
      if (waitMs > 0) {
        await this.delay(waitMs);
      }

      const filledCount = await this.performSmartFillAttempt(context, details);
      if (filledCount > 0) {
        return {
          success: true,
          filledCount,
          message: `Filled ${filledCount} field${filledCount === 1 ? '' : 's'}`,
          details,
          timingMs: performance.now() - startTime,
        };
      }
    }

    return {
      success: false,
      filledCount: 0,
      message: 'No fields found',
      details,
      timingMs: performance.now() - startTime,
    };
  }

  private async performSmartFillAttempt(
    context: PageContext,
    details: FillDetail[]
  ): Promise<number> {
    const { identity, otpCode } = await this.fetchIdentityAndOTP();
    if (!identity && !otpCode) {
      return 0;
    }

    await this.adaptive.init();

    const candidates = this.contextEngine.getCandidates();

    let filledCount = 0;
    for (const candidate of candidates) {
      if (candidate.decision === 'BLOCK') {
        log.warn(`Field fill blocked by safety gate: ${candidate.selector}`);
        continue;
      }
      if (candidate.decision === 'ABSTAIN') {
        continue;
      }

      if (this.shouldPreserveExistingValue(candidate.element as HTMLInputElement, candidate.fieldType)) {
        continue;
      }

      const value = this.getValueForFieldType(candidate.fieldType, identity, otpCode, candidate.element as HTMLInputElement, context);
      if (value) {
        const start = performance.now();
        const orderedFiller = new UniversalFiller(
          this.adaptive.getOptimalStrategyOrder(window.location.hostname, (this.filler as any).strategies)
        );

        const fillResult = await this.loop.verifyAndCorrect(orderedFiller, candidate, value);
        const latency = performance.now() - start;

        await this.adaptive.recordOutcome(window.location.hostname, fillResult.strategy, candidate.fieldType, fillResult.success, latency);

        if (fillResult.success) {
          filledCount++;
          const selector = candidate.selector;
          this.saveTrustedSelector(candidate.fieldType, selector);
          details.push({
            fieldType: candidate.fieldType,
            selector,
            strategy: fillResult.strategy,
            success: true,
          });
        }
      }
    }

    return filledCount;
  }

  // ═══════════════════════════════════════════════════════════
  //  FORM FILLING & UI
  // ═══════════════════════════════════════════════════════════

  async fillForm(formSelector?: string, data?: Record<string, string>): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }

    const form = formSelector
      ? (deepQuerySelectorAll<HTMLFormElement>(formSelector)[0] ?? null)
      : (deepQuerySelectorAll<HTMLFormElement>('form')[0] ?? null);
    if (!form) {
      return false;
    }

    if (!data) {
      return (await this.smartFill()).success;
    }

    const framework = this.getContext().framework;
    let filledAny = false;
    for (const [field, value] of Object.entries(data)) {
      const input =
        deepQuerySelectorAll<HTMLInputElement>(
          `input[name="${CSS.escape(field)}"], input[id="${CSS.escape(field)}"]`,
          form
        )[0] ?? null;
      if (input && !input.disabled && !input.readOnly) {
        if (await FieldSetter.setValue(input, value, framework)) {
          filledAny = true;
        }
      }
    }
    return filledAny;
  }

  async injectIcons(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    // Skip injection on authentication provider pages where hidden fields are
    // legitimate and would trigger false-positive honeypot warnings.
    if (this.isInjectionExcludedHost(window.location.hostname)) {
      return;
    }

    const relevantTypes: ReadonlySet<FieldType> = new Set<FieldType>([
      'email',
      'password',
      'username',
      'first-name',
      'last-name',
      'full-name',
    ]);

    const inputs = deepQuerySelectorAll<HTMLInputElement>('input');
    for (const input of inputs) {
      if (input.hasAttribute('data-ghost-attached')) {
        continue;
      }

      const record = extractFieldRecord(input);
      const calibrated = this.intelligence.classify(record);
      if (calibrated.decision === 'BLOCK') {
        log.debug('Skipping field icon injection after safety check', {
          reason: calibrated.safetyReason ?? 'blocked',
        });
        continue;
      }
      if (calibrated.decision === 'ABSTAIN') {
        continue;
      }

      const type = calibrated.fieldType;
      const looksLikeIdentifier =
        type === 'unknown' &&
        /user|login|name|email/i.test(`${input.name} ${input.id} ${input.placeholder}`);

      if (relevantTypes.has(type) || looksLikeIdentifier) {
        this.attachGhostIcon(input, type);
      }
    }

    document.body.setAttribute('data-ghost-injected', 'true');
  }

  private isInjectionExcludedHost(hostname: string): boolean {
    return INJECTION_EXCLUDED_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  }

  private attachGhostIcon(input: HTMLInputElement, type: FieldType): void {
    const ghost = document.createElement('ghost-label') as GhostLabelElement;
    // Only commit the element to the DOM if it can actually attach; otherwise we
    // would leak an orphaned, non-functional <ghost-label> node.
    if (typeof ghost.attachToAttribute !== 'function') {
      return;
    }
    document.body.appendChild(ghost);
    ghost.attachToAttribute(input, () => {
      void this.handleIconClick(input, type);
    });
    input.setAttribute('data-ghost-attached', 'true');
  }

  private async handleIconClick(input: HTMLInputElement, type: FieldType): Promise<void> {
    let { identity, otpCode } = await this.fetchIdentityAndOTP();
    const context = this.getContext();
    if (this.shouldPreserveExistingValue(input, type)) {
      log.debug('Skipping icon fill because field already has a value', { fieldType: type });
      return;
    }

    if ((type === 'email' || type === 'username') && identity && !identity.email) {
      log.info('✨ Ghost icon clicked on email/identifier field but no email generated yet. Generating one...');
      try {
        const genResp = await safeSendMessage({
          action: 'GENERATE_EMAIL',
          payload: { domain: window.location.hostname },
        });
        if (genResp?.success && (genResp as any).email?.fullEmail) {
          const refetched = await this.fetchIdentityAndOTP();
          if (refetched.identity) {
            identity = refetched.identity;
          }
        }
      } catch (e) {
        log.warn('Failed to auto-generate email during icon click', e);
      }
    }

    const value = this.getValueForFieldType(type, identity, otpCode, input, context);
    if (value && (await FieldSetter.setValue(input, value, context.framework))) {
      this.saveTrustedSelector(type, this.buildFieldSelector(input));
    }
  }

  async clearForm(): Promise<void> {
    const framework = this.getContext().framework;
    // Only clear value-bearing text inputs; never touch buttons, checkboxes,
    // radios, hidden fields, etc.
    const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea'
    ).filter((el) => el instanceof HTMLTextAreaElement || this.isClearableInput(el));
    for (const input of inputs) {
      if (!input.disabled && !input.readOnly) {
        await FieldSetter.setValue(input, '', framework);
      }
    }
  }

  private isClearableInput(el: HTMLInputElement): boolean {
    const nonText = new Set([
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
    ]);
    return !nonText.has(el.type);
  }

  async fillField(selector: string, value: string): Promise<boolean> {
    const el = deepQuerySelectorAll<FormInputElement>(selector)[0] ?? null;
    return el ? FieldSetter.setValue(el, value, this.getContext().framework) : false;
  }

  async fillElement(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): Promise<boolean> {
    return FieldSetter.setValue(element, value, this.getContext().framework);
  }

  async fillCurrentField(value: string, fieldType?: FieldType): Promise<boolean> {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return false;
    }

    // If a fieldType is specified, verify the active element matches before filling.
    if (fieldType && fieldType !== 'unknown') {
      const record = extractFieldRecord(el);
      const calibrated = this.intelligence.classify(record);
      if (calibrated.decision === 'BLOCK') {
        log.warn(`Field fill blocked by safety gate: ${calibrated.safetyReason ?? ''}`);
        return false;
      }
      if (calibrated.decision === 'ABSTAIN') {
        return false;
      }
      const classified = calibrated.fieldType;
      if (classified !== fieldType && classified !== 'unknown') {
        log.debug('fillCurrentField: active element type mismatch, skipping', {
          expected: fieldType,
          got: classified,
        });
        return false;
      }
    }

    return FieldSetter.setValue(el, value, this.getContext().framework);
  }

  // ═══════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════

  private async fetchIdentityAndOTP(): Promise<{
    identity: IdentityWithCredentials | null;
    otpCode: string | null;
  }> {
    const [idRes, otpRes] = await Promise.all([
      safeSendMessage({ action: 'GET_IDENTITY' }) as Promise<{
        success?: boolean;
        identity?: IdentityWithCredentials;
      } | null>,
      safeSendMessage({ action: 'GET_LAST_OTP' }) as Promise<{
        lastOTP?: { code?: string };
      } | null>,
    ]);

    return {
      identity: idRes?.success ? (idRes.identity ?? null) : null,
      otpCode: otpRes?.lastOTP?.code ?? null,
    };
  }

  private getValueForFieldType(
    type: FieldType,
    identity: IdentityWithCredentials | null,
    otp: string | null,
    element?: FormInputElement,
    context?: PageContext
  ): string | null {
    if (type === 'otp') {
      return otp;
    }
    if (!identity) {
      return null;
    }

    switch (type) {
      case 'email':
        return identity.email ?? identity.username ?? null;
      case 'username':
        return this.getPreferredIdentifierValue(identity, element, context);
      case 'password':
      case 'confirm-password':
        return identity.password ?? null;
      case 'first-name':
        return identity.firstName ?? null;
      case 'last-name':
        return identity.lastName ?? null;
      case 'full-name':
        return identity.fullName ?? null;
      case 'phone':
        return identity.phone ?? null;
      default:
        return null;
    }
  }

  private shouldPreserveExistingValue(element: FormInputElement, type: FieldType): boolean {
    if (isOverwritableWhenFilled(type)) {
      return false;
    }
    return element.value.length > 0;
  }

  /** Builds a reasonably stable CSS selector for a field, preferring id > name. */
  private buildFieldSelector(field: HTMLInputElement | null | undefined): string {
    if (!field) {
      return 'input';
    }
    if (field.id) {
      return `#${CSS.escape(field.id)}`;
    }
    if (field.name) {
      return `input[name="${CSS.escape(field.name)}"]`;
    }
    return 'input';
  }

  private saveTrustedSelector(fieldType: FieldType, selector: string): void {
    if (!TRUSTED_SELECTOR_FIELD_TYPES.has(fieldType)) {
      return;
    }
    void HistoryManager.saveTrustedSelector(window.location.hostname, fieldType, selector);
  }

  private getPreferredIdentifierValue(
    identity: IdentityWithCredentials,
    element?: FormInputElement,
    context?: PageContext
  ): string | null {
    if (!identity.email && !identity.username) {
      return null;
    }

    const descriptor = [
      element?.name,
      element?.id,
      element?.placeholder,
      element?.getAttribute('aria-label'),
      element?.getAttribute('autocomplete'),
      element instanceof HTMLInputElement ? (element.labels?.[0]?.textContent ?? '') : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const isEmailLike = /email|e-mail|mail|identifier|login|sign in|account|@/i.test(descriptor);
    const isExplicitUsername =
      /username|user.?name|user.?id|handle|nickname|screen.?name|alias|member.?id|uid|uname/i.test(
        descriptor
      );

    const authContext =
      Boolean(context?.isLoginPage) ||
      Boolean(context?.isSignupPage) ||
      Boolean(context?.isPasswordResetPage);
    const usesUsernameAutocomplete =
      element instanceof HTMLInputElement && element.autocomplete.toLowerCase() === 'username';

    if (
      identity.email &&
      (isEmailLike || (authContext && usesUsernameAutocomplete && !isExplicitUsername))
    ) {
      return identity.email;
    }

    return identity.username ?? identity.email ?? null;
  }

  markOTPUsed(): void {
    void safeSendMessage({ action: 'MARK_OTP_USED' }).catch(() => {});
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  GENERIC FIELD RESOLVER
  //
  //  Used by the FAB's actions (email, password, identity names).
  //  Locates the best target input on the page through four stages:
  //
  //  Stage 0 — Domain trusted-selector cache (instant warm-hit)
  //  Stage 1 — Heuristic classifier pipeline (authoritative, same as smartFill)
  //  Stage 2 — Lightweight shared classifier on contextHint (focused element)
  //  Stage 3 — Ordered CSS heuristic selectors (fallback)
  //  Stage 4 — Fallback to contextHint element if it is fillable
  // ═══════════════════════════════════════════════════════════

  /**
   * Find the most-likely input on the page for a specific FieldType.
   *
   * Returns [element, selector] so the caller can both fill and cache.
   * Returns null if nothing credible is found.
   */
  async resolveField(
    fieldType: FieldType,
    contextHint: HTMLElement | null
  ): Promise<{ element: HTMLInputElement; selector: string } | null> {
    const domain = window.location.hostname;

    // ── Stage 0: trusted-selector fast-path ──────────────────
    const trusted = await HistoryManager.getTrustedSelector(domain, fieldType);
    if (trusted) {
      const hits = deepQuerySelectorAll<HTMLInputElement>(trusted);
      const live = hits.find((el) => el.isConnected && !el.disabled && !el.readOnly && this.isVisibleInput(el));
      if (live) {
        log.debug(`FieldResolver: Stage 0 hit (trusted selector for ${fieldType})`, { selector: trusted });
        return { element: live, selector: trusted };
      }
      log.debug(`FieldResolver: Stage 0 miss (stale selector for ${fieldType})`, { selector: trusted });
    }

    // ── Stage 1: full heuristic classifier ─────────────────
    const FILLABLE = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="range"]):not([type="color"])';
    const allInputs = deepQuerySelectorAll<HTMLInputElement>(FILLABLE)
      .filter((el) => el.isConnected && !el.disabled && !el.readOnly && this.isVisibleInput(el));

    let bestEl: HTMLInputElement | null = null;
    let bestScore = 0;

    for (const input of allInputs) {
      const record = extractFieldRecord(input);
      const calibrated = this.intelligence.classify(record);
      if (calibrated.decision === 'BLOCK') continue;
      const type = calibrated.fieldType;
      
      let match = type === fieldType;
      // Allow Username to act as email target if resolving email and no better email exists
      if (!match && fieldType === 'email' && type === 'username') {
        match = true;
      }

      if (match && calibrated.confidence > bestScore) {
        bestScore = calibrated.confidence;
        bestEl = input;
      }
    }

    if (bestEl && bestScore >= 0.30) {
      const selector = this.buildFieldSelector(bestEl);
      log.debug(`FieldResolver: Stage 1 hit (classifier for ${fieldType})`, { selector, score: bestScore });
      return { element: bestEl, selector };
    }

    // ── Stage 2: check contextHint using shared lightweight classifier ──
    if (contextHint instanceof HTMLInputElement && !contextHint.disabled && !contextHint.readOnly) {
      try {
        const { classifyField: sharedClassify } = await import('../shared/fieldClassifier');
        const type = sharedClassify(contextHint);
        let match = false;
        if (fieldType === 'email') {
          match = type === 'email' || type === 'user';
        } else if (fieldType === 'password') {
          match = type === 'password';
        } else if (fieldType === 'first-name' || fieldType === 'last-name' || fieldType === 'full-name') {
          match = type === 'user';
        } else {
          match = type === (fieldType as any);
        }

        if (match) {
          const selector = this.buildFieldSelector(contextHint);
          log.debug(`FieldResolver: Stage 2 hit (shared classifier on contextHint for ${fieldType})`);
          return { element: contextHint, selector };
        }
      } catch {
        // dynamic import failed
      }
    }

    // ── Stage 3: CSS heuristic ordered selectors ──────────────
    const CSS_SELECTORS_MAP: Record<string, string[]> = {
      'email': [
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[autocomplete*="email" i]',
        'input[name*="email" i]',
        'input[id*="email" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="e-mail" i]',
        'input[aria-label*="email" i]',
        'input[aria-label*="e-mail" i]',
      ],
      'password': [
        'input[type="password"]',
        'input[autocomplete="new-password"]',
        'input[autocomplete="current-password"]',
        'input[name*="password" i]',
        'input[id*="password" i]',
        'input[placeholder*="password" i]',
        'input[aria-label*="password" i]',
      ],
      'confirm-password': [
        'input[name*="confirm" i][name*="password" i]',
        'input[id*="confirm" i][id*="password" i]',
        'input[placeholder*="confirm" i][placeholder*="password" i]',
        'input[name*="password" i][name*="2" i]',
      ],
      'first-name': [
        'input[autocomplete="given-name"]',
        'input[name*="firstname" i]',
        'input[name*="first_name" i]',
        'input[name*="first-name" i]',
        'input[id*="firstname" i]',
        'input[id*="first_name" i]',
        'input[id*="first-name" i]',
        'input[placeholder*="first name" i]',
      ],
      'last-name': [
        'input[autocomplete="family-name"]',
        'input[name*="lastname" i]',
        'input[name*="last_name" i]',
        'input[name*="last-name" i]',
        'input[id*="lastname" i]',
        'input[id*="last_name" i]',
        'input[id*="last-name" i]',
        'input[placeholder*="last name" i]',
      ],
      'full-name': [
        'input[autocomplete="name"]',
        'input[name*="fullname" i]',
        'input[name*="full_name" i]',
        'input[name*="full-name" i]',
        'input[name="name" i]',
        'input[id*="fullname" i]',
        'input[id*="full_name" i]',
        'input[id*="full-name" i]',
        'input[id="name" i]',
        'input[placeholder*="full name" i]',
        'input[placeholder*="your name" i]',
      ],
      'username': [
        'input[autocomplete="username"]',
        'input[name*="username" i]',
        'input[name*="user_name" i]',
        'input[name*="user-name" i]',
        'input[id*="username" i]',
        'input[id*="user_name" i]',
        'input[id*="user-name" i]',
        'input[placeholder*="username" i]',
      ]
    };

    const selectors = CSS_SELECTORS_MAP[fieldType];
    if (selectors) {
      const searchRoots: ParentNode[] = [];
      const form = contextHint?.closest?.('form');
      if (form) searchRoots.push(form);
      searchRoots.push(document);

      for (const root of searchRoots) {
        for (const sel of selectors) {
          try {
            const candidates = Array.from(root.querySelectorAll<HTMLInputElement>(sel));
            const hit = candidates.find((el) => el.isConnected && !el.disabled && !el.readOnly && this.isVisibleInput(el));
            if (hit) {
              const selector = this.buildFieldSelector(hit);
              log.debug(`FieldResolver: Stage 3 hit (CSS heuristic for ${fieldType})`, { selector: sel });
              return { element: hit, selector };
            }
          } catch { /* skip */ }
        }
      }
    }

    // ── Stage 4: contextHint fallback if it matches basic constraints ──
    if (contextHint instanceof HTMLInputElement && !contextHint.disabled && !contextHint.readOnly && this.isVisibleInput(contextHint)) {
      const selector = this.buildFieldSelector(contextHint);
      log.debug(`FieldResolver: Stage 4 fallback hit (contextHint for ${fieldType})`, { selector });
      return { element: contextHint, selector };
    }

    log.warn(`FieldResolver: all stages exhausted, no ${fieldType} field found`);
    return null;
  }

  /** Helper: is the input visually present (non-zero size, not hidden). */
  private isVisibleInput(el: HTMLInputElement): boolean {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0;
    } catch {
      return false;
    }
  }

  /**
   * Fill a resolved field with the targeted value.
   * Mirrors the fill-and-cache lifecycle of smartFill / performSmartFillAttempt.
   *
   * @param fieldType   The type of field we want to target.
   * @param value       The string value to fill.
   * @param contextHint The field that had focus when the FAB opened (used as resolver hint).
   * @returns true if the field was resolved AND filled successfully.
   */
  async fillFieldIntoTarget(fieldType: FieldType, value: string, contextHint: HTMLElement | null): Promise<boolean> {
    const resolved = await this.resolveField(fieldType, contextHint);
    if (!resolved) {
      log.warn(`fillFieldIntoTarget: no ${fieldType} field found on page`);
      return false;
    }

    const { element, selector } = resolved;
    const context = this.getContext();

    // Re-focus the resolved element. If the user clicked the FAB menu,
    // focus is now on the shadow-DOM host — we must restore it before
    // any strategy that checks document.activeElement.
    try {
      element.focus({ preventScroll: true });
    } catch { /* detached element — FieldSetter will handle it */ }

    const success = await FieldSetter.setValue(element, value, context.framework);
    if (success) {
      // Persist the winning selector so Stage 0 is instant next time.
      this.saveTrustedSelector(fieldType, selector);
      log.info(`fillFieldIntoTarget: filled ${fieldType} successfully`, { selector });

      // Intelligent co-filling for confirmation passwords
      if (fieldType === 'password') {
        const confirmResolved = await this.resolveField('confirm-password', contextHint);
        if (confirmResolved) {
          log.info('fillFieldIntoTarget: Autofilling confirm-password field as well');
          await FieldSetter.setValue(confirmResolved.element, value, context.framework);
          this.saveTrustedSelector('confirm-password', confirmResolved.selector);
        }
      }

      return true;
    }

    log.warn(`fillFieldIntoTarget: FieldSetter failed on resolved element for ${fieldType}`, { selector });
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.fieldWatcher.stop();
    this.contextEngine.destroy();
    // Reject any queued OTP request so callers don't hang forever.
    if (this.latestPendingOTP) {
      this.latestPendingOTP.resolve(false);
      this.latestPendingOTP = null;
    }
    deepQuerySelectorAll('ghost-label').forEach((el) => el.remove());
    document.body.removeAttribute('data-ghost-injected');
  }
}
