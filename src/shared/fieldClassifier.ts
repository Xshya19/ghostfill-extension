/**
 * GhostFill 3.0 — Unified Field Classifier
 *
 * Single source of truth for classifying HTML input fields.
 * Used by both the FAB (floatingButton.ts) and GhostLabel (ghostLabel.ts)
 * to ensure consistent behaviour across all content-script UI layers.
 *
 * Previously these two components had diverging logic:
 *   - FAB checked CAPTCHA patterns; GhostLabel did not.
 *   - FAB was page-context-aware; GhostLabel was not.
 *   - OTP `maxLength` heuristic was applied unconditionally in GhostLabel.
 *
 * This module unifies all classification into a single, tested function.
 */

export type FieldType = 'email' | 'password' | 'otp' | 'user' | 'generic';

export type PageContext =
  | 'default'
  | 'signup'
  | 'login'
  | 'verification'
  | '2fa'
  | 'password-reset';

// ── Exclusion Patterns ──────────────────────────────────────────

const EXCLUDED_INPUT_TYPES = new Set([
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
  'search',
]);

const SEARCH_PATTERN = /search|query|q$|filter|find/i;

const CAPTCHA_PATTERN =
  /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i;

// ── Detection Patterns ──────────────────────────────────────────

const OTP_AUTOCOMPLETE = new Set(['one-time-code', 'one-time-password']);

const OTP_COMBINED =
  /otp|one[-_\s]?time|verification[-_\s]?code|passcode|security[-_\s]?code|check[-_\s]?code|verify[-_\s]?code/i;

const OTP_EXACT_NAMES = new Set([
  'code',
  'pin',
  'token',
  'checkcode',
  'verifycode',
]);

const EMAIL_NAME = /e[-_]?mail/i;
const PASSWORD_NAME = /password|passwd|pwd/i;
const USERNAME_NAME = /user[-_]?name|login[-_]?name|login[-_]?id/i;
const NAME_FIELD =
  /first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name/i;

const CREDIT_CARD = /card[-_]?number|cvc|cvv|ccv|expiration|expiry/i;
const CREDIT_CARD_AUTOCOMPLETE = new Set(['cc-number', 'cc-csc']);
const ADDRESS = /street|address|city|country|state|zip|postal/i;

// ── Public API ──────────────────────────────────────────────────

/**
 * Classify an HTML input element into a GhostFill field type.
 *
 * The classification uses a priority stack:
 * 1. OTP / Verification codes (highest — verified by autocomplete or page context)
 * 2. Email addresses
 * 3. Passwords
 * 4. Usernames (mapped to email fill mode)
 * 5. Credit card / address / search (excluded → generic)
 * 6. Name fields
 * 7. Signup context boost
 * 8. Generic fallback
 *
 * @param input - The HTMLInputElement to classify
 * @param pageContext - The detected page context for disambiguation
 */
export function classifyField(
  input: HTMLInputElement,
  pageContext: PageContext = 'default'
): FieldType {
  const type = (input.type ?? '').toLowerCase();
  const name = (input.name ?? '').toLowerCase();
  const id = (input.id ?? '').toLowerCase();
  const placeholder = (input.placeholder ?? '').toLowerCase();
  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
  const label = findLabelText(input).toLowerCase();
  const combined = `${type} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel} ${label}`;
  const nameId = name + id;

  const isVerificationPage =
    pageContext === 'verification' ||
    pageContext === '2fa' ||
    pageContext === 'password-reset';

  // ── 1. OTP / Verification Code (Highest Priority) ────────────
  if (OTP_AUTOCOMPLETE.has(autocomplete)) {return 'otp';}
  if (!CAPTCHA_PATTERN.test(combined) && OTP_COMBINED.test(combined)) {return 'otp';}
  if (
    !CAPTCHA_PATTERN.test(combined) &&
    (OTP_EXACT_NAMES.has(name) || OTP_EXACT_NAMES.has(id))
  )
    {return 'otp';}
  if (
    isVerificationPage &&
    (input.inputMode === 'numeric' ||
      (input.maxLength >= 4 && input.maxLength <= 10))
  )
    {return 'otp';}

  // ── 2. Email ─────────────────────────────────────────────────
  if (type === 'email') {return 'email';}
  if (isVerificationPage) {
    if (/@/.test(placeholder) || /enter[\s._-]*email/i.test(label)) {return 'email';}
  } else {
    if (
      EMAIL_NAME.test(nameId) ||
      /email/i.test(label) ||
      /@/.test(placeholder)
    )
      {return 'email';}
  }

  // ── 3. Password ───────────────────────────────────────────────
  if (type === 'password' || PASSWORD_NAME.test(nameId)) {return 'password';}
  if (/password|passwd/.test(combined)) {return 'password';}

  // ── 4. Username → email fill mode (not on verification pages) ─
  if (!isVerificationPage) {
    if (USERNAME_NAME.test(nameId) || autocomplete === 'username') {return 'email';}
  }

  // ── 5. Excluded → generic ─────────────────────────────────────
  if (CREDIT_CARD.test(combined) || CREDIT_CARD_AUTOCOMPLETE.has(autocomplete))
    {return 'generic';}
  if (type === 'search' || SEARCH_PATTERN.test(combined)) {return 'generic';}
  if (ADDRESS.test(combined)) {return 'generic';}

  // ── 6. Name fields ────────────────────────────────────────────
  if (NAME_FIELD.test(nameId)) {return 'user';}
  if (
    /name/i.test(nameId) &&
    !/user/i.test(nameId) &&
    !/company/i.test(nameId)
  )
    {return 'user';}

  // ── 7. Signup context boost ───────────────────────────────────
  if (pageContext === 'signup' && /user|name|profile/i.test(label)) {return 'user';}

  return 'generic';
}

/**
 * Determine whether an input should receive a GhostLabel overlay or FAB decoration.
 *
 * Returns false for:
 * - Non-text input types (hidden, submit, button, etc.)
 * - Search-intent fields
 * - Single-character OTP digit boxes (handled separately by content script)
 * - Disabled or read-only fields
 * - Visually hidden or zero-size fields
 */
export function shouldDecorateField(input: HTMLInputElement): boolean {
  if (!input) {return false;}

  const type = (input.type ?? '').toLowerCase();

  if (EXCLUDED_INPUT_TYPES.has(type)) {return false;}
  if (type === 'search') {return false;}

  const nameIdPlaceholder = (
    (input.name || '') +
    (input.id || '') +
    (input.placeholder || '')
  ).toLowerCase();
  if (SEARCH_PATTERN.test(nameIdPlaceholder)) {return false;}

  // Single-char OTP digit boxes — handled by the content script aggregate handler
  if (input.maxLength === 1) {return false;}

  if (input.disabled || input.readOnly) {return false;}

  try {
    const rect = input.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 15) {return false;}
  } catch {
    return false;
  }

  try {
    const style = window.getComputedStyle(input);
    if (style.display === 'none' || style.visibility === 'hidden') {return false;}
    if (style.opacity === '0') {return false;}
  } catch {
    return false;
  }

  return true;
}

/**
 * Get a contextual tooltip string for a classified field type.
 */
export function getFieldTooltip(fieldType: FieldType): string {
  const tooltips: Record<FieldType, string> = {
    email: 'Fill email address',
    password: 'Fill password',
    otp: 'Paste verification code',
    user: 'Fill name',
    generic: 'GhostFill — Auto-fill',
  };
  return tooltips[fieldType];
}

// ── Internal Helpers ────────────────────────────────────────────

/**
 * Find the visible text label associated with an input element.
 * Checks (in priority order):
 * 1. `<label for="id">` association
 * 2. `aria-labelledby` references
 * 3. Ancestor `<label>` wrapping
 * 4. `aria-label` attribute
 */
function findLabelText(input: HTMLInputElement): string {
  // 1. Standard label[for] association
  if (input.id) {
    try {
      const label = document.querySelector<HTMLLabelElement>(
        `label[for="${CSS.escape(input.id)}"]`
      );
      if (label?.textContent) {return label.textContent.trim();}
    } catch {
      /* skip on cross-origin or restricted DOM */
    }
  }

  // 2. aria-labelledby references
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((refId) => {
      try {
        return document.getElementById(refId)?.textContent?.trim() || '';
      } catch {
        return '';
      }
    });
    const text = parts.filter(Boolean).join(' ');
    if (text) {return text;}
  }

  // 3. Ancestor label wrapping
  try {
    const parent = input.closest('label');
    if (parent?.textContent) {return parent.textContent.trim();}
  } catch {
    /* skip */
  }

  // 4. aria-label attribute fallback
  return input.getAttribute('aria-label') || '';
}
