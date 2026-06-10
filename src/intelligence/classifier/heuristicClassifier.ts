// The strong, deterministic primary classifier. Designed to be a SUPERSET of
// every signal a fallback heuristic would use (autocomplete, type, name/id
// patterns, label/aria/placeholder text, structural OTP cues, multilingual
// keywords) so that a separate "fallback classifier" is unnecessary.
//
// Output is a calibrated-ready score distribution + detected hard-negative.
// This file has NO DOM dependency so it runs in Node for eval and (eventually)
// alongside the distilled model in the offscreen document.

import { FIELD_CLASSES } from '../contract';
import { matchesAny, normalizeText } from '../keywords';
import type { ClassificationResult, FieldClass, HardNegative, RawFieldRecord } from '../types';

type Scores = Record<FieldClass, number>;

function zeroScores(): Scores {
  const s = {} as Scores;
  for (const c of FIELD_CLASSES) {
    s[c] = 0;
  }
  return s;
}

function combinedText(r: RawFieldRecord): string {
  return [
    r.labelText,
    r.placeholder,
    r.ariaLabel,
    r.surroundingText,
    r.name,
    r.id,
    r.autocomplete,
  ].join(' ');
}

// Strong split/single OTP structural signal.
export function looksLikeOtpField(r: RawFieldRecord): boolean {
  const text = combinedText(r);
  const textOtp =
    matchesAny(text, 'otp') || (matchesAny(text, 'code') && matchesAny(text, 'verify'));
  const splitShape =
    r.maxLength === 1 &&
    (r.inputMode === 'numeric' || r.type === 'tel' || r.type === 'number' || r.type === 'text');
  const shortNumeric =
    r.maxLength > 0 &&
    r.maxLength <= 8 &&
    (r.inputMode === 'numeric' || r.autocomplete.includes('one-time-code'));
  return (
    r.autocomplete.includes('one-time-code') ||
    (textOtp && (splitShape || shortNumeric || r.maxLength === 6))
  );
}

// Detect hard-negative subtypes that must never be treated as identity/OTP.
export function detectHardNegative(r: RawFieldRecord): HardNegative | undefined {
  const text = combinedText(r);
  // honeypot: invisible-ish field that nonetheless asks for identity-like data
  if (
    !r.visible &&
    r.type !== 'hidden' &&
    (matchesAny(text, 'email') || matchesAny(text, 'user') || matchesAny(text, 'fullname'))
  ) {
    return 'Honeypot';
  }
  if (matchesAny(text, 'cvv')) {
    return 'CVV';
  }
  if (matchesAny(text, 'card')) {
    return 'CardNumber';
  }
  if (matchesAny(text, 'expiry')) {
    return 'CardExpiry';
  }
  if (matchesAny(text, 'captcha')) {
    return 'Captcha';
  }
  if (matchesAny(text, 'coupon')) {
    return 'Coupon';
  }
  if (r.type === 'search' || matchesAny(text, 'search')) {
    return 'Search';
  }
  if (matchesAny(text, 'zip')) {
    return 'ZIP';
  }
  if (matchesAny(text, 'dob')) {
    return 'DateOfBirth';
  }
  if (matchesAny(text, 'amount')) {
    return 'Amount';
  }
  return undefined;
}

function softmax(scores: Scores, temperature: number): Scores {
  const t = temperature > 0 ? temperature : 1;
  const vals = FIELD_CLASSES.map((c) => (scores[c] ?? 0) / t);
  const max = Math.max(...vals);
  const exps = vals.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  const out = zeroScores();
  FIELD_CLASSES.forEach((c, i) => {
    const expVal = exps[i];
    if (expVal !== undefined) {
      out[c] = expVal / sum;
    }
  });
  return out;
}

export interface ClassifyOptions {
  temperature?: number | undefined; // calibration temperature (default 1.0)
}

export function classifyHeuristic(
  r: RawFieldRecord,
  opts: ClassifyOptions = {}
): ClassificationResult {
  const s = zeroScores();
  const signals: string[] = [];
  const add = (c: FieldClass, w: number, why: string) => {
    s[c] += w;
    signals.push(why + ' -> ' + c + ' (+' + w + ')');
  };
  const text = combinedText(r);
  const ac = r.autocomplete;

  // baseline mass on Unknown so weak fields abstain rather than guess
  s.Unknown += 0.6;

  // ---- Tier 1: autocomplete (highest precision) ----
  if (ac.includes('one-time-code')) {
    add('OTP', 6, 'autocomplete=one-time-code');
  }
  if (ac.includes('email')) {
    add('Email', 5, 'autocomplete=email');
  }
  if (ac.includes('username')) {
    add('Username', 5, 'autocomplete=username');
  }
  if (ac.includes('current-password')) {
    add('Password', 5.5, 'autocomplete=current-password');
  }
  if (ac.includes('new-password')) {
    add('Password', 3, 'autocomplete=new-password');
    add('Target_Password_Confirm', 1.5, 'new-password may be confirm');
  }
  if (ac.includes('tel')) {
    add('Phone', 5, 'autocomplete=tel');
  }
  if (ac.includes('given-name')) {
    add('First_Name', 5, 'autocomplete=given-name');
  }
  if (ac.includes('family-name')) {
    add('Last_Name', 5, 'autocomplete=family-name');
  }
  if (ac === 'name' || ac.includes('cc-name')) {
    add('Full_Name', 4.5, 'autocomplete=name');
  }

  // ---- Tier 2: input type ----
  if (r.type === 'email') {
    add('Email', 3.5, 'type=email');
  }
  if (r.type === 'tel') {
    add('Phone', 3, 'type=tel');
  }
  if (r.type === 'password') {
    add('Password', 3.5, 'type=password');
    add('Target_Password_Confirm', 1, 'type=password');
  }

  // ---- Tier 3: OTP structural ----
  if (looksLikeOtpField(r)) {
    add('OTP', 4.5, 'otp structural/text signal');
  }

  // ---- Tier 4: keyword text signals (multilingual) ----
  if (matchesAny(text, 'email')) {
    add('Email', 3, 'kw:email');
  }
  if (matchesAny(text, 'user')) {
    add('Username', 2.5, 'kw:user');
  }
  if (matchesAny(text, 'password')) {
    add('Password', 2.5, 'kw:password');
    if (matchesAny(text, 'confirm')) {
      add('Target_Password_Confirm', 3.5, 'kw:confirm+password');
    }
    if (matchesAny(text, 'newpw')) {
      add('Password', 1.5, 'kw:new-password');
    }
    if (matchesAny(text, 'currentpw')) {
      add('Password', 1.5, 'kw:current-password');
    }
  }
  // confirm-password must DECISIVELY beat plain password when confirm/repeat is present
  if (matchesAny(text, 'confirm') && (matchesAny(text, 'password') || r.type === 'password')) {
    add('Target_Password_Confirm', 6, 'confirm+password dominance');
    s.Password *= 0.35;
    signals.push('dampen Password in favor of confirm');
  }
  if (matchesAny(text, 'otp')) {
    add('OTP', 3.5, 'kw:otp');
  }
  if (matchesAny(text, 'phone')) {
    add('Phone', 3, 'kw:phone');
  }
  if (matchesAny(text, 'first')) {
    add('First_Name', 3.5, 'kw:first-name');
  }
  if (matchesAny(text, 'last')) {
    add('Last_Name', 3.5, 'kw:last-name');
  }

  const localTxt = [r.labelText, r.placeholder, r.ariaLabel, r.name, r.id, r.autocomplete].join(
    ' '
  );
  const hasLocalFirst = matchesAny(localTxt, 'first');
  const hasLocalLast = matchesAny(localTxt, 'last');
  const normLocalText = normalizeText(localTxt);
  const hasExplicitFullName =
    matchesAny(text, 'fullname') &&
    (normLocalText.includes('full name') ||
      normLocalText.includes('fullname') ||
      normLocalText.includes('your name') ||
      normLocalText.includes('nombre completo') ||
      normLocalText.includes('nom complet') ||
      normLocalText.includes('cardholder name'));

  const hasLocalFullName = matchesAny(localTxt, 'fullname') && !hasLocalFirst && !hasLocalLast;

  let isExplicitOrCombinedName = false;
  if (hasExplicitFullName) {
    add('Full_Name', 4.0, 'kw:explicit-full-name');
    isExplicitOrCombinedName = true;
  } else if (hasLocalFirst && hasLocalLast) {
    add('Full_Name', 4.5, 'kw:first-and-last-combined');
    isExplicitOrCombinedName = true;
  } else if (hasLocalFullName) {
    add('Full_Name', 3.5, 'kw:local-full-name');
    isExplicitOrCombinedName = true;
  } else if (
    matchesAny(text, 'fullname') &&
    !matchesAny(text, 'first') &&
    !matchesAny(text, 'last')
  ) {
    add('Full_Name', 2.5, 'kw:generic-name');
  }

  // ---- Negative evidence: hard negatives suppress identity/OTP fills ----
  const hardNegative = detectHardNegative(r);
  if (hardNegative) {
    // collapse identity/OTP mass; keep Unknown dominant so the safety gate blocks
    for (const c of FIELD_CLASSES) {
      if (c !== 'Unknown') {
        s[c] *= 0.15;
      }
    }
    s.Unknown += 4;
    signals.push('hard-negative:' + hardNegative + ' -> suppress identity/OTP');
  }

  // disambiguate first vs last vs full
  if (s.First_Name > 0 && s.Last_Name > 0 && !isExplicitOrCombinedName) {
    s.Full_Name *= 0.5;
  }

  const probs = softmax(s, opts.temperature ?? 1.0);
  const ranked = FIELD_CLASSES.map((c) => ({ c, p: probs[c] ?? 0 })).sort((a, b) => b.p - a.p);
  const topRanked = ranked[0]!;
  const top = topRanked.c;
  const topProb = topRanked.p;
  const margin = topProb - (ranked[1]?.p ?? 0);

  return { scores: probs, top, topProb, margin, hardNegative, signals };
}
