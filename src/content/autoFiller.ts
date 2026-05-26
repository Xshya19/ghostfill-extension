import {
  PageContext,
  FormInputElement,
  FillResult,
  FillDetail,
  IdentityWithCredentials,
  FieldType as FormFieldType,
} from '../types/form.types';
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
  FieldClassifier,
  FieldType,
} from './autofill/index';
import { FieldAnalyzer } from './fieldAnalyzer';
import { HistoryManager } from './utils/intelligenceCore';

const log = createLogger('AutoFiller');

const DYNAMIC_WATCH_TIMEOUT_MS = 7000;
const SMART_FILL_RETRY_DELAYS_MS = [0, 500, 1500, 3000];
const OTP_EXACT_FIELD_NAMES = new Set([
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

const NON_OTP_FIELD_TYPES = new Set([
  'email',
  'username',
  'first-name',
  'last-name',
  'full-name',
  'phone',
  'text',
]);

const TRUSTED_SELECTOR_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set([
  'email',
  'password',
  'confirm-password',
  'otp',
  'username',
  'name',
  'first-name',
  'last-name',
  'middle-name',
  'full-name',
  'phone',
  'address',
  'city',
  'zip',
  'country',
  'credit-card',
  'cvv',
  'expiry',
  'unknown',
]);

interface GhostLabelElement extends HTMLElement {
  attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

export class AutoFiller {
  private fieldWatcher = new FieldWatcher();
  private pageContext: PageContext | null = null;
  private destroyed = false;
  private fillLock = false;
  private latestPendingOTP: {
    otp: string;
    fieldSelectors?: string[];
    isBackgroundTab: boolean;
    resolve: (val: boolean) => void;
  } | null = null;

  private processNextOTPInQueue(): void {
    if (this.latestPendingOTP && !this.destroyed) {
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
  }

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

  // ═══════════════════════════════════════════════════════════
  //  CORE: OTP FILLING
  // ═══════════════════════════════════════════════════════════

  async fillOTP(
    otp: string,
    fieldSelectors?: string[],
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
    if (this.destroyed) {
      return false;
    }
    if (this.fillLock) {
      // If the lock is held but only because the passive fieldWatcher is waiting for dynamically rendered fields,
      // stop the watcher immediately. This resolves the watcher's promise, releasing the lock,
      // and allows us to process the new OTP request without waiting for the full watcher timeout.
      if (this.fieldWatcher.isActive) {
        log.info('🔄 New OTP request received while passive FieldWatcher was active. Stopping current watcher to prioritize new request.');
        this.fieldWatcher.stop();
      }

      log.info('🔒 Fill lock active, queuing OTP request to process after current run completes');
      return new Promise<boolean>((resolve) => {
        if (this.latestPendingOTP) {
          this.latestPendingOTP.resolve(false);
        }
        this.latestPendingOTP = {
          otp,
          ...(fieldSelectors && { fieldSelectors }),
          isBackgroundTab,
          resolve,
        };
      });
    }

    this.fillLock = true;

    try {
      const context = this.getContext();
      // Keep original for single fields, clean for split fields
      const cleanOTP = otp.replace(/[-\s]/g, '');
      if (cleanOTP.length === 0) {
        return false;
      }

      log.info('🔑 OTP Fill Pipeline Started', { length: cleanOTP.length, original: otp.length });

      if (fieldSelectors?.length) {
        const result = await this.fillOTPWithSelectors(
          otp,
          cleanOTP,
          fieldSelectors,
          context,
          isBackgroundTab
        );
        if (result) {
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

        // Use cleanOTP for split fields, original OTP for single fields (unless single field is type=number)
        let finalOtp = safeGroup.isSplit ? cleanOTP : otp;
        if (!safeGroup.isSplit && safeGroup.fields[0]?.type === 'number') {
          finalOtp = cleanOTP; // number fields can't handle hyphens
        }

        const result = await OTPFiller.fill(
          finalOtp,
          safeGroup,
          context.framework,
          isBackgroundTab
        );
        if (result.success) {
          void AutoSubmitDetector.checkAndHighlight(safeGroup);
          this.markOTPUsed();
          // Intelligence 2.0: Save trusted OTP selector (first field of group)
          if (safeGroup.fields[0]) {
            void HistoryManager.saveTrustedSelector(
              window.location.hostname,
              'otp',
              safeGroup.fields[0].id
                ? `#${safeGroup.fields[0].id}`
                : safeGroup.fields[0].name
                  ? `input[name="${safeGroup.fields[0].name}"]`
                  : 'input'
            );
          }
          return true;
        }
      }

      return this.tryFallbackOTPFill(otp, cleanOTP, context, isBackgroundTab);
    } finally {
      this.fillLock = false;
      this.processNextOTPInQueue();
    }
  }

  private async tryFallbackOTPFill(
    otp: string,
    cleanOTP: string,
    context: PageContext,
    isBackgroundTab: boolean
  ): Promise<boolean> {
    const focusedField =
      this.getFocusedOTPField(cleanOTP.length) ?? this.findControllerOTPField([], cleanOTP.length);
    if (focusedField) {
      const focusedValue = focusedField.type === 'number' ? cleanOTP : otp;
      const focusedResult = await this.fillFocusedOTPField(
        focusedField,
        focusedValue,
        context,
        isBackgroundTab
      );
      if (focusedResult) {
        this.markOTPUsed();
        return true;
      }
    }

    // ── Background tab guard ──
    // In background tabs, we can't rely on DOM focus events or fieldWatcher.
    // If no OTP fields accepted the code after direct and controller recovery,
    // bail gracefully instead of spinning on retries that need active focus.
    if (isBackgroundTab) {
      log.info('🔇 Background tab: no OTP fields accepted the code, skipping fieldWatcher retry');
      return false;
    }

    return this.fieldWatcher.watch(cleanOTP, context, DYNAMIC_WATCH_TIMEOUT_MS);
  }

  private async fillOTPWithSelectors(
    originalOtp: string,
    cleanOtp: string,
    selectors: string[],
    context: PageContext,
    isBackgroundTab: boolean = false
  ): Promise<boolean> {
    const rawFields = selectors
      .map((s) => document.querySelector(s) as HTMLInputElement)
      .filter((f) => f && !f.disabled && !f.readOnly);

    if (rawFields.length === 0) {
      return false;
    }

    const initialGroup: OTPFieldGroup = {
      fields: rawFields,
      score: 100,
      strategy: 'provided-selectors',
      isSplit: rawFields.length > 1, // Fix: don't strictly require maxLength=1
      expectedLength: rawFields.length,
      signals: ['provided'],
    };
    const group = this.normalizeOTPGroup(initialGroup, cleanOtp.length, context);
    if (!group) {
      return false;
    }
    const fields = group.fields;

    // For selectors, we assume cleanOTP if it's split
    const finalOtp = group.isSplit
      ? cleanOtp
      : fields[0]?.type === 'number'
        ? cleanOtp
        : originalOtp;
    const result = await OTPFiller.fill(finalOtp, group, context.framework, isBackgroundTab);
    if (result.success) {
      void AutoSubmitDetector.checkAndHighlight(group);
      this.markOTPUsed();
      // Intelligence 2.0: Save trusted OTP selector
      if (fields[0]) {
        void HistoryManager.saveTrustedSelector(window.location.hostname, 'otp', selectors[0]!);
      }
      return true;
    }

    const controllerField = this.findControllerOTPField(fields, cleanOtp.length);
    if (controllerField) {
      const controllerValue = controllerField.type === 'number' ? cleanOtp : originalOtp;
      const controllerResult = await this.fillFocusedOTPField(
        controllerField,
        controllerValue,
        context,
        isBackgroundTab
      );
      if (controllerResult) {
        this.markOTPUsed();
        return true;
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: SMART FILL
  // ═══════════════════════════════════════════════════════════

  private getFocusedOTPField(expectedLength: number): HTMLInputElement | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) || active.disabled || active.readOnly) {
      return null;
    }

    return this.isOTPFillCandidate(active, expectedLength, this.getContext()) ? active : null;
  }

  private findControllerOTPField(
    ignoreFields: HTMLInputElement[],
    expectedLength: number
  ): HTMLInputElement | null {
    const ignored = new Set(ignoreFields);
    const active =
      document.activeElement instanceof HTMLInputElement ? document.activeElement : null;

    const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
      .filter((field) => !ignored.has(field))
      .filter((field) => field.isConnected && !field.disabled && !field.readOnly)
      .filter((field) => ['text', 'tel', 'number', 'password', ''].includes(field.type));

    let bestField: HTMLInputElement | null = null;
    let bestScore = -1;

    for (const field of candidates) {
      let score = 0;
      if (field === active) {
        score += 5;
      }
      if (field.autocomplete === 'one-time-code') {
        score += 4;
      }
      if (
        field.inputMode === 'numeric' ||
        field.getAttribute('inputmode') === 'numeric' ||
        field.type === 'number'
      ) {
        score += 2;
      }
      if (this.hasStrongOTPSignal(field, expectedLength, this.getContext())) {
        score += 3;
      }
      if (field.maxLength === expectedLength || field.maxLength > expectedLength) {
        score += 2;
      }
      if (!this.isOTPFillCandidate(field, expectedLength, this.getContext())) {
        score = -1;
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

    const splitLike =
      fillableFields.length >= 4 &&
      fillableFields.length <= 8 &&
      fillableFields.every((field) => {
        const rect = field.getBoundingClientRect();
        return field.maxLength === 1 || rect.width <= 90;
      });

    if (group.isSplit || splitLike) {
      const compatibleSplitFields = fillableFields.filter((field) =>
        this.isOTPCompatibleInput(field)
      );
      if (compatibleSplitFields.length < 4) {
        return null;
      }
      return {
        ...group,
        fields: compatibleSplitFields.slice(0, Math.min(compatibleSplitFields.length, 8)),
        isSplit: true,
        expectedLength: compatibleSplitFields.length,
      };
    }

    const safeFields = fillableFields.filter((field) =>
      this.isOTPFillCandidate(field, expectedLength, context)
    );

    if (safeFields.length === 0) {
      return null;
    }

    return {
      ...group,
      fields: [safeFields[0]!],
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

    const descriptor = this.getFieldDescriptor(field);
    const hasAutocompleteOTP = field.autocomplete.toLowerCase() === 'one-time-code';
    if (CAPTCHA_DESCRIPTOR_PATTERN.test(descriptor) && !hasAutocompleteOTP) {
      return false;
    }

    const classified = FieldClassifier.classify(field);
    const strongOTP = this.hasStrongOTPSignal(field, expectedLength, context);

    if (classified === 'otp') {
      return true;
    }

    if (NON_OTP_FIELD_TYPES.has(classified)) {
      return strongOTP;
    }

    return strongOTP;
  }

  private isOTPCompatibleInput(field: HTMLInputElement): boolean {
    return ['text', 'tel', 'number', 'password', ''].includes(field.type);
  }

  private hasStrongOTPSignal(
    field: HTMLInputElement,
    expectedLength: number,
    context: PageContext
  ): boolean {
    const descriptor = this.getFieldDescriptor(field);
    const name = field.name.toLowerCase();
    const id = field.id.toLowerCase();

    if (field.autocomplete.toLowerCase() === 'one-time-code') {
      return true;
    }
    if (OTP_EXACT_FIELD_NAMES.has(name) || OTP_EXACT_FIELD_NAMES.has(id)) {
      return true;
    }
    if (STRONG_OTP_DESCRIPTOR_PATTERN.test(descriptor)) {
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
    const labels = field.labels ? Array.from(field.labels).map((label) => label.textContent) : [];
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
    const setResult = await FieldSetter.setValue(field, value, context.framework, isBackgroundTab);
    if (setResult) {
      return true;
    }

    if (isBackgroundTab) {
      return false;
    }

    field.focus({ preventScroll: true });
    field.click();
    await PhantomTyper.typeSimulatedString(field, value);
    return (
      field.value === value || field.value.replace(/[-\s]/g, '') === value.replace(/[-\s]/g, '')
    );
  }

  async smartFill(): Promise<FillResult> {
    if (this.destroyed) {
      return { success: false, filledCount: 0, message: 'Destroyed', details: [], timingMs: 0 };
    }

    const startTime = performance.now();
    const context = this.getContext();
    const details: FillDetail[] = [];

    const group = OTPFieldDiscovery.discover(context);

    if (
      context.isLoginPage &&
      !context.isVerificationPage &&
      !context.is2FAPage &&
      !context.isSignupPage &&
      !context.isPasswordResetPage
    ) {
      // Only block if we haven't found a strong OTP field group during discovery
      if (!group || group.score < 0.5) {
        log.warn('🚫 Smart Fill blocked on pure login page without visible OTP fields');
        return {
          success: false,
          filledCount: 0,
          message: 'Blocked on login page',
          details,
          timingMs: performance.now() - startTime,
        };
      } else {
        log.info('🛡️ Bypassing login block due to high-conviction OTP field discovery');
        // Skipping block, context stays same but we proceed.
      }
    }

    for (const waitMs of SMART_FILL_RETRY_DELAYS_MS) {
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, waitMs);
        });
      }
      const filledCount = await this.performSmartFillAttempt(context, details);
      if (filledCount > 0) {
        return {
          success: true,
          filledCount,
          message: `Filled ${filledCount} fields`,
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

    const filledElements = new Set<HTMLElement>();

    // AI Detection
    try {
      const analyzer = FieldAnalyzer.getInstance();
      const aiResult = await analyzer.getAllFieldsWithAI();
      for (const field of aiResult.fields || []) {
        if (filledElements.has(field.element)) {
          continue;
        }
        const fieldType = this.normalizeSmartFillFieldType(field.fieldType);
        if (this.shouldPreserveExistingValue(field.element, fieldType)) {
          continue;
        }
        const value = this.getValueForFieldType(
          fieldType,
          identity,
          otpCode,
          field.element,
          context
        );
        if (
          value &&
          (await FieldSetter.setValue(field.element as HTMLInputElement, value, context.framework))
        ) {
          filledElements.add(field.element);
          details.push({
            fieldType,
            selector: field.selector,
            strategy: 'ai-detected',
            success: true,
          });
          // Intelligence 2.0: Self-Healing
          this.saveTrustedSelector(fieldType, field.selector);
        }
      }
    } catch {
      // AI-assisted field detection is opportunistic; continue with fallback heuristics.
    }

    // Direct Classification
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input, textarea')
    ).filter((f) => !filledElements.has(f) && !f.disabled && !f.readOnly);

    for (const input of inputs) {
      const type = this.normalizeSmartFillFieldType(FieldClassifier.classify(input));
      if (type === 'unknown') {
        continue;
      }
      if (this.shouldPreserveExistingValue(input, type)) {
        continue;
      }
      const value = this.getValueForFieldType(type, identity, otpCode, input, context);
      if (value && (await FieldSetter.setValue(input, value, context.framework))) {
        filledElements.add(input);
        details.push({
          fieldType: type,
          selector: input.id || input.name || 'input',
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
      ? document.querySelector<HTMLFormElement>(formSelector)
      : document.querySelector('form');
    if (!form) {
      return false;
    }

    if (data) {
      const framework = this.getContext().framework;
      for (const [field, value] of Object.entries(data)) {
        const input = form.querySelector<HTMLInputElement>(
          `input[name="${CSS.escape(field)}"], input[id="${CSS.escape(field)}"]`
        );
        if (input) {
          await FieldSetter.setValue(input, value, framework);
        }
      }
      return true;
    }
    return (await this.smartFill()).success;
  }

  async injectIcons(): Promise<void> {
    if (this.destroyed || document.body.hasAttribute('data-ghost-injected')) {
      return;
    }
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    const relevantTypes = new Set([
      'email',
      'password',
      'username',
      'first-name',
      'last-name',
      'full-name',
    ]);

    for (const input of inputs) {
      if (input.hasAttribute('data-ghost-attached')) {
        continue;
      }
      const type = FieldClassifier.classify(input);
      if (
        relevantTypes.has(type) ||
        (type === 'unknown' &&
          /user|login|name|email/i.test(input.name + input.id + input.placeholder))
      ) {
        this.attachGhostIcon(input, type);
      }
    }
    document.body.setAttribute('data-ghost-injected', 'true');
  }

  private attachGhostIcon(input: HTMLInputElement, type: FieldType): void {
    const ghost = document.createElement('ghost-label') as GhostLabelElement;
    document.body.appendChild(ghost);
    if (ghost.attachToAttribute) {
      ghost.attachToAttribute(input, () => {
        void this.handleIconClick(input, type);
      });
    }
    input.setAttribute('data-ghost-attached', 'true');
  }

  private async handleIconClick(input: HTMLInputElement, type: FieldType): Promise<void> {
    const { identity, otpCode } = await this.fetchIdentityAndOTP();
    const fieldType = this.normalizeSmartFillFieldType(type);
    if (this.shouldPreserveExistingValue(input, fieldType)) {
      log.debug('Skipping icon fill because field already has a value', { fieldType });
      return;
    }
    const value = this.getValueForFieldType(fieldType, identity, otpCode, input, this.getContext());
    if (value) {
      await FieldSetter.setValue(input, value, this.getContext().framework);
    }
  }

  async clearForm(): Promise<void> {
    const inputs = document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])');
    const framework = this.getContext().framework;
    for (const input of Array.from(inputs)) {
      await FieldSetter.setValue(input, '', framework);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  UTILITIES
  // ═══════════════════════════════════════════════════════════

  private async fetchIdentityAndOTP(): Promise<{
    identity: IdentityWithCredentials | null;
    otpCode: string | null;
  }> {
    const idRes = (await safeSendMessage({ action: 'GET_IDENTITY' })) as {
      success?: boolean;
      identity?: IdentityWithCredentials;
    } | null;
    const otpRes = (await safeSendMessage({ action: 'GET_LAST_OTP' })) as {
      lastOTP?: { code?: string };
    } | null;
    return {
      identity: idRes?.success ? (idRes.identity ?? null) : null,
      otpCode: otpRes?.lastOTP?.code || null,
    };
  }

  private getValueForFieldType(
    type: string,
    id: IdentityWithCredentials | null,
    otp: string | null,
    element?: FormInputElement,
    context?: PageContext
  ): string | null {
    if (type === 'otp') {
      return otp;
    }
    if (!id) {
      return null;
    }

    if (type === 'username') {
      const preferredIdentifier = this.getPreferredIdentifierValue(id, element, context);
      if (preferredIdentifier) {
        return preferredIdentifier;
      }
    }

    const map: Record<string, string | undefined> = {
      email: id.email ?? id.username ?? '',
      password: id.password ?? '',
      'confirm-password': id.password ?? '',
      username: id.username,
      'first-name': id.firstName,
      'last-name': id.lastName,
      'full-name': id.fullName,
    };
    return map[type] ?? null;
  }

  private normalizeSmartFillFieldType(type: string): string {
    if (type === 'name') {
      return 'full-name';
    }
    if (type === 'confirm_password') {
      return 'confirm-password';
    }
    return type;
  }

  private shouldPreserveExistingValue(element: FormInputElement, type: string): boolean {
    if (type === 'otp' || type === 'unknown') {
      return false;
    }
    return element.value.length > 0;
  }

  private saveTrustedSelector(fieldType: string, selector: string): void {
    if (!TRUSTED_SELECTOR_FIELD_TYPES.has(fieldType as FormFieldType)) {
      return;
    }
    void HistoryManager.saveTrustedSelector(
      window.location.hostname,
      fieldType as FormFieldType,
      selector
    );
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
      element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : '',
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const emailLikePattern = /email|e-mail|mail|identifier|login|sign in|account|@/i;
    const explicitUsernamePattern =
      /username|user.?name|user.?id|handle|nickname|screen.?name|alias|member.?id|uid|uname/i;

    const isEmailLike = emailLikePattern.test(descriptor);
    const isExplicitUsername = explicitUsernamePattern.test(descriptor);
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
    safeSendMessage({ action: 'MARK_OTP_USED' }).catch(() => {});
  }

  async fillField(selector: string, value: string): Promise<boolean> {
    const el = document.querySelector<FormInputElement>(selector);
    return el ? FieldSetter.setValue(el, value, this.getContext().framework) : false;
  }

  async fillElement(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ): Promise<boolean> {
    return FieldSetter.setValue(element, value, this.getContext().framework);
  }

  async fillCurrentField(value: string, fieldType?: string): Promise<boolean> {
    const el = document.activeElement;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return false;
    }
    // If a fieldType is specified, verify the active element actually matches before filling
    if (fieldType && fieldType !== 'unknown') {
      const classified = FieldClassifier.classify(el as HTMLInputElement);
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

  /**
   * Discover OTP fields with retry for SPA-injected fields.
   * Some frameworks (React, Vue, Angular) inject OTP inputs after page load.
   * This method retries discovery up to 5 times with 200ms intervals.
   */
  private async discoverOTPFieldWithRetry(
    context: PageContext,
    isBackgroundTab: boolean
  ): Promise<OTPFieldGroup | null> {
    // First attempt: immediate discovery
    let group = OTPFieldDiscovery.discover(context);
    if (group) {
      return group;
    }

    // SPA retry: wait for dynamically injected fields
    if (isBackgroundTab) {
      return null;
    } // Don't retry in background tabs

    const maxRetries = 5;
    const retryDelay = 200;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      log.debug(`OTP field discovery attempt ${attempt}/${maxRetries} — waiting for DOM to settle`);
      await new Promise((resolve) => setTimeout(resolve, retryDelay));

      // Refresh context to pick up new DOM elements
      this.refreshContext();
      const freshContext = this.getContext();
      group = OTPFieldDiscovery.discover(freshContext);

      if (group) {
        log.info(`✅ OTP field found on retry attempt ${attempt}/${maxRetries}`);
        return group;
      }
    }

    log.debug('OTP field not found after all retry attempts');
    return null;
  }

  destroy(): void {
    this.destroyed = true;
    this.fieldWatcher.stop();
    document.querySelectorAll('ghost-label').forEach((e) => e.remove());
    document.body.removeAttribute('data-ghost-injected');
  }
}
