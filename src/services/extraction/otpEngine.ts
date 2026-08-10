// src/services/extraction/otpEngine.ts
// ══════════════════════════════════════════════════════════════════
//  OTP ENGINE v4 — occurrence-scored, log-odds calibrated, abstaining
// ══════════════════════════════════════════════════════════════════

import { foldHomoglyphs, type ParsedEmail } from './parseText';

export interface OtpVerdict {
  code: string | null;
  probability: number;      // calibrated 0..1
  marginNats: number;       // top - runnerUp
  action: 'autofill' | 'suggest' | 'abstain';
  reasons: string[];
  runnerUp: string | null;
  all: Array<{ code: string; p: number; nats: number; reasons: string[] }>;
}

export interface OtpContext {
  intent?: 'verification' | 'activation' | 'password-reset' | 'other';
  intentConfidence?: number;          // 0..1
  provider?: { name: string; length?: number; format?: 'numeric' | 'alnum' } | null;
  recipientEmail?: string;
  /** Codes already tried and rejected by the site. Hard-excluded. */
  burned?: string[];
}

// ── Tunables (nats). Log-odds weights. ──
const W = {
  bias:                 -2.60,
  labelAdjacent:         3.30,   // "code: X" / "code is X"
  postfixIsYourCode:     2.80,   // "X is your code"
  labelNear:             2.10,   // label within 40 chars
  labelWide:             1.20,   // label within 140 chars
  isolatedCell:          1.50,
  visuallyProminent:     1.30,   // letter-spacing | font-size>=18 | bold
  inSubjectAndBody:      2.45,
  providerExactMatch:    2.00,
  doNotShareNearby:      1.15,
  expiryNearby:          1.05,
  instructionVerb:       0.70,
  mixedAlnum:            0.50,
  corroborated2or3:      0.35,
  entropyOk:             0.40,

  intentVerification:    0.90,
  intentActivationOnly: -0.65,
  intentOther:          -0.30,

  occursTooOften:       -1.20,   // >=4 occurrences => boilerplate
  footerZone:           -1.90,
  lowEntropy:           -0.80,
  yearNoLabel:          -3.40,
  sequentialNoLabel:    -2.60,
  repeatedNoLabel:      -2.30,
  looksLikeDateCtx:     -2.00,
  bareLongDigits:       -1.40,   // 9-12 digits, no label
} as const;

// Empirical length prior, expressed as LLR vs. background token distribution.
const LEN_LLR: Record<number, number> = {
  4: 0.55, 5: 0.35, 6: 1.35, 7: 0.30, 8: 0.70,
  9: 0.10, 10: 0.10, 11: 0.20, 12: 0.10,
};

const MIN_LEN = 4;
const MAX_LEN = 12;           // fixes 11-char alphanumeric codes like A5EG382JW8W

const CODE_NOUN =
  '(?:otp|code|pin|passcode|password|token|c[oó]digo|clave|kennwort|' +
  'kod|şifre|senha|код|رمز|كود|認証コード|验证码|驗證碼|인증번호|verifikasi)';

const LABEL_TAIL = new RegExp(
  `${CODE_NOUN}\\s*(?:is|ist|est|es|:|=|-|–|—|→|は|为|：)?\\s*$`, 'i');

const POSTFIX = new RegExp(
  `^\\s*(?:is|ist|est|es|enter|type|use|input|copy|below|above)?\\s*(?:the|your|this|su|ihr|votre|to)?\\s*(?:\\w+\\s+){0,3}${CODE_NOUN}`, 'i');

const ACCEPT_P   = 0.75;
const SUGGEST_P  = 0.50;
const MARGIN_MIN = 0.80;

interface Occ { i: number; raw: string; }

function vetoOccurrence(v: string, p: ParsedEmail, occ: Occ): string | null {
  const t = p.text;
  const i = occ.i;
  const end = i + occ.raw.length;

  // Inside a URL (path or query) — unless it's a recognized OTP param
  const winStart = Math.max(0, i - 200);
  const win = t.slice(winStart, Math.min(t.length, end + 200));
  const li = i - winStart;
  const urlRe = /(?:\u0001|https?:\/\/)[^\s\u0001]+/g;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(win)) !== null) {
    if (li >= m.index && li + occ.raw.length <= m.index + m[0].length) {
      const beforeUrl = win.slice(m.index, li);
      if (!/(?:code|otp|pin|token|val)=$/i.test(beforeUrl)) return 'inside-url';
    }
  }

  // Currency / Units / Hashes / Color codes / Dimensions
  const prevChar = i > 0 ? t[i - 1]! : ' ';
  const nextChar = end < t.length ? t[end]! : ' ';
  if (/[$\u20AC\u00A3\u00A5%#@]/i.test(prevChar)) return 'currency-or-symbol';
  if (/^[a-f0-9]{3,8}$/i.test(v) && prevChar === '#') return 'hex-color';
  if (/\b(?:px|em|rem|vh|vw|kg|mb|gb|tb|hz|khz|mhz|ghz)\b/i.test(t.slice(end, end + 6))) return 'unit';

  return null;
}

function shapeOk(v: string): boolean {
  if (v.length < MIN_LEN || v.length > MAX_LEN) return false;
  if (!/\d/.test(v)) return false;                 // pure words are never OTPs
  if (!/^[A-Za-z0-9]+$/.test(v)) return false;
  if (/^0x/i.test(v)) return false;
  return true;
}

function entropy(v: string): number {
  const f = new Map<string, number>();
  for (const c of v) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const c of f.values()) { const q = c / v.length; h -= q * Math.log2(q); }
  return h;
}

function isSequential(v: string): boolean {
  if (!/^\d+$/.test(v) || v.length < 3) return false;
  let inc = true, dec = true;
  for (let i = 1; i < v.length; i++) {
    const d = v.charCodeAt(i) - v.charCodeAt(i - 1);
    if (d !== 1) inc = false;
    if (d !== -1) dec = false;
  }
  return inc || dec;
}

function isRepeated(v: string): boolean {
  return /^(\d)\1+$/.test(v);
}

function harvest(p: ParsedEmail): Map<string, Occ[]> {
  const map = new Map<string, Occ[]>();
  const push = (val: string, i: number, raw: string) => {
    const key = foldHomoglyphs(val).toUpperCase();
    if (!shapeOk(key)) return;
    const arr = map.get(key) ?? [];
    if (!arr.some((o) => o.i === i)) arr.push({ i, raw });
    map.set(key, arr);
  };

  const t = p.text;

  // a) Contiguous alphanumeric tokens
  const tok = /[A-Za-z0-9]{4,12}/g;
  let m: RegExpExecArray | null;
  while ((m = tok.exec(t)) !== null) push(m[0], m.index, m[0]);

  // b) Hyphenated/spaced split codes (e.g. 483-920, 123 456, AB1-CD2)
  const splitRe = /\b(\d{2,6})[\s-](\d{2,6})\b|\b([A-Za-z0-9]*\d[A-Za-z0-9]*)[\s-]([A-Za-z0-9]*\d[A-Za-z0-9]*)\b/g;
  while ((m = splitRe.exec(t)) !== null) {
    const p1 = m[1] || m[3];
    const p2 = m[2] || m[4];
    if (p1 && p2) {
      const joined = p1 + p2;
      if (joined.length >= MIN_LEN && joined.length <= MAX_LEN) push(joined, m.index, m[0]);
    }
  }

  return map;
}

function scoreOcc(
  v: string,
  p: ParsedEmail,
  occ: Occ,
  ctx: OtpContext,
  nOcc: number
): { nats: number; reasons: string[] } | null {
  const veto = vetoOccurrence(v, p, occ);
  if (veto) return null;

  const t = p.text;
  const i = occ.i;
  const end = i + occ.raw.length;
  const reasons: string[] = [];
  let s: number = W.bias;
  const add = (w: number, r: string) => { s += w; reasons.push(`${r}${w >= 0 ? '+' : ''}${w.toFixed(2)}`); };

  const before  = t.slice(Math.max(0, i - 140), i);
  const after   = t.slice(end, Math.min(t.length, end + 140));
  const near    = before.slice(-40) + ' ' + after.slice(0, 40);
  const wide    = before + ' ' + after;

  // Label evidence — strongest, and it licenses overriding priors
  let labeled = false;
  if (LABEL_TAIL.test(before.slice(-30)))      { add(W.labelAdjacent, 'label-adj'); labeled = true; }
  else if (POSTFIX.test(after))                { add(W.postfixIsYourCode, 'postfix'); labeled = true; }
  else if (new RegExp(CODE_NOUN, 'i').test(after.slice(0, 60))) { add(W.postfixIsYourCode, 'postfix-near'); labeled = true; }
  else if (new RegExp(CODE_NOUN, 'i').test(before.slice(-40))) { add(W.labelNear, 'label-near'); labeled = true; }
  else if (new RegExp(CODE_NOUN, 'i').test(wide)) add(W.labelWide, 'label-wide');

  add(LEN_LLR[v.length] ?? -1.0, `len${v.length}`);

  // Layout prominence
  const hIdx = p.htmlDecoded.indexOf(occ.raw);
  if (hIdx >= 0) {
    const pre = p.htmlDecoded.slice(Math.max(0, hIdx - 260), hIdx);
    const post = p.htmlDecoded.slice(hIdx + occ.raw.length, hIdx + occ.raw.length + 40);
    if (/<td\b[^>]*>\s*$/i.test(pre) && /^\s*<\/td>/i.test(post)) add(W.isolatedCell, 'isolated-cell');
    if (/letter-spacing|font-size\s*:\s*(?:1[8-9]|[2-9]\d|1\d{2})|font-weight\s*:\s*(?:bold|[6-9]00)/i.test(pre))
      add(W.visuallyProminent, 'prominent');
    if (/unsubscribe|all rights reserved|view in browser/i.test(pre.slice(-400)) || /<footer>/i.test(pre.slice(-200))) add(W.footerZone, 'footer');
  }

  if (p.subject.toUpperCase().includes(v) && (t.length - p.subject.length) > 0) {
    const bodyOnly = t.slice(p.subject.length);
    if (foldHomoglyphs(bodyOnly).toUpperCase().includes(v)) add(W.inSubjectAndBody, 'subject+body');
  }

  if (/do not share|don'?t share|never share|no compartas|confidential/i.test(wide)) add(W.doNotShareNearby, 'do-not-share');
  if (/expires?\s+in|valid\s+for|within\s+\d+\s*(?:min|hour|second)/i.test(wide)) add(W.expiryNearby, 'expiry');
  if (/\b(?:enter|use|type|paste|input|submit|copy)\b/i.test(before.slice(-60))) add(W.instructionVerb, 'verb');
  if (/[A-Za-z]/.test(v) && /\d/.test(v)) add(W.mixedAlnum, 'mixed-alnum');

  const H = entropy(v);
  if (H >= 1.8) add(W.entropyOk, 'entropy'); else if (H < 1.2) add(W.lowEntropy, 'low-entropy');

  // Year check: soft penalty, overridden if labeled
  const numVal = parseInt(v, 10);
  if (!isNaN(numVal) && numVal >= 1970 && numVal <= 2030) {
    if (!labeled) add(W.yearNoLabel, 'year-unlabeled');
  }

  if (isSequential(v) && !labeled) add(W.sequentialNoLabel, 'sequential-unlabeled');
  if (isRepeated(v) && !labeled) add(W.repeatedNoLabel, 'repeated-unlabeled');

  if (/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(near)) add(W.looksLikeDateCtx, 'date-ctx');
  if (/^\d{9,12}$/.test(v) && !labeled) add(W.bareLongDigits, 'bare-long-digits');

  if (nOcc >= 4) add(W.occursTooOften, 'too-frequent');
  else if (nOcc >= 2) add(W.corroborated2or3, 'corroborated');

  return { nats: s, reasons };
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function extractOtp(p: ParsedEmail, ctx: OtpContext = {}): OtpVerdict {
  const burned = new Set((ctx.burned ?? []).map((b) => b.toUpperCase()));
  const cands = harvest(p);
  const scored: Array<{ code: string; nats: number; reasons: string[] }> = [];

  // Recipient's own address digits must never win
  const selfDigits = (ctx.recipientEmail ?? '').replace(/\D/g, '');

  for (const [code, occs] of cands) {
    if (burned.has(code)) continue;
    if (selfDigits.length >= 4 && selfDigits.includes(code)) continue;

    let best: { nats: number; reasons: string[] } | null = null;
    for (const occ of occs) {
      const r = scoreOcc(code, p, occ, ctx, occs.length);
      if (r && (!best || r.nats > best.nats)) best = r;
    }
    if (best) scored.push({ code, nats: best.nats, reasons: best.reasons });
  }

  scored.sort((a, b) => b.nats - a.nats);
  const top = scored[0];
  const second = scored[1];

  if (!top) {
    return { code: null, probability: 0, marginNats: 0, action: 'abstain',
             reasons: ['no-candidate'], runnerUp: null, all: [] };
  }

  const pTop = sigmoid(top.nats);
  const margin = top.nats - (second?.nats ?? -Infinity);
  const finiteMargin = Number.isFinite(margin) ? margin : 99;

  let action: OtpVerdict['action'] = 'abstain';
  if (pTop >= ACCEPT_P && finiteMargin >= MARGIN_MIN) action = 'autofill';
  else if (pTop >= SUGGEST_P) action = 'suggest';

  return {
    code: top.code,
    probability: pTop,
    marginNats: finiteMargin,
    action,
    reasons: top.reasons,
    runnerUp: second?.code ?? null,
    all: scored.slice(0, 6).map((c) => ({ code: c.code, p: sigmoid(c.nats), nats: c.nats, reasons: c.reasons })),
  };
}
