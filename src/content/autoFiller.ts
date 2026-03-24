import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { 
  PageIntelligence, 
  OTPFieldDiscovery, 
  OTPFiller, 
  AutoSubmitDetector,
  FieldWatcher,
  FieldSetter,
  OTPFieldGroup,
  FieldClassifier,
  FieldType
} from './autofill/index';
import { 
  PageContext, 
  FormInputElement, 
  FillResult, 
  FillDetail, 
  IdentityWithCredentials,
  DetectedField
} from '../types/form.types';
import { FieldAnalyzer } from './fieldAnalyzer';
import { pageStatus } from './pageStatus';

const log = createLogger('AutoFiller');

const DYNAMIC_WATCH_TIMEOUT_MS = 15000;
const SMART_FILL_RETRY_DELAYS_MS = [0, 500, 1500, 3000];

interface GhostLabelElement extends HTMLElement {
  attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

export class AutoFiller {
  private fieldWatcher = new FieldWatcher();
  private pageContext: PageContext | null = null;
  private destroyed = false;
  private fillLock = false;

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

  async fillOTP(otp: string, fieldSelectors?: string[], isBackgroundTab: boolean = false): Promise<boolean> {
    if (this.destroyed || this.fillLock) return false;
    this.fillLock = true;

    try {
      const context = this.getContext();
      // Keep original for single fields, clean for split fields
      const cleanOTP = otp.replace(/[-\s]/g, '');
      if (cleanOTP.length === 0 && otp.length === 0) return false;

      log.info('🔑 OTP Fill Pipeline Started', { length: cleanOTP.length, original: otp.length });

      if (fieldSelectors?.length) {
        const result = await this.fillOTPWithSelectors(cleanOTP, fieldSelectors, context, isBackgroundTab);
        if (result) return true;
      }

      const group = OTPFieldDiscovery.discover(context);
      if (group) {
        // Use cleanOTP for split fields, original OTP for single fields (unless single field is type=number)
        let finalOtp = group.isSplit ? cleanOTP : otp;
        if (!group.isSplit && group.fields[0]?.type === 'number') {
           finalOtp = cleanOTP; // number fields can't handle hyphens
        }
        
        const result = await OTPFiller.fill(finalOtp, group, context.framework, isBackgroundTab);
        if (result.success) {
          void AutoSubmitDetector.checkAndHighlight(group);
          this.markOTPUsed();
          return true;
        }
      }

      // ── Background tab guard ──
      // In background tabs, we can't rely on DOM focus events or fieldWatcher.
      // If no OTP fields were found after detection, bail gracefully instead of
      // spamming retries that will always fail on a post-redirect dashboard page.
      if (isBackgroundTab) {
        log.info('🔇 Background tab: no OTP fields found after detection, skipping fieldWatcher retry');
        return false;
      }

      return await this.fieldWatcher.watch(cleanOTP, context, DYNAMIC_WATCH_TIMEOUT_MS);
    } finally {
      this.fillLock = false;
    }
  }

  private async fillOTPWithSelectors(otp: string, selectors: string[], context: PageContext, isBackgroundTab: boolean = false): Promise<boolean> {
    const fields = selectors
      .map(s => document.querySelector(s) as HTMLInputElement)
      .filter(f => f && !f.disabled && !f.readOnly);

    if (fields.length === 0) return false;

    const group: OTPFieldGroup = {
      fields,
      score: 100,
      strategy: 'provided-selectors',
      isSplit: fields.length > 1, // Fix: don't strictly require maxLength=1
      expectedLength: fields.length,
      signals: ['provided']
    };

    // For selectors, we assume cleanOTP if it's split
    const finalOtp = group.isSplit ? otp : (fields[0]?.type === 'number' ? otp : otp);
    const result = await OTPFiller.fill(finalOtp, group, context.framework, isBackgroundTab);
    if (result.success) {
      void AutoSubmitDetector.checkAndHighlight(group);
      this.markOTPUsed();
      return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  //  CORE: SMART FILL
  // ═══════════════════════════════════════════════════════════

  async smartFill(): Promise<FillResult> {
    if (this.destroyed) return { success: false, filledCount: 0, message: 'Destroyed', details: [], timingMs: 0 };

    const startTime = performance.now();
    const context = this.getContext();
    const details: FillDetail[] = [];

    const group = OTPFieldDiscovery.discover(context);

    if (context.isLoginPage && !context.isVerificationPage && !context.is2FAPage && !context.isSignupPage && !context.isPasswordResetPage) {
       // Only block if we haven't found a strong OTP field group during discovery
       if (!group || group.score < 0.5) {
         log.warn('🚫 Smart Fill blocked on pure login page without visible OTP fields');
         return { success: false, filledCount: 0, message: 'Blocked on login page', details, timingMs: performance.now() - startTime };
       } else {
         log.info('🛡️ Bypssing login block due to high-conviction OTP field discovery');
         // Skipping block, context stays same but we proceed.
       }
    }

    for (const waitMs of SMART_FILL_RETRY_DELAYS_MS) {
      if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
      const filledCount = await this.performSmartFillAttempt(context, details);
      if (filledCount > 0) {
        return { success: true, filledCount, message: `Filled ${filledCount} fields`, details, timingMs: performance.now() - startTime };
      }
    }

    return { success: false, filledCount: 0, message: 'No fields found', details, timingMs: performance.now() - startTime };
  }

  private async performSmartFillAttempt(context: PageContext, details: FillDetail[]): Promise<number> {
    const { identity, otpCode } = await this.fetchIdentityAndOTP();
    if (!identity && !otpCode) return 0;

    const filledElements = new Set<HTMLElement>();
    
    // AI Detection
    try {
      const analyzer = FieldAnalyzer.getInstance();
      const aiResult = await analyzer.getAllFieldsWithAI();
      for (const field of aiResult.fields || []) {
        if (filledElements.has(field.element)) continue;
        const value = this.getValueForFieldType(field.fieldType, identity, otpCode);
        if (value && await FieldSetter.setValue(field.element as HTMLInputElement, value, context.framework)) {
          filledElements.add(field.element);
          details.push({ fieldType: field.fieldType, selector: field.selector, strategy: 'ai-detected', success: true });
        }
      }
    } catch {}

    // Direct Classification
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input, textarea'))
      .filter(f => !filledElements.has(f) && !f.disabled && !f.readOnly);

    for (const input of inputs) {
      const type = FieldClassifier.classify(input);
      if (type === 'unknown') continue;
      const value = this.getValueForFieldType(type, identity, otpCode);
      if (value && await FieldSetter.setValue(input, value, context.framework)) {
        filledElements.add(input);
        details.push({ fieldType: type, selector: input.id || input.name || 'input', strategy: 'classification', success: true });
      }
    }

    return filledElements.size;
  }

  // ═══════════════════════════════════════════════════════════
  //  FORM FILLING & UI
  // ═══════════════════════════════════════════════════════════

  async fillForm(formSelector?: string, data?: Record<string, string>): Promise<boolean> {
    if (this.destroyed) return false;
    const form = formSelector ? document.querySelector<HTMLFormElement>(formSelector) : document.querySelector('form');
    if (!form) return false;

    if (data) {
      const framework = this.getContext().framework;
      for (const [field, value] of Object.entries(data)) {
        const input = form.querySelector<HTMLInputElement>(`input[name="${CSS.escape(field)}"], input[id="${CSS.escape(field)}"]`);
        if (input) await FieldSetter.setValue(input, value, framework);
      }
      return true;
    }
    return (await this.smartFill()).success;
  }

  async injectIcons(): Promise<void> {
    if (this.destroyed || document.body.hasAttribute('data-ghost-injected')) return;
    const inputs = document.querySelectorAll<HTMLInputElement>('input');
    const relevantTypes = new Set(['email', 'password', 'username', 'first-name', 'last-name', 'full-name']);

    for (const input of inputs) {
      if (input.hasAttribute('data-ghost-attached')) continue;
      const type = FieldClassifier.classify(input);
      if (relevantTypes.has(type) || (type === 'unknown' && /user|login|name|email/i.test(input.name + input.id + input.placeholder))) {
        this.attachGhostIcon(input, type);
      }
    }
    document.body.setAttribute('data-ghost-injected', 'true');
  }

  private attachGhostIcon(input: HTMLInputElement, type: FieldType): void {
    const ghost = document.createElement('ghost-label') as GhostLabelElement;
    document.body.appendChild(ghost);
    if (ghost.attachToAttribute) {
      ghost.attachToAttribute(input, () => this.handleIconClick(input, type));
    }
    input.setAttribute('data-ghost-attached', 'true');
  }

  private async handleIconClick(input: HTMLInputElement, type: FieldType): Promise<void> {
    const { identity, otpCode } = await this.fetchIdentityAndOTP();
    const value = this.getValueForFieldType(type, identity, otpCode);
    if (value) {
      await FieldSetter.setValue(input, value, this.getContext().framework);
      await this.smartFill();
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

  private async fetchIdentityAndOTP(): Promise<{ identity: any, otpCode: string | null }> {
    const idRes = (await safeSendMessage({ action: 'GET_IDENTITY' })) as any;
    const otpRes = (await safeSendMessage({ action: 'GET_LAST_OTP' })) as any;
    return {
      identity: idRes?.success ? idRes.identity : null,
      otpCode: otpRes?.lastOTP?.code || null
    };
  }

  private getValueForFieldType(type: string, id: any, otp: string | null): string | null {
    if (type === 'otp') return otp;
    if (!id) return null;
    const map: Record<string, string> = {
      email: id.email, password: id.password, 'confirm-password': id.password,
      username: id.username, 'first-name': id.firstName, 'last-name': id.lastName, 'full-name': id.fullName
    };
    return map[type] || null;
  }

  markOTPUsed(): void {
    safeSendMessage({ action: 'MARK_OTP_USED' }).catch(() => {});
  }

  async fillField(selector: string, value: string): Promise<boolean> {
    const el = document.querySelector<FormInputElement>(selector);
    return el ? FieldSetter.setValue(el, value, this.getContext().framework) : false;
  }

  async fillElement(element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<boolean> {
    return FieldSetter.setValue(element, value, this.getContext().framework);
  }

  async fillCurrentField(value: string, fieldType?: string): Promise<boolean> {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return FieldSetter.setValue(el, value, this.getContext().framework);
    }
    return false;
  }

  destroy(): void {
    this.destroyed = true;
    this.fieldWatcher.stop();
    document.querySelectorAll('ghost-label').forEach(e => e.remove());
    document.body.removeAttribute('data-ghost-injected');
  }
}
