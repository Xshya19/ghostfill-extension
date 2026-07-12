// src/services/extraction/cognitiveOtpExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  COGNITIVE OTP EXTRACTOR
//  Real DOM traversal + relational block scoping + prominence matrix +
//  subject cross-validation + split-digit reconstruction + calibrated
//  probability scoring.
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import { KnowledgeBase } from './knowledge';
import type { ProviderKnowledge, EmailZone, ExtractedOTP, IntentResult, OTPSignal } from '../types/extraction.types';
import {
  buildDom, getFlattenedText, walkTextNodes, getEffectiveStyle,
  getAncestorChain, isIsolatedInParent, normalizeForExtraction,
  type DOMNode,
} from './domEngine';

const log = createLogger('CognitiveOTP');

const CODE_RE = /\b([A-Za-z0-9]{4,10})\b/g;

const OTP_INTENT_RE =
  /\b(otp|verification\s*code|security\s*code|access\s*code|login\s*code|pin|passcode|two.?factor|2fa|mfa|authenticat\w*|confirmation\s*code|auth\s*code|one.?time|verification|código|验证码|認証|인증)\b/i;
const ACTION_INTENT_RE =
  /\b(verify|confirm|activate|log\s*in|sign\s*in|authenticate|complete|submit|enter|use|type|input)\b/i;
const DIRECT_ASSIGN_RE =
  /\b(?:your\s+code\s+is|use\s+code|code\s*(?:is|:|=)|is\s+your\s+(?:code|otp|pin)|passcode\s*(?:is|:))\b/i;

const ANTI_ORDER_RE =
  /\b(order|tracking|shipment|package|invoice|receipt|transaction|ref\w*)\s*(no\.?|#|number|id)?\b/i;
const ANTI_PRICE_RE =
  /[$€£¥₹]|\b(price|total|amount|subtotal|shipping\s*fee|usd|eur|gbp|inr)\b/i;
const ANTI_DATE_RE =
  /\b(date|expires?\s*(?:on)?|valid\s*until|expiry|mm\/dd|dd\/mm|yyyy)\b/i;
const ANTI_ACCOUNT_RE =
  /\b(account|acct|a\/c|member|customer)\s*(no\.?|#|number|id)\b/i;
const ANTI_PROMO_RE =
  /\b(coupon|promo|discount|voucher|referral|gift\s*card)\s*(code)?\b/i;

interface Candidate {
  code: string;
  points: number;          // raw log-odds-ish points, unclamped
  isolated: boolean;
  fromSplit: boolean;
  fromSubjectMatch: boolean;
  node: DOMNode | null;
  contextSample: string;
}

function styleProminence(node: DOMNode): number {
  let score = 0;
  const fontSize = getEffectiveStyle(node, 'font-size');
  if (fontSize) {
    const px = parseFloat(fontSize);
    const unit = fontSize.replace(/[\d.]/g, '');
    const normalizedPx = unit === 'pt' ? px * 1.333 : unit === 'em' || unit === 'rem' ? px * 16 : px;
    if (normalizedPx >= 24) score += 22;
    else if (normalizedPx >= 18) score += 15;
    else if (normalizedPx >= 14) score += 6;
  }
  if (getEffectiveStyle(node, 'letter-spacing')) score += 12;
  const weight = getEffectiveStyle(node, 'font-weight');
  if (weight && (weight === 'bold' || parseInt(weight, 10) >= 600)) score += 10;
  const align = getEffectiveStyle(node, 'text-align');
  if (align === 'center') score += 6;

  const chain = [node.parent, ...getAncestorChain(node, 4)].filter(Boolean) as DOMNode[];
  for (const anc of chain) {
    if (/^(strong|b|code|pre|tt|kbd|mark)$/i.test(anc.tag || '')) { score += 12; break; }
  }
  for (const anc of chain) {
    if (/^h[1-3]$/i.test(anc.tag || '')) { score += 15; break; }
  }
  return Math.min(score, 60);
}

/** Relational anti-pattern check: strong reject only if the disqualifying
 *  keyword lives in the SAME tight structural scope (same td/tr/p/li) as
 *  the candidate. Weaker, decayed penalty for keywords further up the tree.
 *  This is what makes "Order #123456 ... later in the email OTP: 654321"
 *  work correctly — the two numbers are relationally isolated. */
function relationalAntiCheck(node: DOMNode, localText: string): { reject: boolean; penalty: number; reason: string } {
  const tightScopes = [node.parent, ...getAncestorChain(node, 2)].filter(Boolean) as DOMNode[];
  const tightText = tightScopes.map(getFlattenedText).join(' ');

  for (const [re, reason] of [
    [ANTI_ORDER_RE, 'order-context'],
    [ANTI_PRICE_RE, 'price-context'],
    [ANTI_ACCOUNT_RE, 'account-context'],
    [ANTI_PROMO_RE, 'promo-context'],
  ] as const) {
    if (re.test(tightText) && !OTP_INTENT_RE.test(tightText)) {
      return { reject: true, penalty: 60, reason };
    }
  }
  if (ANTI_DATE_RE.test(tightText) && !OTP_INTENT_RE.test(tightText)) {
    return { reject: false, penalty: 25, reason: 'date-context' };
  }

  // Wider (decayed) scope: only a soft penalty, never a hard reject.
  const wideScopes = getAncestorChain(node, 6);
  const wideText = wideScopes.map(getFlattenedText).join(' ').slice(0, 2000);
  let softPenalty = 0;
  if (ANTI_ORDER_RE.test(wideText) && !OTP_INTENT_RE.test(localText)) softPenalty += 8;
  if (ANTI_PRICE_RE.test(wideText) && !OTP_INTENT_RE.test(localText)) softPenalty += 6;

  return { reject: false, penalty: softPenalty, reason: '' };
}

/** Detects the classic "one digit per cell/span" OTP box UI and
 *  reconstructs the full code — solves the split-digit problem via
 *  real tree structure instead of fragile regex chains. */
function findSplitDigitCodes(root: DOMNode): Candidate[] {
  const results: Candidate[] = [];
  const containerTags = new Set(['tr', 'div', 'p', 'td', 'table']);

  for (const container of walkAllElements(root)) {
    if (!containerTags.has(container.tag || '')) continue;
    const cellLike = container.children.filter(
      (c) => c.type === 'element' && /^(td|th|span|div|li)$/i.test(c.tag || '')
    );
    if (cellLike.length < 4 || cellLike.length > 8) continue;

    const chars: string[] = [];
    let allSingle = true;
    for (const cell of cellLike) {
      const t = getFlattenedText(cell).trim();
      if (!/^[A-Za-z0-9]{1,2}$/.test(t)) { allSingle = false; break; }
      chars.push(t);
    }
    if (!allSingle) continue;

    const code = chars.join('');
    if (code.length < 4 || code.length > 8 || !/\d/.test(code)) continue;

    results.push({
      code, points: 0, isolated: true, fromSplit: true, fromSubjectMatch: false,
      node: container, contextSample: getFlattenedText(container).slice(0, 120),
    });
  }
  return results;
}

function* walkAllElements(node: DOMNode): Generator<DOMNode> {
  if (node.type === 'element') {
    yield node;
    for (const c of node.children) yield* walkAllElements(c);
  }
}

function sigmoid(points: number): number {
  const k = 0.075;
  const midpoint = 42;
  return 1 / (1 + Math.exp(-k * (points - midpoint)));
}

export function extractOTPCognitive(
  fullText: string,
  htmlBody: string,
  provider: ProviderKnowledge | null,
  zones: EmailZone[],
  intent: IntentResult,
  subject: string = ''
): ExtractedOTP | null {
  const normalizedHtml = normalizeForExtraction(htmlBody || '');
  const normalizedSubject = normalizeForExtraction(subject);
  const root = buildDom(normalizedHtml);

  const byCode = new Map<string, Candidate>();
  const upsert = (c: Candidate) => {
    const existing = byCode.get(c.code);
    if (!existing || c.points > existing.points) byCode.set(c.code, c);
  };

  // ── Strategy A: text-node scan with relational scoping ─────────────────
  for (const textNode of walkTextNodes(root)) {
    const text = textNode.text || '';
    CODE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CODE_RE.exec(text)) !== null) {
      const code = m[1]!;
      if (!/\d/.test(code)) continue;
      if (/^(\d)\1{3,}$/.test(code)) continue; // repeated digits
      if (/^(?:0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)\d*$/.test(code)) continue;

      // Reject years (e.g. 2026) if preceded by copyright or not explicitly labeled as OTP
      if (/^(?:19|20)\d{2}$/.test(code)) {
        const startIdx = m.index;
        const before = text.slice(Math.max(0, startIdx - 30), startIdx).toLowerCase();
        const after = text.slice(startIdx + code.length, startIdx + code.length + 30).toLowerCase();
        const near = before + ' ' + after;
        if (/(?:©|copyright|\(c\)|copr\.)/i.test(before) || !/(?:code|pin|otp|password|token|passcode)/i.test(near)) {
          continue;
        }
      }

      const parent = textNode.parent!;
      const localScope = [parent, ...getAncestorChain(textNode, 1)].filter(Boolean) as DOMNode[];
      const localText = localScope.map(getFlattenedText).join(' ');

      // Widen scope to the parent table row — solves label-in-adjacent-cell.
      const rowAncestor = findAncestorTagName(textNode, 'tr', 3);
      const relationalText = rowAncestor ? getFlattenedText(rowAncestor) : localText;

      const anti = relationalAntiCheck(textNode, localText);
      if (anti.reject) continue;

      let points = 30; // base: plausible code shape
      if (OTP_INTENT_RE.test(relationalText)) points += 36;
      if (ACTION_INTENT_RE.test(relationalText)) points += 14;
      if (DIRECT_ASSIGN_RE.test(relationalText)) points += 28;
      points += styleProminence(textNode.parent!);
      if (isIsolatedInParent(textNode)) points += 24;
      points -= anti.penalty;
      if (provider?.otpLength === code.length) points += 24;
      if (intent.intent === 'verification') points += 18;
      // Classic 6-digit codes dominate real OTP mail — slight prior
      if (/^\d{6}$/.test(code)) points += 8;
      else if (/^\d{4}$/.test(code) || /^\d{8}$/.test(code)) points += 4;

      // Run curated KnowledgeBase label patterns against the LOCAL block only
      // (not the whole email) — keeps their precision, drops their false-proximity risk.
      for (const pat of KnowledgeBase.otpPatterns) {
        if (pat.name.includes('colon-prefixed') || pat.name.includes('your-code-is') || pat.name.includes('code-is-yours')) {
          const rx = new RegExp(pat.pattern.source, pat.pattern.flags.replace('g', ''));
          if (rx.test(relationalText)) { points += 15; break; }
        }
      }

      upsert({
        code, points, isolated: isIsolatedInParent(textNode), fromSplit: false,
        fromSubjectMatch: false, node: textNode, contextSample: relationalText.slice(0, 150),
      });
    }
  }

  // ── Strategy B: split-digit box reconstruction ──────────────────────────
  for (const split of findSplitDigitCodes(root)) {
    const relationalText = split.contextSample;
    let points = 65; // structurally near-unfakeable signal
    if (OTP_INTENT_RE.test(relationalText)) points += 24;
    const anti = relationalAntiCheck(split.node!, relationalText);
    if (anti.reject) continue;
    points -= anti.penalty;
    upsert({ ...split, points });
  }

  // ── Strategy C: subject-body cross-confirmation ─────────────────────────
  for (const c of byCode.values()) {
    if (normalizedSubject && normalizedSubject.includes(c.code)) {
      c.points += 42;
      c.fromSubjectMatch = true;
    }
  }

  // ── Strategy D: dominant single-candidate floor (SMS-autofill heuristic) ─
  const numericCandidates = [...byCode.values()].filter((c) => /^\d{4,8}$/.test(c.code));
  if (numericCandidates.length === 1 && numericCandidates[0]) {
    numericCandidates[0].points = Math.max(numericCandidates[0].points, 62);
  }

  if (byCode.size === 0) {
    log.debug('Cognitive OTP: no candidates found');
    return null;
  }

  const candidates = [...byCode.values()].sort((a, b) => b.points - a.points);
  const best = candidates[0]!;
  const runnerUp = candidates[1];

  let ambiguous = false;
  // Only mark ambiguous when runner-up is truly close (reduces false soft-caps)
  if (runnerUp && runnerUp.code !== best.code && best.points - runnerUp.points < 10) {
    ambiguous = true;
  }

  const confidence = ambiguous ? Math.min(sigmoid(best.points), 0.49) : sigmoid(best.points);

  const matchedSignals: OTPSignal[] = [];
  if (best.fromSubjectMatch) matchedSignals.push({ name: 'subject-body-agreement', points: 35, layer: 'cross-source', detail: 'Code independently confirmed in subject line' });
  if (best.fromSplit) matchedSignals.push({ name: 'split-digit-reconstruction', points: 55, layer: 'structural', detail: 'Reconstructed from per-character DOM cells' });
  if (best.isolated) matchedSignals.push({ name: 'dom-isolation', points: 20, layer: 'isolation', detail: 'Sole content of its DOM parent' });

  log.info(`Cognitive OTP: ${best.code} (${(confidence * 100).toFixed(0)}%) points=${best.points.toFixed(1)} ambiguous=${ambiguous}`);

  return {
    code: best.code,
    rawCode: best.code,
    score: confidence * 100,
    confidence,
    type: 'verification-code',
    length: best.code.length,
    format: /^\d+$/.test(best.code) ? 'numeric' : 'alphanumeric',
    strategy: best.fromSplit ? 'html-prominent' : 'proximity-inference',
    context: best.contextSample,
    label: null,
    fromUrl: false,
    urlParam: null,
    sourceUrl: null,
    visualProminence: best.node ? styleProminence(best.node) : 0,
    providerMatch: provider && provider.otpLength === best.code.length ? {
      name: provider.name, expectedLength: provider.otpLength || 0,
      expectedFormat: provider.otpFormat || 'numeric', confidence: provider.confidence,
    } : null,
    matchedSignals,
    antiSignals: [],
    reasoning: {
      steps: [
        {
          layer: 'dom-structural',
          observation: `Code resolved via relational DOM scope: "${best.contextSample.slice(0, 80)}..."`,
          conclusion: `Structural + semantic points: ${best.points.toFixed(1)}`,
          impact: 'positive',
        },
        ...(ambiguous ? [{
          layer: 'ambiguity' as const, observation: 'Runner-up candidate within margin.',
          conclusion: 'Confidence capped for manual review.', impact: 'negative' as const,
        }] : []),
      ],
      summary: `Extracted '${best.code}' via Cognitive DOM-Relational analysis.`,
      confidenceExplanation: `Calibrated probability ${(confidence * 100).toFixed(0)}% from sigmoid(${best.points.toFixed(1)} pts).`,
    },
  };
}

function findAncestorTagName(node: DOMNode, tag: string, maxDepth: number): DOMNode | null {
  let cur = node.parent;
  let depth = 0;
  while (cur && depth < maxDepth) {
    if (cur.tag === tag) return cur;
    cur = cur.parent;
    depth++;
  }
  return null;
}
