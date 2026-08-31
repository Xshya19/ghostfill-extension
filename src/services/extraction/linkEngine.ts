// src/services/extraction/linkEngine.ts
// ══════════════════════════════════════════════════════════════════
//  LINK ENGINE v4 — anchor-paired, tracking-unwrapped, target-deduped
// ══════════════════════════════════════════════════════════════════

import { decodeEntities } from './parseText';

export interface Anchor {
  url: string;
  text: string;
  before: string;
  after: string;
  isButton: boolean;
}

export interface LinkVerdict {
  url: string | null;
  probability: number;
  action: 'auto-open' | 'suggest' | 'abstain';
  reasons: string[];
}

/** Tracking wrappers patterns */
const TRACKING_WRAPPERS = [
  /https?:\/\/ct\.sendgrid\.net\/ls\/click\?[^"'\s]+/i,
  /https?:\/\/[^/]+\.list-manage\.com\/track\/click\?[^"'\s]+/i,
  /https?:\/\/ablink\.[^/]+\/ss\/c\/[^"'\s]+/i,
  /https?:\/\/[^/]+\.safelinks\.protection\.outlook\.com\/\?[^"'\s]+/i,
  /https?:\/\/urldefense\.(?:proofpoint|com)\.[^/]+\/v[23]\/[^"'\s]+/i,
];

/** Unwrap tracking wrappers to extract real target URL */
export function unwrapUrl(rawUrl: string): { url: string; hops: number; opaqueTracker: boolean } {
  let url = decodeEntities(rawUrl).trim();
  let hops = 0;
  let opaque = false;

  const isTracker = (u: string) => TRACKING_WRAPPERS.some((r) => r.test(u));

  for (; hops < 6; hops++) {
    if (!isTracker(url)) {break;}
    opaque = true;

    // Try common query parameters containing target URL
    try {
      const parsed = new URL(url);
      let targetParam =
        parsed.searchParams.get('url') ??
        parsed.searchParams.get('u') ??
        parsed.searchParams.get('target') ??
        parsed.searchParams.get('dest') ??
        parsed.searchParams.get('redirect');

      // Safelinks & Proofpoint decoding
      if (!targetParam && url.includes('safelinks.protection.outlook.com')) {
        targetParam = parsed.searchParams.get('url');
      }

      if (targetParam && /^https?:/i.test(targetParam)) {
        url = targetParam;
        continue;
      }
    } catch {
      /* Intentionally ignored */
    }

    // Try base64 embedded target
    const b64Match = url.match(/(?:[a-zA-Z0-9+/=]{24,})/);
    if (b64Match) {
      try {
        const decoded = atob(b64Match[0]);
        if (/^https?:\/\//i.test(decoded)) {
          url = decoded;
          continue;
        }
      } catch {
        /* Intentionally ignored */
      }
    }

    break;
  }

  return { url, hops, opaqueTracker: opaque };
}

export function hasHighEntropyToken(u: string): boolean {
  const m = u.match(/[?&#/][a-zA-Z0-9_-]{16,512}(?:[&#/]|$)/g);
  return !!m?.some((s) => /\d/.test(s) && /[A-Za-z]/.test(s));
}

const STRONG_PATH_RE =
  /\/(?:verify|verification|activate|activation|confirm|confirmation|validate|validation|register|signup|magic|passwordless|signin|login|auth|invite|join|reset|recover)(?:\/|$|\?|#)/i;

// Strict query token parameter list (excludes promiscuous email=, uid=, exp=, code=)
const STRICT_STRONG_QUERY =
  /[?&#](?:token|confirm[-]?token|activation[-]?token|verify[-]?token|verification[-]?token|validation[-]?token|invite[-]?token|magic[-]?token|email[-]?token|auth[-]?token|login[-]?token|reset[-]?token|recovery[-]?token|oob[-]?code|oobCode|mode=(?:verifyEmail|resetPassword|signIn)|action=(?:verify|confirm|activate|validate|accept))=/i;

const STRONG_ANCHOR_RE =
  /\b(?:verify(?:\s+(?:my|your|this|the))?\s*(?:email|account|identity)?|confirm(?:\s+(?:my|your|this|the))?\s*(?:email|account|registration)?|activate(?:\s+(?:my|your|this|the))?\s*(?:email|account|membership)?|validate|complete\s+(?:registration|signup)|reset\s+password|sign\s*in|log\s*in|join|claim|enable|verificar|confirmar|activar|validar)\b/i;

const HARD_REJECT_ANCHOR =
  /\b(?:unsubscribe|opt[-]?out|privacy|terms|twitter|facebook|linkedin|instagram|download|app\s+store|google\s+play|view\s+in\s+browser|manage\s+preferences)\b/i;

const HARD_REJECT_URL =
  /(?:unsubscribe|privacy|terms|facebook\.com|twitter\.com|linkedin\.com|instagram\.com|youtube\.com|google\.com\/maps)/i;

export function extractAnchors(html: string): Anchor[] {
  const out: Anchor[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const hrefMatch = m[1]!.match(/href\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch?.[1];
    if (!href || !/^https?:/i.test(href)) {continue;}

    const text = m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const ctxPre = html.slice(Math.max(0, m.index - 400), m.index);
    const isButton = /bgcolor=|background(?:-color)?\s*:\s*#|border-radius|role=["']button/i.test(ctxPre.slice(-300) + m[1]!);

    out.push({
      url: href,
      text,
      before: ctxPre.replace(/<[^>]+>/g, ' ').slice(-200),
      after: html.slice(m.index + m[0].length, m.index + m[0].length + 200).replace(/<[^>]+>/g, ' '),
      isButton,
    });
  }
  return out;
}

function canonical(u: string): string {
  try {
    const x = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'fbclid', 'gclid']
      .forEach((k) => x.searchParams.delete(k));
    return `${x.origin}${x.pathname}?${[...x.searchParams].sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
  } catch {
    return u;
  }
}

export function pickActivationLink(
  anchors: Anchor[],
  plainUrls: string[],
  intent = 'activation'
): LinkVerdict {
  const groups = new Map<string, { a: Anchor[]; raw: string; hits: number; opaque: boolean }>();

  for (const a of anchors) {
    const { url, opaqueTracker } = unwrapUrl(a.url);
    const key = canonical(url);
    const g = groups.get(key) ?? { a: [], raw: url, hits: 0, opaque: opaqueTracker };
    g.a.push(a);
    g.hits++;
    g.opaque = g.opaque || opaqueTracker;
    groups.set(key, g);
  }

  // Bare URLs in plaintext fallback corroborate the anchor
  for (const u of plainUrls) {
    const key = canonical(unwrapUrl(u).url);
    const g = groups.get(key);
    if (g) {g.hits++;}
  }

  let best: { url: string; nats: number; reasons: string[] } | null = null;

  for (const [, g] of groups) {
    const anchorText = g.a.map((x) => x.text).join(' | ');
    let s = -2.4;
    const rs: string[] = [];
    const put = (w: number, r: string) => { s += w; rs.push(r); };

    if (STRONG_PATH_RE.test(g.raw))            {put(2.6, 'path');}
    if (STRICT_STRONG_QUERY.test(g.raw))       {put(1.4, 'query');}
    if (hasHighEntropyToken(g.raw))            {put(1.5, 'entropy-token');}
    if (STRONG_ANCHOR_RE.test(anchorText))     {put(2.4, 'anchor');}
    if (g.a.some((x) => x.isButton))           {put(1.1, 'button');}
    if (g.hits >= 2)                           {put(0.9, 'repeated-cta');}
    if (intent === 'activation' || intent === 'password-reset') {put(0.8, 'intent');}

    if (HARD_REJECT_ANCHOR.test(anchorText))   {put(-4.0, 'marketing-anchor');}
    if (HARD_REJECT_URL.test(g.raw) && !STRONG_PATH_RE.test(g.raw)) {put(-4.0, 'marketing-url');}
    if (g.opaque && !STRONG_ANCHOR_RE.test(anchorText)) {put(-1.6, 'opaque-no-anchor');}
    if (g.opaque && STRONG_ANCHOR_RE.test(anchorText))  {put(0.4, 'opaque-but-anchored');}
    if (!/^https:/i.test(g.raw))               {put(-1.5, 'non-https');}

    if (!best || s > best.nats) {best = { url: g.raw, nats: s, reasons: rs };}
  }

  const p = 1 / (1 + Math.exp(-(best?.nats ?? -99)));
  let action: LinkVerdict['action'] = 'abstain';
  if (p >= 0.90) {action = 'auto-open';}
  else if (p >= 0.60) {action = 'suggest';}

  return {
    url: best?.url ?? null,
    probability: p,
    action,
    reasons: best?.reasons ?? [],
  };
}
