/**
 * extractor.ts — GhostFill DOM Feature Extractor
 * Produces an 8-channel text tensor & a 64-dimensional structural vector
 * per <input> element. Handles Shadow DOM, floating labels, split OTPs, 
 * advanced keyword detection, and form context analysis.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

export const CHAR_VOCAB_SIZE = 256;
export const MAX_TEXT_LEN = 80;
export const NUM_TEXT_CHANNELS = 8;
export const NUM_STRUCTURAL_FEATURES = 128;

export const FIELD_CLASSES = [
  "username", "email", "password", "confirm_password",
  "otp", "phone", "submit_button", "honeypot", "unknown"
];

export interface RawFieldFeatures {
  textChannels: Int32Array[];     // 8 channels, each length 80
  structural: Float32Array;       // length 128
  element: HTMLInputElement | HTMLTextAreaElement;
  isVisible: boolean;
}

// ─── Tokenization ─────────────────────────────────────────────────────────

function encodeText(raw: string): Int32Array {
  const s = (raw || "").toLowerCase().trim().slice(0, MAX_TEXT_LEN);
  const encoded = new Int32Array(MAX_TEXT_LEN);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    encoded[i] = code < CHAR_VOCAB_SIZE ? code : 1; // 1 = UNK, 0 = PAD
  }
  return encoded;
}

// ─── Visibility & Honeypot Heuristics ──────────────────────────────────────

interface VisibilityInfo {
  isVisible: boolean;
  isOpacityZero: boolean;
  isOffscreen: boolean;
  isClipped: boolean;
  isAriaHidden: boolean;
  width: number;
  height: number;
}

function analyzeVisibility(el: HTMLElement): VisibilityInfo {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  
  const isOpacityZero = parseFloat(cs.opacity || "1") < 0.05;
  const isOffscreen = 
    rect.right < 0 || rect.bottom < 0 || 
    rect.left > window.innerWidth + 50 || 
    rect.top > window.innerHeight + 50 ||
    parseInt(cs.left || "0", 10) < -900 || 
    parseInt(cs.top || "0", 10) < -900;
    
  const isClipped = 
    cs.clipPath === "inset(100%)" || 
    cs.clip === "rect(0px, 0px, 0px, 0px)" ||
    (rect.width === 0 && cs.overflow === "hidden");
    
  const isAriaHidden = 
    el.getAttribute("aria-hidden") === "true" ||
    el.closest("[aria-hidden='true']") !== null ||
    el.hasAttribute("hidden");
    
  const isVisible = 
    cs.display !== "none" &&
    cs.visibility !== "hidden" &&
    !isOpacityZero &&
    !isOffscreen &&
    !isClipped &&
    !isAriaHidden &&
    rect.width > 2 &&
    rect.height > 2;

  return { isVisible, isOpacityZero, isOffscreen, isClipped, isAriaHidden, width: rect.width, height: rect.height };
}

function computeHoneypotScore(el: HTMLElement): number {
  let score = 0;
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  
  if (parseFloat(cs.opacity) < 0.1) {score += 0.3;}
  if (rect.width < 5 && rect.height < 5) {score += 0.25;}
  if (cs.position === 'absolute' && (parseFloat(cs.left) < -100 || parseFloat(cs.top) < -100)) {score += 0.35;}
  if (el.tabIndex === -1 && rect.width < 10) {score += 0.15;}
  
  const nameOrId = (((el as HTMLInputElement).name || '') + (el.id || '')).toLowerCase();
  if (/honey|pot|trap|gotcha|catch|bot/i.test(nameOrId)) {score += 0.5;}
  
  return Math.min(score, 1.0);
}

// ─── Spatial Floating Label Discovery ──────────────────────────────────────

function findFloatingLabel(el: HTMLElement): string {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) {return "";}

  const searchRect = {
    top: rect.top - 30,
    bottom: rect.bottom + 10,
    left: rect.left - 20,
    right: rect.right + 20,
  };

  const candidates: { text: string; distance: number }[] = [];
  const root = el.closest('form') || el.parentElement?.parentElement || document.body;
  const nearbyEls = root.querySelectorAll("label, span, div, p, legend, strong");

  for (const candidate of Array.from(nearbyEls)) {
    if (candidate === el || candidate.contains(el) || candidate.querySelector('input, select, textarea')) {continue;}
    
    const cRect = candidate.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0 || cRect.height > 80) {continue;}

    const overlapsHoriz = cRect.left < searchRect.right && cRect.right > searchRect.left;
    const overlapsVert = cRect.top < searchRect.bottom && cRect.bottom > searchRect.top;

    if (overlapsHoriz && overlapsVert) {
      const text = (candidate.textContent || "").trim();
      if (text.length > 0 && text.length < 100) {
        const dx = Math.abs((cRect.left + cRect.right) / 2 - (rect.left + rect.right) / 2);
        const dy = Math.abs((cRect.top + cRect.bottom) / 2 - (rect.top + rect.bottom) / 2);
        candidates.push({ text, distance: dx + dy * 0.5 });
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.length > 0 ? candidates[0].text : "";
}

// ─── Explicit Label Discovery ──────────────────────────────────────────────

function findExplicitLabel(el: HTMLElement): string {
  if (el.id) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) {return (label.textContent || "").trim();}
  }

  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    return (clone.textContent || "").trim();
  }

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const parts = labelledBy.split(/\s+/).map((refId) => {
      const refEl = root.getElementById(refId);
      return refEl ? (refEl.textContent || "").trim() : "";
    });
    return parts.filter(Boolean).join(" ");
  }

  return "";
}

// ─── Nearby Text Context ───────────────────────────────────────────────────

function findNearbyText(el: HTMLElement): string {
  const fragments: string[] = [];
  let sib: Element | null = el.previousElementSibling;
  let sibCount = 0;
  
  while (sib && sibCount < 3) {
    if (!sib.querySelector("input, select, textarea")) {
      const t = (sib.textContent || "").trim();
      if (t.length > 0 && t.length < 150) {fragments.push(t);}
    }
    sib = sib.previousElementSibling;
    sibCount++;
  }

  const parent = el.parentElement;
  if (parent) {
    let pSib = parent.previousElementSibling;
    let pCount = 0;
    while (pSib && pCount < 2) {
      if (!pSib.querySelector("input")) {
        const t = (pSib.textContent || "").trim();
        if (t.length > 0 && t.length < 150) {fragments.push(t);}
      }
      pSib = pSib.previousElementSibling;
      pCount++;
    }
  }

  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    describedBy.split(/\s+/).forEach((refId) => {
      const refEl = root.getElementById(refId);
      if (refEl) {
        const t = (refEl.textContent || "").trim();
        if (t) {fragments.push(t);}
      }
    });
  }

  return fragments.join(" ").slice(0, 300);
}

// ─── Form Heading & Action ─────────────────────────────────────────────────

function findFormHeading(el: HTMLElement): string {
  const form = el.closest("form, [role='form']");
  const container = form || el.closest("div, section");
  if (!container) {return "";}

  const headings = container.querySelectorAll("h1, h2, h3, h4, [role='heading'], legend");
  for (const h of Array.from(headings)) {
    const t = (h.textContent || "").trim();
    if (t.length > 0 && t.length < 120) {return t;}
  }
  return "";
}

function analyzeSubmitButton(el: HTMLElement): { dist: number; actionText: string; formAction: string } {
  const form = el.closest("form") || document.body;
  const buttons = form.querySelectorAll('button, input[type="submit"], [role="button"], a[class*="btn"]');
  
  const elRect = el.getBoundingClientRect();
  let closestDist = 9999;
  let closestText = "";

  buttons.forEach((btn) => {
    const btnRect = btn.getBoundingClientRect();
    if (btnRect.width === 0) {return;}
    const dist = Math.sqrt(Math.pow(elRect.left - btnRect.left, 2) + Math.pow(elRect.top - btnRect.top, 2));
    if (dist < closestDist) {
      closestDist = dist;
      closestText = ((btn as HTMLElement).textContent || (btn as HTMLInputElement).value || "").trim().toLowerCase();
    }
  });

  return { 
    dist: Math.min(closestDist / 1000, 1.0),
    actionText: closestText.substring(0, 50),
    formAction: ((form as HTMLFormElement).action || "").toLowerCase()
  };
}

// ─── Advanced Context & Sibling Analysis ───────────────────────────────────

interface SiblingInfo {
  formFieldCount: number;
  passwordFieldCount: number;
  fieldIndex: number;
  distanceToPrevPassword: number;
  hasEmailSibling: boolean;
  hasUsernameSibling: boolean;
}

function analyzeSiblings(el: HTMLInputElement | HTMLTextAreaElement): SiblingInfo {
  const form = el.closest('form') || el.closest("[role='form']") || el.parentElement?.closest("div, section") || document.body;
  const inputs = Array.from(
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea'
    )
  );

  let passwordFieldCount = 0;
  let hasEmailSibling = false;
  let hasUsernameSibling = false;
  let lastPasswordIdx = -1;
  const fieldIndex = inputs.indexOf(el);

  inputs.forEach((inp, idx) => {
    const type = (inp as HTMLInputElement).type?.toLowerCase();
    const nameId = ((inp as HTMLInputElement).name || '') + (inp.id || '');
    if (type === 'password') {
      passwordFieldCount++;
      if (idx < fieldIndex) {lastPasswordIdx = idx;}
    }
    if (type === 'email' || /email/i.test(nameId) && inp !== el) {hasEmailSibling = true;}
    if (/user/i.test(nameId) && inp !== el) {hasUsernameSibling = true;}
  });

  let distanceToPrevPassword = -1;
  if (lastPasswordIdx >= 0 && fieldIndex >= 0) {
    distanceToPrevPassword = fieldIndex - lastPasswordIdx;
  }

  return {
    formFieldCount: inputs.length,
    passwordFieldCount,
    fieldIndex: fieldIndex >= 0 ? fieldIndex : 0,
    distanceToPrevPassword,
    hasEmailSibling,
    hasUsernameSibling
  };
}

interface OTPGroupInfo {
  isSplitOTP: boolean;
  groupSize: number;
  positionInGroup: number;
}

function detectSplitOTP(el: HTMLInputElement | HTMLTextAreaElement): OTPGroupInfo {
  const result: OTPGroupInfo = { isSplitOTP: false, groupSize: 0, positionInGroup: 0 };
  const maxLen = (el as HTMLInputElement).maxLength;
  if (maxLen !== 1 && maxLen !== 2) {return result;}

  const rect = el.getBoundingClientRect();
  if (rect.width === 0) {return result;}

  // Intelligence 2.0: Vision-like Global Alignment Scan
  // Instead of just siblings, we look for any input on the same horizontal plane.
  const root = el.closest('form') || el.closest('[role="form"]') || document.body;
  const potentialSiblings = Array.from(root.querySelectorAll<HTMLInputElement>('input')).filter(inp => {
    if (inp.maxLength !== maxLen) {return false;}
    
    const r = inp.getBoundingClientRect();
    if (r.width === 0) {return false;}
    
    // Geometry check: same horizontal band (+/- 15px) and similar height
    const isSameRow = Math.abs(r.top - rect.top) < 15;
    const isSimilarHeight = Math.abs(r.height - rect.height) < (rect.height * 0.25);
    const isRelativelyClose = Math.abs(r.left - rect.left) < 500; // Guard against distant fields
    
    return isSameRow && isSimilarHeight && isRelativelyClose;
  });

  if (potentialSiblings.length >= 3 && potentialSiblings.length <= 10) {
    // Sort by visual X position (left-to-right)
    potentialSiblings.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    
    result.isSplitOTP = true;
    result.groupSize = potentialSiblings.length;
    result.positionInGroup = potentialSiblings.indexOf(el as HTMLInputElement);
  }

  return result;
}

// ─── Encoding Maps ─────────────────────────────────────────────────────────

const INPUT_TYPE_MAP: Record<string, number> = {
  'text': 1, 'email': 2, 'password': 3, 'tel': 4, 'number': 5,
  'url': 6, 'search': 7, 'textarea': 8
};

const AUTOCOMPLETE_MAP: Record<string, number> = {
  'email': 1, 'username': 2, 'current-password': 3, 'new-password': 4,
  'given-name': 5, 'family-name': 6, 'name': 7, 'tel': 8, 'one-time-code': 9,
  'off': 10
};

// ─── Main Extraction Function ──────────────────────────────────────────────

export function extractFeatures(el: HTMLInputElement | HTMLTextAreaElement): RawFieldFeatures {
  const placeholder = el.placeholder || "";
  const ariaLabel = (el.getAttribute("aria-label") || "") + " " + (el.getAttribute("aria-placeholder") || "");
  const explicitLabel = findExplicitLabel(el);
  const nameAttr = el.name || "";
  const idAttr = el.id || "";
  const autocompleteAttr = el.autocomplete || el.getAttribute("autocomplete") || "";
  const floatingLabel = findFloatingLabel(el);
  const nearbyText = findNearbyText(el);
  const formHeading = findFormHeading(el);

  // 1. Text Channels (8 channels)
  const textChannels = [
    encodeText(placeholder),                          // ch0
    encodeText(ariaLabel),                            // ch1
    encodeText(explicitLabel),                        // ch2
    encodeText(nameAttr + " " + idAttr),              // ch3
    encodeText(autocompleteAttr),                     // ch4
    encodeText(floatingLabel),                        // ch5
    encodeText(nearbyText),                           // ch6
    encodeText(formHeading),                          // ch7
  ];

  // 2. Structural Features
  const vec = new Float32Array(NUM_STRUCTURAL_FEATURES);
  const vis = analyzeVisibility(el);
  const hpScore = computeHoneypotScore(el);
  const submitInfo = analyzeSubmitButton(el);
  const sibInfo = analyzeSiblings(el);
  const otpInfo = detectSplitOTP(el);
  
  const type = el.tagName.toLowerCase() === 'textarea' ? 'textarea' : el.type.toLowerCase();
  
  // Basic properties [0-11]
  vec[0] = (INPUT_TYPE_MAP[type] || 0) / 10.0;
  vec[1] = (AUTOCOMPLETE_MAP[autocompleteAttr.toLowerCase().trim()] || 0) / 10.0;
  const maxL = (el as HTMLInputElement).maxLength > 0 ? (el as HTMLInputElement).maxLength : -1;
  vec[2] = maxL > 0 ? Math.min(maxL, 100) / 100 : 0;
  vec[3] = maxL === 1 || maxL === 2 ? 1 : 0;
  vec[4] = el.required ? 1 : 0;
  vec[5] = el.readOnly ? 1 : 0;
  vec[6] = el.disabled ? 1 : 0;
  
  const pattern = el.getAttribute("pattern");
  vec[7] = pattern ? 1 : 0;
  vec[8] = pattern && /^\[?\\?d|0-9/.test(pattern) ? 1 : 0;
  
  const inputMode = (el.inputMode || el.getAttribute("inputmode") || "").toLowerCase();
  vec[9] = inputMode === "numeric" || inputMode === "decimal" ? 1 : 0;
  vec[10] = inputMode === "tel" ? 1 : 0;
  vec[11] = inputMode === "email" ? 1 : 0;

  // Visibility & Honeypot [12-16]
  vec[12] = vis.isVisible ? 1 : 0;
  vec[13] = vis.isOpacityZero ? 1 : 0;
  vec[14] = vis.isOffscreen ? 1 : 0;
  vec[15] = vis.isAriaHidden ? 1 : 0;
  vec[16] = hpScore;

  // Dimensions [17-19]
  vec[17] = Math.min(vis.width, 800) / 800;
  vec[18] = Math.min(vis.height, 100) / 100;
  vec[19] = vis.height > 0 ? Math.min(vis.width / vis.height, 20) / 20 : 0;

  // Submit Context [20-24]
  vec[20] = submitInfo.dist;
  vec[21] = /\b(log[_-]?in|sign[_-]?in|authenticate|connexion|iniciar[_-]?sesión)\b/i.test(submitInfo.actionText) ? 1 : 0;
  vec[22] = /\b(sign[_-]?up|register|create[_-]?account|join|inscription|registrarse)\b/i.test(submitInfo.actionText) ? 1 : 0;
  vec[23] = /\b(submit|continue|next|verify|confirm|send|go|enter|proceed)\b/i.test(submitInfo.actionText) ? 1 : 0;
  vec[24] = /log|sign/i.test(submitInfo.formAction) ? 1 : 0;

  // Shadow DOM [25]
  vec[25] = el.getRootNode() instanceof ShadowRoot ? 1 : 0;

  const allText = textChannels.map(ch => {
    let s = "";
    for (let i = 0; i < ch.length; i++) {s += String.fromCharCode(ch[i]);}
    return s;
  }).join(" ").toLowerCase();
  
  // Keyword triggers (flags 26-34) with reliable regex bounds
  vec[26] = /\b(e[-_]?mail|correo|courriel|email[-_]?addr(?:ess)?)\b/i.test(allText) ? 1 : 0;
  vec[27] = /\b(user[-_]?name|login[-_]?id|screen[-_]?name|handle|acct[-_]?name|identifiant|usuario)\b/i.test(allText) ? 1 : 0;
  vec[28] = /\b(pass[-_]?word|pwd|contraseña|mot[-_]?de[-_]?passe|passwort|senha)\b/i.test(allText) ? 1 : 0;
  vec[29] = /\b(confirm[-_]?pass|re[-_]?(?:enter|type)[-_]?pass|verify[-_]?pass|repeat[-_]?pass|pass[-_]?confirm|password[-_]?again)\b/i.test(allText) ? 1 : 0;
  vec[30] = /\b(first[-_]?name|given[-_]?name|f[-_]?name|prénom|nombre|vorname)\b/i.test(allText) ? 1 : 0;
  vec[31] = /\b(last[-_]?name|sur[-_]?name|family[-_]?name|l[-_]?name|nom[-_]?(?:de[-_]?)?famille|apellido|nachname)\b/i.test(allText) ? 1 : 0;
  vec[32] = /\b(full[-_]?name|your[-_]?name|name|display[-_]?name|nom[-_]?complet|nombre[-_]?completo)\b/i.test(allText) ? 1 : 0;
  vec[33] = /\b(phone|tel(?:ephone)?|mobile|cell|número|numéro|telefon|sms[-_]?number)\b/i.test(allText) ? 1 : 0;
  vec[34] = /\b(otp|verif(?:y|ication)[-_]?code|security[-_]?code|one[-_]?time|auth(?:entication)?[-_]?code|pin[-_]?code|mfa[-_]?code|2fa[-_]?code|token|passcode|code[-_]?sent)\b/i.test(allText) ? 1 : 0;

  // Split OTP Advanced Details [35-37]
  vec[35] = otpInfo.isSplitOTP ? 1 : 0;
  vec[36] = otpInfo.groupSize / 8.0;
  vec[37] = otpInfo.groupSize > 0 ? Math.max(0, otpInfo.positionInGroup) / otpInfo.groupSize : 0;

  // Form / Siblings Context [38-44]
  vec[38] = Math.min(sibInfo.formFieldCount, 20) / 20.0;
  vec[39] = Math.min(sibInfo.passwordFieldCount, 5) / 5.0;
  vec[40] = sibInfo.formFieldCount > 0 ? sibInfo.fieldIndex / sibInfo.formFieldCount : 0;
  vec[41] = sibInfo.hasEmailSibling ? 1 : 0;
  vec[42] = sibInfo.hasUsernameSibling ? 1 : 0;
  vec[43] = sibInfo.distanceToPrevPassword >= 0 ? Math.min(sibInfo.distanceToPrevPassword, 5) / 5.0 : 0;
  vec[44] = el.closest('form') ? 1 : 0; // isInForm

  // ── Extended Features [45-49] (Upgrade 5) ─────────────
  
  // 45: tabIndex normalised (0-10)
  const tabIdx = el.tabIndex;
  vec[45] = tabIdx >= 0 ? Math.min(tabIdx, 10) / 10.0 : 0.5; // 0.5 for default -1

  // 46: ARIA roles
  const role = el.getAttribute('role')?.toLowerCase();
  vec[46] = (role === 'textbox' || role === 'spinbutton' || role === 'searchbox') ? 1 : 0;

  // 47: Sibling OTP score from heuristics
  vec[47] = Math.min((el.id.includes('otp') || el.name.includes('otp') ? 0.5 : 0) + 
            (sibInfo.formFieldCount < 3 ? 0.3 : 0), 1.0);

  // 48: Dataset key count
  vec[48] = Math.min(Object.keys(el.dataset).length, 5) / 5.0;

  // 49: Is inside a fieldset or div with "verification" class
  const context = el.closest('fieldset, [class*="verif" i], [class*="otp" i]');
  vec[49] = context ? 1 : 0;

  // ── Elite Features [50-55] (Intelligence 2.0) ───────────
  
  // 50: Action Proximity (Distance to closest submit/verify button)
  vec[50] = submitInfo.dist; // Already normalized 0-1
  
  // 51: Horizontal Centering (Is it in the middle of the screen?)
  const centerX = (vis.width / 2) + el.getBoundingClientRect().left;
  vec[51] = Math.abs(window.innerWidth / 2 - centerX) / (window.innerWidth / 2);
  vec[51] = 1.0 - Math.min(vec[51], 1.0); // 1.0 = perfectly centered

  // 52: Vertical Position (Is it in the top/middle of the viewport?)
  const centerY = (vis.height / 2) + el.getBoundingClientRect().top;
  vec[52] = Math.min(Math.max(centerY / window.innerHeight, 0), 1.0);

  // 53: Semantic Page Context (OTP/Auth keywords in document)
  const docText = (document.title + " " + (document.querySelector('h1')?.textContent || "")).toLowerCase();
  vec[53] = /otp|verif|code|auth|sign[-_\s]?in|login/i.test(docText) ? 1.0 : 0.0;

  // 54: Container Sibling Density (How many inputs in the same immediate parent?)
  const parentInputs = el.parentElement?.querySelectorAll('input')?.length || 1;
  vec[54] = Math.min(parentInputs, 10) / 10.0;

  // 55: Topology Score (Aspect ratio + consistency)
  const aspect = vis.height > 0 ? vis.width / vis.height : 0;
  // OTP fields are often square (aspect ~1) or very wide (aspect > 5)
  vec[55] = (aspect > 0.8 && aspect < 1.2) || (aspect > 4) ? 1.0 : 0.5;

  // Elements 56-63 remain 0.0 for future extensions

  return { textChannels, structural: vec, element: el, isVisible: vis.isVisible };
}

export interface NeighborInfo {
  name: string;
  id: string;
  type: string;
}

export interface ContextualFieldFeatures extends RawFieldFeatures {
  topology: {
    domain: string;
    formAction: string;
    prevNeighbor: NeighborInfo | null;
    nextNeighbor: NeighborInfo | null;
    isInsideShadow: boolean;
    url: string;
  };
}

/**
 * Enhanced extractor for Continuous Learning.
 * Returns the field features PLUS contextual "topology" data (neighbors, form info).
 */
export function extractContextualFeatures(el: HTMLInputElement | HTMLTextAreaElement): ContextualFieldFeatures {
  const base = extractFeatures(el);
  const form = el.closest('form, [role="form"]');
  const allInputs = Array.from(document.querySelectorAll('input, textarea'));
  const idx = allInputs.indexOf(el);

  return {
    ...base,
    topology: {
      domain: window.location.hostname,
      formAction: (form as HTMLFormElement)?.action || '',
      prevNeighbor: idx > 0 ? {
        name: (allInputs[idx-1] as any).name || '',
        id: allInputs[idx-1].id || '',
        type: (allInputs[idx-1] as any).type || ''
      } : null,
      nextNeighbor: idx < allInputs.length - 1 ? {
        name: (allInputs[idx+1] as any).name || '',
        id: allInputs[idx+1].id || '',
        type: (allInputs[idx+1] as any).type || ''
      } : null,
      isInsideShadow: el.getRootNode() instanceof ShadowRoot,
      url: window.location.href
    }
  };
}

// ─── Batch Collection ──────────────────────────────────────────────────────

const COLLECT_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
  ':not([type="reset"]):not([type="image"]):not([type="file"])' +
  ':not([type="radio"]):not([type="checkbox"]), textarea';

/**
 * Collect features for all fillable fields in the document (including shadow DOM).
 * Uses a targeted CSS selector to avoid the O(n) querySelectorAll("*") full-DOM scan
 * that was the original implementation.
 */
export function collectAllFields(root: Document | ShadowRoot = document): RawFieldFeatures[] {
  const results: RawFieldFeatures[] = [];

  // Query only fillable elements directly — O(k) where k << n
  for (const el of Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(COLLECT_SELECTOR))) {
    results.push(extractFeatures(el));
  }

  // Recurse into shadow roots found in this root using TreeWalker (O(n) but no array allocation)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.nextNode();
  while (node) {
    if ((node as Element).shadowRoot) {
      results.push(...collectAllFields((node as Element).shadowRoot!));
    }
    node = walker.nextNode();
  }

  return results;
}


