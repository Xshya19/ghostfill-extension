/**
 * GhostFill 3.0 — Unified Field Classifier
 *
 * Single source of truth for classifying HTML input fields.
 * Used by both the FAB (floatingButton.ts) and GhostLabel (ghostLabel.ts)
 * to ensure consistent behaviour across all content-script UI layers.
 *
 * Classification is deterministic and side-effect free, so it can be unit tested
 * in isolation. DOM access is confined to label discovery and visibility checks,
 * each guarded against cross-origin / detached-node exceptions.
 */

export type FieldType = 'email' | 'password' | 'otp' | 'user' | 'generic';

export type PageContext =
  | 'default'
  | 'signup'
  | 'login'
  | 'verification'
  | '2fa'
  | 'password-reset';

// ── Exclusion Patterns ─────────────────────────────────
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

// Standalone search-intent tokens. The bare "q" field name is handled separately
// (exact match) rather than via an anchored alternative, which never worked
// reliably inside a multi-token descriptor string.
const SEARCH_PATTERN = /search|query|filter|find/i;
const CAPTCHA_PATTERN =
  /captcha|recaptcha|hcaptcha|turnstile|anti[-_\s]?bot|bot[-_\s]?check|robot/i;

// ── Detection Patterns ────────────────────────────────
const OTP_COMBINED =
  /otp|one[-_\s]?time|verification[-_\s]?code|passcode|security[-_\s]?code|check[-_\s]?code|verify[-_\s]?code/i;
const OTP_EXACT_NAMES = new Set(['code', 'pin', 'token', 'checkcode', 'verifycode']);
const EMAIL_NAME = /e[-_]?mail/i;
const PASSWORD_NAME = /password|passwd|pwd/i;
const USERNAME_NAME = /user[-_]?name|login[-_]?name|login[-_]?id/i;
const NAME_FIELD =
  /first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name|^first$|^last$|fname|lname/i;
const CREDIT_CARD = /card[-_]?number|cvc|cvv|ccv|expiration|expiry/i;
const ADDRESS = /street|address|city|country|state|zip|postal/i;
// "name" catch-all should never fire for these clearly non-person fields.
const NON_PERSON_NAME = /user|company|file|host|domain|nick|brand|product|folder/i;

// Autocomplete is a space-separated token list (e.g. "section-foo billing email").
// Match against individual tokens rather than the whole attribute string.
const OTP_AUTOCOMPLETE_TOKENS = new Set(['one-time-code', 'one-time-password']);
const EMAIL_AUTOCOMPLETE_TOKENS = new Set(['email']);
const USERNAME_AUTOCOMPLETE_TOKENS = new Set(['username']);
const PASSWORD_AUTOCOMPLETE_TOKENS = new Set(['current-password', 'new-password']);
const CREDIT_CARD_AUTOCOMPLETE_TOKENS = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
]);

// ── Public API ──────────────────────────────────────
/**
 * Classify an HTML input element into a GhostFill field type.
 *
 * Priority stack:
 * 1. OTP / Verification codes (highest — autocomplete, name/label, or page context)
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
  const autocompleteRaw = (input.autocomplete ?? '').toLowerCase();
  const autocompleteTokens = tokenize(autocompleteRaw);
  const ariaLabel = (input.getAttribute('aria-label') ?? '').toLowerCase();
  const label = findLabelText(input).toLowerCase();

  const combined = `${type} ${name} ${id} ${placeholder} ${autocompleteRaw} ${ariaLabel} ${label}`;
  const nameId = name + id;
  const isCaptcha = CAPTCHA_PATTERN.test(combined);
  const isVerificationPage =
    pageContext === 'verification' || pageContext === '2fa' || pageContext === 'password-reset';

  // ── 1. OTP / Verification Code (Highest Priority) ────────────
  if (hasAnyToken(autocompleteTokens, OTP_AUTOCOMPLETE_TOKENS)) {
    return 'otp';
  }
  if (!isCaptcha && OTP_COMBINED.test(combined)) {
    return 'otp';
  }
  if (!isCaptcha && (OTP_EXACT_NAMES.has(name) || OTP_EXACT_NAMES.has(id))) {
    return 'otp';
  }
  if (
    isVerificationPage &&
    !isCaptcha &&
    (input.inputMode === 'numeric' ||
      isShortNumericPattern(input) ||
      (input.maxLength >= 4 && input.maxLength <= 10))
  ) {
    return 'otp';
  }

  // ── 2. Email ───────────────────────────────────
  if (type === 'email' || hasAnyToken(autocompleteTokens, EMAIL_AUTOCOMPLETE_TOKENS)) {
    return 'email';
  }
  if (isVerificationPage) {
    // On code-entry pages, only trust strong email signals to avoid hijacking the OTP box.
    if (/@/.test(placeholder) || EMAIL_NAME.test(label)) {
      return 'email';
    }
  } else if (EMAIL_NAME.test(nameId) || EMAIL_NAME.test(label) || /@/.test(placeholder)) {
    return 'email';
  }

  // ── 3. Password ─────────────────────────────────
  if (
    type === 'password' ||
    PASSWORD_NAME.test(nameId) ||
    hasAnyToken(autocompleteTokens, PASSWORD_AUTOCOMPLETE_TOKENS) ||
    /password|passwd/.test(combined)
  ) {
    return 'password';
  }

  // ── 4. Username → email fill mode (not on verification pages) ─
  if (!isVerificationPage) {
    if (
      USERNAME_NAME.test(nameId) ||
      hasAnyToken(autocompleteTokens, USERNAME_AUTOCOMPLETE_TOKENS)
    ) {
      return 'email';
    }
  }

  // ── 5. Excluded → generic ───────────────────────────
  if (
    CREDIT_CARD.test(combined) ||
    hasAnyToken(autocompleteTokens, CREDIT_CARD_AUTOCOMPLETE_TOKENS)
  ) {
    return 'generic';
  }
  if (type === 'search' || SEARCH_PATTERN.test(combined) || name === 'q' || id === 'q') {
    return 'generic';
  }
  if (ADDRESS.test(combined)) {
    return 'generic';
  }

  // ── 6. Name fields ────────────────────────────────
  if (NAME_FIELD.test(nameId)) {
    return 'user';
  }
  if (/name/i.test(nameId) && !NON_PERSON_NAME.test(nameId)) {
    return 'user';
  }

  // ── 7. Signup context boost ──────────────────────────
  if (pageContext === 'signup' && /user|name|profile/i.test(label)) {
    return 'user';
  }

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
  if (!input) {
    return false;
  }

  const type = (input.type ?? '').toLowerCase();
  if (EXCLUDED_INPUT_TYPES.has(type)) {
    return false;
  }

  const name = (input.name ?? '').toLowerCase();
  const id = (input.id ?? '').toLowerCase();
  const nameIdPlaceholder = name + id + (input.placeholder ?? '').toLowerCase();
  if (SEARCH_PATTERN.test(nameIdPlaceholder) || name === 'q' || id === 'q') {
    return false;
  }

  // Single-char OTP digit boxes — handled by the content script aggregate handler
  if (input.maxLength === 1) {
    return false;
  }

  if (input.disabled || input.readOnly) {
    return false;
  }

  try {
    const rect = input.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 15) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const style = window.getComputedStyle(input);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      parseFloat(style.opacity || '1') === 0
    ) {
      return false;
    }
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
  return tooltips[fieldType] ?? tooltips.generic;
}

// ── Internal Helpers ────────────────────────────────
function tokenize(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

function hasAnyToken(tokens: string[], set: Set<string>): boolean {
  return tokens.some((token) => set.has(token));
}

/** True when the input constrains entry to a short numeric code (e.g. pattern="[0-9]{6}"). */
function isShortNumericPattern(input: HTMLInputElement): boolean {
  const pattern = input.getAttribute('pattern');
  if (!pattern) {
    return false;
  }
  return /^\^?\\?d|\[0-9\]/.test(pattern);
}

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
      if (label?.textContent) {
        return normalizeWhitespace(label.textContent);
      }
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
    if (text) {
      return normalizeWhitespace(text);
    }
  }

  // 3. Ancestor label wrapping
  try {
    const parent = input.closest('label');
    if (parent?.textContent) {
      return normalizeWhitespace(parent.textContent);
    }
  } catch {
    /* skip */
  }

  // 4. aria-label attribute fallback
  return input.getAttribute('aria-label') || '';
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
