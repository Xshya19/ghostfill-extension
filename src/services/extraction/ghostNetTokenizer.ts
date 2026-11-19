import type { PageVerificationExpectation } from '../types/extraction.types';

import type {
  CompiledEmailDocument,
  DocumentCodeCandidate,
  DocumentLinkCandidate,
  DocumentZone,
} from './emailDocument';

export const INTENT_CLASSES = [
  'verification',
  'activation',
  'magic-link-login',
  'password-reset',
  'two-factor',
  'invitation',
  'transactional',
  'marketing',
] as const;

export type GhostNetIntentClass = (typeof INTENT_CLASSES)[number];

export const ACTION_CLASSES = [
  'fill-otp',
  'open-link',
  'fill-otp-and-open-link',
  'show-review',
  'ignore',
] as const;

export type GhostNetActionClass = (typeof ACTION_CLASSES)[number];

export const MAX_SEQ_LEN = 48;
export const D_MODEL = 32;
export const N_HEADS = 4;
export const D_HEAD = 8;
export const D_FFN = 48;
export const V_VOCAB = 1536;
export const B_CHAR = 768;
export const N_EMB_ROWS = V_VOCAB + B_CHAR; // 2304
export const B_CODE_CHAR = 256;
export const N_ZONES = 8;

export const G_OTP = 20;
export const D_MORPH_EMB = 16;
export const D_SPAN_RAW = D_MODEL * 4 + D_MORPH_EMB + G_OTP; // 164 ([h_left, h_right, h_span, h_ctx, morph, geom])
export const D_POINTER = 24;

export const G_LINK = 16;
export const D_LINK_RAW = D_MODEL * 3 + G_LINK; // 112

export const D_ACTION_META = 28;
export const D_ACTION_IN = D_MODEL + INTENT_CLASSES.length + D_POINTER * 2 + D_ACTION_META; // 116

// Reserved structural token IDs (0..9) — zero keyword bias
export const TOK_PAD = 0;
export const TOK_CLS = 1;
export const TOK_UNK = 2;
export const TOK_NUM4 = 3;
export const TOK_NUM5 = 4;
export const TOK_NUM6 = 5;
export const TOK_NUM7_8 = 6;
export const TOK_NUM_LONG = 7;
export const TOK_ALNUM_TOK = 8;
export const TOK_PRICE = 9;
export const TOK_RESERVED_COUNT = 10;

const ZONE_TO_ID: Record<DocumentZone, number> = {
  subject: 0,
  preheader: 1,
  'code-box': 2,
  hero: 3,
  cta: 4,
  'body-primary': 5,
  footer: 6,
  quoted: 7,
};

export function fnv1aHash(str: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const CJK_RUN_RE = /^[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+$/;
const TOKEN_CHUNK_RE = /[#$€£¥₹]?[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu;

const isAsciiAlnum = (ch: number): boolean =>
  (ch >= 48 && ch <= 57) || (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);

function splitAsciiTokens(slice: string): string[] {
  const out: string[] = [];
  const len = slice.length;
  let i = 0;

  while (i < len) {
    let ch = slice.charCodeAt(i);
    const hasPrefix =
      (ch === 35 || ch === 36) && i + 1 < len && isAsciiAlnum(slice.charCodeAt(i + 1));
    const start = i;
    if (hasPrefix) {
      i += 1;
      ch = slice.charCodeAt(i);
    }
    if (!isAsciiAlnum(ch)) {
      i += 1;
      continue;
    }

    while (i < len) {
      ch = slice.charCodeAt(i);
      if (isAsciiAlnum(ch)) {
        i += 1;
        continue;
      }
      if ((ch === 45 || ch === 39) && i + 1 < len && isAsciiAlnum(slice.charCodeAt(i + 1))) {
        i += 1;
        continue;
      }
      break;
    }

    const tokLen = i - start;
    if (tokLen <= 36) {
      out.push(slice.slice(start, i).toLowerCase());
    }
  }
  return out;
}

/**
 * Pure structural Unicode text tokenizer (zero keyword heuristics).
 * Splits contiguous CJK/kana scripts into 2-char overlapping tokens plus unigrams
 * so CJK/Japanese models tokenize naturally alongside whitespace-delimited languages.
 */
export function splitIntoTokens(text: string): string[] {
  if (!text) {
    return [];
  }
  const slice = text.length > 2600 ? text.slice(0, 2600) : text;
  let hasNonAscii = false;
  for (let i = 0; i < slice.length; i++) {
    if (slice.charCodeAt(i) >= 128) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return splitAsciiTokens(slice);
  }

  const lowered = slice.toLowerCase();
  const rawMatches = lowered.match(TOKEN_CHUNK_RE) || [];
  const out: string[] = [];

  for (const m of rawMatches) {
    if (m.length > 36) {
      continue;
    }
    if (CJK_RUN_RE.test(m) && m.length > 2) {
      for (let i = 0; i < m.length; i++) {
        if (i + 1 < m.length) {
          out.push(m.slice(i, i + 2));
        } else {
          out.push(m[i]!);
        }
      }
      continue;
    }
    out.push(m);
  }
  return out;
}

function resolveWordVocabId(tok: string, vocabMap: Map<string, number>): number {
  const exact = vocabMap.get(tok);
  if (exact !== undefined && exact < V_VOCAB) {
    return exact;
  }
  if (/^[$€£¥₹]\d+(?:\.\d+)?$/.test(tok)) {
    return TOK_PRICE;
  }
  if (/^\d+$/.test(tok)) {
    if (tok.length === 4) {
      return TOK_NUM4;
    }
    if (tok.length === 5) {
      return TOK_NUM5;
    }
    if (tok.length === 6) {
      return TOK_NUM6;
    }
    if (tok.length >= 7 && tok.length <= 8) {
      return TOK_NUM7_8;
    }
    if (tok.length >= 9) {
      return TOK_NUM_LONG;
    }
  }
  if (/^(?=.*\d)(?=.*[a-z])[a-z0-9-]{4,12}$/.test(tok)) {
    return TOK_ALNUM_TOK;
  }
  return TOK_UNK;
}

export function char3GramBuckets(tok: string): [number, number, number] {
  const padded = `<${tok}>`;
  if (padded.length <= 3) {
    const b0 = V_VOCAB + (fnv1aHash(padded, 0x9e3779b1) % B_CHAR);
    return [b0, b0, b0];
  }
  const len = padded.length - 2;
  const step = Math.max(1, Math.floor(len / 3));
  const b0 = V_VOCAB + (fnv1aHash(padded.slice(0, 3), 0x9e3779b1) % B_CHAR);
  const s1 = Math.min(len - 1, step);
  const b1 = V_VOCAB + (fnv1aHash(padded.slice(s1, s1 + 3), 0x9e3779b1) % B_CHAR);
  const s2 = Math.min(len - 1, step * 2);
  const b2 = V_VOCAB + (fnv1aHash(padded.slice(s2, s2 + 3), 0x9e3779b1) % B_CHAR);
  return [b0, b1, b2];
}

export interface TokenizedEmailSequence {
  seqLen: number;
  vocabIds: Uint16Array;
  charIds: Uint16Array; // length seqLen * 3 (values in V_VOCAB .. V_VOCAB + B_CHAR - 1)
  zoneIds: Uint8Array;
  rawTokens: string[];
  codePositions: number[][]; // matching positions in [0..seqLen-1] per codeCandidate
  linkAnchorPositions: number[][]; // matching positions per eligible linkCandidate
}

function normalizeTokenKey(s: string): string {
  const len = s.length;
  let needsBuild = false;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) {
      needsBuild = true;
      break;
    }
  }
  if (!needsBuild) {
    return s;
  }

  let out = '';
  let nonAscii = '';
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      out += s[i]!;
    } else if (c >= 65 && c <= 90) {
      out += String.fromCharCode(c + 32);
    } else if (c >= 128) {
      nonAscii += s[i]!;
    }
  }
  return out || nonAscii.toLowerCase();
}

/**
 * Compile `CompiledEmailDocument` into a fixed-cap (<= 96) sequence tensor
 * preserving subject, sender, primary discourse, candidate windows, CTA, and tail zones.
 */
export function tokenizeEmailDocument(
  doc: CompiledEmailDocument,
  vocabMap: Map<string, number>,
  eligibleLinks: DocumentLinkCandidate[]
): TokenizedEmailSequence {
  const rawTokens: string[] = [];
  const zones: number[] = [];

  const pushToken = (tok: string, zoneId: number): number => {
    if (rawTokens.length >= MAX_SEQ_LEN) {
      return -1;
    }
    const idx = rawTokens.length;
    rawTokens.push(tok);
    zones.push(zoneId);
    return idx;
  };

  // Slot 0: <CLS>
  pushToken('[cls]', ZONE_TO_ID.subject);

  // Subject tokens (up to 10)
  const subjToks = splitIntoTokens(doc.subject).slice(0, 10);
  for (const t of subjToks) {
    pushToken(t, ZONE_TO_ID.subject);
  }

  // Sender role local-part tokens only (never domain/TLD tokens, preventing domain overfitting)
  const localPart = (doc.sender.split('@')[0] || '').toLowerCase();
  for (const part of localPart
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 2 && w.length <= 16)
    .slice(0, 2)) {
    pushToken(part, ZONE_TO_ID.preheader);
  }

  // Primary visible body stream (strip raw URLs into host+path words so they don't bloat sequence with random tokens)
  const cleanBodyText = (doc.effectiveHtmlText || doc.visibleText || doc.effectiveBody).replace(
    /https?:\/\/[^\s]+/gi,
    ' '
  );
  const bodyToks = splitIntoTokens(cleanBodyText);

  // Take up to 20 non-repetitive prefix tokens (skips repeated 4-gram boilerplate)
  let pushedPrefix = 0;
  let prefixEnd = 0;
  for (
    let i = 0;
    i < bodyToks.length && pushedPrefix < 20 && rawTokens.length < MAX_SEQ_LEN - 8;
    i++
  ) {
    if (
      i >= 4 &&
      i + 3 < bodyToks.length &&
      bodyToks[i] === bodyToks[i - 4] &&
      bodyToks[i + 1] === bodyToks[i - 3] &&
      bodyToks[i + 2] === bodyToks[i - 2] &&
      bodyToks[i + 3] === bodyToks[i - 1]
    ) {
      i += 3;
      continue;
    }
    pushToken(bodyToks[i]!, ZONE_TO_ID['body-primary']);
    pushedPrefix += 1;
    prefixEnd = i + 1;
  }
  const prefixLimit = prefixEnd;

  // Ensure every code candidate has at least one occurrence + local window inside the 64-token budget
  const seenInPrefix = new Set(rawTokens.map((t) => normalizeTokenKey(t)));
  const candsToCheck = doc.codeCandidates.slice(0, 12);
  const bodyKeys = candsToCheck.length > 0 ? bodyToks.map(normalizeTokenKey) : [];
  for (const cand of candsToCheck) {
    if (rawTokens.length >= MAX_SEQ_LEN - 6) {
      break;
    }
    const key = cand.code.toLowerCase();
    if (seenInPrefix.has(key)) {
      continue;
    }
    const posInBody = bodyKeys.indexOf(key);
    if (posInBody >= 0) {
      const start = Math.max(0, posInBody - 4);
      const end = Math.min(bodyToks.length, posInBody + 4);
      for (let i = start; i < end && rawTokens.length < MAX_SEQ_LEN - 3; i++) {
        const z = cand.fromQuotedRegion ? ZONE_TO_ID.quoted : ZONE_TO_ID['code-box'];
        pushToken(bodyToks[i]!, z);
        seenInPrefix.add(normalizeTokenKey(bodyToks[i]!));
      }
    } else if (cand.tightBlockText) {
      // Split-box or tight-block fallback tokens
      for (const bt of splitIntoTokens(cand.tightBlockText).slice(0, 6)) {
        if (rawTokens.length >= MAX_SEQ_LEN - 3) {
          break;
        }
        pushToken(bt, ZONE_TO_ID['code-box']);
      }
      pushToken(cand.code.toLowerCase(), ZONE_TO_ID['code-box']);
      seenInPrefix.add(key);
    }
  }

  // Add primary eligible CTA anchor phrases if room remains
  for (const link of eligibleLinks.slice(0, 3)) {
    if (rawTokens.length >= MAX_SEQ_LEN - 2) {
      break;
    }
    for (const at of splitIntoTokens(link.anchorText).slice(0, 4)) {
      pushToken(at, link.isCTA ? ZONE_TO_ID.cta : ZONE_TO_ID[link.zone]);
    }
  }

  // Append tail body tokens (e.g. footer / unsubscribe signals) if slots remain
  const tailStart = Math.max(prefixLimit, bodyToks.length - 8);
  for (let i = tailStart; i < bodyToks.length && rawTokens.length < MAX_SEQ_LEN; i++) {
    pushToken(bodyToks[i]!, ZONE_TO_ID.footer);
  }

  // Append quoted markers briefly if quoted text exists and space remains
  if (doc.quotedText && rawTokens.length < MAX_SEQ_LEN - 2) {
    for (const qt of splitIntoTokens(doc.quotedText).slice(0, 6)) {
      pushToken(qt, ZONE_TO_ID.quoted);
    }
  }

  const seqLen = rawTokens.length;
  const vocabIds = new Uint16Array(seqLen);
  const charIds = new Uint16Array(seqLen * 3);
  const zoneIds = new Uint8Array(seqLen);

  vocabIds[0] = TOK_CLS;
  zoneIds[0] = ZONE_TO_ID.subject;
  const clsC = char3GramBuckets('[cls]');
  charIds[0] = clsC[0];
  charIds[1] = clsC[1];
  charIds[2] = clsC[2];

  const normalizedStream: string[] = ['cls'];
  for (let t = 1; t < seqLen; t++) {
    const tok = rawTokens[t]!;
    vocabIds[t] = resolveWordVocabId(tok, vocabMap);
    const cg = char3GramBuckets(tok);
    charIds[t * 3] = cg[0];
    charIds[t * 3 + 1] = cg[1];
    charIds[t * 3 + 2] = cg[2];
    zoneIds[t] = zones[t]!;
    normalizedStream.push(normalizeTokenKey(tok));
  }

  // Map every codeCandidate to sequence position(s)
  const codePositions: number[][] = [];
  for (const cand of doc.codeCandidates.slice(0, 16)) {
    const key = cand.code.toLowerCase();
    const matches: number[] = [];
    for (let t = 1; t < seqLen; t++) {
      if (normalizedStream[t] === key) {
        matches.push(t);
      } else if (
        t + 1 < seqLen &&
        key.length >= 4 &&
        normalizedStream[t]! + normalizedStream[t + 1]! === key
      ) {
        matches.push(t);
      }
    }
    if (matches.length === 0) {
      // Fallback: anchor around zone/tightBlock match or position 1
      const snippet = splitIntoTokens(cand.tightBlockText || cand.rowText).map(normalizeTokenKey);
      const anchorTok = snippet.find((s) => s.length >= 3);
      if (anchorTok) {
        const hit = normalizedStream.indexOf(anchorTok, 1);
        if (hit > 0) {
          matches.push(hit);
        }
      }
      if (matches.length === 0) {
        matches.push(Math.min(seqLen - 1, 1));
      }
    }
    codePositions.push(matches);
  }

  // Map every linkCandidate anchor to sequence position(s)
  const linkAnchorPositions: number[][] = [];
  for (const link of eligibleLinks.slice(0, 14)) {
    const anchorKeys = splitIntoTokens(link.anchorText)
      .map(normalizeTokenKey)
      .filter((k) => k.length >= 2);
    const matches: number[] = [];
    if (anchorKeys.length > 0) {
      for (let t = 1; t < seqLen; t++) {
        if (normalizedStream[t] === anchorKeys[0]) {
          matches.push(t);
        }
      }
    }
    if (matches.length === 0) {
      matches.push(Math.min(seqLen - 1, 1));
    }
    linkAnchorPositions.push(matches);
  }

  return {
    seqLen,
    vocabIds,
    charIds,
    zoneIds,
    rawTokens,
    codePositions,
    linkAnchorPositions,
  };
}

function shannonEntropy(str: string): number {
  const len = str.length;
  if (len <= 1) {
    return 0;
  }
  let ent = 0;
  for (let i = 0; i < len; i++) {
    const ch = str.charCodeAt(i);
    let seenBefore = false;
    for (let j = 0; j < i; j++) {
      if (str.charCodeAt(j) === ch) {
        seenBefore = true;
        break;
      }
    }
    if (seenBefore) {
      continue;
    }
    let count = 1;
    for (let j = i + 1; j < len; j++) {
      if (str.charCodeAt(j) === ch) {
        count++;
      }
    }
    const p = count / len;
    ent -= p * Math.log2(p);
  }
  return ent;
}

const GEOM_OTP_BUF = new Float32Array(G_OTP);
const GEOM_LINK_BUF = new Float32Array(G_LINK);

export function extractCodeMorphCharIds(code: string): [number, number, number, number] {
  const s = `<${code.toLowerCase()}>`;
  const h = (sub: string) => fnv1aHash(sub, 0x811c9dc5) % B_CODE_CHAR;
  const g0 = h(s.slice(0, Math.min(s.length, 3)));
  const g1 = h(s.slice(Math.min(1, s.length - 1), Math.min(s.length, 4)));
  const g2 = h(s.slice(Math.max(0, s.length - 3)));
  const g3 = h(`${code.length}:${/^\d+$/.test(code) ? 'D' : 'A'}`);
  return [g0, g1, g2, g3];
}

/**
 * Pure mathematical + DOM structural descriptor for a code candidate (G_OTP = 20).
 * Zero keyword or intent regular expressions.
 */
export function extractCodeStructuralGeometry(
  cand: DocumentCodeCandidate,
  doc: CompiledEmailDocument,
  providerOtpLength?: number,
  pageExpectation?: PageVerificationExpectation
): Float32Array {
  const g = GEOM_OTP_BUF;
  g.fill(0);
  const code = cand.code;
  const len = code.length;

  let digits = 0;
  let upper = 0;
  let transitions = 0;
  let prevDigit = false;
  let maxRepeatRun = 1;
  let curRun = 1;

  for (let i = 0; i < len; i++) {
    const ch = code.charCodeAt(i);
    const isDigit = ch >= 48 && ch <= 57;
    const isUp = ch >= 65 && ch <= 90;
    if (isDigit) {
      digits += 1;
    }
    if (isUp) {
      upper += 1;
    }
    if (i > 0) {
      if (isDigit !== prevDigit) {
        transitions += 1;
      }
      if (code[i] === code[i - 1]) {
        curRun += 1;
        if (curRun > maxRepeatRun) {
          maxRepeatRun = curRun;
        }
      } else {
        curRun = 1;
      }
    }
    prevDigit = isDigit;
  }

  let uniqueChars = 0;
  for (let i = 0; i < len; i++) {
    const ch = code.charCodeAt(i);
    let seenBefore = false;
    for (let j = 0; j < i; j++) {
      if (code.charCodeAt(j) === ch) {
        seenBefore = true;
        break;
      }
    }
    if (!seenBefore) {
      uniqueChars += 1;
    }
  }
  const ent = shannonEntropy(code);

  g[0] = Math.min(1, len / 12);
  g[1] = digits / Math.max(1, len);
  g[2] = upper / Math.max(1, len);
  g[3] = len > 1 ? transitions / (len - 1) : 0;
  g[4] = Math.min(1, ent / 3.5);
  g[5] = uniqueChars / Math.max(1, len);
  g[6] = maxRepeatRun / Math.max(1, len);
  g[7] = Math.min(1, cand.domProminence.fontSizePx / 32);
  g[8] = cand.domProminence.isBold ? 1 : 0;
  g[9] = cand.domProminence.isMonospace ? 1 : 0;
  g[10] = cand.domProminence.hasLetterSpacing ? 1 : 0;
  g[11] = cand.domProminence.isIsolated ? 1 : 0;
  g[12] = cand.domProminence.isSplitBox ? 1 : 0;
  g[13] = Math.min(1, Math.max(0, cand.domProminence.verticalRatio));
  g[14] = cand.fromQuotedRegion ? 1 : 0;
  g[15] = cand.insideUrlOnly ? 1 : 0;
  g[16] = cand.embeddedInEmailHandle ? 1 : 0;
  g[17] = cand.inSubject ? 1 : 0;
  g[18] = cand.inVisibleBodyOutsideUrls ? 1 : 0;

  let pageAlign = 0;
  if (pageExpectation?.expectedOtpLength) {
    pageAlign = pageExpectation.expectedOtpLength === len ? 1 : -1;
  } else if (providerOtpLength) {
    pageAlign = providerOtpLength === len ? 0.6 : -0.4;
  }
  if (pageExpectation?.expectedOtpFormat === 'numeric') {
    const formatBias = digits === len ? 0.25 : -0.35;
    pageAlign = Math.max(-1, Math.min(1, pageAlign + formatBias));
  }
  g[19] = pageAlign;
  void doc;
  return g;
}

/**
 * Tokenize URL host/path/query-keys into pure subword vocab + char3gram IDs
 * so the neural model learns URL structure without regex patterns.
 */
export function extractUrlSubwordTokens(urlStr: string): string[] {
  try {
    const parts: string[] = [];
    let start = 0;
    const protoEnd = urlStr.indexOf('://');
    if (protoEnd !== -1) {
      start = protoEnd + 3;
    }
    let pathStart = urlStr.indexOf('/', start);
    const queryStart = urlStr.indexOf('?', start);
    if (pathStart === -1 || (queryStart !== -1 && queryStart < pathStart)) {
      pathStart = queryStart !== -1 ? queryStart : urlStr.length;
    }
    const host = urlStr.slice(start, pathStart).toLowerCase();
    for (const h of host.split('.')) {
      if (h && h !== 'www') {
        parts.push(h);
      }
    }
    const pathEnd = queryStart !== -1 ? queryStart : urlStr.length;
    if (pathStart < pathEnd) {
      const path = urlStr.slice(pathStart, pathEnd).toLowerCase();
      for (const seg of path.split(/[/._-]+/)) {
        if (seg && seg.length <= 24) {
          parts.push(seg);
        }
      }
    }
    if (queryStart !== -1) {
      const query = urlStr.slice(queryStart + 1).toLowerCase();
      for (const pair of query.split('&')) {
        const eq = pair.indexOf('=');
        const key = eq !== -1 ? pair.slice(0, eq) : pair;
        if (key && key.length <= 24) {
          parts.push(key);
        }
      }
    }
    return parts.slice(0, 12);
  } catch {
    return [];
  }
}

export function resolveTokenVocabAndChars(
  tok: string,
  vocabMap: Map<string, number>
): { vocabId: number; c0: number; c1: number; c2: number } {
  const [c0, c1, c2] = char3GramBuckets(tok);
  return {
    vocabId: resolveWordVocabId(tok, vocabMap),
    c0,
    c1,
    c2,
  };
}

/**
 * Pure mathematical + structural link candidate geometry (G_LINK = 16).
 */
export function extractLinkStructuralGeometry(
  cand: DocumentLinkCandidate,
  doc: CompiledEmailDocument,
  bestOtpCode: string | null
): Float32Array {
  const g = GEOM_LINK_BUF;
  g.fill(0);
  let pathSegs = 0;
  let queryCount = 0;
  let maxValLen = 0;
  let maxValEnt = 0;
  let isHttps = 0;
  let isIp = 0;

  try {
    const u = new URL(cand.url);
    isHttps = u.protocol === 'https:' ? 1 : 0;
    isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.includes('xn--') ? 1 : 0;
    pathSegs = u.pathname.split('/').filter(Boolean).length;
    for (const val of u.searchParams.values()) {
      queryCount += 1;
      if (val.length > maxValLen) {
        maxValLen = val.length;
      }
      const e = shannonEntropy(val.slice(0, 64));
      if (e > maxValEnt) {
        maxValEnt = e;
      }
    }
    for (const seg of u.pathname.split('/')) {
      if (seg.length >= 16) {
        maxValLen = Math.max(maxValLen, seg.length);
        maxValEnt = Math.max(maxValEnt, shannonEntropy(seg.slice(0, 64)));
      }
    }
  } catch {
    isIp = 1;
  }

  g[0] = Math.min(1, pathSegs / 6);
  g[1] = Math.min(1, queryCount / 6);
  g[2] = Math.min(1, maxValLen / 40);
  g[3] = Math.min(1, maxValEnt / 5.5);
  g[4] = isHttps;
  g[5] = isIp;
  g[6] = cand.isCTA ? 1 : 0;
  g[7] = Math.min(1, cand.mentionCount / 3);
  g[8] = cand.hasPlaintextFallbackDuplicate ? 1 : 0;
  g[9] = cand.hostMatchesSender ? 1 : 0;
  g[10] = cand.hostMatchesExpected ? 1 : 0;
  g[11] = (ZONE_TO_ID[cand.zone] ?? 5) / 7;
  g[12] = bestOtpCode && cand.url.toLowerCase().includes(bestOtpCode.toLowerCase()) ? 1 : 0;
  g[13] = Math.min(1, cand.gate.quality / 100);
  g[14] = cand.gate.structuralAutoOpen ? 1 : 0;
  g[15] = doc.expectedRoots.size > 0 ? 1 : 0;
  return g;
}
