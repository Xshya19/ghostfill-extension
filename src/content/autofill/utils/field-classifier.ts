import { FormInputElement } from '../../../types/form.types';

export type FieldType =
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

export class FieldClassifier {
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
    'code',
    'pin',
    'token',
    'verifycode',
    'verify-code',
    'verify_code',
    'otp',
    'otc',
    'one-time-code',
    'oneTimeCode',
  ]);

  static classify(input: FormInputElement): FieldType {
    const type = (input.type ?? '').toLowerCase();
    const name = (input.name ?? '').toLowerCase();
    const id = (input.id ?? '').toLowerCase();
    const placeholder = (input.placeholder ?? '').toLowerCase();
    const autocomplete = (input.autocomplete ?? '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
    const label = this.findLabelText(input).toLowerCase();

    const all = `${type}|${name}|${id}|${placeholder}|${autocomplete}|${ariaLabel}|${label}`;

    if (this.AUTOCOMPLETE_MAP.get(autocomplete) === 'otp') {
      return 'otp';
    }
    if (/otp|one[-_]?time|verification[-\s_]?code|passcode|security[-_]?code/i.test(all)) {
      return 'otp';
    }
    if (this.OTP_EXACT_NAMES.has(name) || this.OTP_EXACT_NAMES.has(id)) {
      return 'otp';
    }

    if (type === 'email') {
      return 'email';
    }
    if (type === 'password') {
      return /confirm|repeat|retype|re-enter|again|match/i.test(all)
        ? 'confirm-password'
        : 'password';
    }

    const autoType = this.AUTOCOMPLETE_MAP.get(autocomplete);
    if (autoType) {
      return autoType;
    }

    if (/e[-_]?mail|email/i.test(name + id) || /email/i.test(label)) {
      return 'email';
    }
    if (/password|passwd|pwd|pass[-_]?word/i.test(name + id)) {
      return /confirm|repeat|retype|re-enter|again/i.test(all) ? 'confirm-password' : 'password';
    }
    if (/first[-_]?name|given[-_]?name|fname/i.test(name + id) || /first\s*name/i.test(label)) {
      return 'first-name';
    }
    if (
      /last[-_]?name|family[-_]?name|surname|lname/i.test(name + id) ||
      /last\s*name|surname/i.test(label)
    ) {
      return 'last-name';
    }
    if (
      /full[-_]?name|your[-_]?name|display[-_]?name/i.test(name + id) ||
      /full\s*name|your\s*name/i.test(label)
    ) {
      return 'full-name';
    }
    if (
      /user[-_]?name|login[-_]?name|login[-_]?id|user[-_]?id/i.test(name + id) ||
      /username/i.test(label)
    ) {
      return 'username';
    }
    if (/phone|mobile|tel(?:ephone)?|cell/i.test(name + id) || /phone/i.test(label)) {
      return 'phone';
    }
    if (/@/.test(placeholder) || /email|e-mail/i.test(placeholder)) {
      return 'email';
    }
    if (/password/i.test(placeholder)) {
      return 'password';
    }
    if (/username/i.test(placeholder)) {
      return 'username';
    }
    if (/code|otp|pin|digit/i.test(placeholder)) {
      return 'otp';
    }

    return 'unknown';
  }

  private static findLabelText(input: HTMLElement): string {
    // 1. Explicit labels via 'for' attribute
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label?.textContent) {
        return label.textContent.trim();
      }
    }

    // 2. Wrapping label
    const parentLabel = input.closest('label');
    if (parentLabel?.textContent) {
      return parentLabel.textContent.trim();
    }

    // 3. ARIA labels
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join(' ');
      }
    }
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel;
    }

    // 4. ARIA describedby (common in Material/Radix for hints)
    const describedBy = input.getAttribute('aria-describedby');
    if (describedBy) {
      const descEl = document.getElementById(describedBy);
      if (descEl?.textContent) {
        return descEl.textContent.trim();
      }
    }

    // 5. Floating Labels (Nearby text check)
    // Sites often put labels in a sibling span or div for animation.
    const parent = input.parentElement;
    if (parent) {
      const siblingText = Array.from(parent.children)
        .filter((c) => c !== input && !['INPUT', 'SELECT', 'TEXTAREA'].includes(c.tagName))
        .map((c) => c.textContent?.trim())
        .find((t) => t && t.length > 2 && t.length < 50);
      if (siblingText) {
        return siblingText;
      }
    }

    // 6. Previous sibling fallback
    const prevSibling = input.previousElementSibling;
    if (prevSibling && prevSibling.tagName !== 'INPUT' && prevSibling.textContent) {
      const t = prevSibling.textContent.trim();
      if (t.length > 2) {
        return t;
      }
    }

    return '';
  }
}
