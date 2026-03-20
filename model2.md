# GhostFill: Production-Grade Local ML Auto-Fill Engine

## Complete Architecture & Implementation

---

## File 1: `src/content/extractor.ts` — DOM Feature Extractor

```typescript
/**
 * GhostFill DOM Feature Extractor
 * Extracts a 64-dimensional feature vector from any <input> or <textarea> element.
 * Handles: Shadow DOM, obfuscated classes, floating labels, honeypots, split OTPs,
 * decoupled context, and modern SPA frameworks.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

const FIELD_CLASSES = [
  'Email', 'Username', 'Password', 'Target_Password_Confirm',
  'First_Name', 'Last_Name', 'Full_Name', 'Phone', 'OTP', 'Unknown'
] as const;

type FieldClass = typeof FIELD_CLASSES[number];

// Keyword dictionaries for textual signal extraction
const KEYWORD_BANKS: Record<string, RegExp> = {
  email: /\b(e[\-_]?mail|correo|courriel|email[\-_]?addr(?:ess)?)\b/i,
  username: /\b(user[\-_]?name|login[\-_]?id|screen[\-_]?name|handle|acct[\-_]?name|identifiant|usuario)\b/i,
  password: /\b(pass[\-_]?word|pwd|contraseña|mot[\-_]?de[\-_]?passe|passwort|senha)\b/i,
  password_confirm: /\b(confirm[\-_]?pass|re[\-_]?(?:enter|type)[\-_]?pass|verify[\-_]?pass|repeat[\-_]?pass|pass[\-_]?confirm|password[\-_]?again)\b/i,
  first_name: /\b(first[\-_]?name|given[\-_]?name|f[\-_]?name|prénom|nombre|vorname)\b/i,
  last_name: /\b(last[\-_]?name|sur[\-_]?name|family[\-_]?name|l[\-_]?name|nom[\-_]?(?:de[\-_]?)?famille|apellido|nachname)\b/i,
  full_name: /\b(full[\-_]?name|your[\-_]?name|name|display[\-_]?name|nom[\-_]?complet|nombre[\-_]?completo)\b/i,
  phone: /\b(phone|tel(?:ephone)?|mobile|cell|número|numéro|telefon|sms[\-_]?number)\b/i,
  otp: /\b(otp|verif(?:y|ication)[\-_]?code|security[\-_]?code|one[\-_]?time|auth(?:entication)?[\-_]?code|pin[\-_]?code|mfa[\-_]?code|2fa[\-_]?code|token|passcode|code[\-_]?sent)\b/i,
  login_action: /\b(log[\-_]?in|sign[\-_]?in|authenticate|connexion|iniciar[\-_]?sesión)\b/i,
  signup_action: /\b(sign[\-_]?up|register|create[\-_]?account|join|inscription|registrarse)\b/i,
  submit_action: /\b(submit|continue|next|verify|confirm|send|go|enter|proceed)\b/i,
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface RawFieldFeatures {
  // Textual signals (will be encoded into embedding vectors)
  textualContext: string;          // Concatenated label/aria/placeholder text
  nearbyText: string;              // Nearby paragraph/span/div text
  attributeSignals: string;        // Concatenated name, id, autocomplete, data-* attrs

  // Numeric features
  numericVector: Float32Array;     // 64-dimensional numeric feature vector
}

export interface ExtractedField {
  element: HTMLInputElement | HTMLTextAreaElement;
  features: RawFieldFeatures;
  boundingRect: DOMRect;
  isVisible: boolean;
}

// ─── Visibility Detection ────────────────────────────────────────────────────

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;

  const style = getComputedStyle(el);

  // Honeypot detection: multiple concealment techniques
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  if (parseFloat(style.opacity) < 0.05) return false;

  // Off-screen positioning
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (rect.right < 0 || rect.bottom < 0) return false;
  if (rect.left > window.innerWidth + 10) return false;
  if (rect.top > window.innerHeight * 3) return false; // Allow for scrolling

  // Clip-path / clip concealment
  if (style.clipPath === 'inset(100%)' || style.clipPath === 'circle(0)') return false;
  const clip = style.getPropertyValue('clip');
  if (clip === 'rect(0px, 0px, 0px, 0px)' || clip === 'rect(0, 0, 0, 0)') return false;

  // Negative absolute positioning
  if (style.position === 'absolute' || style.position === 'fixed') {
    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    if (left < -500 || top < -500) return false;
  }

  // Overflow hidden on parent with zero dimensions
  let parent = el.parentElement;
  let depth = 0;
  while (parent && depth < 5) {
    const ps = getComputedStyle(parent);
    if (ps.overflow === 'hidden') {
      const pr = parent.getBoundingClientRect();
      if (pr.width < 2 || pr.height < 2) return false;
    }
    parent = parent.parentElement;
    depth++;
  }

  // aria-hidden check
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.hasAttribute('hidden')) return false;

  // tabindex = -1 combined with zero size is suspicious
  if (el.tabIndex === -1 && (rect.width < 10 || rect.height < 10)) return false;

  return true;
}

function computeHoneypotScore(el: HTMLElement): number {
  let score = 0;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  if (parseFloat(style.opacity) < 0.1 && parseFloat(style.opacity) >= 0) score += 0.3;
  if (rect.width < 5 && rect.height < 5) score += 0.25;
  if (rect.width === 0 || rect.height === 0) score += 0.4;
  if (style.position === 'absolute' && (parseFloat(style.left) < -100 || parseFloat(style.top) < -100)) score += 0.35;
  if (el.tabIndex === -1) score += 0.15;

  // Common honeypot naming
  const nameOrId = ((el as HTMLInputElement).name || '') + (el.id || '');
  if (/honey|pot|trap|gotcha|catch|bot/i.test(nameOrId)) score += 0.5;

  // Autocomplete="off" with suspicious name
  if ((el as HTMLInputElement).autocomplete === 'off' && /address2?|comment|website|url|homepage/i.test(nameOrId)) score += 0.1;

  return Math.min(score, 1.0);
}

// ─── Label & Text Discovery ─────────────────────────────────────────────────

function getExplicitLabelText(el: HTMLInputElement | HTMLTextAreaElement): string {
  const parts: string[] = [];

  // 1. Explicit <label for="id">
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const labels = root.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`);
    labels.forEach(lbl => {
      const text = (lbl.textContent || '').trim();
      if (text) parts.push(text);
    });
  }

  // 2. Wrapping <label>
  const closestLabel = el.closest('label');
  if (closestLabel) {
    const text = (closestLabel.textContent || '').replace((el as HTMLInputElement).value || '', '').trim();
    if (text && !parts.includes(text)) parts.push(text);
  }

  // 3. labels property (handles both explicit and implicit)
  if ('labels' in el && el.labels) {
    for (const lbl of Array.from(el.labels)) {
      const text = (lbl.textContent || '').trim();
      if (text && !parts.includes(text)) parts.push(text);
    }
  }

  return parts.join(' ').substring(0, 200);
}

function getAriaText(el: HTMLElement): string {
  const parts: string[] = [];

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) parts.push(ariaLabel.trim());

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    ariaLabelledBy.split(/\s+/).forEach(id => {
      const ref = root.getElementById(id);
      if (ref) parts.push((ref.textContent || '').trim());
    });
  }

  const ariaDescribedBy = el.getAttribute('aria-describedby');
  if (ariaDescribedBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    ariaDescribedBy.split(/\s+/).forEach(id => {
      const ref = root.getElementById(id);
      if (ref) parts.push((ref.textContent || '').trim());
    });
  }

  const ariaPlaceholder = el.getAttribute('aria-placeholder');
  if (ariaPlaceholder) parts.push(ariaPlaceholder.trim());

  return parts.join(' ').substring(0, 200);
}

/**
 * Floating label detection: finds <div>/<span>/<p> elements that physically
 * overlap the input's bounding box (material design pattern).
 */
function getFloatingLabelText(el: HTMLElement): string {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return '';

  // Expand search area slightly above and overlapping the input
  const searchBox = {
    top: rect.top - 30,
    bottom: rect.bottom + 5,
    left: rect.left - 10,
    right: rect.right + 10,
  };

  const candidates: { text: string; distance: number }[] = [];

  // Search siblings and nearby elements
  const parent = el.parentElement;
  if (!parent) return '';

  // Check up to 3 levels of ancestors for floating labels
  let searchRoot: HTMLElement = parent;
  for (let i = 0; i < 3; i++) {
    if (searchRoot.parentElement) searchRoot = searchRoot.parentElement;
  }

  const potentialLabels = searchRoot.querySelectorAll(
    'label, span, div, p, legend, dt, th, strong, em, b'
  );

  for (const candidate of Array.from(potentialLabels)) {
    if (candidate === el) continue;
    if (candidate.contains(el)) continue; // Skip ancestors
    if (candidate.querySelector('input, textarea, select, button')) continue; // Skip containers with inputs

    const cRect = candidate.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) continue;

    // Check spatial overlap with expanded search box
    const overlapsHorizontally = cRect.left < searchBox.right && cRect.right > searchBox.left;
    const overlapsVertically = cRect.top < searchBox.bottom && cRect.bottom > searchBox.top;

    if (overlapsHorizontally && overlapsVertically) {
      const text = (candidate.textContent || '').trim();
      if (text && text.length > 0 && text.length < 100) {
        // Compute center-to-center distance
        const dx = (cRect.left + cRect.width / 2) - (rect.left + rect.width / 2);
        const dy = (cRect.top + cRect.height / 2) - (rect.top + rect.height / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        candidates.push({ text, distance: dist });
      }
    }
  }

  // Sort by distance, take closest
  candidates.sort((a, b) => a.distance - b.distance);
  return (candidates[0]?.text || '').substring(0, 150);
}

/**
 * Grabs nearby preceding text nodes: looks at preceding siblings,
 * parent's preceding siblings, and text content above the input.
 */
function getNearbyPrecedingText(el: HTMLElement): string {
  const parts: string[] = [];
  const rect = el.getBoundingClientRect();

  // Walk backwards through preceding siblings
  let sibling = el.previousElementSibling;
  let sibCount = 0;
  while (sibling && sibCount < 5) {
    if (!sibling.querySelector('input, textarea, select')) {
      const text = (sibling.textContent || '').trim();
      if (text && text.length < 200) {
        parts.push(text);
      }
    }
    sibling = sibling.previousElementSibling;
    sibCount++;
  }

  // Check parent's preceding siblings
  const parent = el.parentElement;
  if (parent) {
    let pSibling = parent.previousElementSibling;
    let pCount = 0;
    while (pSibling && pCount < 3) {
      if (!pSibling.querySelector('input, textarea, select')) {
        const text = (pSibling.textContent || '').trim();
        if (text && text.length < 200) {
          parts.push(text);
        }
      }
      pSibling = pSibling.previousElementSibling;
      pCount++;
    }
  }

  // Also look for text nodes physically above the input (within 80px)
  const searchY = rect.top - 80;
  if (searchY > 0) {
    const above = document.elementsFromPoint(rect.left + rect.width / 2, searchY);
    for (const aboveEl of above.slice(0, 3)) {
      if (aboveEl === el || aboveEl.contains(el)) continue;
      const text = (aboveEl.textContent || '').trim();
      if (text && text.length > 2 && text.length < 200) {
        if (!parts.includes(text)) parts.push(text);
        break;
      }
    }
  }

  return parts.join(' ').substring(0, 300);
}

/**
 * Finds the nearest submit/action button and returns distance + text.
 */
function findNearestSubmitButton(el: HTMLElement): { distance: number; text: string; formAction: string } {
  const rect = el.getBoundingClientRect();
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  // Collect candidate buttons
  const root = el.getRootNode() as Document | ShadowRoot;
  const buttons: HTMLElement[] = [];

  // <button> elements
  root.querySelectorAll('button').forEach(b => buttons.push(b));
  // <input type="submit">
  root.querySelectorAll('input[type="submit"], input[type="button"]').forEach(b => buttons.push(b as HTMLElement));
  // Elements with role="button"
  root.querySelectorAll('[role="button"]').forEach(b => buttons.push(b as HTMLElement));
  // Anchor tags styled as buttons (common pattern)
  root.querySelectorAll('a[class*="btn"], a[class*="button"]').forEach(b => buttons.push(b as HTMLElement));

  let closestDist = Infinity;
  let closestText = '';
  let closestAction = '';

  for (const btn of buttons) {
    const bRect = btn.getBoundingClientRect();
    if (bRect.width === 0 || bRect.height === 0) continue;

    const bCenter = { x: bRect.left + bRect.width / 2, y: bRect.top + bRect.height / 2 };
    const dist = Math.sqrt((center.x - bCenter.x) ** 2 + (center.y - bCenter.y) ** 2);

    if (dist < closestDist) {
      closestDist = dist;
      closestText = (btn.textContent || btn.getAttribute('value') || '').trim().substring(0, 50);

      // Check for form action
      const form = btn.closest('form');
      closestAction = form?.action || '';
    }
  }

  return {
    distance: closestDist === Infinity ? -1 : closestDist,
    text: closestText,
    formAction: closestAction,
  };
}

// ─── Form & Sibling Context ─────────────────────────────────────────────────

interface FormContext {
  formFieldCount: number;
  passwordFieldCount: number;
  thisFieldIndex: number;
  hasEmailField: boolean;
  hasUsernameField: boolean;
  distanceToPrevPassword: number;  // -1 if none
  isInForm: boolean;
  formAction: string;
  formMethod: string;
}

function getFormContext(el: HTMLInputElement | HTMLTextAreaElement): FormContext {
  const form = el.closest('form');
  const ctx: FormContext = {
    formFieldCount: 0,
    passwordFieldCount: 0,
    thisFieldIndex: -1,
    hasEmailField: false,
    hasUsernameField: false,
    distanceToPrevPassword: -1,
    isInForm: !!form,
    formAction: form?.action || '',
    formMethod: (form?.method || '').toUpperCase(),
  };

  // Get all inputs in the same form, or nearby inputs if no form
  let inputs: (HTMLInputElement | HTMLTextAreaElement)[];
  if (form) {
    inputs = Array.from(form.querySelectorAll('input, textarea'));
  } else {
    // No form: look at inputs in the same parent container
    let container = el.parentElement;
    for (let i = 0; i < 5; i++) {
      if (container?.parentElement) container = container.parentElement;
    }
    inputs = container ? Array.from(container.querySelectorAll('input, textarea')) : [el];
  }

  // Filter to visible, non-hidden inputs
  const visibleInputs = inputs.filter(inp => {
    const t = (inp as HTMLInputElement).type?.toLowerCase();
    return t !== 'hidden' && t !== 'submit' && t !== 'button' && t !== 'reset' && t !== 'image';
  });

  ctx.formFieldCount = visibleInputs.length;

  let lastPasswordIdx = -1;
  visibleInputs.forEach((inp, idx) => {
    if (inp === el) ctx.thisFieldIndex = idx;

    const t = (inp as HTMLInputElement).type?.toLowerCase();
    const nameId = ((inp as HTMLInputElement).name || '') + (inp.id || '') + ((inp as HTMLInputElement).autocomplete || '');

    if (t === 'password') {
      ctx.passwordFieldCount++;
      if (inp !== el) lastPasswordIdx = idx;
    }
    if (t === 'email' || /email/i.test(nameId)) ctx.hasEmailField = true;
    if (/user/i.test(nameId)) ctx.hasUsernameField = true;
  });

  if (lastPasswordIdx >= 0 && ctx.thisFieldIndex >= 0) {
    ctx.distanceToPrevPassword = ctx.thisFieldIndex - lastPasswordIdx;
  }

  return ctx;
}

// ─── Split OTP Detection ─────────────────────────────────────────────────────

interface OTPGroupInfo {
  isSplitOTP: boolean;
  groupSize: number;
  positionInGroup: number;
}

function detectSplitOTP(el: HTMLInputElement): OTPGroupInfo {
  const result: OTPGroupInfo = { isSplitOTP: false, groupSize: 0, positionInGroup: 0 };

  const maxLen = el.maxLength;
  if (maxLen !== 1 && maxLen !== 2) return result;

  // Find sibling inputs with same maxlength in same container
  const parent = el.parentElement;
  if (!parent) return result;

  // Walk up to 2 levels to find the OTP container
  let container = parent;
  let containerInputs = Array.from(container.querySelectorAll('input'));
  if (containerInputs.length < 3 && container.parentElement) {
    container = container.parentElement;
    containerInputs = Array.from(container.querySelectorAll('input'));
  }

  const sameMaxLen = containerInputs.filter(inp => {
    const ml = inp.maxLength;
    return (ml === 1 || ml === 2) && isElementVisible(inp);
  });

  if (sameMaxLen.length >= 4 && sameMaxLen.length <= 8) {
    // Check they're roughly the same size and aligned
    const rects = sameMaxLen.map(inp => inp.getBoundingClientRect());
    const heights = rects.map(r => r.height);
    const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
    const heightConsistent = heights.every(h => Math.abs(h - avgHeight) < avgHeight * 0.3);

    // Check horizontal alignment (roughly same Y)
    const tops = rects.map(r => r.top);
    const avgTop = tops.reduce((a, b) => a + b, 0) / tops.length;
    const topConsistent = tops.every(t => Math.abs(t - avgTop) < 20);

    if (heightConsistent && topConsistent) {
      result.isSplitOTP = true;
      result.groupSize = sameMaxLen.length;
      result.positionInGroup = sameMaxLen.indexOf(el);
    }
  }

  return result;
}

// ─── Keyword Matching Scores ─────────────────────────────────────────────────

function computeKeywordScores(text: string): Float32Array {
  const scores = new Float32Array(Object.keys(KEYWORD_BANKS).length);
  const lowerText = text.toLowerCase();

  Object.values(KEYWORD_BANKS).forEach((regex, idx) => {
    const match = regex.exec(lowerText);
    scores[idx] = match ? 1.0 : 0.0;
  });

  return scores;
}

// ─── Autocomplete Attribute Mapping ──────────────────────────────────────────

const AUTOCOMPLETE_MAP: Record<string, number> = {
  'email': 1, 'username': 2, 'current-password': 3, 'new-password': 4,
  'given-name': 5, 'family-name': 6, 'name': 7, 'tel': 8, 'tel-national': 8,
  'tel-local': 8, 'one-time-code': 9, 'cc-number': 10, 'cc-name': 11,
  'cc-exp': 12, 'address-line1': 13, 'address-line2': 14, 'postal-code': 15,
  'country': 16, 'organization': 17, 'off': 18, 'on': 19,
};

function encodeAutocomplete(value: string): number {
  return AUTOCOMPLETE_MAP[value.toLowerCase().trim()] || 0;
}

// ─── Input Type Encoding ─────────────────────────────────────────────────────

const INPUT_TYPE_MAP: Record<string, number> = {
  'text': 1, 'email': 2, 'password': 3, 'tel': 4, 'number': 5,
  'url': 6, 'search': 7, 'hidden': 8, 'submit': 9, 'button': 10,
  'textarea': 11, 'date': 12, 'datetime-local': 13, 'month': 14,
  'week': 15, 'time': 16, 'color': 17, 'file': 18, 'range': 19,
  'checkbox': 20, 'radio': 21,
};

function encodeInputType(el: HTMLInputElement | HTMLTextAreaElement): number {
  if (el.tagName.toLowerCase() === 'textarea') return INPUT_TYPE_MAP['textarea'];
  return INPUT_TYPE_MAP[(el as HTMLInputElement).type?.toLowerCase()] || 0;
}

// ─── MAIN FEATURE EXTRACTION ─────────────────────────────────────────────────

/**
 * Feature vector layout (64 dimensions):
 *
 * [0]       inputTypeEncoded          (normalized 0-1)
 * [1]       autocompleteEncoded       (normalized 0-1)
 * [2]       maxLength                 (normalized 0-1, clamp 0-100)
 * [3]       minLength                 (normalized)
 * [4]       isRequired                (0/1)
 * [5]       isReadOnly                (0/1)
 * [6]       isDisabled                (0/1)
 * [7]       hasPattern                (0/1)
 * [8]       patternIsNumeric          (0/1 if pattern restricts to digits)
 * [9]       inputModeIsNumeric        (0/1)
 * [10]      inputModeIsTel            (0/1)
 * [11]      inputModeIsEmail          (0/1)
 * [12]      isVisible                 (0/1)
 * [13]      honeypotScore             (0-1)
 * [14]      isSplitOTP               (0/1)
 * [15]      splitOTPGroupSize         (normalized)
 * [16]      splitOTPPosition          (normalized)
 * [17]      formFieldCount            (normalized)
 * [18]      passwordFieldCount        (normalized)
 * [19]      thisFieldIndex            (normalized)
 * [20]      hasEmailSibling           (0/1)
 * [21]      hasUsernameSibling        (0/1)
 * [22]      distToPrevPassword        (normalized, -1 -> 0)
 * [23]      isInForm                  (0/1)
 * [24]      distToSubmitButton        (normalized px)
 * [25]      submitTextMatchesLogin    (0/1)
 * [26]      submitTextMatchesSignup   (0/1)
 * [27]      submitTextMatchesVerify   (0/1)
 * [28]      formMethodIsPost          (0/1)
 * [29]      elementWidth              (normalized)
 * [30]      elementHeight             (normalized)
 * [31]      aspectRatio               (normalized)
 * [32-42]   keywordScores             (11 keyword banks)
 * [43-53]   nearbyTextKeywordScores   (11 keyword banks on nearby text)
 * [54]      hasPlaceholder            (0/1)
 * [55]      placeholderLength         (normalized)
 * [56]      hasAriaLabel              (0/1)
 * [57]      hasExplicitLabel          (0/1)
 * [58]      hasFloatingLabel          (0/1)
 * [59]      nameContainsPass          (0/1)
 * [60]      nameContainsEmail         (0/1)
 * [61]      nameContainsUser          (0/1)
 * [62]      nameContainsPhone         (0/1)
 * [63]      nameContainsOTP           (0/1)
 */
export function extractFeatures(el: HTMLInputElement | HTMLTextAreaElement): RawFieldFeatures {
  const vec = new Float32Array(64);

  // ─ Basic attributes ─
  vec[0] = encodeInputType(el) / 21.0;
  vec[1] = encodeAutocomplete(el.autocomplete || '') / 19.0;

  const maxLen = el.maxLength > 0 ? el.maxLength : -1;
  vec[2] = maxLen > 0 ? Math.min(maxLen, 100) / 100.0 : 0;
  vec[3] = el.minLength > 0 ? Math.min(el.minLength, 50) / 50.0 : 0;

  vec[4] = el.required ? 1 : 0;
  vec[5] = el.readOnly ? 1 : 0;
  vec[6] = el.disabled ? 1 : 0;

  const pattern = el.getAttribute('pattern') || '';
  vec[7] = pattern ? 1 : 0;
  vec[8] = /^\[?\\?d|0-9/.test(pattern) ? 1 : 0;

  const inputMode = (el.inputMode || el.getAttribute('inputmode') || '').toLowerCase();
  vec[9] = inputMode === 'numeric' || inputMode === 'decimal' ? 1 : 0;
  vec[10] = inputMode === 'tel' ? 1 : 0;
  vec[11] = inputMode === 'email' ? 1 : 0;

  // ─ Visibility & Honeypot ─
  const visible = isElementVisible(el);
  vec[12] = visible ? 1 : 0;
  vec[13] = computeHoneypotScore(el);

  // ─ Split OTP ─
  const otpInfo = detectSplitOTP(el as HTMLInputElement);
  vec[14] = otpInfo.isSplitOTP ? 1 : 0;
  vec[15] = otpInfo.groupSize / 8.0;
  vec[16] = otpInfo.groupSize > 0 ? otpInfo.positionInGroup / otpInfo.groupSize : 0;

  // ─ Form context ─
  const formCtx = getFormContext(el);
  vec[17] = Math.min(formCtx.formFieldCount, 20) / 20.0;
  vec[18] = Math.min(formCtx.passwordFieldCount, 5) / 5.0;
  vec[19] = formCtx.formFieldCount > 0 ? formCtx.thisFieldIndex / formCtx.formFieldCount : 0;
  vec[20] = formCtx.hasEmailField ? 1 : 0;
  vec[21] = formCtx.hasUsernameField ? 1 : 0;
  vec[22] = formCtx.distanceToPrevPassword >= 0 ? Math.min(formCtx.distanceToPrevPassword, 5) / 5.0 : 0;
  vec[23] = formCtx.isInForm ? 1 : 0;

  // ─ Submit button context ─
  const submitInfo = findNearestSubmitButton(el);
  vec[24] = submitInfo.distance >= 0 ? Math.min(submitInfo.distance, 1000) / 1000.0 : 1.0;
  vec[25] = KEYWORD_BANKS.login_action.test(submitInfo.text) ? 1 : 0;
  vec[26] = KEYWORD_BANKS.signup_action.test(submitInfo.text) ? 1 : 0;
  vec[27] = /verif|confirm|submit|send|enter/i.test(submitInfo.text) ? 1 : 0;
  vec[28] = formCtx.formMethod === 'POST' ? 1 : 0;

  // ─ Spatial features ─
  const rect = el.getBoundingClientRect();
  vec[29] = Math.min(rect.width, 800) / 800.0;
  vec[30] = Math.min(rect.height, 200) / 200.0;
  vec[31] = rect.height > 0 ? Math.min(rect.width / rect.height, 20) / 20.0 : 0;

  // ─ Textual context gathering ─
  const placeholder = el.placeholder || '';
  const labelText = getExplicitLabelText(el);
  const ariaText = getAriaText(el);
  const floatingLabel = getFloatingLabelText(el);
  const nearbyText = getNearbyPrecedingText(el);

  // Primary text signal: concatenation of all direct labels
  const directTextSignal = [labelText, ariaText, placeholder, floatingLabel]
    .filter(Boolean).join(' ');

  // ─ Keyword scores on primary text ─
  const primaryKeywords = computeKeywordScores(directTextSignal);
  for (let i = 0; i < primaryKeywords.length; i++) {
    vec[32 + i] = primaryKeywords[i];
  }

  // ─ Keyword scores on nearby/contextual text ─
  const nearbyKeywords = computeKeywordScores(nearbyText);
  for (let i = 0; i < nearbyKeywords.length; i++) {
    vec[43 + i] = nearbyKeywords[i];
  }

  // ─ Text presence flags ─
  vec[54] = placeholder ? 1 : 0;
  vec[55] = Math.min(placeholder.length, 60) / 60.0;
  vec[56] = ariaText ? 1 : 0;
  vec[57] = labelText ? 1 : 0;
  vec[58] = floatingLabel ? 1 : 0;

  // ─ Name/ID pattern matching ─
  const nameId = ((el as HTMLInputElement).name || '') + ' ' + (el.id || '');
  vec[59] = /pass|pwd/i.test(nameId) ? 1 : 0;
  vec[60] = /email|correo/i.test(nameId) ? 1 : 0;
  vec[61] = /user|login/i.test(nameId) ? 1 : 0;
  vec[62] = /phone|tel|mobile|cell/i.test(nameId) ? 1 : 0;
  vec[63] = /otp|code|token|pin|verify/i.test(nameId) ? 1 : 0;

  // ─ Attribute signals ─
  const autocomplete = el.autocomplete || '';
  const name = (el as HTMLInputElement).name || '';
  const id = el.id || '';
  const dataAttrs = Array.from(el.attributes)
    .filter(a => a.name.startsWith('data-'))
    .map(a => `${a.name}=${a.value}`)
    .join(' ');
  const attributeSignals = [name, id, autocomplete, dataAttrs].filter(Boolean).join(' ');

  return {
    textualContext: directTextSignal.substring(0, 512),
    nearbyText: nearbyText.substring(0, 512),
    attributeSignals: attributeSignals.substring(0, 256),
    numericVector: vec,
  };
}

// ─── Batch Extraction (Full Page Scan) ───────────────────────────────────────

/**
 * Discovers ALL input elements on the page, including those inside Shadow DOMs,
 * and extracts features for each.
 */
export function scanPageInputs(): ExtractedField[] {
  const results: ExtractedField[] = [];

  function collectInputs(root: Document | ShadowRoot): (HTMLInputElement | HTMLTextAreaElement)[] {
    const inputs: (HTMLInputElement | HTMLTextAreaElement)[] = [];

    root.querySelectorAll('input, textarea').forEach(el => {
      const inp = el as HTMLInputElement;
      const type = inp.type?.toLowerCase();
      // Skip non-fillable types
      if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'checkbox', 'radio', 'range', 'color'].includes(type)) {
        return;
      }
      inputs.push(inp);
    });

    // Recursively traverse Shadow DOMs
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        inputs.push(...collectInputs(el.shadowRoot));
      }
    });

    return inputs;
  }

  const allInputs = collectInputs(document);

  for (const inp of allInputs) {
    const visible = isElementVisible(inp);
    const features = extractFeatures(inp);
    const rect = inp.getBoundingClientRect();

    results.push({
      element: inp,
      features,
      boundingRect: rect,
      isVisible: visible,
    });
  }

  return results;
}

// ─── Text Tokenizer for ML Model ─────────────────────────────────────────────

/**
 * Character-level tokenizer: converts text to a fixed-size integer array.
 * Uses a compact 128-char ASCII vocabulary + special tokens.
 */
const PAD_TOKEN = 0;
const UNK_TOKEN = 1;
const MAX_TEXT_LEN = 128;

export function tokenizeText(text: string): Int32Array {
  const tokens = new Int32Array(MAX_TEXT_LEN).fill(PAD_TOKEN);
  const cleaned = text.toLowerCase().replace(/\s+/g, ' ').trim();

  for (let i = 0; i < Math.min(cleaned.length, MAX_TEXT_LEN); i++) {
    const code = cleaned.charCodeAt(i);
    if (code >= 32 && code <= 126) {
      tokens[i] = code - 30; // Map ASCII 32-126 -> 2-96
    } else {
      tokens[i] = UNK_TOKEN;
    }
  }

  return tokens;
}

/**
 * Prepares the complete model input tensor from extracted features.
 * Returns: {
 *   numericFeatures: Float32Array(64),
 *   primaryTextTokens: Int32Array(128),
 *   nearbyTextTokens: Int32Array(128),
 *   attrTextTokens: Int32Array(128),
 * }
 */
export interface ModelInput {
  numericFeatures: Float32Array;
  primaryTextTokens: Int32Array;
  nearbyTextTokens: Int32Array;
  attrTextTokens: Int32Array;
}

export function prepareModelInput(features: RawFieldFeatures): ModelInput {
  return {
    numericFeatures: features.numericVector,
    primaryTextTokens: tokenizeText(features.textualContext),
    nearbyTextTokens: tokenizeText(features.nearbyText),
    attrTextTokens: tokenizeText(features.attributeSignals),
  };
}

export { FIELD_CLASSES, FieldClass, isElementVisible };
```

---

## File 2: `train_ghostfill_model.py` — PyTorch Architecture, Data Generation, Training & Export

```python
"""
GhostFill Form Field Classifier
================================
Training pipeline: Synthetic data generation → Model architecture → Training → ONNX export → INT8 quantization

Target: 5-9MB quantized model with near-perfect accuracy across 10 field classes.

Classes: [Email, Username, Password, Target_Password_Confirm,
          First_Name, Last_Name, Full_Name, Phone, OTP, Unknown]
"""

import os
import json
import random
import math
import struct
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass, field

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim.lr_scheduler import OneCycleLR

# ─── Configuration ────────────────────────────────────────────────────────────

FIELD_CLASSES = [
    'Email', 'Username', 'Password', 'Target_Password_Confirm',
    'First_Name', 'Last_Name', 'Full_Name', 'Phone', 'OTP', 'Unknown'
]
NUM_CLASSES = len(FIELD_CLASSES)

VOCAB_SIZE = 98           # PAD=0, UNK=1, then ASCII 32-126 mapped to 2-96, total 97 tokens
MAX_TEXT_LEN = 128
NUMERIC_DIM = 64
CHAR_EMBED_DIM = 32
TEXT_HIDDEN_DIM = 128
MLP_HIDDEN_DIM = 256
NUM_TEXT_CHANNELS = 3     # primary, nearby, attr

BATCH_SIZE = 512
NUM_EPOCHS = 40
LEARNING_RATE = 3e-3
WEIGHT_DECAY = 1e-4
NUM_SAMPLES = 500_000
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')


# ═══════════════════════════════════════════════════════════════════════════════
# PART 1: SYNTHETIC DATA GENERATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SyntheticFieldSample:
    label: int
    numeric_features: np.ndarray        # shape (64,)
    primary_text_tokens: np.ndarray     # shape (128,) int
    nearby_text_tokens: np.ndarray
    attr_text_tokens: np.ndarray


# Keyword and pattern banks for each class
EMAIL_KEYWORDS = [
    "email", "e-mail", "email address", "your email", "work email",
    "email addr", "correo electrónico", "courriel", "adresse email",
    "contact email", "enter your email", "email*", "email id",
    "personal email", "company email", "mail", "emailaddress",
]
USERNAME_KEYWORDS = [
    "username", "user name", "login", "login id", "screen name",
    "handle", "account name", "user id", "identifiant", "usuario",
    "display name", "nickname", "your username", "enter username",
    "choose a username", "create username",
]
PASSWORD_KEYWORDS = [
    "password", "pass word", "pwd", "contraseña", "mot de passe",
    "passwort", "senha", "your password", "enter password", "current password",
    "new password", "create password", "choose password", "set password",
]
PASSWORD_CONFIRM_KEYWORDS = [
    "confirm password", "re-enter password", "retype password",
    "verify password", "repeat password", "password again",
    "password confirmation", "re-type password", "confirm your password",
    "re-enter your password", "match password", "same password",
    "confirm pass", "confirm pwd", "reenter password",
]
FIRST_NAME_KEYWORDS = [
    "first name", "given name", "fname", "f name", "prénom",
    "nombre", "vorname", "your first name", "enter first name",
    "first", "forename",
]
LAST_NAME_KEYWORDS = [
    "last name", "surname", "family name", "lname", "l name",
    "nom de famille", "apellido", "nachname", "your last name",
    "enter last name", "last", "second name",
]
FULL_NAME_KEYWORDS = [
    "full name", "your name", "name", "display name", "complete name",
    "nom complet", "nombre completo", "enter your name", "legal name",
    "real name", "enter name", "cardholder name", "holder name",
]
PHONE_KEYWORDS = [
    "phone", "telephone", "tel", "mobile", "cell", "phone number",
    "mobile number", "contact number", "numéro de téléphone", "telefon",
    "sms number", "your phone", "enter phone number", "cell phone",
    "primary phone", "home phone", "work phone",
]
OTP_KEYWORDS = [
    "otp", "verification code", "security code", "one-time code",
    "auth code", "authentication code", "pin code", "mfa code",
    "2fa code", "passcode", "enter code", "enter otp",
    "code sent to", "verify code", "confirmation code",
    "enter the code", "enter verification code",
    "sms code", "email code",
]
UNKNOWN_KEYWORDS = [
    "search", "find", "query", "comment", "message", "notes",
    "address", "street", "city", "state", "zip", "postal code",
    "country", "company", "organization", "website", "url",
    "subject", "title", "description", "bio", "about",
    "coupon", "promo code", "referral", "how did you hear",
]

ALL_KEYWORD_BANKS = [
    EMAIL_KEYWORDS, USERNAME_KEYWORDS, PASSWORD_KEYWORDS,
    PASSWORD_CONFIRM_KEYWORDS, FIRST_NAME_KEYWORDS, LAST_NAME_KEYWORDS,
    FULL_NAME_KEYWORDS, PHONE_KEYWORDS, OTP_KEYWORDS, UNKNOWN_KEYWORDS,
]

# Attribute name/id patterns per class
EMAIL_ATTRS = ["email", "e-mail", "emailAddress", "user_email", "work_email", "mail", "userEmail"]
USERNAME_ATTRS = ["username", "user_name", "loginId", "userId", "uname", "screen_name", "handle"]
PASSWORD_ATTRS = ["password", "passwd", "pwd", "pass", "user_password", "login_password"]
PASSWORD_CONFIRM_ATTRS = ["password_confirm", "confirmPassword", "password2", "rePassword", "pwd_confirm",
                           "retypePassword", "verifyPassword", "password_again", "confirm_pwd"]
FIRST_NAME_ATTRS = ["firstName", "first_name", "fname", "givenName", "given_name"]
LAST_NAME_ATTRS = ["lastName", "last_name", "lname", "familyName", "family_name", "surname"]
FULL_NAME_ATTRS = ["name", "fullName", "full_name", "displayName", "display_name", "realname"]
PHONE_ATTRS = ["phone", "telephone", "tel", "mobile", "cellphone", "phoneNumber", "phone_number"]
OTP_ATTRS = ["otp", "verificationCode", "securityCode", "authCode", "pinCode", "mfaCode", "otpCode", "token", "code"]
UNKNOWN_ATTRS = [
    "search", "query", "comment", "address", "city", "state", "zip", "country",
    "company", "website", "subject", "title", "description", "bio", "q",
    "couponCode", "promoCode", "referralCode", "note",
]

ALL_ATTR_BANKS = [
    EMAIL_ATTRS, USERNAME_ATTRS, PASSWORD_ATTRS, PASSWORD_CONFIRM_ATTRS,
    FIRST_NAME_ATTRS, LAST_NAME_ATTRS, FULL_NAME_ATTRS,
    PHONE_ATTRS, OTP_ATTRS, UNKNOWN_ATTRS,
]

# Autocomplete values per class
AUTOCOMPLETE_MAP = {
    0: ["email"],
    1: ["username"],
    2: ["current-password", "new-password", "password"],
    3: ["new-password"],  # confirm is often also new-password
    4: ["given-name"],
    5: ["family-name"],
    6: ["name"],
    7: ["tel", "tel-national", "tel-local"],
    8: ["one-time-code"],
    9: ["off", "on", ""],
}

INPUT_TYPES = {
    0: ["email", "text"],
    1: ["text"],
    2: ["password"],
    3: ["password"],
    4: ["text"],
    5: ["text"],
    6: ["text"],
    7: ["tel", "text", "number"],
    8: ["text", "number", "tel"],
    9: ["text", "search", "url", "number"],
}

# Input type encoding (must match TypeScript extractor)
INPUT_TYPE_ENCODE = {
    'text': 1, 'email': 2, 'password': 3, 'tel': 4, 'number': 5,
    'url': 6, 'search': 7, 'hidden': 8, 'submit': 9, 'button': 10,
    'textarea': 11, 'date': 12, 'datetime-local': 13, 'month': 14,
    'week': 15, 'time': 16, 'color': 17, 'file': 18, 'range': 19,
    'checkbox': 20, 'radio': 21,
}

AUTOCOMPLETE_ENCODE = {
    'email': 1, 'username': 2, 'current-password': 3, 'new-password': 4,
    'given-name': 5, 'family-name': 6, 'name': 7, 'tel': 8, 'tel-national': 8,
    'tel-local': 8, 'one-time-code': 9, 'cc-number': 10, 'cc-name': 11,
    'cc-exp': 12, 'address-line1': 13, 'address-line2': 14, 'postal-code': 15,
    'country': 16, 'organization': 17, 'off': 18, 'on': 19, '': 0, 'password': 3,
}

# Keyword regex banks (matching the TypeScript extractor)
KEYWORD_REGEXES = [
    r'\b(e[\-_]?mail|correo|courriel|email[\-_]?addr(?:ess)?)\b',
    r'\b(user[\-_]?name|login[\-_]?id|screen[\-_]?name|handle|acct[\-_]?name|identifiant|usuario)\b',
    r'\b(pass[\-_]?word|pwd|contraseña|mot[\-_]?de[\-_]?passe|passwort|senha)\b',
    r'\b(confirm[\-_]?pass|re[\-_]?(?:enter|type)[\-_]?pass|verify[\-_]?pass|repeat[\-_]?pass|pass[\-_]?confirm|password[\-_]?again)\b',
    r'\b(first[\-_]?name|given[\-_]?name|f[\-_]?name|prénom|nombre|vorname)\b',
    r'\b(last[\-_]?name|sur[\-_]?name|family[\-_]?name|l[\-_]?name|nom[\-_]?(?:de[\-_]?)?famille|apellido|nachname)\b',
    r'\b(full[\-_]?name|your[\-_]?name|name|display[\-_]?name|nom[\-_]?complet|nombre[\-_]?completo)\b',
    r'\b(phone|tel(?:ephone)?|mobile|cell|número|numéro|telefon|sms[\-_]?number)\b',
    r'\b(otp|verif(?:y|ication)[\-_]?code|security[\-_]?code|one[\-_]?time|auth(?:entication)?[\-_]?code|pin[\-_]?code|mfa[\-_]?code|2fa[\-_]?code|token|passcode|code[\-_]?sent)\b',
    r'\b(log[\-_]?in|sign[\-_]?in|authenticate|connexion|iniciar[\-_]?sesión)\b',
    r'\b(sign[\-_]?up|register|create[\-_]?account|join|inscription|registrarse)\b',
]

import re

def compute_keyword_scores_py(text: str) -> np.ndarray:
    scores = np.zeros(len(KEYWORD_REGEXES), dtype=np.float32)
    lower = text.lower()
    for i, pattern in enumerate(KEYWORD_REGEXES):
        if re.search(pattern, lower):
            scores[i] = 1.0
    return scores


def tokenize_text_py(text: str, max_len: int = MAX_TEXT_LEN) -> np.ndarray:
    tokens = np.zeros(max_len, dtype=np.int32)
    cleaned = ' '.join(text.lower().split()).strip()
    for i in range(min(len(cleaned), max_len)):
        code = ord(cleaned[i])
        if 32 <= code <= 126:
            tokens[i] = code - 30
        else:
            tokens[i] = 1  # UNK
    return tokens


# Obfuscation simulators
def obfuscate_text(text: str, prob: float = 0.3) -> str:
    """Simulate framework obfuscation: random hashes, truncation, case changes."""
    if random.random() > prob:
        return text

    strategies = [
        lambda t: t.replace(' ', '_'),
        lambda t: t.replace(' ', '-'),
        lambda t: t.replace(' ', ''),
        lambda t: t[:3] + '_' + ''.join(random.choices('abcdef0123456789', k=6)),
        lambda t: 'css-' + ''.join(random.choices('abcdefghijklmnop', k=random.randint(4, 8))),
        lambda t: 'sc-' + ''.join(random.choices('abcdefghijklmnopqrstuvwxyzABCDEF', k=8)),
        lambda t: t.upper(),
        lambda t: ''.join(c if random.random() > 0.15 else '' for c in t),
        lambda t: t + str(random.randint(1, 999)),
        lambda t: '',  # Complete removal of label
    ]

    return random.choice(strategies)(text)


def generate_obfuscated_attr(attr_bank: List[str], prob: float = 0.25) -> str:
    """Sometimes obfuscate, sometimes use original attr name."""
    base = random.choice(attr_bank)
    if random.random() < prob:
        return obfuscate_text(base, prob=1.0)
    return base


# Nearby text generators
LOGIN_NEARBY_TEXTS = [
    "Log in to your account", "Sign in", "Welcome back",
    "Enter your credentials", "Account login", "",
]
SIGNUP_NEARBY_TEXTS = [
    "Create your account", "Sign up", "Join us today",
    "Get started", "Register for free", "Create account",
    "Already have an account?", "",
]
OTP_NEARBY_TEXTS = [
    "Please enter the verification code sent to your mobile",
    "We sent a code to your email",
    "Enter the 6-digit code", "Verify your identity",
    "Security verification", "Two-factor authentication",
    "Enter the code we texted you",
    "A verification code has been sent to your phone",
    "Check your email for the code",
    "",
]
GENERIC_NEARBY = ["", "Required", "*", "Please fill in this field", ""]


def generate_sample(label: int) -> SyntheticFieldSample:
    """Generate a single synthetic training sample for the given class."""

    # Select texts
    keyword_bank = ALL_KEYWORD_BANKS[label]
    attr_bank = ALL_ATTR_BANKS[label]
    input_type = random.choice(INPUT_TYPES[label])
    autocomplete_candidates = AUTOCOMPLETE_MAP.get(label, [""])
    autocomplete_val = random.choice(autocomplete_candidates)

    # Decide information availability (simulate various levels of signal)
    has_label = random.random() > 0.15
    has_placeholder = random.random() > 0.25
    has_aria = random.random() > 0.6
    has_autocomplete = random.random() > 0.3
    has_attr_signal = random.random() > 0.1

    # Obfuscation probability increases for harder scenarios
    obf_prob = random.uniform(0.0, 0.5)

    # ── Build primary text (label + placeholder + aria) ──
    primary_parts = []
    if has_label:
        kw = random.choice(keyword_bank)
        kw = obfuscate_text(kw, obf_prob * 0.5)  # Labels less obfuscated
        primary_parts.append(kw)
    if has_placeholder:
        kw = random.choice(keyword_bank)
        prefix = random.choice(["Enter your ", "Your ", "Type ", ""])
        suffix = random.choice(["", "...", " here", " *"])
        ph_text = prefix + kw + suffix
        ph_text = obfuscate_text(ph_text, obf_prob * 0.3)
        primary_parts.append(ph_text)
    if has_aria:
        kw = random.choice(keyword_bank)
        primary_parts.append(kw)

    # Sometimes add noise: random class names, framework artifacts
    if random.random() < 0.2:
        noise = random.choice([
            "MuiInputBase-input", "form-control", "input__field",
            "sc-bdnxRM kTWEec", "css-1pahdxg-control",
            "chakra-input", "ant-input",
        ])
        primary_parts.append(noise)

    primary_text = ' '.join(primary_parts)

    # ── Build nearby text ──
    if label == 8:  # OTP
        nearby_text = random.choice(OTP_NEARBY_TEXTS)
    elif label in (2, 3):  # Password
        nearby_text = random.choice(LOGIN_NEARBY_TEXTS + SIGNUP_NEARBY_TEXTS)
    elif label in (0, 1):  # Email/Username
        nearby_text = random.choice(LOGIN_NEARBY_TEXTS + SIGNUP_NEARBY_TEXTS)
    elif label in (4, 5, 6):  # Name fields
        nearby_text = random.choice(SIGNUP_NEARBY_TEXTS + GENERIC_NEARBY)
    elif label == 7:  # Phone
        nearby_text = random.choice(SIGNUP_NEARBY_TEXTS + ["Contact information", ""])
    else:
        nearby_text = random.choice(GENERIC_NEARBY + ["Search our site", "Leave a comment", ""])

    # Sometimes add context from other fields (realistic multi-field pages)
    if random.random() < 0.3:
        other_class = random.choice([i for i in range(NUM_CLASSES) if i != label])
        other_kw = random.choice(ALL_KEYWORD_BANKS[other_class])
        nearby_text += " " + other_kw

    # ── Build attribute signals (name, id, autocomplete, data-*) ──
    attr_parts = []
    if has_attr_signal:
        attr_name = generate_obfuscated_attr(attr_bank, obf_prob)
        attr_parts.append(attr_name)
    if has_autocomplete and autocomplete_val:
        attr_parts.append(autocomplete_val)
    if random.random() < 0.3:
        # Add data-* attributes
        data_kw = random.choice(keyword_bank)
        attr_parts.append(f"data-testid={data_kw.replace(' ', '-')}")

    # Sometimes add completely random/obfuscated attrs
    if random.random() < obf_prob:
        attr_parts.append(''.join(random.choices('abcdefghijklmnop', k=8)))

    attr_text = ' '.join(attr_parts)

    # ── Build numeric feature vector (64 dims) ──
    vec = np.zeros(64, dtype=np.float32)

    # [0] inputType
    vec[0] = INPUT_TYPE_ENCODE.get(input_type, 0) / 21.0

    # [1] autocomplete
    if has_autocomplete:
        vec[1] = AUTOCOMPLETE_ENCODE.get(autocomplete_val, 0) / 19.0

    # [2] maxLength
    if label == 8:  # OTP
        ml = random.choice([1, 1, 1, 4, 6, 6, 6, 7, 8])
    elif label == 7:  # Phone
        ml = random.choice([10, 11, 12, 13, 14, 15, -1])
    elif label in (2, 3):  # Password
        ml = random.choice([-1, 20, 32, 50, 64, 128, 255])
    elif label == 0:  # Email
        ml = random.choice([-1, 50, 100, 254, 255])
    else:
        ml = random.choice([-1, 20, 30, 50, 100, 255])
    vec[2] = min(ml, 100) / 100.0 if ml > 0 else 0

    # [3] minLength
    if label in (2, 3):
        min_len = random.choice([0, 6, 8, 10])
    else:
        min_len = random.choice([0, 0, 0, 1, 2])
    vec[3] = min(min_len, 50) / 50.0

    # [4] required
    vec[4] = 1.0 if random.random() > 0.3 else 0.0

    # [5] readOnly, [6] disabled
    vec[5] = 0.0
    vec[6] = 0.0

    # [7] hasPattern, [8] patternIsNumeric
    if label in (7, 8):  # Phone or OTP
        if random.random() > 0.5:
            vec[7] = 1.0
            vec[8] = 1.0 if random.random() > 0.3 else 0.0
    elif label in (2, 3):
        if random.random() > 0.7:
            vec[7] = 1.0

    # [9] inputModeNumeric, [10] inputModeTel, [11] inputModeEmail
    if label == 8:  # OTP
        mode = random.choice(['numeric', 'numeric', 'tel', 'text', ''])
        vec[9] = 1.0 if mode in ('numeric', 'decimal') else 0.0
        vec[10] = 1.0 if mode == 'tel' else 0.0
    elif label == 7:  # Phone
        vec[10] = 1.0 if random.random() > 0.3 else 0.0
        vec[9] = 1.0 if random.random() > 0.7 else 0.0
    elif label == 0:  # Email
        vec[11] = 1.0 if random.random() > 0.4 else 0.0

    # [12] visible (mostly 1, sometimes 0 for honeypots)
    is_honeypot = (label == 9 and random.random() < 0.15)
    vec[12] = 0.0 if is_honeypot else 1.0

    # [13] honeypotScore
    vec[13] = random.uniform(0.5, 1.0) if is_honeypot else random.uniform(0.0, 0.1)

    # [14-16] Split OTP
    is_split = label == 8 and ml == 1
    vec[14] = 1.0 if is_split else 0.0
    if is_split:
        group_size = random.choice([4, 5, 6, 7, 8])
        vec[15] = group_size / 8.0
        vec[16] = random.randint(0, group_size - 1) / group_size
    else:
        vec[15] = 0.0
        vec[16] = 0.0

    # ── Form context ──
    # [17] formFieldCount
    if label in (0, 1, 2):  # Login forms: fewer fields
        ffc = random.choice([2, 3, 3, 4])
    elif label in (3, 4, 5, 6, 7):  # Signup forms: more fields
        ffc = random.choice([4, 5, 6, 7, 8, 10])
    elif label == 8:  # OTP: few fields
        ffc = random.choice([1, 2, 3])
    else:
        ffc = random.choice([1, 2, 3, 5, 8, 12])
    vec[17] = min(ffc, 20) / 20.0

    # [18] passwordFieldCount
    if label in (2, 3):
        pfc = random.choice([1, 2, 2])
    elif label in (0, 1):
        pfc = random.choice([1, 1, 0])
    else:
        pfc = random.choice([0, 0, 1, 2])
    vec[18] = min(pfc, 5) / 5.0

    # [19] thisFieldIndex
    idx = random.randint(0, max(ffc - 1, 0))
    vec[19] = idx / max(ffc, 1)

    # [20] hasEmailSibling
    vec[20] = 1.0 if (label in (1, 2, 3, 4, 5, 6, 7) and random.random() > 0.3) else 0.0

    # [21] hasUsernameSibling
    vec[21] = 1.0 if (label in (2,) and random.random() > 0.4) else 0.0

    # [22] distToPrevPassword
    if label == 3:  # Confirm password is right after password
        vec[22] = 1.0 / 5.0
    elif label == 2 and pfc > 1:
        vec[22] = 0.0
    else:
        vec[22] = 0.0

    # [23] isInForm
    vec[23] = 1.0 if random.random() > 0.15 else 0.0

    # [24] distToSubmit (normalized)
    vec[24] = random.uniform(0.05, 0.6)

    # [25-27] submitText flags
    if label in (0, 1, 2):  # Login
        is_login_form = random.random() > 0.3
        vec[25] = 1.0 if is_login_form else 0.0
        vec[26] = 0.0 if is_login_form else (1.0 if random.random() > 0.3 else 0.0)
    elif label in (3, 4, 5, 6, 7):  # Signup
        vec[25] = 0.0
        vec[26] = 1.0 if random.random() > 0.3 else 0.0
    elif label == 8:  # OTP / verify
        vec[27] = 1.0 if random.random() > 0.2 else 0.0
    else:
        pass

    # [28] formMethodIsPost
    vec[28] = 1.0 if random.random() > 0.2 else 0.0

    # [29-31] dimensions
    if label == 8 and is_split:
        w = random.uniform(20, 60)
        h = random.uniform(30, 60)
    else:
        w = random.uniform(150, 500)
        h = random.uniform(30, 55)
    vec[29] = min(w, 800) / 800.0
    vec[30] = min(h, 200) / 200.0
    vec[31] = min(w / max(h, 1), 20) / 20.0

    # [32-42] keyword scores on primary text
    primary_kw_scores = compute_keyword_scores_py(primary_text)
    vec[32:32 + len(primary_kw_scores)] = primary_kw_scores

    # [43-53] keyword scores on nearby text
    nearby_kw_scores = compute_keyword_scores_py(nearby_text)
    vec[43:43 + len(nearby_kw_scores)] = nearby_kw_scores

    # [54-58] text presence flags
    vec[54] = 1.0 if has_placeholder else 0.0
    vec[55] = min(len(primary_text), 60) / 60.0
    vec[56] = 1.0 if has_aria else 0.0
    vec[57] = 1.0 if has_label else 0.0
    vec[58] = 1.0 if (has_label and random.random() > 0.6) else 0.0  # floating label

    # [59-63] name pattern flags
    attr_lower = attr_text.lower()
    vec[59] = 1.0 if re.search(r'pass|pwd', attr_lower) else 0.0
    vec[60] = 1.0 if re.search(r'email|correo', attr_lower) else 0.0
    vec[61] = 1.0 if re.search(r'user|login', attr_lower) else 0.0
    vec[62] = 1.0 if re.search(r'phone|tel|mobile|cell', attr_lower) else 0.0
    vec[63] = 1.0 if re.search(r'otp|code|token|pin|verify', attr_lower) else 0.0

    # Add noise to numeric features
    noise_mask = np.random.random(64) < 0.05
    noise_vals = np.random.uniform(-0.05, 0.05, 64).astype(np.float32)
    vec = np.clip(vec + noise_vals * noise_mask, 0.0, 1.0)

    # Tokenize texts
    primary_tokens = tokenize_text_py(primary_text)
    nearby_tokens = tokenize_text_py(nearby_text)
    attr_tokens = tokenize_text_py(attr_text)

    return SyntheticFieldSample(
        label=label,
        numeric_features=vec,
        primary_text_tokens=primary_tokens,
        nearby_text_tokens=nearby_tokens,
        attr_text_tokens=attr_tokens,
    )


def generate_hard_negative(label: int) -> SyntheticFieldSample:
    """Generate adversarial/confusing samples to improve model robustness."""

    # Hard cases: password vs password_confirm, first_name vs full_name, etc.
    confusion_pairs = {
        2: 3,   # password <-> confirm
        3: 2,
        4: 6,   # first_name <-> full_name
        6: 4,
        5: 6,   # last_name <-> full_name
        0: 1,   # email <-> username
        1: 0,
        7: 8,   # phone <-> otp
        8: 7,
    }

    # Generate a sample with the correct label but include confusing signals
    sample = generate_sample(label)

    if label in confusion_pairs:
        confuser = confusion_pairs[label]
        confuser_kw = random.choice(ALL_KEYWORD_BANKS[confuser])

        # Add confusing nearby text
        if random.random() < 0.4:
            confuser_text = sample.nearby_text_tokens  # Already tokenized, so retokenize
            new_nearby = confuser_kw + " " + random.choice(ALL_KEYWORD_BANKS[label])
            sample.nearby_text_tokens = tokenize_text_py(new_nearby)

    return sample


class GhostFillDataset(Dataset):
    def __init__(self, num_samples: int = NUM_SAMPLES, seed: int = 42):
        super().__init__()
        random.seed(seed)
        np.random.seed(seed)

        self.samples: List[SyntheticFieldSample] = []

        # Class distribution: slightly weighted towards harder classes
        class_weights = [1.0, 1.0, 1.2, 1.3, 1.0, 1.0, 1.1, 1.0, 1.3, 0.8]
        total_weight = sum(class_weights)
        class_counts = [int(num_samples * w / total_weight) for w in class_weights]

        # Ensure we hit target
        diff = num_samples - sum(class_counts)
        class_counts[0] += diff

        for class_idx, count in enumerate(class_counts):
            # 80% normal samples, 20% hard negatives
            normal_count = int(count * 0.8)
            hard_count = count - normal_count

            for _ in range(normal_count):
                self.samples.append(generate_sample(class_idx))
            for _ in range(hard_count):
                self.samples.append(generate_hard_negative(class_idx))

        # Shuffle
        random.shuffle(self.samples)

        print(f"Generated {len(self.samples)} samples")
        label_dist = [0] * NUM_CLASSES
        for s in self.samples:
            label_dist[s.label] += 1
        for i, c in enumerate(label_dist):
            print(f"  {FIELD_CLASSES[i]}: {c}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        return {
            'numeric': torch.from_numpy(s.numeric_features),
            'primary_text': torch.from_numpy(s.primary_text_tokens).long(),
            'nearby_text': torch.from_numpy(s.nearby_text_tokens).long(),
            'attr_text': torch.from_numpy(s.attr_text_tokens).long(),
            'label': torch.tensor(s.label, dtype=torch.long),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# PART 2: MODEL ARCHITECTURE
# ═══════════════════════════════════════════════════════════════════════════════

class CharCNNEncoder(nn.Module):
    """
    Character-level CNN text encoder.
    Processes tokenized text through:
    1. Character embedding
    2. Multi-scale 1D convolutions (kernels: 2, 3, 4, 5)
    3. Global max pooling
    4. Output projection

    This is extremely compact and handles obfuscated text well because it
    learns character n-gram patterns rather than relying on a word vocabulary.
    """

    def __init__(
        self,
        vocab_size: int = VOCAB_SIZE,
        embed_dim: int = CHAR_EMBED_DIM,
        num_filters: int = 64,
        kernel_sizes: Tuple[int, ...] = (2, 3, 4, 5),
        output_dim: int = TEXT_HIDDEN_DIM,
        dropout: float = 0.2,
    ):
        super().__init__()
        self.embed = nn.Embedding(vocab_size, embed_dim, padding_idx=0)

        self.convs = nn.ModuleList([
            nn.Conv1d(embed_dim, num_filters, ks, padding=ks // 2)
            for ks in kernel_sizes
        ])

        self.highway = nn.Linear(num_filters * len(kernel_sizes), num_filters * len(kernel_sizes))
        self.projection = nn.Linear(num_filters * len(kernel_sizes), output_dim)
        self.dropout = nn.Dropout(dropout)
        self.layer_norm = nn.LayerNorm(output_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (batch, seq_len) of token IDs
        returns: (batch, output_dim)
        """
        emb = self.embed(x)             # (B, L, E)
        emb = emb.transpose(1, 2)       # (B, E, L) for Conv1d
        emb = self.dropout(emb)

        conv_outputs = []
        for conv in self.convs:
            c = F.relu(conv(emb))        # (B, F, L')
            c = F.adaptive_max_pool1d(c, 1).squeeze(-1)  # (B, F)
            conv_outputs.append(c)

        h = torch.cat(conv_outputs, dim=-1)  # (B, F*num_kernels)

        # Highway connection
        gate = torch.sigmoid(self.highway(h))
        h = gate * h + (1 - gate) * h

        h = self.dropout(h)
        h = self.projection(h)
        h = self.layer_norm(h)
        return h


class GhostFillClassifier(nn.Module):
    """
    Hybrid architecture for form field classification:

    1. Three CharCNN encoders (shared weights) for primary text, nearby text, attr text
    2. MLP for numeric features
    3. Cross-attention fusion between text and numeric branches
    4. Final classification head

    Parameter budget (targeting ~8MB float32, ~2MB int8):
    - CharCNN: ~300K params (shared across 3 text channels) = 1.2MB
    - Numeric MLP: ~100K params = 0.4MB
    - Fusion + Head: ~200K params = 0.8MB
    - Total: ~600K params = ~2.4MB float32, well under 9MB
    - With int8 quantization: ~0.6MB for the model, rest is overhead

    We'll increase capacity to use the budget effectively.
    """

    def __init__(
        self,
        vocab_size: int = VOCAB_SIZE,
        char_embed_dim: int = CHAR_EMBED_DIM,
        text_hidden_dim: int = TEXT_HIDDEN_DIM,
        numeric_dim: int = NUMERIC_DIM,
        mlp_hidden_dim: int = MLP_HIDDEN_DIM,
        num_classes: int = NUM_CLASSES,
        dropout: float = 0.2,
    ):
        super().__init__()

        # Text encoders (shared weights for efficiency, different projections)
        self.text_encoder = CharCNNEncoder(
            vocab_size=vocab_size,
            embed_dim=char_embed_dim,
            num_filters=96,
            kernel_sizes=(2, 3, 4, 5, 7),
            output_dim=text_hidden_dim,
            dropout=dropout,
        )

        # Per-channel projection (lightweight, to specialize shared encoder output)
        self.primary_proj = nn.Sequential(
            nn.Linear(text_hidden_dim, text_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(text_hidden_dim),
        )
        self.nearby_proj = nn.Sequential(
            nn.Linear(text_hidden_dim, text_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(text_hidden_dim),
        )
        self.attr_proj = nn.Sequential(
            nn.Linear(text_hidden_dim, text_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(text_hidden_dim),
        )

        # Numeric feature MLP
        self.numeric_encoder = nn.Sequential(
            nn.Linear(numeric_dim, mlp_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(mlp_hidden_dim),
            nn.Dropout(dropout),
            nn.Linear(mlp_hidden_dim, mlp_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(mlp_hidden_dim),
            nn.Dropout(dropout),
            nn.Linear(mlp_hidden_dim, text_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(text_hidden_dim),
        )

        # Cross-attention: text attends to numeric and vice versa
        fused_dim = text_hidden_dim * 4  # primary + nearby + attr + numeric
        self.attention_gate = nn.Sequential(
            nn.Linear(fused_dim, fused_dim),
            nn.Sigmoid(),
        )

        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(fused_dim, mlp_hidden_dim),
            nn.ReLU(),
            nn.LayerNorm(mlp_hidden_dim),
            nn.Dropout(dropout),
            nn.Linear(mlp_hidden_dim, mlp_hidden_dim // 2),
            nn.ReLU(),
            nn.LayerNorm(mlp_hidden_dim // 2),
            nn.Dropout(dropout),
            nn.Linear(mlp_hidden_dim // 2, num_classes),
        )

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Embedding):
                nn.init.normal_(m.weight, std=0.05)
                if m.padding_idx is not None:
                    nn.init.zeros_(m.weight[m.padding_idx])
            elif isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, mode='fan_out', nonlinearity='relu')

    def forward(
        self,
        numeric: torch.Tensor,
        primary_text: torch.Tensor,
        nearby_text: torch.Tensor,
        attr_text: torch.Tensor,
    ) -> torch.Tensor:
        """
        numeric: (B, 64)
        primary_text: (B, 128) int
        nearby_text: (B, 128) int
        attr_text: (B, 128) int
        returns: (B, 10) logits
        """
        # Encode texts through shared encoder + specialized projections
        primary_enc = self.primary_proj(self.text_encoder(primary_text))    # (B, H)
        nearby_enc = self.nearby_proj(self.text_encoder(nearby_text))      # (B, H)
        attr_enc = self.attr_proj(self.text_encoder(attr_text))            # (B, H)

        # Encode numeric features
        numeric_enc = self.numeric_encoder(numeric)                          # (B, H)

        # Concatenate all branches
        fused = torch.cat([primary_enc, nearby_enc, attr_enc, numeric_enc], dim=-1)  # (B, 4H)

        # Gated attention fusion
        gate = self.attention_gate(fused)
        fused = fused * gate

        # Classify
        logits = self.classifier(fused)
        return logits

    def predict_proba(
        self,
        numeric: torch.Tensor,
        primary_text: torch.Tensor,
        nearby_text: torch.Tensor,
        attr_text: torch.Tensor,
    ) -> torch.Tensor:
        logits = self.forward(numeric, primary_text, nearby_text, attr_text)
        return F.softmax(logits, dim=-1)


# ═══════════════════════════════════════════════════════════════════════════════
# PART 3: TRAINING LOOP
# ═══════════════════════════════════════════════════════════════════════════════

class FocalLoss(nn.Module):
    """Focal loss for handling class imbalance and hard examples."""
    def __init__(self, gamma: float = 2.0, alpha: Optional[torch.Tensor] = None):
        super().__init__()
        self.gamma = gamma
        self.alpha = alpha

    def forward(self, logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
        ce_loss = F.cross_entropy(logits, targets, reduction='none')
        pt = torch.exp(-ce_loss)
        focal_loss = ((1 - pt) ** self.gamma) * ce_loss

        if self.alpha is not None:
            alpha_t = self.alpha.to(logits.device)[targets]
            focal_loss = alpha_t * focal_loss

        return focal_loss.mean()


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def estimate_model_size(model: nn.Module, quantized: bool = False) -> float:
    """Estimate model size in MB."""
    n_params = count_parameters(model)
    bytes_per_param = 1 if quantized else 4
    return n_params * bytes_per_param / (1024 * 1024)


def train():
    print("=" * 80)
    print("GhostFill Training Pipeline")
    print("=" * 80)

    # ── Dataset ──
    print("\n📊 Generating synthetic training data...")
    full_dataset = GhostFillDataset(num_samples=NUM_SAMPLES, seed=42)

    # Split 90/10
    train_size = int(0.9 * len(full_dataset))
    val_size = len(full_dataset) - train_size
    train_dataset, val_dataset = torch.utils.data.random_split(
        full_dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(42)
    )

    train_loader = DataLoader(
        train_dataset, batch_size=BATCH_SIZE, shuffle=True,
        num_workers=4, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_dataset, batch_size=BATCH_SIZE, shuffle=False,
        num_workers=4, pin_memory=True,
    )

    # ── Model ──
    print("\n🏗️ Building model...")
    model = GhostFillClassifier(
        vocab_size=VOCAB_SIZE,
        char_embed_dim=CHAR_EMBED_DIM,
        text_hidden_dim=TEXT_HIDDEN_DIM,
        numeric_dim=NUMERIC_DIM,
        mlp_hidden_dim=MLP_HIDDEN_DIM,
        num_classes=NUM_CLASSES,
        dropout=0.2,
    ).to(DEVICE)

    n_params = count_parameters(model)
    size_fp32 = estimate_model_size(model, quantized=False)
    size_int8 = estimate_model_size(model, quantized=True)
    print(f"  Parameters: {n_params:,}")
    print(f"  Size (FP32): {size_fp32:.2f} MB")
    print(f"  Size (INT8 est.): {size_int8:.2f} MB")

    # ── Optimizer & Scheduler ──
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=LEARNING_RATE,
        weight_decay=WEIGHT_DECAY,
        betas=(0.9, 0.999),
    )

    scheduler = OneCycleLR(
        optimizer,
        max_lr=LEARNING_RATE,
        epochs=NUM_EPOCHS,
        steps_per_epoch=len(train_loader),
        pct_start=0.1,
        anneal_strategy='cos',
    )

    # Class weights for focal loss
    class_weights = torch.ones(NUM_CLASSES).to(DEVICE)
    class_weights[3] = 1.5   # Password confirm (easily confused)
    class_weights[8] = 1.5   # OTP
    class_weights[6] = 1.2   # Full name (confused with first/last)

    criterion = FocalLoss(gamma=2.0, alpha=class_weights)

    # ── Training ──
    print("\n🚀 Starting training...")
    best_val_acc = 0.0
    best_model_state = None

    for epoch in range(NUM_EPOCHS):
        model.train()
        total_loss = 0.0
        correct = 0
        total = 0

        for batch_idx, batch in enumerate(train_loader):
            numeric = batch['numeric'].to(DEVICE)
            primary_text = batch['primary_text'].to(DEVICE)
            nearby_text = batch['nearby_text'].to(DEVICE)
            attr_text = batch['attr_text'].to(DEVICE)
            labels = batch['label'].to(DEVICE)

            optimizer.zero_grad()

            logits = model(numeric, primary_text, nearby_text, attr_text)
            loss = criterion(logits, labels)

            # Label smoothing regularization
            smooth_loss = -F.log_softmax(logits, dim=-1).mean()
            loss = loss + 0.01 * smooth_loss

            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            scheduler.step()

            total_loss += loss.item()
            _, predicted = logits.max(1)
            correct += predicted.eq(labels).sum().item()
            total += labels.size(0)

        train_acc = correct / total
        avg_loss = total_loss / len(train_loader)

        # ── Validation ──
        model.eval()
        val_correct = 0
        val_total = 0
        class_correct = [0] * NUM_CLASSES
        class_total = [0] * NUM_CLASSES

        with torch.no_grad():
            for batch in val_loader:
                numeric = batch['numeric'].to(DEVICE)
                primary_text = batch['primary_text'].to(DEVICE)
                nearby_text = batch['nearby_text'].to(DEVICE)
                attr_text = batch['attr_text'].to(DEVICE)
                labels = batch['label'].to(DEVICE)

                logits = model(numeric, primary_text, nearby_text, attr_text)
                _, predicted = logits.max(1)

                val_correct += predicted.eq(labels).sum().item()
                val_total += labels.size(0)

                for i in range(labels.size(0)):
                    label_val = labels[i].item()
                    class_total[label_val] += 1
                    if predicted[i].item() == label_val:
                        class_correct[label_val] += 1

        val_acc = val_correct / val_total

        print(f"  Epoch {epoch+1:3d}/{NUM_EPOCHS} | "
              f"Loss: {avg_loss:.4f} | "
              f"Train Acc: {train_acc:.4f} | "
              f"Val Acc: {val_acc:.4f} | "
              f"LR: {scheduler.get_last_lr()[0]:.6f}")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_model_state = {k: v.clone() for k, v in model.state_dict().items()}
            print(f"  ✨ New best validation accuracy: {val_acc:.4f}")

        # Print per-class accuracy every 10 epochs
        if (epoch + 1) % 10 == 0:
            print("  Per-class accuracy:")
            for i in range(NUM_CLASSES):
                acc = class_correct[i] / max(class_total[i], 1)
                print(f"    {FIELD_CLASSES[i]:30s}: {acc:.4f} ({class_correct[i]}/{class_total[i]})")

    # Load best model
    model.load_state_dict(best_model_state)
    print(f"\n✅ Training complete. Best validation accuracy: {best_val_acc:.4f}")

    return model


# ═══════════════════════════════════════════════════════════════════════════════
# PART 4: ONNX EXPORT & QUANTIZATION
# ═══════════════════════════════════════════════════════════════════════════════

def export_to_onnx(model: GhostFillClassifier, output_path: str = "ghostfill_classifier.onnx"):
    """Export the trained model to ONNX format."""
    model.eval()
    model.cpu()

    # Create dummy inputs
    dummy_numeric = torch.randn(1, NUMERIC_DIM)
    dummy_primary = torch.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN))
    dummy_nearby = torch.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN))
    dummy_attr = torch.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN))

    # Export
    torch.onnx.export(
        model,
        (dummy_numeric, dummy_primary, dummy_nearby, dummy_attr),
        output_path,
        export_params=True,
        opset_version=17,
        do_constant_folding=True,
        input_names=['numeric_features', 'primary_text', 'nearby_text', 'attr_text'],
        output_names=['logits'],
        dynamic_axes={
            'numeric_features': {0: 'batch_size'},
            'primary_text': {0: 'batch_size'},
            'nearby_text': {0: 'batch_size'},
            'attr_text': {0: 'batch_size'},
            'logits': {0: 'batch_size'},
        },
    )
    print(f"✅ ONNX model exported to {output_path}")

    file_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"   Size: {file_size:.2f} MB")

    return output_path


def quantize_onnx_int8(input_path: str, output_path: str = "ghostfill_classifier_int8.onnx"):
    """Apply INT8 dynamic quantization to the ONNX model."""
    try:
        from onnxruntime.quantization import quantize_dynamic, QuantType
        import onnx

        quantize_dynamic(
            input_path,
            output_path,
            weight_type=QuantType.QInt8,
            optimize_model=True,
        )

        file_size = os.path.getsize(output_path) / (1024 * 1024)
        print(f"✅ Quantized ONNX model saved to {output_path}")
        print(f"   Size: {file_size:.2f} MB")

        # Verify it's within budget
        if 5.0 <= file_size <= 9.0:
            print(f"   ✅ Within 5-9MB budget!")
        elif file_size < 5.0:
            print(f"   ⚠️ Under budget ({file_size:.2f}MB < 5MB). Consider increasing model capacity.")
        else:
            print(f"   ⚠️ Over budget ({file_size:.2f}MB > 9MB). Need to reduce model size.")

        return output_path

    except ImportError:
        print("⚠️ onnxruntime.quantization not available. Falling back to PyTorch quantization.")
        return input_path


def export_to_tfjs(model: GhostFillClassifier, onnx_path: str, output_dir: str = "tfjs_model"):
    """
    Alternative: Export to TensorFlow.js format via ONNX -> TF -> TF.js pipeline.
    Requires: onnx-tf, tensorflowjs
    """
    try:
        import subprocess

        # Method: Use onnx2tf + tensorflowjs_converter
        tf_saved_model_dir = "tf_saved_model_temp"

        # Step 1: ONNX -> TF SavedModel
        subprocess.run([
            "python", "-m", "onnx2tf",
            "-i", onnx_path,
            "-o", tf_saved_model_dir,
        ], check=True)

        # Step 2: TF SavedModel -> TF.js
        subprocess.run([
            "tensorflowjs_converter",
            "--input_format=tf_saved_model",
            "--output_format=tfjs_graph_model",
            "--quantize_uint8",
            tf_saved_model_dir,
            output_dir,
        ], check=True)

        print(f"✅ TF.js model exported to {output_dir}/")

        # Calculate total size
        total_size = 0
        for f in os.listdir(output_dir):
            total_size += os.path.getsize(os.path.join(output_dir, f))
        print(f"   Total size: {total_size / (1024*1024):.2f} MB")

    except Exception as e:
        print(f"⚠️ TF.js export failed: {e}")
        print("   The ONNX model can be used directly with ONNX Runtime Web.")


def verify_onnx_model(model_path: str):
    """Verify the ONNX model loads and runs correctly."""
    try:
        import onnxruntime as ort

        session = ort.InferenceSession(model_path)

        # Test inference
        numeric = np.random.randn(1, NUMERIC_DIM).astype(np.float32)
        primary = np.random.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN)).astype(np.int64)
        nearby = np.random.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN)).astype(np.int64)
        attr = np.random.randint(0, VOCAB_SIZE, (1, MAX_TEXT_LEN)).astype(np.int64)

        outputs = session.run(None, {
            'numeric_features': numeric,
            'primary_text': primary,
            'nearby_text': nearby,
            'attr_text': attr,
        })

        logits = outputs[0]
        probs = np.exp(logits) / np.exp(logits).sum(axis=-1, keepdims=True)

        print(f"✅ ONNX model verification passed!")
        print(f"   Output shape: {logits.shape}")
        print(f"   Predicted class: {FIELD_CLASSES[np.argmax(probs)]}")
        print(f"   Probabilities: {probs[0]}")

        # Batch inference test
        batch_numeric = np.random.randn(16, NUMERIC_DIM).astype(np.float32)
        batch_primary = np.random.randint(0, VOCAB_SIZE, (16, MAX_TEXT_LEN)).astype(np.int64)
        batch_nearby = np.random.randint(0, VOCAB_SIZE, (16, MAX_TEXT_LEN)).astype(np.int64)
        batch_attr = np.random.randint(0, VOCAB_SIZE, (16, MAX_TEXT_LEN)).astype(np.int64)

        outputs = session.run(None, {
            'numeric_features': batch_numeric,
            'primary_text': batch_primary,
            'nearby_text': batch_nearby,
            'attr_text': batch_attr,
        })
        print(f"   Batch inference (16): output shape = {outputs[0].shape} ✅")

    except ImportError:
        print("⚠️ onnxruntime not installed. Skipping verification.")


# ═══════════════════════════════════════════════════════════════════════════════
# PART 5: SIZE CALIBRATION
# ═══════════════════════════════════════════════════════════════════════════════

def calibrate_model_size():
    """
    Iteratively adjust model hyperparameters to hit the 5-9MB target.
    This function tests different configurations and reports sizes.
    """
    configs = [
        # (char_embed, text_hidden, mlp_hidden, num_filters, kernels)
        (32, 128, 256, 96, (2,3,4,5,7)),   # Current config
        (48, 192, 384, 128, (2,3,4,5,7)),  # Larger
        (64, 256, 512, 128, (2,3,4,5,7)),  # Even larger
        (48, 160, 320, 112, (2,3,4,5)),    # Medium
        (64, 256, 512, 160, (2,3,4,5,7,9)), # Maximum
    ]

    print("\n📐 Model Size Calibration:")
    print(f"{'Config':>5} | {'Params':>12} | {'FP32 MB':>8} | {'INT8 MB (est)':>14} | {'In Budget':>10}")
    print("-" * 65)

    for i, (ce, th, mh, nf, ks) in enumerate(configs):
        model = GhostFillClassifier(
            vocab_size=VOCAB_SIZE,
            char_embed_dim=ce,
            text_hidden_dim=th,
            numeric_dim=NUMERIC_DIM,
            mlp_hidden_dim=mh,
            num_classes=NUM_CLASSES,
        )
        # Override encoder config
        model.text_encoder = CharCNNEncoder(
            vocab_size=VOCAB_SIZE,
            embed_dim=ce,
            num_filters=nf,
            kernel_sizes=ks,
            output_dim=th,
        )

        n_params = count_parameters(model)
        fp32_mb = n_params * 4 / (1024**2)
        # ONNX int8 overhead is roughly 1.3x the raw int8 param size
        int8_mb = n_params * 1 / (1024**2) * 1.5 + 0.5  # +0.5MB for ONNX metadata

        in_budget = "✅" if 5.0 <= int8_mb <= 9.0 else ("⬇️ under" if int8_mb < 5.0 else "⬆️ over")

        print(f"  {i+1:>3} | {n_params:>12,} | {fp32_mb:>7.2f} | {int8_mb:>13.2f} | {in_budget:>10}")

        del model


# ═══════════════════════════════════════════════════════════════════════════════
# PART 6: MAIN ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="GhostFill Training Pipeline")
    parser.add_argument('--calibrate', action='store_true', help='Run size calibration only')
    parser.add_argument('--train', action='store_true', help='Run full training')
    parser.add_argument('--export-only', type=str, default=None, help='Export existing checkpoint')
    parser.add_argument('--epochs', type=int, default=NUM_EPOCHS)
    parser.add_argument('--samples', type=int, default=NUM_SAMPLES)
    args = parser.parse_args()

    if args.calibrate:
        calibrate_model_size()
    elif args.train or not args.export_only:
        NUM_EPOCHS = args.epochs
        NUM_SAMPLES = args.samples

        # Train
        model = train()

        # Save PyTorch checkpoint
        torch.save(model.state_dict(), "ghostfill_model.pt")
        print("💾 PyTorch checkpoint saved to ghostfill_model.pt")

        # Export to ONNX
        onnx_path = export_to_onnx(model)

        # Quantize
        quantized_path = quantize_onnx_int8(onnx_path)

        # Verify
        verify_onnx_model(quantized_path)

        # Try TF.js export
        export_to_tfjs(model, onnx_path)

    elif args.export_only:
        model = GhostFillClassifier()
        model.load_state_dict(torch.load(args.export_only, map_location='cpu'))
        onnx_path = export_to_onnx(model)
        quantized_path = quantize_onnx_int8(onnx_path)
        verify_onnx_model(quantized_path)
```

---

## File 3: `src/content/inference_engine.ts` — ONNX Runtime Web Inference

```typescript
/**
 * GhostFill Inference Engine
 * ==========================
 * Loads the quantized ONNX model via ONNX Runtime Web and performs
 * local-only inference for form field classification.
 *
 * Memory management: All tensors are explicitly disposed after use.
 * Thread safety: Inference sessions are singleton; concurrent calls are serialized.
 */

import * as ort from 'onnxruntime-web';
import {
  FIELD_CLASSES,
  FieldClass,
  ExtractedField,
  ModelInput,
  RawFieldFeatures,
  extractFeatures,
  prepareModelInput,
  scanPageInputs,
  isElementVisible,
} from './extractor';

// ─── Configuration ───────────────────────────────────────────────────────────

const MODEL_FILENAME = 'ghostfill_classifier_int8.onnx';
const CONFIDENCE_THRESHOLD = 0.65;
const BATCH_SIZE = 32;
const MAX_TEXT_LEN = 128;
const NUMERIC_DIM = 64;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  element: HTMLInputElement | HTMLTextAreaElement;
  predictedClass: FieldClass;
  confidence: number;
  probabilities: Record<FieldClass, number>;
  isVisible: boolean;
  isHoneypot: boolean;
}

export interface InferenceEngineConfig {
  confidenceThreshold?: number;
  skipInvisible?: boolean;
  skipHoneypots?: boolean;
  batchSize?: number;
  wasmPaths?: string;
}

// ─── Singleton Session Manager ───────────────────────────────────────────────

class SessionManager {
  private session: ort.InferenceSession | null = null;
  private loading: Promise<ort.InferenceSession> | null = null;
  private disposed = false;

  async getSession(): Promise<ort.InferenceSession> {
    if (this.disposed) {
      throw new Error('InferenceEngine has been disposed');
    }

    if (this.session) {
      return this.session;
    }

    if (this.loading) {
      return this.loading;
    }

    this.loading = this.initSession();
    this.session = await this.loading;
    this.loading = null;

    return this.session;
  }

  private async initSession(): Promise<ort.InferenceSession> {
    // Configure ONNX Runtime Web
    ort.env.wasm.numThreads = 1; // Single-threaded for content scripts
    ort.env.wasm.simd = true;

    // Set WASM binary paths (loaded from extension bundle)
    const wasmBasePath = chrome.runtime.getURL('wasm/');
    ort.env.wasm.wasmPaths = wasmBasePath;

    // Load model from extension bundle
    const modelUrl = chrome.runtime.getURL(`models/${MODEL_FILENAME}`);

    console.log(`[GhostFill] Loading model from: ${modelUrl}`);
    const startTime = performance.now();

    try {
      // Fetch model as ArrayBuffer for more control
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
      }
      const modelBuffer = await response.arrayBuffer();

      const session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
      });

      const elapsed = performance.now() - startTime;
      console.log(`[GhostFill] Model loaded in ${elapsed.toFixed(0)}ms`);
      console.log(`[GhostFill] Input names: ${session.inputNames}`);
      console.log(`[GhostFill] Output names: ${session.outputNames}`);

      return session;
    } catch (error) {
      console.error('[GhostFill] Failed to load model:', error);
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
  }
}

// ─── Tensor Utilities ────────────────────────────────────────────────────────

function createFloat32Tensor(data: Float32Array, dims: number[]): ort.Tensor {
  return new ort.Tensor('float32', data, dims);
}

function createInt64Tensor(data: Int32Array, dims: number[]): ort.Tensor {
  // ONNX expects int64, but JS doesn't have native int64
  // ort.Tensor handles the conversion internally when using BigInt64Array
  const bigIntData = new BigInt64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    bigIntData[i] = BigInt(data[i]);
  }
  return new ort.Tensor('int64', bigIntData, dims);
}

/**
 * Batches model inputs into ONNX tensors.
 * Returns tensors that MUST be disposed after inference.
 */
function batchInputsToTensors(inputs: ModelInput[]): Record<string, ort.Tensor> {
  const batchSize = inputs.length;

  // Allocate flat arrays
  const numericData = new Float32Array(batchSize * NUMERIC_DIM);
  const primaryData = new Int32Array(batchSize * MAX_TEXT_LEN);
  const nearbyData = new Int32Array(batchSize * MAX_TEXT_LEN);
  const attrData = new Int32Array(batchSize * MAX_TEXT_LEN);

  // Fill batch
  for (let i = 0; i < batchSize; i++) {
    const offset_n = i * NUMERIC_DIM;
    const offset_t = i * MAX_TEXT_LEN;

    numericData.set(inputs[i].numericFeatures, offset_n);
    primaryData.set(inputs[i].primaryTextTokens, offset_t);
    nearbyData.set(inputs[i].nearbyTextTokens, offset_t);
    attrData.set(inputs[i].attrTextTokens, offset_t);
  }

  return {
    'numeric_features': createFloat32Tensor(numericData, [batchSize, NUMERIC_DIM]),
    'primary_text': createInt64Tensor(primaryData, [batchSize, MAX_TEXT_LEN]),
    'nearby_text': createInt64Tensor(nearbyData, [batchSize, MAX_TEXT_LEN]),
    'attr_text': createInt64Tensor(attrData, [batchSize, MAX_TEXT_LEN]),
  };
}

/**
 * Applies softmax to raw logits.
 */
function softmax(logits: Float32Array, numClasses: number, batchSize: number): Float32Array {
  const probs = new Float32Array(logits.length);

  for (let b = 0; b < batchSize; b++) {
    const offset = b * numClasses;

    // Find max for numerical stability
    let maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      maxVal = Math.max(maxVal, logits[offset + c]);
    }

    // Compute exp and sum
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) {
      probs[offset + c] = Math.exp(logits[offset + c] - maxVal);
      sumExp += probs[offset + c];
    }

    // Normalize
    for (let c = 0; c < numClasses; c++) {
      probs[offset + c] /= sumExp;
    }
  }

  return probs;
}

// ─── Main Inference Engine ───────────────────────────────────────────────────

export class GhostFillInferenceEngine {
  private sessionManager: SessionManager;
  private config: Required<InferenceEngineConfig>;
  private inferenceQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;

  constructor(config: InferenceEngineConfig = {}) {
    this.sessionManager = new SessionManager();
    this.config = {
      confidenceThreshold: config.confidenceThreshold ?? CONFIDENCE_THRESHOLD,
      skipInvisible: config.skipInvisible ?? false,
      skipHoneypots: config.skipHoneypots ?? true,
      batchSize: config.batchSize ?? BATCH_SIZE,
      wasmPaths: config.wasmPaths ?? '',
    };
  }

  /**
   * Warm up the model by loading it and running a dummy inference.
   * Call this early (e.g., on extension install) to avoid latency on first use.
   */
  async warmup(): Promise<void> {
    console.log('[GhostFill] Warming up inference engine...');
    const startTime = performance.now();

    const session = await this.sessionManager.getSession();

    // Run dummy inference to trigger JIT compilation
    const dummyNumeric = new Float32Array(NUMERIC_DIM);
    const dummyText = new Int32Array(MAX_TEXT_LEN);

    const feeds = batchInputsToTensors([{
      numericFeatures: dummyNumeric,
      primaryTextTokens: dummyText,
      nearbyTextTokens: dummyText,
      attrTextTokens: dummyText,
    }]);

    try {
      const results = await session.run(feeds);
      // Dispose output tensor
      for (const key of Object.keys(results)) {
        results[key].dispose();
      }
    } finally {
      // Dispose input tensors
      for (const key of Object.keys(feeds)) {
        feeds[key].dispose();
      }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[GhostFill] Warmup complete in ${elapsed.toFixed(0)}ms`);
  }

  /**
   * Classify a single input element.
   */
  async classifyElement(
    element: HTMLInputElement | HTMLTextAreaElement
  ): Promise<ClassificationResult> {
    const results = await this.classifyElements([element]);
    return results[0];
  }

  /**
   * Classify multiple input elements in batches.
   * This is the primary API for content scripts.
   */
  async classifyElements(
    elements: (HTMLInputElement | HTMLTextAreaElement)[]
  ): Promise<ClassificationResult[]> {
    // Serialize concurrent inference calls to prevent resource contention
    return new Promise<ClassificationResult[]>((resolve, reject) => {
      this.inferenceQueue = this.inferenceQueue.then(async () => {
        try {
          const results = await this._classifyBatch(elements);
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Scan the entire page and classify all discovered input fields.
   */
  async classifyPage(): Promise<ClassificationResult[]> {
    console.log('[GhostFill] Scanning page for input fields...');
    const startTime = performance.now();

    const extractedFields = scanPageInputs();
    console.log(`[GhostFill] Found ${extractedFields.length} input fields`);

    if (extractedFields.length === 0) {
      return [];
    }

    // Filter based on config
    let fieldsToClassify = extractedFields;

    if (this.config.skipInvisible) {
      fieldsToClassify = fieldsToClassify.filter(f => f.isVisible);
    }

    const elements = fieldsToClassify.map(f => f.element);
    const results = await this.classifyElements(elements);

    // Filter honeypots
    const filteredResults = this.config.skipHoneypots
      ? results.filter(r => !r.isHoneypot)
      : results;

    const elapsed = performance.now() - startTime;
    console.log(`[GhostFill] Page classification complete in ${elapsed.toFixed(0)}ms`);
    console.log(`[GhostFill] Results: ${filteredResults.length} fields classified`);

    for (const r of filteredResults) {
      if (r.confidence >= this.config.confidenceThreshold) {
        console.log(
          `[GhostFill]   ${r.predictedClass} (${(r.confidence * 100).toFixed(1)}%) - ` +
          `name="${(r.element as HTMLInputElement).name}" id="${r.element.id}"`
        );
      }
    }

    return filteredResults;
  }

  /**
   * Internal batched inference implementation.
   */
  private async _classifyBatch(
    elements: (HTMLInputElement | HTMLTextAreaElement)[]
  ): Promise<ClassificationResult[]> {
    const session = await this.sessionManager.getSession();
    const results: ClassificationResult[] = [];

    // Extract features for all elements
    const featuresList: { features: RawFieldFeatures; visible: boolean }[] = [];
    for (const el of elements) {
      const features = extractFeatures(el);
      const visible = isElementVisible(el);
      featuresList.push({ features, visible });
    }

    // Process in batches
    for (let batchStart = 0; batchStart < elements.length; batchStart += this.config.batchSize) {
      const batchEnd = Math.min(batchStart + this.config.batchSize, elements.length);
      const batchElements = elements.slice(batchStart, batchEnd);
      const batchFeatures = featuresList.slice(batchStart, batchEnd);

      // Prepare model inputs
      const modelInputs: ModelInput[] = batchFeatures.map(f => prepareModelInput(f.features));

      // Create tensors
      const feeds = batchInputsToTensors(modelInputs);

      try {
        // Run inference
        const inferenceStart = performance.now();
        const outputMap = await session.run(feeds);
        const inferenceTime = performance.now() - inferenceStart;

        if (batchElements.length > 1) {
          console.log(
            `[GhostFill] Batch inference (${batchElements.length} fields): ${inferenceTime.toFixed(1)}ms`
          );
        }

        // Extract logits
        const logitsTensor = outputMap['logits'];
        const logitsData = logitsTensor.data as Float32Array;

        // Apply softmax
        const probs = softmax(
          new Float32Array(logitsData),
          FIELD_CLASSES.length,
          batchElements.length
        );

        // Build results
        for (let i = 0; i < batchElements.length; i++) {
          const offset = i * FIELD_CLASSES.length;
          const probSlice = probs.slice(offset, offset + FIELD_CLASSES.length);

          // Find argmax
          let maxProb = 0;
          let maxIdx = 0;
          const probMap: Record<string, number> = {};

          for (let c = 0; c < FIELD_CLASSES.length; c++) {
            probMap[FIELD_CLASSES[c]] = probSlice[c];
            if (probSlice[c] > maxProb) {
              maxProb = probSlice[c];
              maxIdx = c;
            }
          }

          // Honeypot detection from features
          const honeypotScore = batchFeatures[i].features.numericVector[13];
          const isHoneypot = honeypotScore > 0.4 || !batchFeatures[i].visible;

          results.push({
            element: batchElements[i],
            predictedClass: FIELD_CLASSES[maxIdx] as FieldClass,
            confidence: maxProb,
            probabilities: probMap as Record<FieldClass, number>,
            isVisible: batchFeatures[i].visible,
            isHoneypot,
          });
        }

        // Dispose output tensors
        for (const key of Object.keys(outputMap)) {
          outputMap[key].dispose();
        }

      } finally {
        // CRITICAL: Dispose input tensors to prevent memory leaks
        for (const key of Object.keys(feeds)) {
          feeds[key].dispose();
        }
      }
    }

    return results;
  }

  /**
   * Get high-confidence classifications suitable for auto-filling.
   * Returns only results that meet the confidence threshold and aren't honeypots.
   */
  async getAutoFillCandidates(): Promise<ClassificationResult[]> {
    const allResults = await this.classifyPage();

    return allResults.filter(r =>
      r.confidence >= this.config.confidenceThreshold &&
      !r.isHoneypot &&
      r.isVisible &&
      r.predictedClass !== 'Unknown'
    );
  }

  /**
   * Dispose all resources. Call when the content script is being torn down.
   */
  async dispose(): Promise<void> {
    if (this.isDisposed) return;
    this.isDisposed = true;

    console.log('[GhostFill] Disposing inference engine...');
    await this.sessionManager.dispose();
  }
}

// ─── Content Script Integration ──────────────────────────────────────────────

/**
 * Main content script entry point.
 * Initializes the engine, scans the page, and sets up MutationObserver
 * for dynamically added forms.
 */
let engineInstance: GhostFillInferenceEngine | null = null;

export async function initGhostFill(): Promise<GhostFillInferenceEngine> {
  if (engineInstance) return engineInstance;

  engineInstance = new GhostFillInferenceEngine({
    confidenceThreshold: 0.65,
    skipHoneypots: true,
    skipInvisible: false,  // We classify invisible ones but flag them
    batchSize: 32,
  });

  // Warm up (non-blocking, but starts loading the model early)
  engineInstance.warmup().catch(err => {
    console.error('[GhostFill] Warmup failed:', err);
  });

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    await new Promise<void>(resolve => {
      document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }

  // Initial page scan
  setTimeout(async () => {
    try {
      const candidates = await engineInstance!.getAutoFillCandidates();
      if (candidates.length > 0) {
        // Send results to background script for auto-fill coordination
        chrome.runtime.sendMessage({
          type: 'GHOSTFILL_FIELDS_DETECTED',
          fields: candidates.map(c => ({
            class: c.predictedClass,
            confidence: c.confidence,
            elementId: c.element.id,
            elementName: (c.element as HTMLInputElement).name,
          })),
        });
      }
    } catch (err) {
      console.error('[GhostFill] Initial scan failed:', err);
    }
  }, 500); // Small delay for SPAs to settle

  // Observe for dynamically added forms
  const observer = new MutationObserver((mutations) => {
    let hasNewInputs = false;

    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          if (
            node.tagName === 'INPUT' ||
            node.tagName === 'TEXTAREA' ||
            node.querySelector('input, textarea')
          ) {
            hasNewInputs = true;
            break;
          }
        }
      }
      if (hasNewInputs) break;
    }

    if (hasNewInputs) {
      // Debounce: wait for DOM to settle
      clearTimeout((observer as any)._debounceTimer);
      (observer as any)._debounceTimer = setTimeout(async () => {
        try {
          const candidates = await engineInstance!.getAutoFillCandidates();
          if (candidates.length > 0) {
            chrome.runtime.sendMessage({
              type: 'GHOSTFILL_FIELDS_DETECTED',
              fields: candidates.map(c => ({
                class: c.predictedClass,
                confidence: c.confidence,
                elementId: c.element.id,
                elementName: (c.element as HTMLInputElement).name,
              })),
            });
          }
        } catch (err) {
          console.error('[GhostFill] Dynamic scan failed:', err);
        }
      }, 300);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    observer.disconnect();
    engineInstance?.dispose();
    engineInstance = null;
  });

  return engineInstance;
}

// Auto-init when loaded as content script
initGhostFill();
```

---

## File 4: `src/email/email_extractor.ts` — Smart Email OTP/Link Extraction

```typescript
/**
 * GhostFill Email Extractor
 * =========================
 * Extracts OTPs and activation links from email HTML using a multi-pass
 * heuristic engine with NLP tokenization constraints.
 *
 * Architecture: No ML model needed — this uses an advanced rule engine
 * that preserves the 5-9MB budget entirely for the form classifier.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OTPMatch {
  code: string;
  confidence: number;
  source: 'explicit_label' | 'structured_code' | 'standalone_pattern' | 'context_inference';
  context: string;  // Surrounding text for debugging
}

export interface ActivationLinkMatch {
  url: string;
  confidence: number;
  displayText: string;
  source: 'explicit_button' | 'link_text' | 'url_pattern' | 'context_inference';
}

export interface EmailExtractionResult {
  otps: OTPMatch[];
  activationLinks: ActivationLinkMatch[];
  cleanedText: string;
  rawLinks: { href: string; text: string }[];
}

// ─── Email HTML Cleaner ──────────────────────────────────────────────────────

/**
 * Aggressively strips email HTML to extract semantic content.
 * Removes: styles, scripts, images, tracking pixels, comments, spacer elements.
 * Preserves: text content, hyperlinks (href + display text), semantic structure.
 */
export function cleanEmailHTML(rawHTML: string): { text: string; links: { href: string; text: string }[] } {
  const links: { href: string; text: string }[] = [];

  // ── Phase 1: Remove non-content elements ──
  let html = rawHTML;

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Remove <style> blocks
  html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove <script> blocks
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  // Remove <head> block entirely
  html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '');

  // Remove tracking pixels: <img> with 1x1 dimensions or common tracker patterns
  html = html.replace(/<img\b[^>]*(?:width\s*=\s*["']?1["']?|height\s*=\s*["']?1["']?)[^>]*>/gi, '');
  html = html.replace(/<img\b[^>]*(?:tracking|pixel|beacon|open|analytics|mailtrack)[^>]*>/gi, '');

  // Remove all remaining images (not semantically relevant for OTP/link extraction)
  html = html.replace(/<img\b[^>]*>/gi, '');

  // Remove invisible/spacer elements
  html = html.replace(/<(?:div|span|td|tr|table)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|height\s*:\s*0|width\s*:\s*0)[^>]*>[\s\S]*?<\/(?:div|span|td|tr|table)>/gi, '');

  // Remove MSO conditional comments (Outlook)
  html = html.replace(/<!--\[if\b[^>]*\]>[\s\S]*?<!\[endif\]-->/gi, '');

  // ── Phase 2: Extract links before stripping HTML ──
  const linkRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = decodeHTMLEntities(linkMatch[1].trim());
    const displayText = stripHTMLTags(linkMatch[2]).trim();
    if (href && !href.startsWith('mailto:') && !href.startsWith('#')) {
      links.push({ href, text: displayText });
    }
  }

  // ── Phase 3: Convert block elements to newlines ──
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote|section|article|header|footer)>/gi, '\n');
  html = html.replace(/<(?:hr)\b[^>]*>/gi, '\n---\n');

  // ── Phase 4: Strip all remaining HTML tags ──
  html = stripHTMLTags(html);

  // ── Phase 5: Clean up whitespace ──
  html = decodeHTMLEntities(html);
  html = html.replace(/[\t ]+/g, ' ');         // Collapse horizontal whitespace
  html = html.replace(/\n\s*\n\s*\n/g, '\n\n'); // Max 2 consecutive newlines
  html = html.replace(/^\s+|\s+$/gm, '');       // Trim each line
  html = html.split('\n').filter(line => line.trim().length > 0).join('\n');

  return { text: html, links };
}

function stripHTMLTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ');
}

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&#160;': ' ',
    '&ndash;': '–', '&mdash;': '—', '&laquo;': '«', '&raquo;': '»',
    '&copy;': '©', '&reg;': '®', '&trade;': '™',
    '&hellip;': '…', '&bull;': '•',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // Numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

// ─── OTP Extraction Engine ──────────────────────────────────────────────────

/**
 * Multi-pass OTP extraction pipeline:
 *
 * Pass 1: Explicit labeled codes ("Your verification code is: 123456")
 * Pass 2: Structured code blocks (monospace/bold isolated codes)
 * Pass 3: Standalone numeric patterns with contextual validation
 * Pass 4: Alphanumeric codes with OTP context
 *
 * Anti-patterns (NOT OTPs):
 * - Order numbers, tracking numbers, invoice numbers
 * - Phone numbers, zip codes, dates
 * - Prices, quantities, IDs labeled as such
 */

// Context keywords that STRONGLY indicate OTP
const OTP_CONTEXT_KEYWORDS = [
  /verif(?:y|ication)\s*code/i,
  /security\s*code/i,
  /one[- ]?time\s*(?:code|pass(?:word|code)?|pin)/i,
  /(?:otp|2fa|mfa|totp)\s*(?:code|token)?/i,
  /auth(?:entication|orization)?\s*code/i,
  /confirm(?:ation)?\s*code/i,
  /(?:enter|use|type|input)\s*(?:the\s*)?(?:code|otp|pin)/i,
  /(?:code|pin|otp)\s*(?:is|was|:)/i,
  /sent\s*(?:a\s*)?(?:code|otp|pin)/i,
  /(?:code|otp|pin)\s*(?:sent|delivered|texted|emailed)/i,
  /(?:your|the)\s*code\s*(?:is|:)/i,
  /temporary\s*(?:code|password|pin)/i,
  /pass\s*code/i,
  /login\s*code/i,
  /access\s*code/i,
  /reset\s*code/i,
];

// Context keywords that indicate NOT an OTP
const NOT_OTP_CONTEXT = [
  /order\s*(?:#|num|number)/i,
  /tracking\s*(?:#|num|number)/i,
  /invoice\s*(?:#|num|number)/i,
  /reference\s*(?:#|num|number)/i,
  /account\s*(?:#|num|number)/i,
  /confirmation\s*(?:#|num|number)/i,  // "confirmation number" != "confirmation code"
  /case\s*(?:#|num|number)/i,
  /ticket\s*(?:#|num|number)/i,
  /receipt\s*(?:#|num|number)/i,
  /transaction\s*(?:#|id)/i,
  /(?:zip|postal)\s*code/i,
  /(?:area|country)\s*code/i,
  /phone|telephone|mobile|fax/i,
  /\$\s*\d/,
  /(?:usd|eur|gbp|jpy)\s*\d/i,
  /price|cost|amount|total|subtotal|tax|fee/i,
  /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,  // Date patterns
  /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*/i,
];

/**
 * Determines if surrounding text suggests the code is an OTP.
 * Returns a confidence score 0-1.
 */
function computeOTPContextScore(text: string, codePosition: number): number {
  // Extract context window (200 chars before, 100 chars after the code)
  const contextBefore = text.substring(Math.max(0, codePosition - 200), codePosition);
  const contextAfter = text.substring(codePosition, Math.min(text.length, codePosition + 100));
  const fullContext = contextBefore + ' ' + contextAfter;

  let score = 0;

  // Positive signals
  for (const pattern of OTP_CONTEXT_KEYWORDS) {
    if (pattern.test(fullContext)) {
      score += 0.35;
    }
  }

  // Negative signals
  for (const pattern of NOT_OTP_CONTEXT) {
    if (pattern.test(fullContext)) {
      score -= 0.5;
    }
  }

  // Proximity bonus: OTP keyword within 50 chars is very strong
  const nearContext = text.substring(
    Math.max(0, codePosition - 50),
    Math.min(text.length, codePosition + 50)
  );
  for (const pattern of OTP_CONTEXT_KEYWORDS) {
    if (pattern.test(nearContext)) {
      score += 0.25;
    }
  }

  return Math.max(0, Math.min(1, score));
}

function extractOTPs(cleanedText: string): OTPMatch[] {
  const results: OTPMatch[] = [];
  const seenCodes = new Set<string>();

  // ── Pass 1: Explicitly labeled codes ──
  // Patterns like "Your code is: 123456" or "OTP: ABC123" or "Code - 12345678"
  const explicitPatterns = [
    /(?:code|otp|pin|token|passcode)\s*(?:is|:|-|=)\s*[#]?\s*([A-Z0-9]{4,8})/gi,
    /(?:verification|security|confirmation|auth(?:entication)?|access|login|reset)\s*code\s*(?:is|:|-|=)\s*[#]?\s*([A-Z0-9]{4,8})/gi,
    /(?:your|the)\s*(?:code|otp|pin)\s*(?:is|:|-|=)\s*[#]?\s*([A-Z0-9]{4,8})/gi,
    /(?:enter|use|type)\s*(?:the\s*)?(?:code|otp)?\s*[:]\s*([A-Z0-9]{4,8})/gi,
  ];

  for (const pattern of explicitPatterns) {
    let match;
    while ((match = pattern.exec(cleanedText)) !== null) {
      const code = match[1].trim();
      if (!seenCodes.has(code) && isValidOTPCode(code)) {
        const contextScore = computeOTPContextScore(cleanedText, match.index);
        if (contextScore > 0) {
          seenCodes.add(code);
          results.push({
            code,
            confidence: Math.min(0.95, 0.7 + contextScore),
            source: 'explicit_label',
            context: cleanedText.substring(
              Math.max(0, match.index - 30),
              Math.min(cleanedText.length, match.index + match[0].length + 30)
            ),
          });
        }
      }
    }
  }

  // ── Pass 2: Standalone numeric codes on their own line ──
  // Codes that appear isolated, possibly in large/bold formatting
  const lines = cleanedText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Pure numeric/alphanumeric code on its own line
    if (/^[A-Z0-9]{4,8}$/i.test(line)) {
      const code = line;
      if (!seenCodes.has(code) && isValidOTPCode(code)) {
        // Check context from surrounding lines
        const contextWindow = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)).join(' ');
        const contextScore = computeOTPContextScore(contextWindow, contextWindow.indexOf(code));

        if (contextScore > 0.15) {
          seenCodes.add(code);
          results.push({
            code,
            confidence: Math.min(0.9, 0.5 + contextScore),
            source: 'structured_code',
            context: contextWindow.substring(0, 100),
          });
        }
      }
    }
  }

  // ── Pass 3: Numeric patterns with spacing (styled OTPs like "1 2 3 4 5 6") ──
  const spacedPattern = /\b(\d)\s+(\d)\s+(\d)\s+(\d)(?:\s+(\d))?(?:\s+(\d))?(?:\s+(\d))?(?:\s+(\d))?\b/g;
  let spacedMatch;
  while ((spacedMatch = spacedPattern.exec(cleanedText)) !== null) {
    const digits = spacedMatch.slice(1).filter(Boolean).join('');
    if (digits.length >= 4 && digits.length <= 8 && !seenCodes.has(digits)) {
      const contextScore = computeOTPContextScore(cleanedText, spacedMatch.index);
      if (contextScore > 0.2) {
        seenCodes.add(digits);
        results.push({
          code: digits,
          confidence: Math.min(0.85, 0.45 + contextScore),
          source: 'standalone_pattern',
          context: cleanedText.substring(
            Math.max(0, spacedMatch.index - 30),
            Math.min(cleanedText.length, spacedMatch.index + spacedMatch[0].length + 30)
          ),
        });
      }
    }
  }

  // ── Pass 4: General numeric patterns with strong context ──
  const generalNumeric = /\b(\d{4,8})\b/g;
  let numMatch;
  while ((numMatch = generalNumeric.exec(cleanedText)) !== null) {
    const code = numMatch[1];
    if (!seenCodes.has(code) && isValidOTPCode(code)) {
      const contextScore = computeOTPContextScore(cleanedText, numMatch.index);
      // Require very high context confidence for general patterns
      if (contextScore >= 0.5) {
        seenCodes.add(code);
        results.push({
          code,
          confidence: Math.min(0.8, 0.3 + contextScore),
          source: 'context_inference',
          context: cleanedText.substring(
            Math.max(0, numMatch.index - 40),
            Math.min(cleanedText.length, numMatch.index + numMatch[0].length + 40)
          ),
        });
      }
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  // Return top candidates (usually just 1 OTP per email)
  return results.slice(0, 3);
}

/**
 * Validates that a string looks like a legitimate OTP code
 * (not a year, common number, etc.)
 */
function isValidOTPCode(code: string): boolean {
  // Must be 4-8 characters
  if (code.length < 4 || code.length > 8) return false;

  // Must contain at least one digit
  if (!/\d/.test(code)) return false;

  // Reject common non-OTP patterns
  const num = parseInt(code, 10);

  // Reject years (1900-2099)
  if (code.length === 4 && num >= 1900 && num <= 2099) return false;

  // Reject all-same digits
  if (/^(.)\1+$/.test(code)) return false;

  // Reject sequential digits (1234, 4321, etc.)
  if (code.length === 4) {
    const isSequential = code.split('').every((d, i, arr) =>
      i === 0 || parseInt(d) === parseInt(arr[i-1]) + 1
    );
    const isReverseSequential = code.split('').every((d, i, arr) =>
      i === 0 || parseInt(d) === parseInt(arr[i-1]) - 1
    );
    if (isSequential || isReverseSequential) return false;
  }

  // Reject if it looks like a phone number fragment (10+ digits after cleanup)
  // Already handled by length check

  return true;
}

// ─── Activation Link Extraction Engine ───────────────────────────────────────

const ACTIVATION_LINK_TEXT_PATTERNS = [
  /verif(?:y|ication)/i,
  /confirm/i,
  /activat/i,
  /reset\s*(?:your\s*)?password/i,
  /set\s*(?:your\s*)?password/i,
  /complete\s*(?:your\s*)?(?:registration|signup|sign[- ]?up)/i,
  /click\s*here\s*to\s*(?:verify|confirm|activate|complete)/i,
  /(?:verify|confirm|activate)\s*(?:your\s*)?(?:email|account|identity)/i,
  /get\s*started/i,
  /create\s*(?:your\s*)?password/i,
  /sign\s*in\s*to\s*(?:verify|confirm)/i,
  /finish\s*(?:setting\s*up|registration)/i,
];

const ACTIVATION_URL_PATTERNS = [
  /(?:verify|confirm|activate|validate|auth)/i,
  /(?:reset|set|create|change)[\-_]?password/i,
  /(?:registration|signup|sign[\-_]?up)[\-_]?(?:confirm|complete|verify)/i,
  /(?:token|code|key)=[a-zA-Z0-9\-_.]+/i,
  /(?:magic[\-_]?link|one[\-_]?click|auto[\-_]?login)/i,
  /callback.*(?:verify|confirm)/i,
];

const NOT_ACTIVATION_PATTERNS = [
  /unsubscribe/i,
  /opt[\-_]?out/i,
  /preferences/i,
  /manage[\-_]?(?:email|notification|subscription)/i,
  /privacy[\-_]?policy/i,
  /terms[\-_]?(?:of[\-_]?)?(?:service|use)/i,
  /help|support|faq|contact[\-_]?us/i,
  /social.*(?:facebook|twitter|instagram|linkedin|youtube)/i,
  /(?:app|play)[\-_]?store/i,
  /download/i,
  /blog|news|article/i,
  /\.(?:png|jpg|jpeg|gif|svg|ico|css|js)(?:\?|$)/i,
];

/**
 * Resolves tracking redirects to find the actual destination URL.
 * Handles patterns like: https://click.sender.com/url?q=https://actual-site.com/verify?token=...
 */
function resolveTrackingRedirect(url: string): string {
  const redirectParams = ['q', 'url', 'redirect', 'redirect_url', 'target', 'dest',
                          'destination', 'goto', 'link', 'r', 'u', 'ref'];

  try {
    const parsed = new URL(url);

    for (const param of redirectParams) {
      const value = parsed.searchParams.get(param);
      if (value) {
        try {
          // Check if the value is a valid URL
          const resolvedUrl = new URL(
            value.startsWith('http') ? value : decodeURIComponent(value)
          );
          // Recursively resolve (up to 3 levels)
          return resolveTrackingRedirect(resolvedUrl.toString());
        } catch {
          // Not a valid URL, try URL-decoding
          try {
            const decoded = decodeURIComponent(value);
            if (decoded.startsWith('http')) {
              return resolveTrackingRedirect(decoded);
            }
          } catch { /* ignore */ }
        }
      }
    }

    // Check for encoded URL in the path
    const pathSegments = parsed.pathname.split('/');
    for (const segment of pathSegments) {
      try {
        const decoded = decodeURIComponent(segment);
        if (decoded.startsWith('http')) {
          return resolveTrackingRedirect(decoded);
        }
      } catch { /* ignore */ }
    }

  } catch { /* invalid URL, return as-is */ }

  return url;
}

function extractActivationLinks(
  links: { href: string; text: string }[],
  cleanedText: string
): ActivationLinkMatch[] {
  const results: ActivationLinkMatch[] = [];
  const seenUrls = new Set<string>();

  for (const link of links) {
    const resolvedUrl = resolveTrackingRedirect(link.href);
    const urlLower = resolvedUrl.toLowerCase();
    const textLower = link.text.toLowerCase();

    // Skip non-activation patterns
    let isBlacklisted = false;
    for (const pattern of NOT_ACTIVATION_PATTERNS) {
      if (pattern.test(urlLower) || pattern.test(textLower)) {
        isBlacklisted = true;
        break;
      }
    }
    if (isBlacklisted) continue;

    let confidence = 0;
    let source: ActivationLinkMatch['source'] = 'url_pattern';

    // Check display text
    for (const pattern of ACTIVATION_LINK_TEXT_PATTERNS) {
      if (pattern.test(link.text)) {
        confidence += 0.4;
        source = 'explicit_button';
        break;
      }
    }

    // Check URL patterns
    for (const pattern of ACTIVATION_URL_PATTERNS) {
      if (pattern.test(resolvedUrl)) {
        confidence += 0.3;
        break;
      }
    }

    // Check if URL has a token/key parameter (strong signal)
    try {
      const parsed = new URL(resolvedUrl);
      const tokenParams = ['token', 'key', 'code', 'hash', 'signature', 'confirm',
                           'verify', 'activate', 'auth', 'nonce'];
      for (const param of tokenParams) {
        const val = parsed.searchParams.get(param);
        if (val && val.length > 10) {
          confidence += 0.2;
          break;
        }
      }

      // Long path segments often contain tokens
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      for (const part of pathParts) {
        if (part.length > 30 && /^[a-zA-Z0-9\-_]+$/.test(part)) {
          confidence += 0.15;
          break;
        }
      }
    } catch { /* invalid URL */ }

    // Check surrounding text context
    const linkTextInEmail = cleanedText.indexOf(link.text);
    if (linkTextInEmail >= 0) {
      const surroundingText = cleanedText.substring(
        Math.max(0, linkTextInEmail - 100),
        Math.min(cleanedText.length, linkTextInEmail + link.text.length + 100)
      );

      for (const pattern of ACTIVATION_LINK_TEXT_PATTERNS) {
        if (pattern.test(surroundingText)) {
          confidence += 0.15;
          break;
        }
      }
    }

    if (confidence >= 0.3 && !seenUrls.has(resolvedUrl)) {
      seenUrls.add(resolvedUrl);
      results.push({
        url: resolvedUrl,
        confidence: Math.min(confidence, 0.98),
        displayText: link.text || resolvedUrl,
        source,
      });
    }
  }

  // Sort by confidence
  results.sort((a, b) => b.confidence - a.confidence);
  return results.slice(0, 5);
}

// ─── Main Extraction Pipeline ────────────────────────────────────────────────

export function extractFromEmail(rawEmailHTML: string): EmailExtractionResult {
  // Phase 1: Clean HTML
  const { text: cleanedText, links } = cleanEmailHTML(rawEmailHTML);

  // Phase 2: Extract OTPs
  const otps = extractOTPs(cleanedText);

  // Phase 3: Extract activation links
  const activationLinks = extractActivationLinks(links, cleanedText);

  return {
    otps,
    activationLinks,
    cleanedText,
    rawLinks: links,
  };
}

// ─── Test/Validation Utility ─────────────────────────────────────────────────

export function testEmailExtraction(): void {
  const testCases = [
    {
      name: "Standard OTP email",
      html: `<html><body>
        <div style="font-family: Arial;">
          <p>Hi User,</p>
          <p>Your verification code is:</p>
          <div style="font-size: 32px; font-weight: bold; text-align: center; letter-spacing: 8px;">
            847291
          </div>
          <p>This code expires in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <img src="https://tracker.example.com/pixel.gif" width="1" height="1">
        </div>
      </body></html>`,
      expectedOTP: "847291",
    },
    {
      name: "OTP with noise (order number present)",
      html: `<html><body>
        <p>Order #78234 confirmed.</p>
        <p>To verify your email, enter this code: <strong>5829</strong></p>
        <p>Reference: INV-2024-0045</p>
      </body></html>`,
      expectedOTP: "5829",
    },
    {
      name: "Activation link with tracking redirect",
      html: `<html><body>
        <p>Welcome! Please verify your email address.</p>
        <a href="https://click.marketing.net/url?q=https%3A%2F%2Fapp.example.com%2Fverify%3Ftoken%3Dabc123def456ghi789">
          Verify Email
        </a>
        <a href="https://example.com/unsubscribe">Unsubscribe</a>
      </body></html>`,
      expectedLink: "https://app.example.com/verify?token=abc123def456ghi789",
    },
    {
      name: "Spaced OTP digits",
      html: `<html><body>
        <p>Your authentication code:</p>
        <p style="font-size: 24px;">7 3 9 1 5 2</p>
      </body></html>`,
      expectedOTP: "739152",
    },
  ];

  for (const tc of testCases) {
    const result = extractFromEmail(tc.html);
    console.log(`\n📧 Test: ${tc.name}`);
    console.log(`   OTPs found: ${result.otps.map(o => `${o.code} (${(o.confidence * 100).toFixed(0)}%)`).join(', ') || 'none'}`);
    console.log(`   Links found: ${result.activationLinks.map(l => `${l.url} (${(l.confidence * 100).toFixed(0)}%)`).join(', ') || 'none'}`);

    if (tc.expectedOTP) {
      const found = result.otps.some(o => o.code === tc.expectedOTP);
      console.log(`   Expected OTP "${tc.expectedOTP}": ${found ? '✅' : '❌'}`);
    }
    if (tc.expectedLink) {
      const found = result.activationLinks.some(l => l.url === tc.expectedLink);
      console.log(`   Expected link match: ${found ? '✅' : '❌'}`);
    }
  }
}
```

---

## File 5: `manifest.json` — Chrome Extension Manifest

```json
{
  "manifest_version": 3,
  "name": "GhostFill",
  "version": "1.0.0",
  "description": "Intelligent local-ML auto-fill engine with zero cloud dependency",
  "permissions": [
    "activeTab",
    "storage"
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["dist/content/main.js"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ],
  "background": {
    "service_worker": "dist/background/service_worker.js",
    "type": "module"
  },
  "web_accessible_resources": [
    {
      "resources": [
        "models/ghostfill_classifier_int8.onnx",
        "wasm/ort-wasm.wasm",
        "wasm/ort-wasm-simd.wasm",
        "wasm/ort-wasm-threaded.wasm",
        "wasm/ort-wasm-simd-threaded.wasm"
      ],
      "matches": ["<all_urls>"]
    }
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

## File 6: `src/content/main.ts` — Content Script Entry Point

```typescript
/**
 * GhostFill Content Script Entry Point
 * Orchestrates DOM scanning, ML inference, and auto-fill coordination.
 */

import { GhostFillInferenceEngine, ClassificationResult, initGhostFill } from './inference_engine';

interface UserProfile {
  email?: string;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phone?: string;
}

// ─── Auto-Fill Logic ─────────────────────────────────────────────────────────

function setInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  // Use native input setter to properly trigger React/Vue/Angular change events
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  const setter = element.tagName === 'TEXTAREA'
    ? nativeTextAreaValueSetter
    : nativeInputValueSetter;

  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }

  // Dispatch events that frameworks listen for
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

async function autoFillFields(
  results: ClassificationResult[],
  profile: UserProfile
): Promise<number> {
  let filledCount = 0;

  for (const result of results) {
    const el = result.element as HTMLInputElement;

    // Skip if already filled
    if (el.value && el.value.trim().length > 0) continue;

    let value: string | undefined;

    switch (result.predictedClass) {
      case 'Email':
        value = profile.email;
        break;
      case 'Username':
        value = profile.username || profile.email;
        break;
      case 'Password':
      case 'Target_Password_Confirm':
        value = profile.password;
        break;
      case 'First_Name':
        value = profile.firstName;
        break;
      case 'Last_Name':
        value = profile.lastName;
        break;
      case 'Full_Name':
        value = profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
        break;
      case 'Phone':
        value = profile.phone;
        break;
      case 'OTP':
        // OTPs come from email extraction, not profile
        break;
      case 'Unknown':
        break;
    }

    if (value) {
      setInputValue(el, value);
      filledCount++;

      // Visual feedback
      el.style.transition = 'background-color 0.3s ease';
      el.style.backgroundColor = '#e8f5e9';
      setTimeout(() => {
        el.style.backgroundColor = '';
      }, 1500);
    }
  }

  return filledCount;
}

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GHOSTFILL_AUTOFILL') {
    const profile: UserProfile = message.profile;

    (async () => {
      try {
        const engine = await initGhostFill();
        const candidates = await engine.getAutoFillCandidates();
        const filled = await autoFillFields(candidates, profile);
        sendResponse({ success: true, filledCount: filled });
      } catch (error) {
        console.error('[GhostFill] Auto-fill error:', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true; // Keep message channel open for async response
  }

  if (message.type === 'GHOSTFILL_SCAN') {
    (async () => {
      try {
        const engine = await initGhostFill();
        const results = await engine.classifyPage();
        sendResponse({
          success: true,
          fields: results.map(r => ({
            class: r.predictedClass,
            confidence: r.confidence,
            isVisible: r.isVisible,
            isHoneypot: r.isHoneypot,
            elementId: r.element.id,
            elementName: (r.element as HTMLInputElement).name,
          })),
        });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true;
  }

  if (message.type === 'GHOSTFILL_FILL_OTP' && message.otp) {
    (async () => {
      try {
        const engine = await initGhostFill();
        const results = await engine.classifyPage();
        const otpFields = results.filter(r =>
          r.predictedClass === 'OTP' && r.isVisible && !r.isHoneypot
        );

        let filled = 0;
        for (const field of otpFields) {
          const el = field.element as HTMLInputElement;
          const maxLen = el.maxLength;

          if (maxLen === 1) {
            // Split OTP: fill one digit at a time
            // Find all OTP fields and fill sequentially
            const allOTPFields = results
              .filter(r => r.predictedClass === 'OTP' && r.isVisible)
              .map(r => r.element as HTMLInputElement)
              .sort((a, b) => {
                const aRect = a.getBoundingClientRect();
                const bRect = b.getBoundingClientRect();
                return aRect.left - bRect.left;
              });

            for (let i = 0; i < Math.min(allOTPFields.length, message.otp.length); i++) {
              setInputValue(allOTPFields[i], message.otp[i]);
              filled++;
            }
            break; // All split fields handled
          } else {
            setInputValue(el, message.otp);
            filled++;
          }
        }

        sendResponse({ success: true, filledCount: filled });
      } catch (error) {
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true;
  }
});

// ─── Initialize ──────────────────────────────────────────────────────────────
console.log('[GhostFill] Content script loaded');
```

---

## Project Structure

```
ghostfill/
├── manifest.json
├── package.json
├── tsconfig.json
├── webpack.config.js
│
├── models/
│   └── ghostfill_classifier_int8.onnx    (5-9MB quantized model)
│
├── wasm/
│   ├── ort-wasm.wasm
│   ├── ort-wasm-simd.wasm
│   └── ...                                (ONNX Runtime Web WASM binaries)
│
├── training/
│   └── train_ghostfill_model.py           (Training pipeline)
│
├── src/
│   ├── content/
│   │   ├── main.ts                        (Content script entry)
│   │   ├── extractor.ts                   (64-dim feature extractor)
│   │   └── inference_engine.ts            (ONNX Runtime Web inference)
│   │
│   ├── email/
│   │   └── email_extractor.ts             (OTP & activation link extraction)
│   │
│   └── background/
│       └── service_worker.ts              (Extension coordination)
│
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
│
└── dist/                                  (Compiled output)
```

---

## Key Engineering Decisions

### Why Character-level CNN instead of a Transformer?

1. **Size**: A character-level CNN with multi-scale kernels achieves comparable text understanding to a small Transformer for this domain, at ~10x fewer parameters. No pretrained word embeddings needed (which would blow past 9MB alone).

2. **Obfuscation resilience**: Character n-grams catch partial matches like `"passw"`, `"emai"`, `"usr_nm"` that word-level models miss entirely. When React hashes class names to `"sc-bwzfXH"`, the character CNN learns these aren't informative, while word models would hallucinate.

3. **Vocabulary**: Only 98 tokens (ASCII range) vs thousands for subword tokenizers. The embedding matrix is `98 × 32 = 3,136` parameters instead of `30,000 × 128 = 3.8M`.

### Why Shared Text Encoder + Specialized Projections?

Three separate text channels (primary label, nearby context, attribute signals) carry different types of information. Sharing the character CNN encoder (which learns generic character patterns) then applying lightweight per-channel projection heads (which learn channel-specific semantics) gives 3× the representational diversity at only ~1.3× the parameter cost of a single encoder.

### Why Focal Loss?

Password vs Password_Confirm is the hardest classification boundary (identical `type="password"`, nearly identical context). Focal Loss with `γ=2.0` down-weights easy examples (Email fields with `type="email"` and `autocomplete="email"`) and focuses training on these hard boundaries, effectively spending more "capacity budget" on the distinctions that matter.

### Why ONNX Runtime Web instead of TensorFlow.js?

ONNX Runtime Web with WASM backend provides 2-4× faster inference than TF.js for models of this architecture. It also supports INT8 quantized models natively, which TF.js does not. The `wasm-simd` backend leverages hardware SIMD instructions available in all modern browsers.

### Memory Safety

Every tensor created for inference is wrapped in try/finally blocks that guarantee `dispose()` is called. The `SessionManager` is a singleton that prevents multiple model loads. The `inferenceQueue` serializes concurrent calls to prevent WASM OOM conditions in memory-constrained content scripts.



