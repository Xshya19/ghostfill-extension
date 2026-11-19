import { rootDomain } from '../../utils/core';
import { sanitizeEmailFrom } from '../../utils/sanitization.core';
import { verificationSiteRoot } from '../../utils/verificationSite';
import { hasFreshCodeSignal, normalizeUrl, stripQuotedHistory } from '../utils/extraction.utils';
import { scoreActivationLink, type ActivationLinkVerdict } from './activationLinkGuard';
import { recursiveUnwrap } from './cognitiveLinkExtractor';
import {
  buildDom,
  getAncestorChain,
  getEffectiveStyle,
  getFlattenedText,
  isIsolatedInParent,
  normalizeForExtraction,
  type DOMNode,
} from './domEngine';
import { extractExplicitVerificationCode, isSubjectDomainToken } from './explicitCode';
import { getContextAround, stripHtmlPreserveStructure } from './zoneAnalyzer';

export type DocumentZone =
  | 'subject'
  | 'preheader'
  | 'hero'
  | 'code-box'
  | 'cta'
  | 'body-primary'
  | 'footer'
  | 'quoted';

export interface CodeDomProminence {
  fontSizePx: number;
  isBold: boolean;
  isMonospace: boolean;
  hasLetterSpacing: boolean;
  isIsolated: boolean;
  isSplitBox: boolean;
  verticalRatio: number;
  zone: DocumentZone;
}

export interface DocumentCodeCandidate {
  code: string;
  rawCode: string;
  format: 'numeric' | 'alphanumeric' | 'dash-separated' | 'space-separated';
  domProminence: CodeDomProminence;
  tightBlockText: string;
  rowText: string;
  inSubject: boolean;
  inVisibleBodyOutsideUrls: boolean;
  embeddedInEmailHandle: boolean;
  insideUrlOnly: boolean;
  isExplicitBodyCode: boolean;
  fromQuotedRegion: boolean;
}

export interface DocumentLinkCandidate {
  url: string;
  rawUrl: string;
  anchorText: string;
  isCTA: boolean;
  zone: DocumentZone;
  surroundingText: string;
  mentionCount: number;
  hasPlaintextFallbackDuplicate: boolean;
  gate: ActivationLinkVerdict;
  host: string;
  hostMatchesExpected: boolean;
  hostMatchesSender: boolean;
}

export interface CompiledEmailDocument {
  subject: string;
  sender: string;
  senderDomain: string | null;
  senderRoot: string | null;
  expectedRoots: Set<string>;
  plainBody: string;
  effectiveBody: string;
  effectiveHtmlText: string;
  visibleText: string;
  quotedText: string;
  htmlBody: string;
  explicitBodyCode: string | null;
  allRawUrls: string[];
  hasSplitDigitBox: boolean;
  hasHiddenTrapNode: boolean;
  zonesPresent: DocumentZone[];
  zoneTexts: Record<DocumentZone, string[]>;
  codeCandidates: DocumentCodeCandidate[];
  linkCandidates: DocumentLinkCandidate[];
}

const CODE_TOKEN_RE = /\b([A-Za-z0-9]{4,12})\b/g;
const HYPHENATED_CODE_RE = /\b([A-Z0-9]{3,5})[-–—]([A-Z0-9]{3,5})\b/gi;
const SPACED_DIGITS_RE =
  /(?:code|pin|otp|passcode|código|clave|验证码|認証|인증)\s*(?:is|:|=)?\s*([A-Z0-9](?:\s+[A-Z0-9]){3,7})\b/gi;
const BRACKETED_CODE_RE =
  /(?:code|pin|otp|passcode|password)\s*(?:is|:|=)?\s*(?:\[|\()\s*([A-Z0-9]{4,10})\s*(?:\]|\))/gi;
const WICG_ORIGIN_OTP_RE = /(?:^|[\r\n\s])@([a-z0-9.-]+\.[a-z]{2,})\s+#([A-Za-z0-9]{4,10})\b/gim;
const TECH_IDENTIFIER_RE =
  /^(?:utf8|utf16|base64|sha1|sha256|sha512|md5|mp3|mp4|h264|ipv4|ipv6|http1|http2|http3|html5|css3|oauth2|es20\d{2})$/i;
const PLAIN_URL_RE = /https?:\/\/[^\s<>"')\]}]+/gi;

const HIDDEN_STYLE_TESTS: Array<
  (style: Record<string, string>, attrs: Record<string, string>) => boolean
> = [
  (s) => s.display === 'none',
  (s) => s.visibility === 'hidden',
  (s) => s.opacity === '0' || s.opacity === '0.0',
  (s) => {
    const fs = s['font-size'];
    if (!fs) {
      return false;
    }
    const n = Number.parseFloat(fs);
    return Number.isFinite(n) && n === 0;
  },
  (s) => {
    const mh = s['max-height'];
    if (!mh) {
      return false;
    }
    const n = Number.parseFloat(mh);
    return Number.isFinite(n) && n === 0 && s.overflow === 'hidden';
  },
  (s) => s['mso-hide'] === 'all',
  (_s, a) => a.type === 'hidden' || a['aria-hidden'] === 'true',
];

function isNodeHidden(node: DOMNode): boolean {
  if (node.type !== 'element') {
    return false;
  }
  const style = node.ownStyle || {};
  const attrs = node.attrs || {};
  for (const check of HIDDEN_STYLE_TESTS) {
    if (check(style, attrs)) {
      return true;
    }
  }
  return false;
}

function isQuotedElement(node: DOMNode): boolean {
  if (node.type !== 'element') {
    return false;
  }
  if (node.tag === 'blockquote') {
    return true;
  }
  const cls = (node.attrs?.class || '').toLowerCase();
  const id = (node.attrs?.id || '').toLowerCase();
  return (
    cls.includes('gmail_quote') ||
    cls.includes('yahoo_quoted') ||
    cls.includes('moz-cite-prefix') ||
    id === 'divrplyfwdmsg'
  );
}

function parseFontSizePx(raw: string | null): number {
  if (!raw) {
    return 14;
  }
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) {
    return 14;
  }
  const unit = raw.replace(/[\d.\s]/g, '').toLowerCase();
  if (unit === 'pt') {
    return n * 1.333;
  }
  if (unit === 'em' || unit === 'rem') {
    return n * 16;
  }
  return n;
}

function isCtaAnchor(anchor: DOMNode): boolean {
  const chain = [anchor, ...getAncestorChain(anchor, 2)];
  for (const node of chain) {
    if (node.attrs?.role === 'button') {
      return true;
    }
    const cls = node.attrs?.class || '';
    if (/\b(btn|button|cta)\b/i.test(cls)) {
      return true;
    }
    const style = node.ownStyle;
    if (style && (style['background-color'] || style.background) && style.padding) {
      return true;
    }
    if (node.attrs?.bgcolor) {
      return true;
    }
  }
  return false;
}

function inferDomZone(
  node: DOMNode,
  totalLen: number,
  isQuoted: boolean,
  isCTA: boolean
): DocumentZone {
  if (isQuoted) {
    return 'quoted';
  }
  if (isCTA) {
    return 'cta';
  }
  const chain = [node, ...getAncestorChain(node, 4)];
  for (const anc of chain) {
    const cls = (anc.attrs?.class || '').toLowerCase();
    const id = (anc.attrs?.id || '').toLowerCase();
    if (cls.includes('preheader') || id.includes('preheader')) {
      return 'preheader';
    }
    if (anc.tag === 'footer' || cls.includes('footer') || id.includes('footer')) {
      return 'footer';
    }
    if (
      anc.tag === 'code' ||
      anc.tag === 'pre' ||
      cls.includes('otp') ||
      cls.includes('code-box')
    ) {
      return 'code-box';
    }
  }
  const ratio = totalLen > 0 ? node.startIndex / totalLen : 0;
  if (ratio < 0.25) {
    return 'hero';
  }
  if (ratio > 0.82) {
    return 'footer';
  }
  return 'body-primary';
}

function findAncestorTagName(node: DOMNode, tag: string, maxDepth: number): DOMNode | null {
  let cur = node.parent;
  let depth = 0;
  while (cur && depth < maxDepth) {
    if (cur.tag === tag) {
      return cur;
    }
    cur = cur.parent;
    depth++;
  }
  return null;
}

function computeRootSet(domains: string[]): Set<string> {
  const out = new Set<string>();
  for (const d of domains) {
    if (!d) {
      continue;
    }
    try {
      const host = d.includes('://') ? new URL(d).hostname : d;
      if (host.includes('.')) {
        out.add(verificationSiteRoot(rootDomain(host.toLowerCase())));
      }
    } catch {
      if (d.includes('.')) {
        out.add(verificationSiteRoot(rootDomain(d.toLowerCase())));
      }
    }
  }
  return out;
}

function extractSenderDomain(sender: string): { domain: string | null; root: string | null } {
  const m = sender.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (!m?.[1]) {
    return { domain: null, root: null };
  }
  const domain = m[1].toLowerCase();
  return { domain, root: verificationSiteRoot(rootDomain(domain)) };
}

function isUrlEmbeddedToken(text: string, idx: number, length: number): boolean {
  const windowStart = Math.max(0, text.slice(0, idx).search(/\S+$/));
  const slice = text.slice(windowStart, Math.min(text.length, idx + length + 160));
  const localStart = idx - windowStart;
  const localEnd = localStart + length;
  PLAIN_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLAIN_URL_RE.exec(slice)) !== null) {
    if (localStart >= m.index && localEnd <= m.index + m[0].length) {
      return true;
    }
  }
  const before = slice.slice(Math.max(0, localStart - 40), localStart).toLowerCase();
  return /(?:[?&#/]|%3[fba]|&amp;)[a-z0-9_.-]{1,40}=$/i.test(before);
}

function appearsStandaloneInVisibleText(code: string, visibleText: string): boolean {
  if (!code || !visibleText) {
    return false;
  }
  const stripped = visibleText.replace(PLAIN_URL_RE, ' ');
  const escaped = code
    .replace(/[-\s]/g, '')
    .split('')
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[-\\s]?');
  const re = new RegExp(`(?:^|[\\s>\\[\\(:])(${escaped})(?=$|[\\s<,;!?.)\\]])`, 'gim');
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const after = stripped[m.index + m[0].length] || '';
    if (after !== '@' && !stripped.slice(m.index, m.index + m[0].length + 1).includes('@')) {
      return true;
    }
  }
  return false;
}

function isTrivialCodeSequence(code: string): boolean {
  // Reject 0123, 123456, 987654 etc.
  return /^(?:0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)\d*$/.test(
    code
  );
}

function isPlausibleCandidateToken(code: string): boolean {
  if (code.length < 4 || code.length > 12) {
    return false;
  }
  if (!/\d/.test(code)) {
    return false;
  }
  if (TECH_IDENTIFIER_RE.test(code)) {
    return false;
  }
  if (isTrivialCodeSequence(code)) {
    return false;
  }
  return true;
}

export function compileEmailDocument(
  subject: string,
  body: string,
  htmlBody = '',
  senderEmail = '',
  expectedDomains: string[] = []
): CompiledEmailDocument {
  const normSubject = normalizeForExtraction(subject).trim().slice(0, 500);
  const normBody = normalizeForExtraction(body);
  const normHtmlBody = normalizeForExtraction(htmlBody);
  const cleanSender = sanitizeEmailFrom(senderEmail);
  const { domain: senderDomain, root: senderRoot } = extractSenderDomain(cleanSender);
  const expectedRoots = computeRootSet(expectedDomains);

  const zoneTexts: Record<DocumentZone, string[]> = {
    subject: normSubject ? [normSubject] : [],
    preheader: [],
    hero: [],
    'code-box': [],
    cta: [],
    'body-primary': [],
    footer: [],
    quoted: [],
  };

  let visibleHtmlText = '';
  let quotedText = '';
  let hasSplitDigitBox = false;
  let hasHiddenTrapNode = false;

  const anchorsByRawUrl = new Map<
    string,
    { anchorText: string; isCTA: boolean; zone: DocumentZone }[]
  >();
  const rawHtmlUrls: string[] = [];
  const rawCodeCandidates: DocumentCodeCandidate[] = [];
  const codeSeen = new Map<string, DocumentCodeCandidate>();

  const registerCode = (cand: DocumentCodeCandidate) => {
    const existing = codeSeen.get(cand.code);
    if (!existing) {
      codeSeen.set(cand.code, cand);
      rawCodeCandidates.push(cand);
      return;
    }
    const mergedOutside = existing.inVisibleBodyOutsideUrls || cand.inVisibleBodyOutsideUrls;
    const mergedInsideUrlOnly = existing.insideUrlOnly && cand.insideUrlOnly;
    // Prefer non-quoted, visible non-URL, explicitly labeled, split-box, or higher prominence copy
    const existingScore =
      (existing.fromQuotedRegion ? -10 : 0) +
      (existing.inVisibleBodyOutsideUrls ? 6 : 0) +
      (existing.isExplicitBodyCode ? 5 : 0) +
      (existing.domProminence.isSplitBox ? 4 : 0) +
      existing.domProminence.fontSizePx;
    const nextScore =
      (cand.fromQuotedRegion ? -10 : 0) +
      (cand.inVisibleBodyOutsideUrls ? 6 : 0) +
      (cand.isExplicitBodyCode ? 5 : 0) +
      (cand.domProminence.isSplitBox ? 4 : 0) +
      cand.domProminence.fontSizePx;
    if (nextScore > existingScore) {
      cand.inVisibleBodyOutsideUrls = mergedOutside;
      cand.insideUrlOnly = mergedInsideUrlOnly;
      const idx = rawCodeCandidates.indexOf(existing);
      if (idx >= 0) {
        rawCodeCandidates[idx] = cand;
      }
      codeSeen.set(cand.code, cand);
    } else {
      existing.inVisibleBodyOutsideUrls = mergedOutside;
      existing.insideUrlOnly = mergedInsideUrlOnly;
    }
  };

  if (normHtmlBody) {
    const root = buildDom(normHtmlBody);
    const totalLen = Math.max(1, normHtmlBody.length);
    const containerTags = new Set(['tr', 'div', 'p', 'td', 'table']);

    const walk = (node: DOMNode, inQuoted: boolean): void => {
      if (isNodeHidden(node)) {
        hasHiddenTrapNode = true;
        return;
      }
      const nextQuoted = inQuoted || isQuotedElement(node);

      if (node.type === 'element') {
        if (node.tag === 'a' && node.attrs?.href) {
          const href = node.attrs.href.replace(/&amp;/gi, '&').trim();
          if (/^https?:\/\//i.test(href)) {
            if (rawHtmlUrls.length < 48) {
              rawHtmlUrls.push(href);
            }
            const anchorText = getFlattenedText(node).replace(/\s+/g, ' ').trim();
            const isCTA = isCtaAnchor(node);
            const zone = inferDomZone(node, totalLen, nextQuoted, isCTA);
            if (anchorText) {
              zoneTexts[zone].push(anchorText);
            }
            const list = anchorsByRawUrl.get(href) ?? [];
            list.push({ anchorText, isCTA, zone });
            anchorsByRawUrl.set(href, list);
          }
        }

        // Check split-digit box container
        if (!nextQuoted && containerTags.has(node.tag || '')) {
          const cells = node.children.filter(
            (c) => c.type === 'element' && /^(td|th|span|div|li)$/i.test(c.tag || '')
          );
          if (cells.length >= 4 && cells.length <= 8) {
            const chars: string[] = [];
            let allSingle = true;
            for (const cell of cells) {
              if (isNodeHidden(cell)) {
                allSingle = false;
                break;
              }
              const txt = getFlattenedText(cell).trim();
              if (!/^[A-Za-z0-9]{1,2}$/.test(txt)) {
                allSingle = false;
                break;
              }
              chars.push(txt);
            }
            if (allSingle) {
              const joined = chars.join('');
              if (joined.length >= 4 && joined.length <= 8 && /\d/.test(joined)) {
                hasSplitDigitBox = true;
                const rowAnc = findAncestorTagName(node, 'tr', 3);
                const rowText = getFlattenedText(rowAnc || node)
                  .replace(/\s+/g, ' ')
                  .trim();
                const zone = inferDomZone(node, totalLen, false, false);
                registerCode({
                  code: joined,
                  rawCode: joined,
                  format: /^\d+$/.test(joined) ? 'numeric' : 'alphanumeric',
                  domProminence: {
                    fontSizePx: parseFontSizePx(getEffectiveStyle(node, 'font-size')),
                    isBold: true,
                    isMonospace: /mono|courier|consolas/i.test(
                      getEffectiveStyle(node, 'font-family') || ''
                    ),
                    hasLetterSpacing: true,
                    isIsolated: true,
                    isSplitBox: true,
                    verticalRatio: node.startIndex / totalLen,
                    zone: zone === 'footer' ? 'code-box' : zone,
                  },
                  tightBlockText: rowText.slice(0, 240),
                  rowText: rowText.slice(0, 320),
                  inSubject: normSubject.toLowerCase().includes(joined.toLowerCase()),
                  inVisibleBodyOutsideUrls: true,
                  embeddedInEmailHandle: false,
                  insideUrlOnly: false,
                  isExplicitBodyCode: false,
                  fromQuotedRegion: false,
                });
              }
            }
          }
        }

        for (const child of node.children) {
          walk(child, nextQuoted);
        }
        return;
      }

      // Text node
      const rawText = (node.text || '').replace(/\s+/g, ' ');
      const trimmed = rawText.trim();
      if (!trimmed) {
        return;
      }

      const zone = inferDomZone(node, totalLen, nextQuoted, false);
      zoneTexts[zone].push(trimmed);

      if (nextQuoted) {
        quotedText += (quotedText ? '\n' : '') + trimmed;
      } else {
        visibleHtmlText += (visibleHtmlText ? ' ' : '') + trimmed;
      }

      // Scan tokens in this text node with DOM metadata
      const parent = node.parent;
      const chain = [parent, ...getAncestorChain(node, 3)].filter(Boolean) as DOMNode[];
      const tightBlock =
        findAncestorTagName(node, 'p', 2) ||
        findAncestorTagName(node, 'td', 2) ||
        findAncestorTagName(node, 'div', 2) ||
        parent ||
        node;
      const rowBlock = findAncestorTagName(node, 'tr', 3) || tightBlock;
      const tightText = getFlattenedText(tightBlock).replace(/\s+/g, ' ').trim();
      const rowText = getFlattenedText(rowBlock).replace(/\s+/g, ' ').trim();

      const fontSizePx = parseFontSizePx(getEffectiveStyle(node, 'font-size'));
      const weight = getEffectiveStyle(node, 'font-weight') || '';
      const isBold =
        weight === 'bold' ||
        Number.parseInt(weight, 10) >= 600 ||
        chain.some((a) => /^(strong|b|h[1-3])$/i.test(a.tag || ''));
      const isMonospace =
        /mono|courier|consolas|menlo/i.test(getEffectiveStyle(node, 'font-family') || '') ||
        chain.some((a) => /^(code|pre|tt|kbd)$/i.test(a.tag || ''));
      const hasLetterSpacing = Boolean(getEffectiveStyle(node, 'letter-spacing'));
      const isolated = isIsolatedInParent(node);

      CODE_TOKEN_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CODE_TOKEN_RE.exec(rawText)) !== null) {
        const token = m[1]!;
        if (!isPlausibleCandidateToken(token)) {
          continue;
        }
        if (isSubjectDomainToken(token, normSubject)) {
          continue;
        }
        const insideUrl = isUrlEmbeddedToken(rawText, m.index, token.length);
        registerCode({
          code: token,
          rawCode: token,
          format: /^\d+$/.test(token) ? 'numeric' : 'alphanumeric',
          domProminence: {
            fontSizePx,
            isBold,
            isMonospace,
            hasLetterSpacing,
            isIsolated: isolated,
            isSplitBox: false,
            verticalRatio: node.startIndex / totalLen,
            zone,
          },
          tightBlockText: tightText.slice(0, 240),
          rowText: rowText.slice(0, 320),
          inSubject: normSubject.toLowerCase().includes(token.toLowerCase()),
          inVisibleBodyOutsideUrls: !insideUrl && !nextQuoted,
          embeddedInEmailHandle: false,
          insideUrlOnly: insideUrl,
          isExplicitBodyCode: false,
          fromQuotedRegion: nextQuoted,
        });
      }

      // Hyphenated codes (e.g., 123-456, K9X-4B2)
      HYPHENATED_CODE_RE.lastIndex = 0;
      while ((m = HYPHENATED_CODE_RE.exec(rawText)) !== null) {
        const clean = `${m[1]}${m[2]}`;
        if (!isPlausibleCandidateToken(clean)) {
          continue;
        }
        if (isUrlEmbeddedToken(rawText, m.index, m[0].length)) {
          continue;
        }
        registerCode({
          code: clean,
          rawCode: m[0],
          format: 'dash-separated',
          domProminence: {
            fontSizePx,
            isBold,
            isMonospace,
            hasLetterSpacing,
            isIsolated: isolated,
            isSplitBox: false,
            verticalRatio: node.startIndex / totalLen,
            zone,
          },
          tightBlockText: tightText.slice(0, 240),
          rowText: rowText.slice(0, 320),
          inSubject: normSubject.toLowerCase().includes(clean.toLowerCase()),
          inVisibleBodyOutsideUrls: !nextQuoted,
          embeddedInEmailHandle: false,
          insideUrlOnly: false,
          isExplicitBodyCode: false,
          fromQuotedRegion: nextQuoted,
        });
      }
    };

    walk(root, false);
  }

  // Fallback / plain-text normalization & quoted history stripping
  const strippedPlain = stripQuotedHistory(normBody);
  const strippedHtmlFallback = visibleHtmlText
    ? stripQuotedHistory(visibleHtmlText)
    : normHtmlBody
      ? stripQuotedHistory(stripHtmlPreserveStructure(normHtmlBody))
      : '';
  const freshHasCode =
    hasFreshCodeSignal(strippedPlain) || hasFreshCodeSignal(strippedHtmlFallback);
  const effectiveBody = freshHasCode ? strippedPlain : normBody;
  const effectiveHtmlText = freshHasCode ? strippedHtmlFallback : visibleHtmlText;
  const preferHtmlVisible = Boolean(
    effectiveHtmlText &&
    (!effectiveBody ||
      (!/\d/.test(effectiveBody) && effectiveHtmlText.length > effectiveBody.length * 2))
  );
  const visibleText = preferHtmlVisible ? effectiveHtmlText : effectiveBody;
  const explicitBodyCode =
    extractExplicitVerificationCode(effectiveBody) ||
    extractExplicitVerificationCode(effectiveHtmlText);

  if (normBody && !normHtmlBody) {
    zoneTexts['body-primary'].push(effectiveBody);
  }

  // Scan plainText + subject for codes missed in HTML (spaced digits, bracketed codes, plain-only emails)
  const scanTextForCodes = (source: string, inSubjOnly: boolean) => {
    if (!source) {
      return;
    }
    const len = Math.max(1, source.length);
    let m: RegExpExecArray | null;

    WICG_ORIGIN_OTP_RE.lastIndex = 0;
    while ((m = WICG_ORIGIN_OTP_RE.exec(source)) !== null) {
      const boundHost = (m[1] || '').toLowerCase();
      const clean = m[2] || '';
      if (!isPlausibleCandidateToken(clean) || isSubjectDomainToken(clean, normSubject)) {
        continue;
      }
      const boundRoot = boundHost.includes('.')
        ? verificationSiteRoot(rootDomain(boundHost))
        : boundHost;
      const expectedMatch = expectedRoots.size === 0 || expectedRoots.has(boundRoot);
      const isVerifiedBinding =
        expectedMatch && (expectedRoots.has(boundRoot) || senderRoot === boundRoot);
      const around = source.slice(
        Math.max(0, m.index - 140),
        Math.min(source.length, m.index + m[0].length + 140)
      );
      registerCode({
        code: clean,
        rawCode: clean,
        format: /^\d+$/.test(clean) ? 'numeric' : 'alphanumeric',
        domProminence: {
          fontSizePx: 15,
          isBold: false,
          isMonospace: true,
          hasLetterSpacing: false,
          isIsolated: true,
          isSplitBox: false,
          verticalRatio: m.index / len,
          zone: inSubjOnly ? 'subject' : 'body-primary',
        },
        tightBlockText: around.slice(0, 240),
        rowText: around.slice(0, 320),
        inSubject: inSubjOnly || normSubject.toLowerCase().includes(clean.toLowerCase()),
        inVisibleBodyOutsideUrls: true,
        embeddedInEmailHandle: false,
        insideUrlOnly: false,
        isExplicitBodyCode: isVerifiedBinding,
        fromQuotedRegion: false,
      });
    }

    SPACED_DIGITS_RE.lastIndex = 0;
    while ((m = SPACED_DIGITS_RE.exec(source)) !== null) {
      const clean = (m[1] || '').replace(/\s+/g, '');
      if (isPlausibleCandidateToken(clean)) {
        const around = source.slice(
          Math.max(0, m.index - 140),
          Math.min(source.length, m.index + m[0].length + 140)
        );
        registerCode({
          code: clean,
          rawCode: m[1] || clean,
          format: 'space-separated',
          domProminence: {
            fontSizePx: 14,
            isBold: false,
            isMonospace: false,
            hasLetterSpacing: true,
            isIsolated: false,
            isSplitBox: false,
            verticalRatio: m.index / len,
            zone: inSubjOnly ? 'subject' : 'body-primary',
          },
          tightBlockText: around.slice(0, 240),
          rowText: around.slice(0, 320),
          inSubject: inSubjOnly || normSubject.toLowerCase().includes(clean.toLowerCase()),
          inVisibleBodyOutsideUrls: true,
          embeddedInEmailHandle: false,
          insideUrlOnly: false,
          isExplicitBodyCode: true,
          fromQuotedRegion: false,
        });
      }
    }

    BRACKETED_CODE_RE.lastIndex = 0;
    while ((m = BRACKETED_CODE_RE.exec(source)) !== null) {
      const clean = m[1] || '';
      if (isPlausibleCandidateToken(clean)) {
        const around = source.slice(
          Math.max(0, m.index - 140),
          Math.min(source.length, m.index + m[0].length + 140)
        );
        registerCode({
          code: clean,
          rawCode: m[0],
          format: /^\d+$/.test(clean) ? 'numeric' : 'alphanumeric',
          domProminence: {
            fontSizePx: 15,
            isBold: true,
            isMonospace: false,
            hasLetterSpacing: false,
            isIsolated: true,
            isSplitBox: false,
            verticalRatio: m.index / len,
            zone: inSubjOnly ? 'subject' : 'body-primary',
          },
          tightBlockText: around.slice(0, 240),
          rowText: around.slice(0, 320),
          inSubject: inSubjOnly || normSubject.toLowerCase().includes(clean.toLowerCase()),
          inVisibleBodyOutsideUrls: true,
          embeddedInEmailHandle: false,
          insideUrlOnly: false,
          isExplicitBodyCode: true,
          fromQuotedRegion: false,
        });
      }
    }

    HYPHENATED_CODE_RE.lastIndex = 0;
    while ((m = HYPHENATED_CODE_RE.exec(source)) !== null) {
      const clean = `${m[1]}${m[2]}`;
      if (isPlausibleCandidateToken(clean) && !isUrlEmbeddedToken(source, m.index, m[0].length)) {
        const around = source.slice(
          Math.max(0, m.index - 140),
          Math.min(source.length, m.index + m[0].length + 140)
        );
        registerCode({
          code: clean,
          rawCode: m[0],
          format: 'dash-separated',
          domProminence: {
            fontSizePx: 14,
            isBold: false,
            isMonospace: false,
            hasLetterSpacing: false,
            isIsolated: false,
            isSplitBox: false,
            verticalRatio: m.index / len,
            zone: inSubjOnly ? 'subject' : 'body-primary',
          },
          tightBlockText: around.slice(0, 240),
          rowText: around.slice(0, 320),
          inSubject: inSubjOnly || normSubject.toLowerCase().includes(clean.toLowerCase()),
          inVisibleBodyOutsideUrls: true,
          embeddedInEmailHandle: false,
          insideUrlOnly: false,
          isExplicitBodyCode: false,
          fromQuotedRegion: false,
        });
      }
    }

    CODE_TOKEN_RE.lastIndex = 0;
    while ((m = CODE_TOKEN_RE.exec(source)) !== null) {
      if (rawCodeCandidates.length >= 32) {
        break;
      }
      const token = m[1]!;
      if (!isPlausibleCandidateToken(token) || isSubjectDomainToken(token, normSubject)) {
        continue;
      }
      const insideUrl = isUrlEmbeddedToken(source, m.index, token.length);
      if (insideUrl) {
        continue;
      }
      const around = source.slice(
        Math.max(0, m.index - 140),
        Math.min(source.length, m.index + m[0].length + 140)
      );
      registerCode({
        code: token,
        rawCode: token,
        format: /^\d+$/.test(token) ? 'numeric' : 'alphanumeric',
        domProminence: {
          fontSizePx: 14,
          isBold: false,
          isMonospace: false,
          hasLetterSpacing: false,
          isIsolated: false,
          isSplitBox: false,
          verticalRatio: m.index / len,
          zone: inSubjOnly ? 'subject' : m.index / len > 0.85 ? 'footer' : 'body-primary',
        },
        tightBlockText: around.slice(0, 240),
        rowText: around.slice(0, 320),
        inSubject: inSubjOnly || normSubject.toLowerCase().includes(token.toLowerCase()),
        inVisibleBodyOutsideUrls: true,
        embeddedInEmailHandle: false,
        insideUrlOnly: false,
        isExplicitBodyCode: explicitBodyCode === token,
        fromQuotedRegion: false,
      });
    }
  };

  if (visibleText) {
    scanTextForCodes(visibleText, false);
  }
  scanTextForCodes(normSubject, true);

  // Mark explicit body code flag + embedded email handle check on all collected code candidates
  const combinedForHandle = `${normSubject}\n${visibleText}`;
  const emailHandles = combinedForHandle.includes('@')
    ? (combinedForHandle.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((h) =>
        h.toLowerCase()
      )
    : [];
  const filteredCodes: DocumentCodeCandidate[] = [];
  for (const cand of rawCodeCandidates) {
    if (explicitBodyCode && cand.code === explicitBodyCode) {
      cand.isExplicitBodyCode = true;
    }
    const handleEmb =
      emailHandles.length > 0 && emailHandles.some((h) => h.includes(cand.code.toLowerCase()));
    const standalone = handleEmb ? appearsStandaloneInVisibleText(cand.code, visibleText) : false;
    cand.embeddedInEmailHandle = handleEmb && !standalone;
    if (cand.fromQuotedRegion && freshHasCode) {
      continue;
    }
    filteredCodes.push(cand);
  }

  // Extract plain-text URLs and merge with HTML anchor URLs
  const plainUrls: string[] = [];
  const plainAndSubj = `${visibleText}\n${normBody}`;
  PLAIN_URL_RE.lastIndex = 0;
  let um: RegExpExecArray | null;
  while ((um = PLAIN_URL_RE.exec(plainAndSubj)) !== null) {
    plainUrls.push(um[0]);
    if (plainUrls.length >= 32) {
      break;
    }
  }

  const allRawUrls = [...new Set([...rawHtmlUrls, ...plainUrls])].slice(0, 36);
  const linkByNormalized = new Map<string, DocumentLinkCandidate>();
  const linkOrder: DocumentLinkCandidate[] = [];

  for (const rawUrl of allRawUrls) {
    if (!rawUrl.startsWith('http')) {
      continue;
    }
    const unwrapped = recursiveUnwrap(rawUrl);
    let normalized = unwrapped;
    try {
      normalized = normalizeUrl(unwrapped);
    } catch {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    const hostRoot = host.includes('.') ? verificationSiteRoot(rootDomain(host)) : host;
    const anchorInfos = anchorsByRawUrl.get(rawUrl) ?? anchorsByRawUrl.get(unwrapped) ?? [];
    let anchorText = '';
    let isCTA = false;
    let zone: DocumentZone = 'body-primary';
    for (const info of anchorInfos) {
      if (info.anchorText && !anchorText) {
        anchorText = info.anchorText;
      }
      if (info.isCTA) {
        isCTA = true;
      }
      if (info.zone === 'cta' || info.zone === 'hero' || info.zone === 'footer') {
        zone = info.zone;
      }
    }

    // Plain-text line label fallback (`Sign in https://...`)
    let uIdx = -1;
    let matchLen = 0;
    if (visibleText) {
      const idx = visibleText.indexOf(rawUrl);
      if (idx >= 0) {
        uIdx = idx;
        matchLen = rawUrl.length;
      } else {
        const unwrappedIdx = visibleText.indexOf(unwrapped);
        if (unwrappedIdx >= 0) {
          uIdx = unwrappedIdx;
          matchLen = unwrapped.length;
        }
      }
      if (uIdx >= 0 && !anchorText) {
        const lineStart = Math.max(0, visibleText.lastIndexOf('\n', uIdx) + 1);
        const prefix = visibleText
          .slice(lineStart, uIdx)
          .replace(/[:\s\-–—]+$/, '')
          .trim();
        if (prefix.length > 0 && prefix.length <= 120) {
          anchorText = prefix;
        }
      }
    }

    let surrounding = '';
    if (visibleText) {
      if (uIdx >= 0) {
        surrounding = visibleText.slice(
          Math.max(0, uIdx - 160),
          Math.min(visibleText.length, uIdx + matchLen + 160)
        );
      } else if (anchorText) {
        const aIdx = visibleText.indexOf(anchorText);
        if (aIdx >= 0) {
          surrounding = visibleText.slice(
            Math.max(0, aIdx - 160),
            Math.min(visibleText.length, aIdx + anchorText.length + 160)
          );
        } else {
          surrounding = getContextAround(visibleText, anchorText, 160);
        }
      }
    }

    const gate = scoreActivationLink(normalized, anchorText, surrounding);
    const existing = linkByNormalized.get(normalized);
    if (existing) {
      existing.mentionCount += 1;
      if (anchorText && !existing.anchorText) {
        existing.anchorText = anchorText;
      }
      if (isCTA) {
        existing.isCTA = true;
      }
      if (plainUrls.includes(rawUrl) || plainUrls.includes(unwrapped)) {
        existing.hasPlaintextFallbackDuplicate = true;
      }
      if (gate.quality > existing.gate.quality) {
        existing.gate = gate;
      }
    } else {
      const candidate: DocumentLinkCandidate = {
        url: normalized,
        rawUrl,
        anchorText,
        isCTA,
        zone,
        surroundingText: surrounding.slice(0, 320),
        mentionCount: 1,
        hasPlaintextFallbackDuplicate:
          anchorInfos.length > 0 && (plainUrls.includes(rawUrl) || plainUrls.includes(unwrapped)),
        gate,
        host,
        hostMatchesExpected: expectedRoots.size > 0 && expectedRoots.has(hostRoot),
        hostMatchesSender: senderRoot !== null && senderRoot === hostRoot,
      };
      linkByNormalized.set(normalized, candidate);
      linkOrder.push(candidate);
    }
  }

  const zonesPresent = (Object.keys(zoneTexts) as DocumentZone[]).filter(
    (z) => zoneTexts[z].length > 0
  );

  return {
    subject: normSubject,
    sender: cleanSender,
    senderDomain,
    senderRoot,
    expectedRoots,
    plainBody: normBody,
    effectiveBody,
    effectiveHtmlText,
    visibleText,
    quotedText,
    htmlBody: normHtmlBody,
    explicitBodyCode,
    allRawUrls,
    hasSplitDigitBox,
    hasHiddenTrapNode,
    zonesPresent,
    zoneTexts,
    codeCandidates: filteredCodes,
    linkCandidates: linkOrder,
  };
}
