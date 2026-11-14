/**
 * Grandmaster activation-link gate.
 *
 * Only genuine verify / activate / confirm / validate / magic-login / invite /
 * password-reset (and their many synonyms) may be selected or auto-opened.
 * Marketing, dashboard, social, and token-only tracking URLs are rejected.
 *
 * Design:
 *  - Broad synonym coverage so real CTAs never fail ("active your mail",
 *    "validate email", "this was me", "claim account", Firebase oobCode, …)
 *  - Hard reject marketing/footer first
 *  - Token without action proof is tracking, not activation
 *  - Auto-open needs higher bar than select
 *  - Auto-open also needs a domain binding: the destination must be a host
 *    the caller vouches for (the account's signup site / a site the user is
 *    waiting on). A structurally perfect link is never auto-openable on its
 *    own, and an absent expectation fails closed.
 */

import { sameVerificationSite } from '../../utils/verificationSite';

export type ActivationLinkClass =
  | 'activation'
  | 'password-reset'
  | 'magic-login'
  | 'invitation'
  | 'device-auth'
  | 'reject'
  | 'unknown';

export interface ActivationLinkVerdict {
  cls: ActivationLinkClass;
  /** 0–100 quality. Auto-open only if >= AUTO_OPEN_MIN and cls !== reject/unknown */
  quality: number;
  reasons: string[];
  hardReject: boolean;
  /**
   * True only when the structural proof passed AND the destination is bound
   * to an expected host. Fails closed when no expectation was supplied.
   */
  canAutoOpen: boolean;
  /**
   * Structural proof only (path + token + anchor + https). Kept for callers
   * that bind the destination themselves (see canAutoOpenVerificationLink).
   */
  structuralAutoOpen: boolean;
  /** True when the destination host matched the caller's expectation. */
  domainBound: boolean;
}

/**
 * Domain expectation for auto-open.
 *
 * The expectation is supplied by the decision layer, which knows the sender
 * and the account's signup origin. The guard never guesses a trusted host:
 * an empty or absent list means "no independent expectation" and therefore
 * refuses the automatic open.
 */
export interface ActivationLinkExpectation {
  /** Hostnames or domains (full URLs are accepted) the destination may point at. */
  trustedHosts?: string[];
}

/** Minimum quality to surface as the extracted activation link */
export const SELECT_MIN_QUALITY = 20;
/**
 * Automatic opening needs two independent activation signals, such as a
 * verification path plus an auth token. A disposable inbox can receive mail
 * from anyone, so selection alone is not consent to open the URL.
 */
export const AUTO_OPEN_MIN_QUALITY = 80;

/**
 * Path / route synonyms: verify · activate · confirm · validate · complete ·
 * magic · invite · reset · claim · enable · unlock · Firebase email-action, etc.
 */
const STRONG_PATH_RE =
  /\/(?:verify(?:[-_]?(?:email|account|address|user|phone|identity|mail))?|verification(?:[-_]?(?:email|account|link|code))?|e[-_]?verify|email[-_]?verif(?:y|ication)|verif(?:y|ication)[-_]?email|activate(?:[-_]?(?:email|account|user|membership|subscription|mail))?|activation(?:[-_]?(?:email|account|link))?|active[-_]?(?:email|account|mail|user)?|confirm(?:[-_]?(?:email|account|address|user|identity|registration|signup|sign[-_]?up|mail))?|confirmation(?:[-_]?(?:email|account|link))?|email[-_]?confirm(?:ation)?|confirm[-_]?email|validate(?:[-_]?(?:email|account|address|user|identity))?|validation(?:[-_]?(?:email|account))?|email[-_]?validat(?:e|ion)|register(?:ation)?(?:[-_]?(?:confirm|verify|activate|complete|finish))?|signup|sign[-_]?up|complete[-_]?(?:signup|sign[-_]?up|registration|setup|account|email|profile|onboarding)?|finish[-_]?(?:signup|sign[-_]?up|registration|setup|account)?|onboard(?:ing)?(?:[-_]?(?:complete|finish|verify|confirm))?|welcome(?:[-_]?(?:aboard|back))?|magic(?:[-_]?(?:link|login|auth))?|passwordless|signin[-_]?link|sign[-_]?in[-_]?link|login[-_]?link|log[-_]?in[-_]?link|email[-_]?(?:login|signin|sign[-_]?in|link|action)|email\/action|auth\/action|__\/auth\/action|auth(?:enticate)?[-_]?(?:link|email|action|verify|confirm)?|accept[-_]?(?:invite|invitation|request)?|invitation|invite(?:[-_]?(?:accept|join|link))?|join[-_]?(?:workspace|team|org|organization|organisation|group|project|board)?|authorize|authorise|approve|authenticate|device[-_]?(?:confirm|auth|trust|verify|approve)?|trust[-_]?device|reset[-_]?password|password[-_]?reset|forgot[-_]?password|password[-_]?forgot|recover[-_]?(?:password|account)|change[-_]?password|set[-_]?password|create[-_]?password|choose[-_]?password|unlock(?:[-_]?account)?|enable(?:[-_]?(?:account|email|2fa|mfa))?|claim(?:[-_]?(?:account|profile|invite))?|consent|acknowledge|prove[-_]?(?:identity|ownership)?|email[-_]?action|user(?:s)?\/(?:activate|verify|confirm|validate|enable)|account(?:s)?\/(?:activate|verify|confirm|validate|enable)|member(?:s)?\/(?:activate|verify|confirm)|oauth\/callback|callback|link\/(?:login|auth|verify)|login\/link|auth\/link|continue(?:[-_]?(?:signup|registration|setup))?|proceed|secure[-_]?(?:account|link)?)(?:\/|$|\?|#)/i;

const STRONG_QUERY =
  /[?&#](?:token|confirmation[_-]?token|confirm[_-]?token|activation[_-]?token|verify[_-]?token|verification[_-]?token|validation[_-]?token|invite[_-]?token|invitation[_-]?token|magic[_-]?token|access[_-]?token|id[_-]?token|email[_-]?token|auth[_-]?token|login[_-]?token|reset[_-]?token|recovery[_-]?token|oob[_-]?code|oobCode|mode=(?:verifyEmail|resetPassword|recoverEmail|signIn)|action=(?:verify|confirm|activate|validate|reset|accept)|type=(?:activation|verification|confirm|email[_-]?verif|invite))=/i;

/**
 * Anchor / button / nearby copy synonyms.
 * Intentionally broad: products use awkward English ("active your mail",
 * "click to validate", "this was me", "claim your seat", …).
 */
const STRONG_ANCHOR_RE =
  /\b(?:verify(?:\s+(?:my|your|this|the))?\s*(?:email|e-?mail|account|address|identity|phone|number|mail)?|confirm(?:\s+(?:my|your|this|the))?\s*(?:email|e-?mail|account|address|identity|registration|signup|sign[\s-]?up|mail)?|activate(?:\s+(?:my|your|this|the))?\s*(?:email|e-?mail|account|mail|membership|subscription)?|active(?:\s+(?:my|your|this|the))?\s*(?:mail|email|e-?mail|account)|validation|validate(?:\s+(?:my|your|this|the))?\s*(?:email|e-?mail|account|address|identity)?|complete\s+(?:registration|signup|sign[\s-]?up|setup|your\s+(?:registration|signup|account|profile|email)|email\s+verification)|finish\s+(?:signing|sign)\s*up|finish\s+(?:registration|setup|account\s+setup)|complete\s+email\s+verification|get\s+started|start\s+(?:now|using|here)|continue(?:\s+to\s+(?:app|account|dashboard|site|website))?|proceed(?:\s+to\s+(?:app|account))?|accept\s+(?:invite|invitation|request)|join\s+(?:workspace|team|organization|organisation|group|project|board|us)|magic\s*link|passwordless|sign\s*in(?:\s+(?:securely|now|here|with\s+(?:email|link)))?|log\s*in(?:\s+(?:securely|now|here))?|sign\s*me\s*in|one[\s-]?click\s+(?:sign[\s-]?in|login|access)|reset\s+(?:my\s+|your\s+)?password|set\s+(?:a\s+|your\s+)?new\s+password|create\s+(?:a\s+|your\s+)?(?:new\s+)?password|change\s+(?:my\s+|your\s+)?password|forgot\s+(?:my\s+|your\s+)?password|recover\s+(?:my\s+|your\s+)?(?:password|account)|authorize|authorise|approve|authenticate|trust\s+this\s+device|yes[,\s]+this\s+was\s+me|this\s+was\s+me|it\s+was\s+me|i\s+recognize\s+this|i\s+recognise\s+this|confirm\s+it'?s?\s+(?:you|me)|claim\s+(?:my\s+|your\s+)?(?:account|profile|invite|seat|spot|access)|enable\s+(?:my\s+|your\s+)?(?:account|email|access|2fa|mfa)|unlock\s+(?:my\s+|your\s+)?(?:account|access)|secure\s+(?:my\s+|your\s+)?(?:account|email)|click\s+(?:here\s+)?to\s+(?:verify|confirm|activate|validate|continue|proceed|finish|complete|reset|join|accept|sign\s*in|log\s*in)|tap\s+(?:here\s+)?to\s+(?:verify|confirm|activate|validate|continue|proceed|finish|complete|reset|join|accept)|open\s+(?:this\s+)?(?:secure\s+)?link|use\s+(?:this\s+)?(?:secure\s+)?link|follow\s+(?:this\s+)?link|access\s+(?:my\s+|your\s+)?(?:account|app)|verificar|confirmar|activar|validar|aktivieren|bestätigen|vérifier|confirmer|activer|valider)\b/i;

/** Soft path tokens — weaker alone, usable with token/anchor */
const SOFT_PATH_RE =
  /\/(?:auth|oauth|sso|login|signin|sign[-_]?in|register|account|user|users|members?|session|identity|security)(?:\/|$|\?)/i;

const DIRECT_ACTION_PATH_RE =
  /\/(?:verify|verification|activate|activation|confirm|confirmation|validate|validation|magic|passwordless|invite|invitation|reset|recover|email\/action|auth\/action|__\/auth\/action)(?:[-_/]|$)/i;
const EXPLICIT_ACTION_QUERY_RE =
  /[?&#](?:confirmation[_-]?token|activation[_-]?token|verify[_-]?token|verification[_-]?token|invite[_-]?token|magic[_-]?token|reset[_-]?token|oob[_-]?code|mode=(?:verifyEmail|resetPassword|signIn)|action=(?:verify|confirm|activate|reset|accept))/i;
const GENERIC_ANCHOR_RE =
  /^(?:get started|start now|continue(?: to .*)?|proceed(?: to .*)?|click here)$/i;
// Email login routes may carry opaque state instead of a token= parameter.
// State only counts as authentication evidence on these specific routes.
const EMAIL_LOGIN_PATH_RE =
  /\/(?:login[-_]?with[-_]?email|signin[-_]?with[-_]?email|email[-_]?login|login\/email|signin\/email)(?:\/|$)/i;

// ── Hard reject (never auto-open) ──
// B4 fix (2026-11-12): the deny list previously matched the RAW URL string,
// including query values, so a legitimate verification link like
// `?redirect=/settings` was hard-rejected while the same destination
// percent-encoded (`redirect=%2Fsettings`) passed — verdicts flipped on
// incidental encoding. The list is now applied to the hostname and the
// DECODED pathname only, never the query string. Host-level brands,
// static/tracking infrastructure, and footer/navigation path segments
// remain hard-rejected with the original semantics.
const HARD_REJECT_HOST_OR_PATH =
  /unsubscribe|opt[-_]?out|email[-_]?preferences|manage[-_]?preferences|privacy(?:[-_]?policy)?|terms(?:[-_]?of)?|cookie|legal|cdn\.|fonts?\.|images?\.|img\.|\/(?:static|assets)(?:\/|$)|\/(?:beacon|pixel)|analytics|view[-_]?in[-_]?browser|web[-_]?version/i;
const HARD_REJECT_HOST_BRANDS =
  /(?:^|\.)(?:facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|pinterest\.com|play\.google\.com|apps\.apple\.com|itunes\.apple\.com)$/i;
const HARD_REJECT_PATH_SEGMENTS =
  /\/(?:dashboard|pricing|plans|billing|settings|preferences|profile|docs|documentation|blog|help|support|shop|store|sale|deals|home)(?:\/|$)|shop\s*now|learn\s*more|read\s*more|download\s*app/i;

const HARD_REJECT_ANCHOR =
  /\b(?:unsubscribe|opt\s*out|manage\s+preferences|privacy\s+policy|terms\s+of\s+(?:service|use)|view\s+in\s+browser|shop\s+now|buy\s+now|learn\s+more|read\s+more|download\s+(?:app|now)|visit\s+(?:our\s+)?(?:site|website|store)|view\s+(?:dashboard|profile|details)|open\s+dashboard|help\s+center|support\s+center|documentation|follow\s+us|view\s+offer|see\s+deals|browse\s+products)\b/i;

const SOFT_MARKETING =
  /\b(?:newsletter|promo|promotion|discount|coupon|sale|deal|offer|webinar|event|blog|update\s+available|new\s+feature|product\s+launch|limited\s+time|flash\s+sale)\b/i;

function hasAuthToken(url: string): boolean {
  return (
    /[?&#](?:token|code|sig|signature|access_token|id_token|confirmation_token|invite_token|oobCode|oob_code|reset_token|magic_token|login_token)=[A-Za-z0-9._%-]{8,}/i.test(
      url
    ) || /#(?:token|code|oobCode)=[A-Za-z0-9._%-]{8,}/i.test(url)
  );
}

/** Normalise a host expectation (bare domain or full URL) to a hostname. */
function normalizeExpectedHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  if (trimmed.includes('://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
      return '';
    }
  }
  return trimmed.replace(/^\.+/, '').replace(/\.$/, '');
}

/**
 * True when `hostname` belongs to one of the expected hosts.
 *
 * Exact hosts, sub-domains of an expected domain and first-party aliases
 * (see verificationSiteRoot) all count as the same site. Used to bind an
 * activation link to the site the user is actually signing up for.
 */
export function hostMatchesExpectation(
  hostname: string,
  expectedHosts: string[] | undefined
): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) {
    return false;
  }
  for (const raw of expectedHosts ?? []) {
    const expected = normalizeExpectedHost(raw);
    if (!expected) {
      continue;
    }
    if (host === expected) {
      return true;
    }
    if (host.endsWith(`.${expected}`)) {
      return true;
    }
    if (sameVerificationSite(host, expected)) {
      return true;
    }
  }
  return false;
}

function classifyPath(url: string, anchorText = ''): ActivationLinkClass {
  // Opaque token/state values can contain words such as "reset" by chance.
  const parsed = new URL(url, 'https://classification.invalid');
  const actionQuery = ['mode', 'action', 'type']
    .map((key) => `${key}=${parsed.searchParams.get(key) || ''}`)
    .join(' ');
  const hay = `${parsed.pathname} ${actionQuery} ${anchorText}`;
  if (
    /reset|forgot|recover|change[-_]?password|set[-_]?password|create[-_]?password|mode=resetPassword/i.test(
      hay
    )
  ) {
    return 'password-reset';
  }
  if (
    EMAIL_LOGIN_PATH_RE.test(parsed.pathname) ||
    /magic|passwordless|signin[-_]?link|login[-_]?link|email[-_]?login|mode=signIn|one[\s-]?click/i.test(
      hay
    )
  ) {
    return 'magic-login';
  }
  if (/invite|invitation|join[-_]?(?:workspace|team|org)|accept[-_]?invite/i.test(hay)) {
    return 'invitation';
  }
  if (
    /authorize|authorise|approve|authenticate|device|trust[-_]?device|this\s+was\s+me|it\s+was\s+me|i\s+recogn/i.test(
      hay
    )
  ) {
    return 'device-auth';
  }
  if (
    /verify|activate|confirm|validat|registration|signup|sign[-_]?up|onboard|email[-_]?action|mode=verifyEmail|claim|enable|unlock|secure[-_]?account/i.test(
      hay
    )
  ) {
    return 'activation';
  }
  return 'unknown';
}

/**
 * Score whether a URL+anchor is a genuine activation/verify link.
 */
export function scoreActivationLink(
  rawUrl: string | { url?: string } | null | undefined,
  anchorText = '',
  surroundingText = '',
  expectation?: ActivationLinkExpectation
): ActivationLinkVerdict {
  const url =
    typeof rawUrl === 'string'
      ? rawUrl
      : rawUrl && typeof rawUrl === 'object' && 'url' in rawUrl && typeof rawUrl.url === 'string'
        ? rawUrl.url
        : '';
  const reasons: string[] = [];
  let quality = 0;
  const combinedText = `${anchorText} ${surroundingText}`.toLowerCase();

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    /* Invalid URL is rejected below. */
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['not-http-url'],
      hardReject: true,
      canAutoOpen: false,
      structuralAutoOpen: false,
      domainBound: false,
    };
  }

  // B4 fix: evaluate the deny list against hostname + decoded pathname
  // only. Query values are ordinary words half the time; scanning them
  // made verdicts depend on encoding. A fully encoded pathname that fails
  // to decode keeps its raw form (still hostname-checked).
  let decodedPathname = parsed.pathname;
  try {
    decodedPathname = decodeURIComponent(parsed.pathname);
  } catch {
    /* keep raw pathname */
  }
  // Action-path override (B4 follow-up): providers genuinely host
  // verification routes INSIDE deny-named sections
  // (`/settings/verify?token=…`, `/help/verify?token=…`). A path segment
  // deny must not veto a link that also carries an explicit action
  // segment AND auth evidence — that combination never describes a
  // footer/dashboard page. Host-level and brand rejects are unaffected.
  const actionPathOverride =
    DIRECT_ACTION_PATH_RE.test(parsed.pathname) &&
    (hasAuthToken(url) || EXPLICIT_ACTION_QUERY_RE.test(`${parsed.search}${parsed.hash}`));
  const hardUrlHit =
    HARD_REJECT_HOST_OR_PATH.test(parsed.hostname) ||
    HARD_REJECT_HOST_OR_PATH.test(decodedPathname) ||
    HARD_REJECT_HOST_BRANDS.test(parsed.hostname) ||
    (!actionPathOverride && HARD_REJECT_PATH_SEGMENTS.test(decodedPathname));
  const hardAnchorHit = HARD_REJECT_ANCHOR.test(anchorText);
  const emailLoginPath = EMAIL_LOGIN_PATH_RE.test(parsed.pathname);
  const pathStrongEarly = STRONG_PATH_RE.test(parsed.pathname) || emailLoginPath;

  // Footer and navigation destinations cannot become activation actions just
  // because the email or even the anchor contains "verify" or a tracking token.
  if (hardAnchorHit) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['hard-reject-marketing-or-footer'],
      hardReject: true,
      canAutoOpen: false,
      structuralAutoOpen: false,
      domainBound: false,
    };
  }
  if (hardUrlHit) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['hard-reject-marketing-or-footer'],
      hardReject: true,
      canAutoOpen: false,
      structuralAutoOpen: false,
      domainBound: false,
    };
  }

  const pathStrong = pathStrongEarly;
  const queryStrong = STRONG_QUERY.test(`${parsed.search}${parsed.hash}`);
  const anchorStrong =
    STRONG_ANCHOR_RE.test(anchorText) && !GENERIC_ANCHOR_RE.test(anchorText.trim());
  const contextStrong = STRONG_ANCHOR_RE.test(surroundingText);
  const softPath = SOFT_PATH_RE.test(parsed.pathname) || emailLoginPath;
  const token =
    hasAuthToken(url) || (emailLoginPath && (parsed.searchParams.get('state')?.length ?? 0) >= 16);
  let cls = classifyPath(`${parsed.pathname}${parsed.search}`, anchorText);

  if (pathStrong) {
    quality += 42;
    reasons.push('strong-path');
  } else if (softPath) {
    quality += 12;
    reasons.push('soft-path');
  }
  if (queryStrong || token) {
    quality += token ? 22 : 14;
    reasons.push(token ? 'auth-token' : 'auth-query');
  }
  if (anchorStrong) {
    quality += 28;
    reasons.push('strong-anchor');
    if (cls === 'unknown') {
      const fromAnchor = classifyPath(parsed.pathname, anchorText);
      cls = fromAnchor !== 'unknown' ? fromAnchor : 'activation';
    }
  }
  if (contextStrong && !anchorStrong && pathStrong) {
    quality += 8;
    reasons.push('strong-context');
  }

  if (parsed.protocol === 'https:') {
    quality += 6;
  } else {
    quality -= 12;
    reasons.push('non-https');
  }

  if (SOFT_MARKETING.test(url) || SOFT_MARKETING.test(combinedText)) {
    quality -= 30;
    reasons.push('marketing-language');
  }

  const hasActionProof = pathStrong || anchorStrong;
  if (token && !hasActionProof) {
    if (softPath) {
      quality -= 18;
      reasons.push('token-with-soft-path-only');
      if (cls === 'unknown') {
        cls = 'activation';
      }
    } else {
      quality -= 40;
      reasons.push('token-without-action-proof');
      cls = 'unknown';
    }
  }

  if (!pathStrong && !anchorStrong && !token && !contextStrong && !softPath) {
    quality = Math.min(quality, 25);
    reasons.push('no-activation-evidence');
    cls = 'unknown';
  }

  if (softPath && !pathStrong && !anchorStrong && !contextStrong && !token) {
    quality = Math.min(quality, 30);
    reasons.push('soft-path-only');
    cls = 'unknown';
  }

  // A generic page plus a token is common in navigation and click tracking.
  if (
    !DIRECT_ACTION_PATH_RE.test(parsed.pathname) &&
    !emailLoginPath &&
    !anchorStrong &&
    !EXPLICIT_ACTION_QUERY_RE.test(`${parsed.search}${parsed.hash}`)
  ) {
    cls = 'unknown';
  }

  if (pathStrong && (token || queryStrong) && (anchorStrong || contextStrong)) {
    quality = Math.max(quality, 94);
    reasons.push('triple-activation-proof');
  } else if (pathStrong && (token || queryStrong)) {
    quality = Math.max(quality, 86);
    reasons.push('path-and-token');
  } else if (pathStrong && anchorStrong) {
    quality = Math.max(quality, 88);
    reasons.push('path-and-anchor');
  } else if (anchorStrong && token) {
    quality = Math.max(quality, 82);
    reasons.push('anchor-and-token');
  }

  quality = Math.max(0, Math.min(100, quality));

  const hardReject = quality < 20 || cls === 'reject';

  const structuralAutoOpen =
    !hardReject &&
    cls !== 'unknown' &&
    quality >= AUTO_OPEN_MIN_QUALITY &&
    parsed.protocol === 'https:' &&
    (((DIRECT_ACTION_PATH_RE.test(parsed.pathname) || emailLoginPath) && (token || anchorStrong)) ||
      (anchorStrong && token && softPath));

  // Domain binding (2026-11-12 security fix): a structurally perfect
  // activation link is NOT auto-openable until its destination is bound to a
  // host the caller vouches for. The caller (decision layer) supplies the
  // account's signup site / the sites the user is waiting on. Without an
  // expectation the gate fails closed — a phishing email that is perfectly
  // consistent with itself (sender domain == link domain) must never be
  // opened automatically just because the URL looks like a verification link.
  const trustedHosts = expectation?.trustedHosts ?? [];
  const domainBound =
    trustedHosts.length > 0 && hostMatchesExpectation(parsed.hostname, trustedHosts);
  if (!domainBound) {
    reasons.push(trustedHosts.length > 0 ? 'domain-not-expected' : 'no-domain-expectation');
  }

  const canAutoOpen = structuralAutoOpen && domainBound;

  if (hardReject) {
    cls = 'reject';
  }

  return { cls, quality, reasons, hardReject, canAutoOpen, structuralAutoOpen, domainBound };
}

/** True if this link is good enough to *select* as the email's action link */
export function isSelectableActivationLink(
  url: string | { url?: string } | null | undefined,
  anchorText = '',
  surroundingText = ''
): boolean {
  const v = scoreActivationLink(url, anchorText, surroundingText);
  return !v.hardReject && v.cls !== 'unknown' && v.quality >= SELECT_MIN_QUALITY;
}

/** True if safe to auto-open without review */
export function isAutoOpenableActivationLink(
  url: string | { url?: string } | null | undefined,
  anchorText = '',
  surroundingText = '',
  expectation?: ActivationLinkExpectation
): boolean {
  const verdict = scoreActivationLink(url, anchorText, surroundingText, expectation);
  // Without an expectation the caller has not established a domain binding
  // yet, so only the structural proof can be judged here. Those callers must
  // bind the destination themselves (see canAutoOpenVerificationLink in
  // services/emailServices/privacy.ts) before opening the link.
  return expectation ? verdict.canAutoOpen : verdict.structuralAutoOpen;
}

/**
 * True if the link is safe to auto-open AND points at one of the expected
 * hosts. Unlike the structural predicate above this always fails closed when
 * the destination is not bound to an expected host.
 */
export function isAutoOpenableActivationLinkForHosts(
  url: string | { url?: string } | null | undefined,
  anchorText = '',
  surroundingText = '',
  trustedHosts: string[]
): boolean {
  return scoreActivationLink(url, anchorText, surroundingText, { trustedHosts }).canAutoOpen;
}

/** Dual-engine consensus: pick the better activation link. */
export function pickBestActivationLink<
  T extends { url: string; anchorText?: string; context?: string; confidence?: number },
>(a: T | null | undefined, b: T | null | undefined): T | null {
  const score = (c: T | null | undefined) => {
    if (!c?.url) {
      return -1;
    }
    const g = scoreActivationLink(c.url, c.anchorText || '', c.context || '');
    if (g.hardReject || g.cls === 'unknown' || g.quality < SELECT_MIN_QUALITY) {
      return -1;
    }
    const conf =
      typeof c.confidence === 'number' ? (c.confidence > 1 ? c.confidence : c.confidence * 100) : 0;
    return g.quality * 1.15 + conf * 0.25;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa < 0 && sb < 0) {
    return null;
  }
  if (sa >= sb) {
    return a ?? null;
  }
  return b ?? null;
}
