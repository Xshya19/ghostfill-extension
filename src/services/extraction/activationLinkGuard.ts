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
 */

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
  canAutoOpen: boolean;
}

/** Minimum quality to surface as the extracted activation link */
export const SELECT_MIN_QUALITY = 62;
/** Minimum quality to auto-open without user review */
export const AUTO_OPEN_MIN_QUALITY = 78;

/**
 * Path / route synonyms: verify · activate · confirm · validate · complete ·
 * magic · invite · reset · claim · enable · unlock · Firebase email-action, etc.
 */
const STRONG_PATH_RE =
  /\/(?:verify(?:[-_]?(?:email|account|address|user|phone|identity|mail))?|verification(?:[-_]?(?:email|account|link|code))?|e[-_]?verify|email[-_]?verif(?:y|ication)|verif(?:y|ication)[-_]?email|activate(?:[-_]?(?:email|account|user|membership|subscription|mail))?|activation(?:[-_]?(?:email|account|link))?|active[-_]?(?:email|account|mail|user)?|confirm(?:[-_]?(?:email|account|address|user|identity|registration|signup|sign[-_]?up|mail))?|confirmation(?:[-_]?(?:email|account|link))?|email[-_]?confirm(?:ation)?|confirm[-_]?email|validate(?:[-_]?(?:email|account|address|user|identity))?|validation(?:[-_]?(?:email|account))?|email[-_]?validat(?:e|ion)|register(?:ation)?(?:[-_]?(?:confirm|verify|activate|complete|finish))?|signup|sign[-_]?up|complete[-_]?(?:signup|sign[-_]?up|registration|setup|account|email|profile|onboarding)?|finish[-_]?(?:signup|sign[-_]?up|registration|setup|account)?|onboard(?:ing)?(?:[-_]?(?:complete|finish|verify|confirm))?|welcome(?:[-_]?(?:aboard|back))?|magic(?:[-_]?(?:link|login|auth))?|passwordless|signin[-_]?link|sign[-_]?in[-_]?link|login[-_]?link|log[-_]?in[-_]?link|email[-_]?(?:login|signin|sign[-_]?in|link|action)|email\/action|auth\/action|__\/auth\/action|auth(?:enticate)?[-_]?(?:link|email|action|verify|confirm)?|accept[-_]?(?:invite|invitation|request)?|invitation|invite(?:[-_]?(?:accept|join|link))?|join[-_]?(?:workspace|team|org|organization|organisation|group|project|board)?|authorize|authorise|approve|authenticate|device[-_]?(?:confirm|auth|trust|verify|approve)?|trust[-_]?device|reset[-_]?password|password[-_]?reset|forgot[-_]?password|password[-_]?forgot|recover[-_]?(?:password|account)|change[-_]?password|set[-_]?password|create[-_]?password|choose[-_]?password|unlock(?:[-_]?account)?|enable(?:[-_]?(?:account|email|2fa|mfa))?|claim(?:[-_]?(?:account|profile|invite))?|consent|acknowledge|prove[-_]?(?:identity|ownership)?|email[-_]?action|user(?:s)?\/(?:activate|verify|confirm|validate|enable)|account(?:s)?\/(?:activate|verify|confirm|validate|enable)|member(?:s)?\/(?:activate|verify|confirm)|oauth\/callback|callback|link\/(?:login|auth|verify)|login\/link|auth\/link|continue(?:[-_]?(?:signup|registration|setup))?|proceed|secure[-_]?(?:account|link)?)(?:\/|$|\?|#)/i;

const STRONG_QUERY =
  /[?&#](?:token|confirmation[_-]?token|confirm[_-]?token|activation[_-]?token|verify[_-]?token|verification[_-]?token|validation[_-]?token|invite[_-]?token|invitation[_-]?token|magic[_-]?token|access[_-]?token|id[_-]?token|email[_-]?token|auth[_-]?token|login[_-]?token|reset[_-]?token|recovery[_-]?token|oob[_-]?code|oobCode|mode=(?:verifyEmail|resetPassword|recoverEmail|signIn)|action=(?:verify|confirm|activate|validate|reset|accept)|type=(?:activation|verification|confirm|email[_-]?verif|invite)|code|otp|sig|signature|expires?|exp|uid|user[_-]?id|email)=/i;

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

// ── Hard reject (never auto-open) ──
const HARD_REJECT_URL =
  /unsubscribe|opt[-_]?out|email[-_]?preferences|manage[-_]?preferences|privacy(?:[-_]?policy)?|terms(?:[-_]?of)?|cookie|legal|cdn\.|\/static\/|\/assets\/|fonts?\.|images?\.|img\.|\/beacon|\/pixel|analytics|view[-_]?in[-_]?browser|web[-_]?version|facebook\.com|twitter\.com|x\.com\/|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com|pinterest\.com|play\.google\.com|apps\.apple\.com|itunes\.apple\.com|\/(?:dashboard|pricing|plans|billing|settings|preferences|profile|docs|documentation|blog|help|support|shop|store|sale|deals|home)(?:\/|\?|$)|shop\s*now|learn\s*more|read\s*more|download\s*app/i;

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

function classifyPath(url: string, anchorText = ''): ActivationLinkClass {
  const hay = `${url} ${anchorText}`;
  if (
    /reset|forgot|recover|change[-_]?password|set[-_]?password|create[-_]?password|mode=resetPassword/i.test(
      hay
    )
  ) {
    return 'password-reset';
  }
  if (
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
  url: string,
  anchorText = '',
  surroundingText = ''
): ActivationLinkVerdict {
  const reasons: string[] = [];
  let quality = 0;
  const combinedText = `${anchorText} ${surroundingText}`.toLowerCase();

  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['not-http-url'],
      hardReject: true,
      canAutoOpen: false,
    };
  }

  const hardUrlHit = HARD_REJECT_URL.test(url);
  const hardAnchorHit = HARD_REJECT_ANCHOR.test(anchorText);
  const pathStrongEarly = STRONG_PATH_RE.test(url);

  // Allow hard-reject URL hits only when a strong activation path coexists
  if (hardAnchorHit && !pathStrongEarly) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['hard-reject-marketing-or-footer'],
      hardReject: true,
      canAutoOpen: false,
    };
  }
  if (hardUrlHit && !pathStrongEarly) {
    return {
      cls: 'reject',
      quality: 0,
      reasons: ['hard-reject-marketing-or-footer'],
      hardReject: true,
      canAutoOpen: false,
    };
  }

  const pathStrong = pathStrongEarly;
  const queryStrong = STRONG_QUERY.test(url);
  const anchorStrong = STRONG_ANCHOR_RE.test(anchorText);
  const contextStrong = STRONG_ANCHOR_RE.test(surroundingText);
  const softPath = SOFT_PATH_RE.test(url);
  const token = hasAuthToken(url);
  let cls = classifyPath(url, anchorText);

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
      const fromAnchor = classifyPath(url, anchorText);
      cls = fromAnchor !== 'unknown' ? fromAnchor : 'activation';
    }
  }
  if (contextStrong && !anchorStrong) {
    quality += 16;
    reasons.push('strong-context');
    if (cls === 'unknown') {
      cls = 'activation';
    }
  }

  if (url.startsWith('https://')) {
    quality += 6;
  } else {
    quality -= 12;
    reasons.push('non-https');
  }

  if (SOFT_MARKETING.test(url) || SOFT_MARKETING.test(combinedText)) {
    quality -= 30;
    reasons.push('marketing-language');
  }

  const hasActionProof = pathStrong || anchorStrong || contextStrong;
  if (token && !hasActionProof) {
    if (softPath) {
      quality -= 18;
      reasons.push('token-with-soft-path-only');
      if (cls === 'unknown') cls = 'activation';
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
  } else if (contextStrong && token && softPath) {
    quality = Math.max(quality, 72);
    reasons.push('context-token-softpath');
  }

  quality = Math.max(0, Math.min(100, quality));

  const hardReject = quality < 20 || cls === 'reject';
  const canAutoOpen =
    !hardReject &&
    cls !== 'unknown' &&
    quality >= AUTO_OPEN_MIN_QUALITY &&
    hasActionProof &&
    (pathStrong || (anchorStrong && token) || (pathStrong && anchorStrong));

  if (hardReject) {
    cls = 'reject';
  }

  return { cls, quality, reasons, hardReject, canAutoOpen };
}

/** True if this link is good enough to *select* as the email's action link */
export function isSelectableActivationLink(
  url: string,
  anchorText = '',
  surroundingText = ''
): boolean {
  const v = scoreActivationLink(url, anchorText, surroundingText);
  return !v.hardReject && v.cls !== 'unknown' && v.quality >= SELECT_MIN_QUALITY;
}

/** True if safe to auto-open without review */
export function isAutoOpenableActivationLink(
  url: string,
  anchorText = '',
  surroundingText = ''
): boolean {
  return scoreActivationLink(url, anchorText, surroundingText).canAutoOpen;
}

/** Dual-engine consensus: pick the better activation link. */
export function pickBestActivationLink<
  T extends { url: string; anchorText?: string; context?: string; confidence?: number },
>(a: T | null | undefined, b: T | null | undefined): T | null {
  const score = (c: T | null | undefined) => {
    if (!c?.url) return -1;
    const g = scoreActivationLink(c.url, c.anchorText || '', c.context || '');
    if (g.hardReject || g.cls === 'unknown' || g.quality < SELECT_MIN_QUALITY) return -1;
    const conf =
      typeof c.confidence === 'number'
        ? c.confidence > 1
          ? c.confidence
          : c.confidence * 100
        : 0;
    return g.quality * 1.15 + conf * 0.25;
  };
  const sa = score(a);
  const sb = score(b);
  if (sa < 0 && sb < 0) return null;
  if (sa >= sb) return a ?? null;
  return b ?? null;
}
