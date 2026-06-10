import { classifyField } from '../intelligence/classifier/classify';
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
import { HistoryManager } from './utils/intelligenceCore';

const log = createLogger('AutoFiller');

/**
 * Maps a classifier `FieldClass` to the canonical `FieldType` used throughout
 * the filler. This is exhaustive: adding a new `FieldClass` without handling it
 * here is a compile-time error (see the `never` assertion in the default case).
 */
function mapFieldClassToFieldType(cls: FieldClass): FieldType {
  switch (cls) {
    case 'Email':
      return 'email';
    case 'Username':
      return 'username';
    case 'Password':
      return 'password';
    case 'Target_Password_Confirm':
      return 'confirm-password';
    case 'First_Name':
      return 'first-name';
    case 'Last_Name':
      return 'last-name';
    case 'Full_Name':
      return 'full-name';
    case 'Phone':
      return 'phone';
    case 'OTP':
      return 'otp';
    case 'Unknown':
      return 'unknown';
    default: {
      // Exhaustiveness guard: if a new FieldClass is added and not handled
      // above, TypeScript will flag this line.
      const _exhaustive: never = cls;
      void _exhaustive;
      return 'unknown';
    }
  }
}

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

    const { decision } = classifyField(extractFieldRecord(field));
    if (decision.action === 'BLOCK') {
      log.warn(`Field fill blocked by safety gate: ${decision.safety ?? ''}`);
      return false;
    }
    if (decision.action === 'ABSTAIN') {
      return false;
    }

    const classified = mapFieldClassToFieldType(decision.class);
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
          message: 'Blocked on login page',
          details,
          timingMs: performance.now() - startTime,
        };
      }
      log.info('🛡️ Bypassing login block due to high-conviction OTP field discovery');
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

    const inputs = deepQuerySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea'
    ).filter((field) => !field.disabled && !field.readOnly);

    const filledElements = new Set<HTMLElement>();
    for (const input of inputs) {
      const { decision } = classifyField(extractFieldRecord(input));
      if (decision.action === 'BLOCK') {
        log.warn(`Field fill blocked by safety gate: ${decision.safety ?? ''}`);
        continue;
      }
      if (decision.action === 'ABSTAIN') {
        continue;
      }

      const type = mapFieldClassToFieldType(decision.class);
      if (type === 'unknown') {
        continue;
      }
      if (this.shouldPreserveExistingValue(input, type)) {
        continue;
      }

      const value = this.getValueForFieldType(type, identity, otpCode, input, context);
      if (value && (await FieldSetter.setValue(input, value, context.framework))) {
        filledElements.add(input);
        const selector = this.buildFieldSelector(input as HTMLInputElement);
        this.saveTrustedSelector(type, selector);
        details.push({
          fieldType: type,
          selector,
          strategy: 'classification',
          success: true,
        });
      }
    }

    return filledElements.size;
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

      const { decision } = classifyField(extractFieldRecord(input));
      if (decision.action === 'BLOCK') {
        log.debug('Skipping field icon injection after safety check', {
          reason: decision.safety ?? 'blocked',
        });
        continue;
      }
      if (decision.action === 'ABSTAIN') {
        continue;
      }

      const type = mapFieldClassToFieldType(decision.class);
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
    const { identity, otpCode } = await this.fetchIdentityAndOTP();
    const context = this.getContext();
    if (this.shouldPreserveExistingValue(input, type)) {
      log.debug('Skipping icon fill because field already has a value', { fieldType: type });
      return;
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
      const { decision } = classifyField(extractFieldRecord(el));
      if (decision.action === 'BLOCK') {
        log.warn(`Field fill blocked by safety gate: ${decision.safety ?? ''}`);
        return false;
      }
      if (decision.action === 'ABSTAIN') {
        return false;
      }
      const classified = mapFieldClassToFieldType(decision.class);
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

  destroy(): void {
    this.destroyed = true;
    this.fieldWatcher.stop();
    // Reject any queued OTP request so callers don't hang forever.
    if (this.latestPendingOTP) {
      this.latestPendingOTP.resolve(false);
      this.latestPendingOTP = null;
    }
    deepQuerySelectorAll('ghost-label').forEach((el) => el.remove());
    document.body.removeAttribute('data-ghost-injected');
  }
}
