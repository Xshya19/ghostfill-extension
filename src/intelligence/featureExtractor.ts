// Browser-only. Extracts a privacy-safe RawFieldRecord + canonical 64-dim
// structural vector from a DOM element. Shadow-DOM-aware label resolution and
// multi-id aria support (fixes audit P1-3 / P1-4). Never reads .value.

import { NUM_STRUCTURAL_FEATURES, STRUCT, emptyStructural } from './contract';
import { KW, matchesAny, normalizeText } from './keywords';
import type { RawFieldRecord } from './types';

type Fillable = HTMLInputElement | HTMLTextAreaElement;

function rootOf(el: Element): Document | ShadowRoot {
  const r = el.getRootNode();
  return r instanceof ShadowRoot ? r : document;
}

function textById(root: Document | ShadowRoot, id: string): string {
  const byId = (root as Document).getElementById
    ? (root as Document).getElementById(id)
    : root.querySelector('#' + (window.CSS ? CSS.escape(id) : id));
  return byId?.textContent?.trim() || '';
}

// Shadow-aware, multi-id aria-aware label resolution.
export function resolveLabelText(el: Fillable): string {
  const root = rootOf(el);

  // 1) explicit <label for=id>
  if (el.id) {
    const sel = 'label[for="' + (window.CSS ? CSS.escape(el.id) : el.id) + '"]';
    const label = root.querySelector(sel);
    if (label?.textContent) {
      return label.textContent.trim();
    }
  }
  // 2) wrapping <label>
  const wrapping = el.closest ? el.closest('label') : null;
  if (wrapping?.textContent) {
    return wrapping.textContent.trim();
  }

  // 3) aria-labelledby (space-separated id LIST)
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy
      .split(/[ \t\r\n]+/)
      .map((id) => textById(root, id))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(' ');
    }
  }
  // 4) aria-describedby (also a LIST)
  const describedBy = el.getAttribute('aria-describedby');
  if (describedBy) {
    const parts = describedBy
      .split(/[ \t\r\n]+/)
      .map((id) => textById(root, id))
      .filter(Boolean);
    if (parts.length) {
      return parts.join(' ');
    }
  }

  // 5) Check preceding element siblings (for custom/div label designs)
  if (el.previousElementSibling) {
    let prev: Element | null = el.previousElementSibling;
    while (prev) {
      const tag = prev.tagName.toLowerCase();
      if (
        tag === 'label' ||
        prev.classList.contains('label') ||
        prev.classList.contains('title') ||
        prev.classList.contains('placeholder') ||
        prev.classList.contains('caption') ||
        prev.classList.contains('text') ||
        prev.classList.contains('input-label')
      ) {
        const text = prev.textContent?.trim();
        if (text && text.length < 100) {
          return text;
        }
      }
      prev = prev.previousElementSibling;
    }
  }

  // 6) Check parent's previous sibling (common grid/layout wrapper labels)
  const parent = el.parentElement;
  if (parent) {
    const prevSibling = parent.previousElementSibling;
    if (prevSibling) {
      const text = prevSibling.textContent?.trim();
      if (text && text.length < 100) {
        return text;
      }
    }
  }

  return '';
}

function surroundingText(el: Fillable): string {
  const container =
    (el.closest && (el.closest('label,div,fieldset,section,form') as HTMLElement)) ||
    el.parentElement;
  if (!container) {
    return '';
  }
  const raw = (container.textContent || '').replace(/[ \t\r\n]+/g, ' ').trim();
  return raw.slice(0, 160);
}

function isVisible(el: Fillable): {
  visible: boolean;
  opacityZero: boolean;
  offscreen: boolean;
  tiny: boolean;
  width: number;
} {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const opacityZero = parseFloat(style.opacity || '1') === 0;
  const hiddenByCss = style.display === 'none' || style.visibility === 'hidden';
  const offscreen =
    rect.bottom < 0 ||
    rect.right < 0 ||
    rect.left > window.innerWidth + 2000 ||
    rect.top > window.innerHeight + 5000;
  const tiny = rect.width <= 2 || rect.height <= 2;
  const visible =
    !hiddenByCss && !opacityZero && !tiny && (el as HTMLInputElement).type !== 'hidden';
  return { visible, opacityZero, offscreen, tiny, width: rect.width };
}

function countSameShapeSiblings(el: Fillable): number {
  const form = (el.closest && el.closest('form,div,fieldset')) as HTMLElement | null;
  if (!form) {
    return 0;
  }
  const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
  const ml = (el as HTMLInputElement).maxLength;
  let n = 0;
  for (const i of inputs) {
    if (i.maxLength === ml && (ml === 1 || (ml > 0 && ml <= 2))) {
      n++;
    }
  }
  return n;
}

export function extractFieldRecord(el: Fillable): RawFieldRecord {
  const tag = el.tagName.toLowerCase();
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const name = el.getAttribute('name') || '';
  const id = el.id || '';
  const placeholder = (el as HTMLInputElement).placeholder || '';
  const ariaLabel = el.getAttribute('aria-label') || '';
  const labelText = resolveLabelText(el);
  const surrounding = surroundingText(el);
  const maxLength = (el as HTMLInputElement).maxLength ?? -1;
  const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
  const pattern = el.getAttribute('pattern') || '';
  const required = (el as HTMLInputElement).required === true;
  const vis = isVisible(el);

  // DETECT duplicate password context: check if this is a password field following another password field.
  let isSecondPasswordField = false;
  if (type === 'password') {
    try {
      const form = el.closest('form, div.form, fieldset') || document;
      const pwdFields = Array.from(form.querySelectorAll('input[type="password"]'));
      const idx = pwdFields.indexOf(el);
      if (idx > 0) {
        isSecondPasswordField = true;
      }
    } catch {
      // safe fallback
    }
  }

  const rec: RawFieldRecord = {
    url: location.href,
    selector: id ? '#' + id : name ? tag + '[name="' + name + '"]' : tag,
    tag,
    type,
    autocomplete,
    name,
    id,
    placeholder,
    ariaLabel,
    labelText,
    surroundingText: surrounding,
    maxLength: typeof maxLength === 'number' ? maxLength : -1,
    inputMode,
    pattern,
    required,
    visible: vis.visible,
    widthPx: Math.round(vis.width),
    focused: document.activeElement === el,
    opacityZero: vis.opacityZero,
    offscreen: vis.offscreen,
    tiny: vis.tiny,
    className: el.className || '',
    isSecondPasswordField,
  };
  rec.structural = buildStructural(rec, {
    ...vis,
    sameShape: countSameShapeSiblings(el),
    inForm: !!el.closest?.('form'),
  });
  return rec;
}

type VisInfo = {
  opacityZero: boolean;
  offscreen: boolean;
  tiny: boolean;
  sameShape: number;
  inForm: boolean;
};

export function buildStructural(rec: RawFieldRecord, vis: VisInfo): number[] {
  const v = emptyStructural();
  const set = (i: number, val = 1) => {
    if (i >= 0 && i < NUM_STRUCTURAL_FEATURES) {
      v[i] = val;
    }
  };
  const combined = [
    rec.labelText,
    rec.placeholder,
    rec.ariaLabel,
    rec.name,
    rec.id,
    rec.surroundingText,
    rec.autocomplete,
    rec.className || '',
  ].join(' ');

  // type one-hots
  const t = rec.type;
  if (t === 'text') {
    set(STRUCT.TYPE_TEXT);
  } else if (t === 'email') {
    set(STRUCT.TYPE_EMAIL);
  } else if (t === 'password') {
    set(STRUCT.TYPE_PASSWORD);
  } else if (t === 'tel') {
    set(STRUCT.TYPE_TEL);
  } else if (t === 'number') {
    set(STRUCT.TYPE_NUMBER);
  } else if (t === 'search') {
    set(STRUCT.TYPE_SEARCH);
  } else if (t === 'hidden') {
    set(STRUCT.TYPE_HIDDEN);
  } else {
    set(STRUCT.TYPE_OTHER);
  }

  // autocomplete buckets
  const ac = rec.autocomplete;
  if (ac.includes('email')) {
    set(STRUCT.AC_EMAIL);
  }
  if (ac.includes('username')) {
    set(STRUCT.AC_USERNAME);
  }
  if (ac.includes('current-password')) {
    set(STRUCT.AC_CURRENT_PASSWORD);
  }
  if (ac.includes('new-password')) {
    set(STRUCT.AC_NEW_PASSWORD);
  }
  if (ac.includes('one-time-code')) {
    set(STRUCT.AC_ONE_TIME_CODE);
  }
  if (ac.includes('tel')) {
    set(STRUCT.AC_TEL);
  }
  if (ac.includes('name') || ac.includes('given') || ac.includes('family')) {
    set(STRUCT.AC_NAME);
  }
  if (ac === '' || ac === 'off' || ac === 'nope') {
    set(STRUCT.AC_OFF_OR_NONE);
  }

  // structural
  if (rec.maxLength === 1) {
    set(STRUCT.MAXLEN_IS_1);
  }
  if (rec.maxLength > 0 && rec.maxLength <= 8) {
    set(STRUCT.MAXLEN_LE_8);
  }
  if (rec.widthPx > 0 && rec.widthPx <= 90) {
    set(STRUCT.WIDTH_LE_90);
  }
  if (rec.inputMode === 'numeric' || rec.inputMode === 'tel') {
    set(STRUCT.INPUTMODE_NUMERIC);
  }
  if (rec.pattern.includes('0-9') || rec.pattern.includes('d{') || rec.pattern.includes('[0-9]')) {
    set(STRUCT.PATTERN_DIGITS);
  }
  if (rec.required) {
    set(STRUCT.REQUIRED);
  }
  if (rec.visible) {
    set(STRUCT.VISIBLE);
  }
  if (rec.labelText) {
    set(STRUCT.HAS_LABEL);
  }
  if (rec.placeholder) {
    set(STRUCT.HAS_PLACEHOLDER);
  }
  if (rec.ariaLabel) {
    set(STRUCT.HAS_ARIA);
  }
  if (vis.inForm) {
    set(STRUCT.IN_FORM);
  }
  if (vis.sameShape >= 4 && vis.sameShape <= 8) {
    set(STRUCT.SIBLING_SAME_SHAPE_COUNT_4_8);
  }
  if (vis.offscreen) {
    set(STRUCT.OFFSCREEN);
  }
  if (vis.opacityZero) {
    set(STRUCT.ZERO_OPACITY);
  }
  if (vis.tiny) {
    set(STRUCT.TINY_SIZE);
  }
  if (rec.tag === 'textarea') {
    set(STRUCT.IS_TEXTAREA);
  }

  // keyword presence
  const kwHit = (group: keyof typeof KW, idx: number) => {
    if (matchesAny(combined, group)) {
      set(idx);
    }
  };
  kwHit('email', STRUCT.KW_EMAIL);
  kwHit('user', STRUCT.KW_USER);
  kwHit('password', STRUCT.KW_PASS);
  kwHit('confirm', STRUCT.KW_CONFIRM);
  kwHit('newpw', STRUCT.KW_NEW);
  kwHit('currentpw', STRUCT.KW_CURRENT);
  kwHit('otp', STRUCT.KW_OTP);
  kwHit('code', STRUCT.KW_CODE);
  kwHit('verify', STRUCT.KW_VERIFY);
  kwHit('phone', STRUCT.KW_PHONE);
  kwHit('first', STRUCT.KW_FIRST);
  kwHit('last', STRUCT.KW_LAST);
  kwHit('fullname', STRUCT.KW_FULLNAME);
  kwHit('cvv', STRUCT.KW_CVV);
  kwHit('card', STRUCT.KW_CARD);
  kwHit('expiry', STRUCT.KW_EXPIRY);
  kwHit('zip', STRUCT.KW_ZIP);
  kwHit('search', STRUCT.KW_SEARCH);
  kwHit('coupon', STRUCT.KW_COUPON);
  kwHit('captcha', STRUCT.KW_CAPTCHA);
  kwHit('amount', STRUCT.KW_AMOUNT);
  kwHit('dob', STRUCT.KW_DOB);
  if (/[0-9]/.test(normalizeText(rec.name + ' ' + rec.id))) {
    set(STRUCT.KW_DIGITS_IN_NAME);
  }
  const otpLenHint = normalizeText(combined).match(/([0-9])\s*(digit|digits|caracteres|stellig)/);
  if (otpLenHint) {
    set(STRUCT.KW_OTP_LENGTH_HINT);
  }

  return v;
}
