// src/services/extraction/cognitiveLinkExtractor.ts
// ═══════════════════════════════════════════════════════════════════════
//  COGNITIVE LINK EXTRACTOR
//  Real DOM anchor resolution + cycle-safe recursive ESP unwrapping +
//  multi-mention agreement + origin-binding trust matrix.
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import type { EmailIntent, ExtractedLink, IntentResult, ProviderKnowledge, EmailZone } from '../types/extraction.types';
import { buildDom, getFlattenedText, walkAllElementsExported, getAncestorChain, normalizeForExtraction, type DOMNode } from './domEngine';
import { normalizeUrl, analyzeUrlParams } from './urlExtractor';
import {
  scoreActivationLink,
  SELECT_MIN_QUALITY,
} from './activationLinkGuard';
import { getContextAround } from './zoneAnalyzer';

const log = createLogger('CognitiveLink');

const ACTION_ANCHOR_RE =
  /\b(verify|confirm|activate|validate|validation|reset|get started|accept invite|sign in|log in|continue|proceed|authorize|approve|join|claim|enable|unlock|secure|active\s+(?:your\s+)?(?:mail|email|account)|this\s+was\s+me|it\s+was\s+me|click\s+(?:here\s+)?to\s+(?:verify|confirm|activate|validate)|verificar|confirmar|activar|validar)\b/i;
const GENERIC_FOOTER_RE =
  /\b(unsubscribe|preferences|privacy|terms|copyright|view in browser|shop now|learn more|dashboard|buy now|download app)\b/i;

const PATH_SCORE_MAP: Array<[RegExp, number, EmailIntent]> = [
  [/\/(?:activate|activation)/i, 32, 'activation'],
  [/\/(?:verify|verification)/i, 30, 'activation'],
  [/\/(?:confirm|confirmation)/i, 28, 'activation'],
  [/\/(?:validate|validation)/i, 28, 'activation'],
  [/\/(?:reset|forgot)[-_]?password/i, 32, 'password-reset'],
  [/\/magic|passwordless/i, 28, 'activation'],
  [/\/(?:invite|invitation)/i, 28, 'activation'],
  [/\/email\/action|auth\/action|email[-_]?action/i, 30, 'activation'],
  [/\/(?:claim|enable|unlock)/i, 24, 'activation'],
  [/\/onboard/i, 22, 'activation'],
  [/\/(?:oauth\/)?callback/i, 22, 'activation'],
  [/\/(?:auth|sso)/i, 18, 'activation'],
];

/** Cycle-safe recursive unwrapper — fixes the missing-cycle-guard bug. */
export function recursiveUnwrap(url: string, depth = 0, seen: Set<string> = new Set()): string {
  if (depth > 6 || !url || seen.has(url)) return url;
  seen.add(url);

  let candidate: string | null = null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    const redirectKeys = ['url', 'u', 'uri', 'next', 'redirect', 'redirect_to', 'redirecturl', 'target', 'dest', 'destination', 'continue', 'returnurl'];
    for (const [key, value] of u.searchParams) {
      if (redirectKeys.includes(key.toLowerCase()) && value) {
        try {
          const decoded = decodeURIComponent(value);
          if (/^https?:\/\//i.test(decoded)) { candidate = decoded; break; }
        } catch { /* ignore */ }
      }
    }

    if (!candidate && (host.includes('sendgrid.net') || host.includes('.u.nr'))) {
      const upn = u.searchParams.get('upn');
      if (upn) {
        try {
          const decoded = atob(upn.replace(/-/g, '+').replace(/_/g, '/'));
          if (decoded.startsWith('http')) candidate = decoded;
        } catch { /* not base64 */ }
      }
    }

    if (!candidate && (host.includes('mailgun') || host.includes('mailchi.mp') || host.includes('list-manage'))) {
      for (const part of u.pathname.split('/').filter(Boolean)) {
        if (part.length > 20) {
          try {
            const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, '=');
            const decoded = atob(padded);
            if (decoded.startsWith('http')) { candidate = decoded; break; }
          } catch { /* not base64 */ }
        }
      }
    }

    if (!candidate && host.includes('safelinks.protection.outlook.com')) {
      const safeUrl = u.searchParams.get('url');
      if (safeUrl) candidate = decodeURIComponent(safeUrl);
    }
  } catch {
    return url;
  }

  if (!candidate || candidate === url) return url;
  return recursiveUnwrap(candidate, depth + 1, seen);
}

function isCtaLike(anchor: DOMNode): boolean {
  const chain = [anchor, ...getAncestorChain(anchor, 2)];
  for (const node of chain) {
    if (node.attrs?.role === 'button') return true;
    const cls = node.attrs?.class || '';
    if (/\b(btn|button|cta)\b/i.test(cls)) return true;
    const style = node.ownStyle;
    if (style && (style['background-color'] || style['background']) && style['padding']) return true;
    if (node.attrs?.bgcolor) return true;
  }
  return false;
}

export function extractLinkCognitive(
  htmlBody: string,
  fullText: string,
  intent: IntentResult,
  provider: ProviderKnowledge | null,
  zones: EmailZone[],
  urls: string[],
  expectedDomains: string[] = []
): ExtractedLink | null {
  const normalizedHtml = normalizeForExtraction(htmlBody || '');
  const root = buildDom(normalizedHtml);

  // Map href -> anchor node(s) for O(1)-ish lookup with multi-mention support.
  const anchorsByHref = new Map<string, DOMNode[]>();
  for (const el of walkAllElementsExported(root)) {
    if (el.tag !== 'a' || !el.attrs?.href) continue;
    const href = el.attrs.href;
    if (!anchorsByHref.has(href)) anchorsByHref.set(href, []);
    anchorsByHref.get(href)!.push(el);
  }

  interface Cand {
    url: string;
    points: number;
    type: EmailIntent;
    anchorText: string;
    isCTA: boolean;
    originBound: boolean;
    mentions: number;
    surrounding: string;
    gateQuality: number;
  }
  const byUrl = new Map<string, Cand>();

  // Brand-agnostic: local body context near each URL (not provider scripts)
  const bodyText = fullText || getFlattenedText(root);

  for (const rawUrl of urls) {
    if (!rawUrl?.startsWith('http')) continue;
    const workingUrl = recursiveUnwrap(rawUrl);
    let normalized: string;
    try { normalized = normalizeUrl(workingUrl); } catch { continue; }

    // Anchor-based signal via REAL DOM lookup first (needed for guard)
    const anchorNodes = anchorsByHref.get(rawUrl) || anchorsByHref.get(workingUrl) || [];
    let anchorText = '';
    let isCTA = false;
    for (const anchor of anchorNodes) {
      const text = getFlattenedText(anchor).trim();
      if (text) anchorText = text;
      if (isCtaLike(anchor)) isCTA = true;
    }

    // Smart local context: sentence/paragraph around this URL or its CTA text
    const surroundingText =
      getContextAround(bodyText, workingUrl, 180) ||
      getContextAround(bodyText, rawUrl, 180) ||
      (anchorText ? getContextAround(bodyText, anchorText, 180) : '') ||
      '';

    // HARD GATE: reject marketing / footer / dashboard before any scoring
    const gate = scoreActivationLink(workingUrl, anchorText, surroundingText);
    if (gate.hardReject) {
      log.debug(`Cognitive skip hard-reject: ${workingUrl.substring(0, 60)} (${gate.reasons.join(',')})`);
      continue;
    }

    // Start from activation quality — NOT a free +30 for every URL
    // Primary score is semantic quality; path map is only a small structural bonus.
    let points = gate.quality * 1.1;
    let detectedType: EmailIntent =
      gate.cls === 'password-reset'
        ? 'password-reset'
        : gate.cls === 'unknown' || gate.cls === 'reject'
          ? 'other'
          : 'activation';

    try {
      const u = new URL(workingUrl);
      const path = u.pathname.toLowerCase();

      for (const [re, score, type] of PATH_SCORE_MAP) {
        if (re.test(path)) {
          points += score * 0.45; // secondary structural hint only
          if (detectedType === 'other') detectedType = type;
          break;
        }
      }

      const paramAn = analyzeUrlParams(workingUrl);
      // Token alone is weak; only boost when path/anchor already prove action
      if (paramAn.hasToken && detectedType !== 'other') points += 14;
      else if (paramAn.hasToken) points += 3;
      if (paramAn.hasCode && detectedType !== 'other') points += 10;
      if (paramAn.tokenLength > 30 && detectedType !== 'other') points += 8;

      // Origin binding is a soft trust signal only — never required for selection
      if (expectedDomains.length > 0) {
        const host = u.hostname.toLowerCase();
        const bound = expectedDomains.some((d) => {
          const dom = d.toLowerCase().replace(/^\.+/, '');
          return host === dom || host.endsWith(`.${dom}`);
        });
        if (bound) points += 12;
        else points -= 6;
      }
    } catch { continue; }

    if (GENERIC_FOOTER_RE.test(anchorText)) points -= 60;
    else if (ACTION_ANCHOR_RE.test(anchorText)) points += 22;
    if (isCTA && ACTION_ANCHOR_RE.test(anchorText)) points += 14;
    else if (isCTA) points += 3;

    // Intent alignment is soft — extraction must still work without knowing the brand
    if (intent.intent === detectedType) points += 10;
    if (intent.intent === 'activation' && detectedType === 'activation') points += 6;

    // Drop weak "other" candidates — they cause wrong auto-opens
    if (detectedType === 'other' && gate.quality < SELECT_MIN_QUALITY) {
      continue;
    }

    const existing = byUrl.get(normalized);
    let originBound = false;
    try {
      if (expectedDomains.length > 0) {
        const host = new URL(workingUrl).hostname.toLowerCase();
        originBound = expectedDomains.some((d) => {
          const dom = d.toLowerCase().replace(/^\.+/, '');
          return host === dom || host.endsWith(`.${dom}`);
        });
      }
    } catch { /* ignore */ }

    if (existing) {
      existing.mentions += 1;
      existing.points = Math.max(existing.points, points) + 8;
      if (anchorText) existing.anchorText = existing.anchorText || anchorText;
      existing.isCTA = existing.isCTA || isCTA;
      if (surroundingText) existing.surrounding = existing.surrounding || surroundingText;
      existing.gateQuality = Math.max(existing.gateQuality, gate.quality);
    } else {
      byUrl.set(normalized, {
        url: normalized,
        points,
        type: detectedType,
        anchorText,
        isCTA,
        originBound,
        mentions: 1,
        surrounding: surroundingText,
        gateQuality: gate.quality,
      });
    }
  }

  if (byUrl.size === 0) return null;

  // Rank by activation quality first (smart), then points — never by brand list
  const sorted = [...byUrl.values()]
    .filter((c) => c.type !== 'other' || c.gateQuality >= SELECT_MIN_QUALITY)
    .sort((a, b) => {
      if (Math.abs(a.gateQuality - b.gateQuality) > 6) return b.gateQuality - a.gateQuality;
      const aAct = a.type !== 'other' ? 1 : 0;
      const bAct = b.type !== 'other' ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;
      return b.points - a.points;
    });

  const best = sorted[0];
  if (!best) return null;

  const finalGate = scoreActivationLink(best.url, best.anchorText, best.surrounding || '');
  if (finalGate.hardReject || finalGate.quality < SELECT_MIN_QUALITY) {
    log.info(
      `Cognitive Link rejected best candidate (quality=${finalGate.quality}): ${best.url.substring(0, 70)}`
    );
    return null;
  }

  const confidence = Math.min(100, Math.max(finalGate.quality, best.points * 0.75));

  log.info(
    `Cognitive Link: ${best.url.substring(0, 70)}... points=${best.points.toFixed(0)} quality=${finalGate.quality} CTA=${best.isCTA} reasons=${finalGate.reasons.join('+')}`
  );

  return {
    url: best.url,
    score: confidence,
    confidence,
    type: best.type === 'other' ? 'activation' : best.type,
    hasEmbeddedCode: false,
    embeddedCode: null,
    embeddedCodeParam: null,
    anchorText: best.anchorText,
    context: best.surrounding || best.anchorText,
    domainTrust: best.originBound ? 90 : Math.max(40, finalGate.quality * 0.7),
    originBound: best.originBound,
    isShortened: false,
    redirectChain: [],
  };
}
