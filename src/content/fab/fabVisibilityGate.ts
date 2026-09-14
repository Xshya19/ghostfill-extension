/**
 * GhostFill 3.0 — FAB Intelligence Layer · visibility gate
 *
 * Answers ONE question: "should the FAB appear for this focused element, and
 * how loudly?"  Pure, synchronous, DOM-read-only, no page-text scans.
 *
 * Decision pipeline
 *   1. Hard blocks   — things the FAB must NEVER decorate (search, chat,
 *                      comments, card numbers, addresses, rich-text editors,
 *                      app surfaces such as Docs/Slack/WhatsApp, muted hosts).
 *   2. Score         — weighted credential evidence: autocomplete tokens,
 *                      input type, descriptor text, label text, form context,
 *                      page analysis, URL, and per-host learning.
 *   3. Presence      — score >= active → full FAB, >= quiet → dot, else hidden.
 */

import {
  DEFAULT_THRESHOLDS,
  type FabBlockReason,
  type FabMode,
  type FieldEvidence,
  type GateDecision,
  type GateOptions,
} from './fabTypes';

// ── Input types the FAB can never decorate ───────────────────────────
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
  'date',
  'datetime-local',
  'month',
  'week',
  'time',
]);

// ── Credential evidence ─────────────────────────────────────────
const CREDENTIAL_AUTOCOMPLETE = new Map<string, number>([
  ['one-time-code', 70],
  ['one-time-password', 70],
  ['current-password', 62],
  ['new-password', 62],
  ['email', 55],
  ['username', 46],
  ['name', 18],
  ['given-name', 18],
  ['family-name', 18],
  ['nickname', 14],
]);

const EMAIL_RE =
  /\b(e[-_ ]?mail|correo|courriel|\u30e1\u30fc\u30eb|\u90ae\u7bb1|\u0438\u043c\u0435\u0439\u043b)\b|email/i;
const PASSWORD_RE =
  /\b(password|passwd|pwd|pass|senha|contrase\u00f1a|mot[-_ ]?de[-_ ]?passe|passwort|\u30d1\u30b9\u30ef\u30fc\u30c9|\u5bc6\u7801|\u092a\u093e\u0938\u0935\u0930\u094d\u0921)\b/i;
const USERNAME_RE =
  /\b(username|user[-_ ]?name|userid|user[-_ ]?id|login[-_ ]?(id|name)?|handle|screen[-_ ]?name|usuario|benutzername)\b/i;
const OTP_STRONG_RE =
  /\b(otp|one[-_ ]?time|2fa|mfa|passcode|verification[-_ ]?code|verify[-_ ]?code|security[-_ ]?code|auth[-_ ]?code|confirmation[-_ ]?code|sms[-_ ]?code|email[-_ ]?code|totp|\u0e23\u0e2b\u0e31\u0e2a|\u9a8c\u8bc1\u7801|\u0913\u091f\u0940\u092a\u0940)\b/i;
const OTP_WEAK_RE = /\b(code|pin|token)\b/i;
const PERSON_NAME_RE =
  /\b(first[-_ ]?name|last[-_ ]?name|full[-_ ]?name|given[-_ ]?name|family[-_ ]?name|surname|fname|lname|display[-_ ]?name)\b/i;

// ── Hard-block descriptors ──────────────────────────────────────
const SEARCH_RE =
  /\b(search|searchbox|searchbar|query|keyword|filter|find|lookup|autocomplete|suggest|omnibox|buscar|suche|recherche|\u691c\u7d22|\u641c\u7d22)\b/i;
const CONTENT_RE =
  /\b(comment|comments|message|messages|msg|chat|reply|replies|post|tweet|caption|feedback|review|note|notes|bio|about|description|summary|subject|body|compose|content|editor|title|headline|question|answer|prompt|todo|task|search[-_ ]?term)\b/i;
const PAYMENT_RE =
  /\b(card|cardnumber|card[-_ ]?no|cc[-_ ]?num(ber)?|cvc|cvv|csc|ccv|expir\w*|exp[-_ ]?(month|year|date)|iban|routing|account[-_ ]?number|upi|vpa|ifsc|swift|bic|billing[-_ ]?zip)\b/i;
const ADDRESS_RE =
  /\b(address|address1|address2|street|addr|city|town|state|province|region|country|zip|zipcode|postal|postcode|pincode|apartment|apt|suite|landmark|house[-_ ]?no)\b/i;
const NUMERIC_RE =
  /\b(quantity|qty|amount|price|total|subtotal|weight|height|width|size|age|year|month|day|date|dob|birth|birthday|salary|budget|count|percent|rating|score|seats|guests|passengers|rooms|nights)\b/i;
const PROMO_RE =
  /\b(coupon|promo|promotion|voucher|discount|referral|refer[-_ ]?code|gift[-_ ]?card|newsletter|subscribe|subscription)\b/i;
const ID_DOC_RE =
  /\b(aadhaar|aadhar|pan[-_ ]?(no|number|card)|ssn|social[-_ ]?security|passport|driver[-_ ]?licen[cs]e|licen[cs]e[-_ ]?no|gstin|gst[-_ ]?no|tax[-_ ]?id|vat)\b/i;
const PHONE_RE = /\b(phone|mobile|telephone|tel|whatsapp|contact[-_ ]?number)\b/i;

/**
 * Product surfaces where a credential FAB is always noise unless the page is
 * genuinely an auth screen. These are the hosts that generated most of the
 * "it appears in random places" reports (chat boxes, doc editors, feeds).
 */
const APP_SURFACE_HOSTS = [
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
  'drive.google.com',
  'mail.google.com',
  'calendar.google.com',
  'chat.google.com',
  'gemini.google.com',
  'meet.google.com',
  'notion.so',
  'notion.site',
  'slack.com',
  'teams.microsoft.com',
  'teams.live.com',
  'outlook.office.com',
  'outlook.live.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'web.whatsapp.com',
  'web.telegram.org',
  'messenger.com',
  'discord.com',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'reddit.com',
  'youtube.com',
  'figma.com',
  'canva.com',
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'perplexity.ai',
  'stackoverflow.com',
  'medium.com',
  'substack.com',
  'atlassian.net',
  'asana.com',
  'trello.com',
  'monday.com',
  'linear.app',
  'overleaf.com',
  'zoom.us',
];

/** Auth intent detected straight from the URL — cheap and very high signal. */
export const AUTH_PATH_RE =
  /(^|[/?#&=_.-])(log[-_]?in|login|sign[-_]?in|signin|sign[-_]?up|signup|register|registration|create[-_]?account|new[-_]?account|join|auth|oauth|openid|sso|saml|session|verify|verification|confirm|activate|otp|2fa|mfa|challenge|password|passwd|reset|recover|forgot|credentials|checkout\/(login|guest))/i;

const CODE_GROUP_MIN = 4;
const CODE_GROUP_MAX = 8;

// ── Helpers ──────────────────────────────────────────────────
function normalise(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function safeRect(el: Element): { width: number; height: number } {
  try {
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  } catch {
    return { width: 0, height: 0 };
  }
}

function labelTextFor(el: HTMLElement): string {
  const parts: string[] = [];

  try {
    if (el.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (label?.textContent) {
        parts.push(label.textContent);
      }
    }
  } catch {
    /* restricted DOM */
  }

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    for (const ref of labelledBy.split(/\s+/)) {
      try {
        const node = document.getElementById(ref);
        if (node?.textContent) {
          parts.push(node.textContent);
        }
      } catch {
        /* ignore */
      }
    }
  }

  try {
    const wrapping = el.closest('label');
    if (wrapping?.textContent) {
      parts.push(wrapping.textContent);
    }
  } catch {
    /* ignore */
  }

  const aria = el.getAttribute('aria-label');
  if (aria) {
    parts.push(aria);
  }

  return normalise(parts.join(' ')).slice(0, 160);
}

function isEditableTarget(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return true;
  }
  const ceAttr = el.getAttribute('contenteditable');
  const ceProp = el.contentEditable;
  return (
    el.isContentEditable ||
    ceProp === 'true' ||
    ceProp === 'plaintext-only' ||
    ceAttr === 'true' ||
    ceAttr === '' ||
    el.getAttribute('role') === 'textbox'
  );
}

function isVisuallyUsable(el: HTMLElement): boolean {
  try {
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse' ||
      parseFloat(style.opacity || '1') === 0 ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

/** Sibling `maxlength=1` boxes that together form a verification-code group. */
function findCodeGroup(input: HTMLInputElement): HTMLElement | null {
  const parent = input.parentElement;
  if (!parent) {
    return null;
  }
  for (let depth = 0, node: HTMLElement | null = parent; depth < 3 && node; depth += 1) {
    const boxes = Array.from(node.querySelectorAll<HTMLInputElement>('input')).filter(
      (candidate) =>
        candidate.maxLength === 1 ||
        (candidate.inputMode === 'numeric' && candidate.value.length <= 1),
    );
    if (boxes.length >= CODE_GROUP_MIN && boxes.length <= CODE_GROUP_MAX) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function isAppSurfaceHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return APP_SURFACE_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function collectFieldEvidence(el: HTMLElement): FieldEvidence {
  const input = el instanceof HTMLInputElement ? el : null;
  const textarea = el instanceof HTMLTextAreaElement ? el : null;
  const form = input?.form ?? textarea?.form ?? null;
  const formInputs = form ? form.querySelectorAll('input, textarea, select') : null;
  const rect = safeRect(el);

  const descriptor = normalise(
    [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('data-testid'),
      el.getAttribute('autocomplete'),
      el.getAttribute('role'),
      el.className && typeof el.className === 'string' ? el.className : '',
    ]
      .filter(Boolean)
      .join(' '),
  ).slice(0, 240);

  return {
    tag: el.tagName.toLowerCase(),
    type: (input?.type ?? '').toLowerCase(),
    autocompleteTokens: (el.getAttribute('autocomplete') ?? '')
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean),
    descriptor,
    labelText: labelTextFor(el),
    inForm: Boolean(form),
    formInputCount: formInputs ? formInputs.length : 0,
    formHasPassword: form ? Boolean(form.querySelector('input[type="password"]')) : false,
    maxLength: input?.maxLength ?? -1,
    inputMode: (el.getAttribute('inputmode') ?? '').toLowerCase(),
    isContentEditable:
      el.isContentEditable ||
      el.contentEditable === 'true' ||
      el.contentEditable === 'plaintext-only' ||
      el.getAttribute('contenteditable') === 'true' ||
      el.getAttribute('contenteditable') === '',
    width: rect.width,
    height: rect.height,
  };
}

function blocked(reason: FabBlockReason, evidence?: FieldEvidence): GateDecision {
  return {
    presence: 'hidden',
    mode: 'magic',
    score: 0,
    confidence: 0,
    reasons: [`block:${reason}`],
    blockedBy: reason,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Main entry point. Replaces the old `showNearField()` page gate, whose
 * `analysis.inputCount < 1` clause made the whole condition unreachable.
 */
export function evaluateFab(target: EventTarget | null, options: GateOptions = {}): GateDecision {
  const thresholds = {
    active: options.thresholds?.active ?? DEFAULT_THRESHOLDS.active,
    quiet: options.thresholds?.quiet ?? DEFAULT_THRESHOLDS.quiet,
  };

  if (options.enabled === false) {
    return blocked('disabled-by-settings');
  }
  if (!(target instanceof HTMLElement)) {
    return blocked('not-a-field');
  }
  if (document.designMode === 'on') {
    return blocked('design-mode');
  }
  if (target.closest('#ghostfill-fab, .gf-fab, [data-ghostfill-ui]')) {
    return blocked('inside-fab');
  }
  if (!isEditableTarget(target)) {
    return blocked('not-a-field');
  }

  const href = options.href ?? location.href;
  const hostname = options.hostname ?? location.hostname;
  const policy = options.policy ?? null;
  const page = options.pageSignals ?? null;
  const evidence = collectFieldEvidence(target);

  if (policy?.muted) {
    return blocked('host-muted', evidence);
  }

  const input = target instanceof HTMLInputElement ? target : null;
  const isPasswordType = evidence.type === 'password';
  const hasCredentialAutocomplete = evidence.autocompleteTokens.some(
    (token) =>
      token === 'one-time-code' ||
      token === 'current-password' ||
      token === 'new-password' ||
      token === 'email' ||
      token === 'username',
  );
  /** A real credential contract from the site — overrides descriptor blocks. */
  const credentialContract =
    isPasswordType || evidence.type === 'email' || hasCredentialAutocomplete;
  const authUrl = AUTH_PATH_RE.test(href);

  // ── 1. Hard blocks ───────────────────────────────────────────
  if (!options.allowAppSurfaces && isAppSurfaceHost(hostname) && !authUrl && !credentialContract) {
    return blocked('host-app-surface', evidence);
  }

  if (input) {
    if (EXCLUDED_INPUT_TYPES.has(evidence.type)) {
      return blocked('excluded-input-type', evidence);
    }
    if (input.disabled || input.readOnly) {
      return blocked('field-not-editable', evidence);
    }
  } else if (target instanceof HTMLTextAreaElement) {
    if (target.disabled || target.readOnly) {
      return blocked('field-not-editable', evidence);
    }
    // Textareas are never credential inputs — they are comments and messages.
    if (!hasCredentialAutocomplete) {
      return blocked('content-field', evidence);
    }
  } else {
    // contenteditable / role=textbox: Docs, Notion, Slack, WhatsApp, chat boxes.
    // The old code skipped every filter for these, which is why the FAB showed
    // up inside rich-text editors.
    if (!hasCredentialAutocomplete) {
      return blocked('rich-text-editor', evidence);
    }
  }

  if (!isVisuallyUsable(target)) {
    return blocked('field-invisible', evidence);
  }
  if (evidence.width < 32 || evidence.height < 16) {
    // Except split code boxes, which are intentionally tiny.
    const group = input ? findCodeGroup(input) : null;
    if (!group) {
      return blocked('field-too-small', evidence);
    }
  }

  const haystack = `${evidence.descriptor} ${evidence.labelText}`;
  const role = (target.getAttribute('role') ?? '').toLowerCase();

  if (!credentialContract) {
    if (
      role === 'searchbox' ||
      role === 'combobox' ||
      target.getAttribute('name') === 'q' ||
      target.getAttribute('name') === 's' ||
      target.id === 'q' ||
      target.id === 's' ||
      SEARCH_RE.test(haystack) ||
      target.closest('[role="search"], form[role="search"]') !== null
    ) {
      return blocked('search-field', evidence);
    }
    if (PAYMENT_RE.test(haystack)) {
      return blocked('payment-field', evidence);
    }
    if (ID_DOC_RE.test(haystack)) {
      return blocked('identity-document-field', evidence);
    }
    if (ADDRESS_RE.test(haystack)) {
      return blocked('address-field', evidence);
    }
    if (PROMO_RE.test(haystack)) {
      return blocked('promo-field', evidence);
    }
    if (CONTENT_RE.test(haystack) && !OTP_STRONG_RE.test(haystack)) {
      return blocked('content-field', evidence);
    }
    if (NUMERIC_RE.test(haystack) && !OTP_STRONG_RE.test(haystack)) {
      return blocked('numeric-field', evidence);
    }
    if (PHONE_RE.test(haystack) && !OTP_STRONG_RE.test(haystack)) {
      return blocked('numeric-field', evidence);
    }
  }

  // ── 2. Score ──────────────────────────────────────────────
  const reasons: string[] = [];
  let score = 0;
  let mode: FabMode = 'magic';

  const add = (points: number, reason: string): void => {
    if (points === 0) {
      return;
    }
    score += points;
    reasons.push(`${points > 0 ? '+' : ''}${points} ${reason}`);
  };

  for (const token of evidence.autocompleteTokens) {
    const weight = CREDENTIAL_AUTOCOMPLETE.get(token);
    if (weight) {
      add(weight, `autocomplete:${token}`);
      if (token === 'one-time-code' || token === 'one-time-password') {
        mode = 'otp';
      } else if (token === 'email') {
        mode = 'email';
      } else if (token === 'current-password' || token === 'new-password') {
        mode = 'password';
      } else if (mode === 'magic') {
        mode = 'user';
      }
    }
  }

  if (isPasswordType) {
    add(60, 'type:password');
    mode = 'password';
  } else if (evidence.type === 'email') {
    add(52, 'type:email');
    mode = mode === 'otp' ? mode : 'email';
  }

  const codeGroup = input && input.maxLength === 1 ? findCodeGroup(input) : null;
  if (codeGroup) {
    add(45, 'split-code-group');
    if (evidence.inputMode === 'numeric' || evidence.type === 'tel') {
      add(16, 'split-code-numeric');
    }
    mode = 'otp';
  }

  if (OTP_STRONG_RE.test(haystack)) {
    add(42, 'descriptor:otp');
    mode = 'otp';
  } else if (
    OTP_WEAK_RE.test(haystack) &&
    (evidence.inputMode === 'numeric' ||
      (evidence.maxLength >= 4 && evidence.maxLength <= 8) ||
      page?.pageType === 'verification' ||
      page?.pageType === '2fa')
  ) {
    add(30, 'descriptor:code+numeric-shape');
    mode = 'otp';
  }

  if (EMAIL_RE.test(haystack)) {
    add(34, 'descriptor:email');
    if (mode === 'magic' || mode === 'user') {
      mode = 'email';
    }
  }
  if (PASSWORD_RE.test(haystack)) {
    add(36, 'descriptor:password');
    if (mode === 'magic' || mode === 'user') {
      mode = 'password';
    }
  }
  if (USERNAME_RE.test(haystack)) {
    add(28, 'descriptor:username');
    if (mode === 'magic') {
      mode = 'user';
    }
  }
  if (PERSON_NAME_RE.test(haystack)) {
    add(16, 'descriptor:person-name');
    if (mode === 'magic') {
      mode = 'user';
    }
  }

  // Form context: a password sibling is the single best "this is auth" signal.
  if (evidence.formHasPassword) {
    add(22, 'form:has-password');
  }
  if (evidence.inForm && evidence.formInputCount > 0 && evidence.formInputCount <= 6) {
    add(6, 'form:compact');
  }
  if (evidence.formInputCount > 14) {
    add(-10, 'form:large-data-entry');
  }

  // Page-level analysis (from PageAnalyzer) — supporting evidence only.
  const pageType = page?.pageType ?? null;
  if (
    pageType === 'login' ||
    pageType === 'signup' ||
    pageType === 'verification' ||
    pageType === '2fa' ||
    pageType === 'password-reset'
  ) {
    add(24, `page:${pageType}`);
  } else if (pageType === 'non-auth') {
    add(-16, 'page:non-auth');
  }
  if (page?.hasPasswordField) {
    add(12, 'page:has-password-field');
  }
  if (page?.hasOTPField) {
    add(10, 'page:has-otp-field');
  }
  if (page?.isAuthRelated) {
    add(10, 'page:auth-related');
  }
  if (authUrl) {
    add(18, 'url:auth-path');
  }
  if (page?.provider) {
    add(6, `provider:${page.provider}`);
  }

  // Per-host learning.
  if (policy) {
    if (policy.accepts > 0) {
      add(15, 'policy:previously-accepted');
    }
    if (policy.dismissals > 0) {
      add(-12 * Math.min(policy.dismissals, 3), 'policy:dismissed-before');
    }
  }

  // Optional bridge to the existing IntelligenceCore classifier.
  if (options.classify) {
    try {
      const classified = options.classify(target);
      if (classified !== 'generic') {
        add(20, `classifier:${classified}`);
        if (mode === 'magic') {
          mode = classified;
        }
      } else {
        add(-8, 'classifier:generic');
      }
    } catch {
      /* classifier must never break the gate */
    }
  }

  // ── 3. Presence ────────────────────────────────────────────
  const confidence = Math.max(0, Math.min(1, score / 100));
  const anchorElement = codeGroup ?? target;

  if (score >= thresholds.active) {
    return {
      presence: 'active',
      mode,
      score,
      confidence,
      reasons,
      anchorElement,
      evidence,
    };
  }
  if (score >= thresholds.quiet) {
    return {
      presence: 'quiet',
      mode,
      score,
      confidence,
      reasons,
      anchorElement,
      evidence,
    };
  }

  return {
    presence: 'hidden',
    mode,
    score,
    confidence,
    reasons,
    blockedBy: 'low-score',
    evidence,
  };
}
