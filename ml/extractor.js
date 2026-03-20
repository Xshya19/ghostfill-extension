"use strict";
/**
 * extractor.ts — GhostFill DOM Feature Extractor
 * Produces an 8-channel text tensor & a 64-dimensional structural vector
 * per <input> element. Handles Shadow DOM, floating labels, split OTPs,
 * advanced keyword detection, and form context analysis.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIELD_CLASSES = exports.NUM_STRUCTURAL_FEATURES = exports.NUM_TEXT_CHANNELS = exports.MAX_TEXT_LEN = exports.CHAR_VOCAB_SIZE = void 0;
exports.extractFeatures = extractFeatures;
exports.collectAllFields = collectAllFields;
// ─── Constants ─────────────────────────────────────────────────────────────
exports.CHAR_VOCAB_SIZE = 256;
exports.MAX_TEXT_LEN = 80;
exports.NUM_TEXT_CHANNELS = 8;
exports.NUM_STRUCTURAL_FEATURES = 64;
exports.FIELD_CLASSES = [
    "Email", "Username", "Password", "Target_Password_Confirm",
    "First_Name", "Last_Name", "Full_Name", "Phone", "OTP", "Unknown"
];
// ─── Tokenization ─────────────────────────────────────────────────────────
function encodeText(raw) {
    const s = (raw || "").toLowerCase().trim().slice(0, exports.MAX_TEXT_LEN);
    const encoded = new Int32Array(exports.MAX_TEXT_LEN);
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        encoded[i] = code < exports.CHAR_VOCAB_SIZE ? code : 1; // 1 = UNK, 0 = PAD
    }
    return encoded;
}
function analyzeVisibility(el) {
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const isOpacityZero = parseFloat(cs.opacity || "1") < 0.05;
    const isOffscreen = rect.right < 0 || rect.bottom < 0 ||
        rect.left > window.innerWidth + 50 ||
        rect.top > window.innerHeight + 50 ||
        parseInt(cs.left || "0") < -900 ||
        parseInt(cs.top || "0") < -900;
    const isClipped = cs.clipPath === "inset(100%)" ||
        cs.clip === "rect(0px, 0px, 0px, 0px)" ||
        (rect.width === 0 && cs.overflow === "hidden");
    const isAriaHidden = el.getAttribute("aria-hidden") === "true" ||
        el.closest("[aria-hidden='true']") !== null ||
        el.hasAttribute("hidden");
    const isVisible = cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        !isOpacityZero &&
        !isOffscreen &&
        !isClipped &&
        !isAriaHidden &&
        rect.width > 2 &&
        rect.height > 2;
    return { isVisible, isOpacityZero, isOffscreen, isClipped, isAriaHidden, width: rect.width, height: rect.height };
}
function computeHoneypotScore(el) {
    let score = 0;
    const cs = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (parseFloat(cs.opacity) < 0.1)
        score += 0.3;
    if (rect.width < 5 && rect.height < 5)
        score += 0.25;
    if (cs.position === 'absolute' && (parseFloat(cs.left) < -100 || parseFloat(cs.top) < -100))
        score += 0.35;
    if (el.tabIndex === -1 && rect.width < 10)
        score += 0.15;
    const nameOrId = ((el.name || '') + (el.id || '')).toLowerCase();
    if (/honey|pot|trap|gotcha|catch|bot/i.test(nameOrId))
        score += 0.5;
    return Math.min(score, 1.0);
}
// ─── Spatial Floating Label Discovery ──────────────────────────────────────
function findFloatingLabel(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0)
        return "";
    const searchRect = {
        top: rect.top - 30,
        bottom: rect.bottom + 10,
        left: rect.left - 20,
        right: rect.right + 20,
    };
    const candidates = [];
    const root = el.closest('form') || el.parentElement?.parentElement || document.body;
    const nearbyEls = root.querySelectorAll("label, span, div, p, legend, strong");
    for (const candidate of Array.from(nearbyEls)) {
        if (candidate === el || candidate.contains(el) || candidate.querySelector('input, select, textarea'))
            continue;
        const cRect = candidate.getBoundingClientRect();
        if (cRect.width === 0 || cRect.height === 0 || cRect.height > 80)
            continue;
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
function findExplicitLabel(el) {
    if (el.id) {
        const root = el.getRootNode();
        const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label)
            return (label.textContent || "").trim();
    }
    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
        const clone = wrappingLabel.cloneNode(true);
        clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
        return (clone.textContent || "").trim();
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
        const root = el.getRootNode();
        const parts = labelledBy.split(/\s+/).map((refId) => {
            const refEl = root.getElementById(refId);
            return refEl ? (refEl.textContent || "").trim() : "";
        });
        return parts.filter(Boolean).join(" ");
    }
    return "";
}
// ─── Nearby Text Context ───────────────────────────────────────────────────
function findNearbyText(el) {
    const fragments = [];
    let sib = el.previousElementSibling;
    let sibCount = 0;
    while (sib && sibCount < 3) {
        if (!sib.querySelector("input, select, textarea")) {
            const t = (sib.textContent || "").trim();
            if (t.length > 0 && t.length < 150)
                fragments.push(t);
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
                if (t.length > 0 && t.length < 150)
                    fragments.push(t);
            }
            pSib = pSib.previousElementSibling;
            pCount++;
        }
    }
    const describedBy = el.getAttribute("aria-describedby");
    if (describedBy) {
        const root = el.getRootNode();
        describedBy.split(/\s+/).forEach((refId) => {
            const refEl = root.getElementById(refId);
            if (refEl) {
                const t = (refEl.textContent || "").trim();
                if (t)
                    fragments.push(t);
            }
        });
    }
    return fragments.join(" ").slice(0, 300);
}
// ─── Form Heading & Action ─────────────────────────────────────────────────
function findFormHeading(el) {
    const form = el.closest("form, [role='form']");
    const container = form || el.closest("div, section");
    if (!container)
        return "";
    const headings = container.querySelectorAll("h1, h2, h3, h4, [role='heading'], legend");
    for (const h of Array.from(headings)) {
        const t = (h.textContent || "").trim();
        if (t.length > 0 && t.length < 120)
            return t;
    }
    return "";
}
function analyzeSubmitButton(el) {
    const form = el.closest("form") || document.body;
    const buttons = form.querySelectorAll('button, input[type="submit"], [role="button"], a[class*="btn"]');
    const elRect = el.getBoundingClientRect();
    let closestDist = 9999;
    let closestText = "";
    buttons.forEach((btn) => {
        const btnRect = btn.getBoundingClientRect();
        if (btnRect.width === 0)
            return;
        const dist = Math.sqrt(Math.pow(elRect.left - btnRect.left, 2) + Math.pow(elRect.top - btnRect.top, 2));
        if (dist < closestDist) {
            closestDist = dist;
            closestText = (btn.textContent || btn.value || "").trim().toLowerCase();
        }
    });
    return {
        dist: Math.min(closestDist / 1000, 1.0),
        actionText: closestText.substring(0, 50),
        formAction: (form.action || "").toLowerCase()
    };
}
function analyzeSiblings(el) {
    const form = el.closest('form') || el.closest("[role='form']") || el.parentElement?.closest("div, section") || document.body;
    const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea'));
    let passwordFieldCount = 0;
    let hasEmailSibling = false;
    let hasUsernameSibling = false;
    let lastPasswordIdx = -1;
    const fieldIndex = inputs.indexOf(el);
    inputs.forEach((inp, idx) => {
        const type = inp.type?.toLowerCase();
        const nameId = (inp.name || '') + (inp.id || '');
        if (type === 'password') {
            passwordFieldCount++;
            if (idx < fieldIndex)
                lastPasswordIdx = idx;
        }
        if (type === 'email' || /email/i.test(nameId) && inp !== el)
            hasEmailSibling = true;
        if (/user/i.test(nameId) && inp !== el)
            hasUsernameSibling = true;
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
function detectSplitOTP(el) {
    const result = { isSplitOTP: false, groupSize: 0, positionInGroup: 0 };
    const maxLen = el.maxLength;
    if (maxLen !== 1 && maxLen !== 2)
        return result;
    const parent = el.parentElement;
    if (!parent)
        return result;
    let container = parent;
    let containerInputs = Array.from(container.querySelectorAll('input'));
    if (containerInputs.length < 3 && container.parentElement) {
        container = container.parentElement;
        containerInputs = Array.from(container.querySelectorAll('input'));
    }
    const sameMaxLen = containerInputs.filter(inp => {
        const ml = inp.maxLength;
        return (ml === 1 || ml === 2) && (inp.offsetWidth || inp.offsetHeight || inp.getClientRects().length);
    });
    if (sameMaxLen.length >= 4 && sameMaxLen.length <= 8) {
        const rects = sameMaxLen.map(inp => inp.getBoundingClientRect());
        const heights = rects.map(r => r.height);
        const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
        const heightConsistent = heights.every(h => Math.abs(h - avgHeight) < avgHeight * 0.3);
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
// ─── Encoding Maps ─────────────────────────────────────────────────────────
const INPUT_TYPE_MAP = {
    'text': 1, 'email': 2, 'password': 3, 'tel': 4, 'number': 5,
    'url': 6, 'search': 7, 'textarea': 8
};
const AUTOCOMPLETE_MAP = {
    'email': 1, 'username': 2, 'current-password': 3, 'new-password': 4,
    'given-name': 5, 'family-name': 6, 'name': 7, 'tel': 8, 'one-time-code': 9,
    'off': 10
};
// ─── Main Extraction Function ──────────────────────────────────────────────
function extractFeatures(el) {
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
        encodeText(placeholder), // ch0
        encodeText(ariaLabel), // ch1
        encodeText(explicitLabel), // ch2
        encodeText(nameAttr + " " + idAttr), // ch3
        encodeText(autocompleteAttr), // ch4
        encodeText(floatingLabel), // ch5
        encodeText(nearbyText), // ch6
        encodeText(formHeading), // ch7
    ];
    // 2. Structural Features
    const vec = new Float32Array(exports.NUM_STRUCTURAL_FEATURES);
    const vis = analyzeVisibility(el);
    const hpScore = computeHoneypotScore(el);
    const submitInfo = analyzeSubmitButton(el);
    const sibInfo = analyzeSiblings(el);
    const otpInfo = detectSplitOTP(el);
    const type = el.tagName.toLowerCase() === 'textarea' ? 'textarea' : el.type.toLowerCase();
    // Basic properties [0-11]
    vec[0] = (INPUT_TYPE_MAP[type] || 0) / 10.0;
    vec[1] = (AUTOCOMPLETE_MAP[autocompleteAttr.toLowerCase().trim()] || 0) / 10.0;
    const maxL = el.maxLength > 0 ? el.maxLength : -1;
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
    vec[21] = /\b(log[\-_]?in|sign[\-_]?in|authenticate|connexion|iniciar[\-_]?sesión)\b/i.test(submitInfo.actionText) ? 1 : 0;
    vec[22] = /\b(sign[\-_]?up|register|create[\-_]?account|join|inscription|registrarse)\b/i.test(submitInfo.actionText) ? 1 : 0;
    vec[23] = /\b(submit|continue|next|verify|confirm|send|go|enter|proceed)\b/i.test(submitInfo.actionText) ? 1 : 0;
    vec[24] = /log|sign/i.test(submitInfo.formAction) ? 1 : 0;
    // Shadow DOM [25]
    vec[25] = el.getRootNode() instanceof ShadowRoot ? 1 : 0;
    const allText = textChannels.map(ch => {
        let s = "";
        for (let i = 0; i < ch.length; i++)
            s += String.fromCharCode(ch[i]);
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
    // Elements 45-63 remain 0.0 for future extensions
    return { textChannels, structural: vec, element: el, isVisible: vis.isVisible };
}
// ─── Batch Collection ──────────────────────────────────────────────────────
const COLLECT_SELECTOR = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"])' +
    ':not([type="reset"]):not([type="image"]):not([type="file"])' +
    ':not([type="radio"]):not([type="checkbox"]), textarea';
/**
 * Collect features for all fillable fields in the document (including shadow DOM).
 * Uses a targeted CSS selector to avoid the O(n) querySelectorAll("*") full-DOM scan
 * that was the original implementation.
 */
function collectAllFields(root = document) {
    const results = [];
    // Query only fillable elements directly — O(k) where k << n
    for (const el of Array.from(root.querySelectorAll(COLLECT_SELECTOR))) {
        results.push(extractFeatures(el));
    }
    // Recurse into shadow roots found in this root
    for (const el of Array.from(root.querySelectorAll('*'))) {
        if (el.shadowRoot) {
            results.push(...collectAllFields(el.shadowRoot));
        }
    }
    return results;
}
