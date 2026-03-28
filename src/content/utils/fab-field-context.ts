/**
 * fab-field-context.ts — Field Context Analyzer
 *
 * Extracted from floatingButton.ts §3 to enforce single responsibility.
 * Determines which GhostFill mode (email/password/otp/user/form/magic)
 * applies to a given form field, and whether to show the FAB at all.
 */
import type { ButtonMode, PageType } from './fab-types';
import { isFormInputElement, escapeCSS, safeQuerySelector } from './fab-utils';

const MIN_FIELD_WIDTH = 30;
const MIN_FIELD_HEIGHT = 15;
const MAX_LABEL_SCAN_LENGTH = 60;

export class FieldContext {
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

  private static readonly OTP_AUTOCOMPLETE = new Set(['one-time-code', 'one-time-password']);
  private static readonly OTP_COMBINED_PATTERN =
    /otp|one[-_\s]?time|verification[-_\s]?code|passcode|security[-_\s]?code|check[-_\s]?code|verify[-_\s]?code/i;
  private static readonly OTP_EXACT_NAMES = new Set(['code', 'pin', 'token', 'checkcode', 'verifycode']);
  private static readonly EMAIL_NAME_PATTERN = /e[-_]?mail/i;
  private static readonly PASSWORD_NAME_PATTERN = /password|passwd|pwd/i;
  private static readonly USERNAME_NAME_PATTERN = /user[-_]?name|login[-_]?name|login[-_]?id/i;
  private static readonly NAME_FIELD_PATTERN =
    /first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name/i;
  private static readonly CREDIT_CARD_PATTERN = /card[-_]?number|cvc|cvv|ccv|expiration|expiry/i;
  private static readonly CREDIT_CARD_AUTOCOMPLETE = new Set(['cc-number', 'cc-csc']);
  private static readonly ADDRESS_PATTERN = /street|address|city|country|state|zip|postal/i;

  static getMode(field: HTMLElement, pageType?: PageType): ButtonMode {
    if (!isFormInputElement(field)) return 'magic';

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

    if (this.OTP_AUTOCOMPLETE.has(autocomplete)) return 'otp';
    if (this.OTP_COMBINED_PATTERN.test(combined)) return 'otp';
    if (this.OTP_EXACT_NAMES.has(name) || this.OTP_EXACT_NAMES.has(id)) return 'otp';
    if (isVerificationPage && (input.inputMode === 'numeric' || (input.maxLength >= 4 && input.maxLength <= 10))) return 'otp';
    if (type === 'email') return 'email';
    if (isVerificationPage) {
      if (/@/.test(placeholder) || /enter[\s._-]*email/i.test(label)) return 'email';
    } else {
      if (this.EMAIL_NAME_PATTERN.test(nameId) || /email/i.test(label) || /@/.test(placeholder)) return 'email';
    }
    if (type === 'password' || this.PASSWORD_NAME_PATTERN.test(nameId)) return 'password';
    if (!isVerificationPage) {
      if (this.USERNAME_NAME_PATTERN.test(nameId) || autocomplete === 'username') return 'email';
    }
    if (this.CREDIT_CARD_PATTERN.test(combined) || this.CREDIT_CARD_AUTOCOMPLETE.has(autocomplete)) return 'magic';
    if (type === 'search' || this.SEARCH_PATTERNS.test(combined)) return 'magic';
    if (this.NAME_FIELD_PATTERN.test(nameId)) return 'user';
    if (/name/i.test(nameId) && !/user/i.test(nameId) && !/company/i.test(nameId)) return 'user';
    if (this.ADDRESS_PATTERN.test(combined)) return 'magic';
    if (pageType === 'signup' && /user|name|profile/i.test(label)) return 'user';

    return 'magic';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getTooltip(mode: ButtonMode, _pageType: PageType): string {
    return this.TOOLTIPS[mode] ?? this.TOOLTIPS.magic;
  }

  static shouldShowButton(field: HTMLElement): boolean {
    if (!isFormInputElement(field)) return false;
    const input = field as HTMLInputElement;
    if (field instanceof HTMLInputElement && this.EXCLUDED_TYPES.has(field.type)) return false;
    if (field instanceof HTMLInputElement && field.type === 'search') return false;
    const name = (input.name || input.id || input.placeholder || '').toLowerCase();
    if (this.SEARCH_PATTERNS.test(name)) return false;
    if (input.maxLength === 1) return false;
    if (input.disabled || input.readOnly) return false;
    const rect = field.getBoundingClientRect();
    if (rect.width < MIN_FIELD_WIDTH || rect.height < MIN_FIELD_HEIGHT) return false;
    const style = window.getComputedStyle(field);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  static findLabelText(input: HTMLElement): string {
    if (input.id) {
      const label = safeQuerySelector<HTMLLabelElement>(document, `label[for="${escapeCSS(input.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
    const parentLabel = input.closest('label');
    if (parentLabel?.textContent) return parentLabel.textContent.trim();
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.textContent) return labelEl.textContent.trim();
    }
    try {
      const prev = input.previousElementSibling;
      if (prev?.textContent && prev.textContent.length < MAX_LABEL_SCAN_LENGTH) return prev.textContent.trim();
      const parent = input.parentElement;
      if (parent) {
        const pPrev = parent.previousElementSibling;
        if (pPrev?.textContent && pPrev.textContent.length < MAX_LABEL_SCAN_LENGTH) return pPrev.textContent.trim();
      }
    } catch { /* ignore */ }
    return '';
  }
}
