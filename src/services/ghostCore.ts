import { createLogger } from '../utils/logger';

import { extractActivationLinks } from './activationLinkExtractor';
// Import shared types from extraction module to prevent circular dependencies
import type { EmailCategory, ClassificationResult } from './extraction/types';
import { extractOTP } from './otpExtractor';

const log = createLogger('GhostCore');

// Re-export types for backward compatibility
export type { EmailCategory, ClassificationResult };

interface ScoringBreakdown {
  codeScore: number;
  linkScore: number;
  antiScore: number;
  codes: string[];
  links: string[];
  urlCodes: UrlCode[];
}

interface UrlCode {
  code: string;
  param: string;
  url: string;
}

// Multi-lingual dictionary for global matching
const VERIFY_KEYWORDS =
  'verification|security|confirmation|one[- ]?time|login|sign[- ]?in|auth|verify|confirm|validate|código|vérification|verificación|Bestätigung|パスワード|認証';
const CODE_KEYWORDS = 'code|pin|otp|token|key|pwd|mot de passe|código';

/**
 * The GhostCore Engine - A blazingly fast, multi-lingual weighted scoring classifier.
 * Replaces heavy LLMs for 95% of use-cases.
 */
export function classifyWithGhostCore(
  subject: string,
  textBody: string,
  htmlBody: string = '',
  sender: string = '',
  expectedDomains: string[] = []
): ClassificationResult {
  const startTime = performance.now();
  const html = htmlBody || textBody;
  const text = textBody; // We expect textBody to already be cleaned

  // Evaluate scores based on structural patterns
  const scores = score(subject, text, html, sender, expectedDomains);

  // Augment with the robust 14-Layer Context-Aware detector
  const otpResult = extractOTP(html, subject, sender);
  if (otpResult.best && otpResult.best.confidence >= 0.5) {
    log.debug(`[GhostFill-OTP] Extracted robust OTP: ${otpResult.best.code}`);
    scores.codes.unshift(otpResult.best.code);
    scores.codeScore += 80; // Guarantee it surpasses the 30pt threshold
  }

  // Rely on Definitive Link Extractor for high-accuracy verification link routing
  const linkResult = extractActivationLinks(html);
  if (linkResult.best && linkResult.best.score >= 20) {
    log.debug(
      `[LinkExtractor] Found optimal link: ${linkResult.best.url} (Score: ${linkResult.best.score})`
    );
    scores.links.unshift(linkResult.best.url);
    scores.linkScore += linkResult.best.score;

    if (linkResult.best.hasEmbeddedCode && linkResult.best.embeddedCode) {
      scores.urlCodes.unshift({
        url: linkResult.best.url,
        code: linkResult.best.embeddedCode,
        param: linkResult.best.embeddedCodeParam || 'code',
      });
      scores.codeScore += 50; // Embedded codes are extremely strong OTPs
    }
  }

  // ── Decision Logic ──────────
  // Anti-score gates everything. If it's clearly not verification (receipt, tracking), bail out.
  if (scores.antiScore >= 50) {
    log.debug(`[GhostCore] Anti-score threshold hit (${scores.antiScore}). Not verification.`);
    return {
      type: 'none',
      confidence: Math.min(scores.antiScore / 100, 1),
      engine: 'ghost-core',
      debug: `Anti-score ${scores.antiScore} >= 50`,
    };
  }

  const hasCode = scores.codeScore >= 30 && scores.codes.length > 0;
  const hasLink = scores.linkScore >= 30 && scores.links.length > 0;
  const hasUrlCode = scores.urlCodes.length > 0;

  let category: EmailCategory = 'none';
  let confidence = 0;
  let code: string | undefined;
  let link: string | undefined;

  // Determine category based on weighted confidence
  if (hasCode && (hasLink || hasUrlCode)) {
    category = 'both';
    confidence = Math.min((scores.codeScore + scores.linkScore) / 200, 1);
    code = scores.codes[0] || scores.urlCodes[0]?.code;
    link = scores.links[0] || scores.urlCodes[0]?.url;
  } else if (hasUrlCode && hasLink) {
    // Mistral/Clerk pattern: code embedded in the required URL
    category = 'both';
    confidence = Math.min(scores.linkScore / 100, 1);
    code = scores.urlCodes[0].code;
    link = scores.urlCodes[0].url;
  } else if (hasCode) {
    category = 'otp';
    confidence = Math.min(scores.codeScore / 100, 1);
    code = scores.codes[0];
  } else if (hasLink) {
    category = 'link';
    confidence = Math.min(scores.linkScore / 100, 1);
    link = scores.links[0];

    // Edge case fallback: link is valid but happens to have a code we missed in URL parser
    if (hasUrlCode) {
      category = 'both';
      code = scores.urlCodes[0].code;
      link = scores.urlCodes[0].url;
    }
  } else {
    category = 'none';
    // Base confidence of why it failed
    confidence = 0.5;
  }

  const latency = (performance.now() - startTime).toFixed(2);
  log.info(
    `[GhostCore] Classification complete in ${latency}ms: ${category} (C:${confidence.toFixed(2)})`
  );

  return {
    type: category,
    confidence,
    code,
    link,
    engine: 'ghost-core',
    debug: `C:${scores.codeScore} L:${scores.linkScore} A:${scores.antiScore} ms:${latency}`,
  };
}

function score(
  subject: string,
  text: string,
  html: string,
  sender: string,
  expectedDomains: string[] = []
): ScoringBreakdown {
  let codeScore = 0;
  let linkScore = 0;
  let antiScore = 0;

  const lowerText = text.toLowerCase();
  const lowerSubject = subject.toLowerCase();
  const lowerSender = sender.toLowerCase();

  // ── 1. CODE SIGNALS ──
  // All naive regex patterns have been ripped out
  // Relying on robust context-aware extraction from OD2 via classifyWithGhostCore injection
  const codes: string[] = [];

  // Code context boosters
  if (/expires?\s*in\s*\d+\s*(min|hour|second|minute)/i.test(text)) {
    codeScore += 15;
  }
  if (/don['’]?t\s*share|ne pas partager|no compartir/i.test(text)) {
    codeScore += 15;
  }
  if (new RegExp(`(?:${VERIFY_KEYWORDS})`).test(lowerText)) {
    codeScore += 10;
  }
  if (new RegExp(`(?:${CODE_KEYWORDS})`).test(lowerSubject)) {
    codeScore += 20;
  }

  // ── 2. LINK SIGNALS ──
  const links: string[] = [];
  const urlCodes: UrlCode[] = [];

  // The legacy anchor-regex parsing has been deferred to activationLinkExtractor

  // Link context boosters
  if (/click\s*(the|this)?\s*(link|button|below)/i.test(text)) {
    linkScore += 15;
  }
  if (new RegExp(VERIFY_KEYWORDS).test(lowerSubject)) {
    linkScore += 15;
  }

  // ── 3. ANTI-SIGNALS (Phishing, Newsletters, Receipts) ──
  if (/newsletter|digest|roundup|update|trending|top\s*stories/i.test(lowerText)) {
    antiScore += 30;
  }
  if (/\b(sale|discount|%\s*off|promo|coupon|deal|buy\s*now|shop)\b/i.test(lowerText)) {
    antiScore += 30;
  }
  if (/order\s*(#|number)|receipt|invoice|payment|statement/i.test(lowerText)) {
    antiScore += 30;
  }
  if (/(liked|commented|mentioned|shared)\s*(your|you)/i.test(lowerText)) {
    antiScore += 25;
  }
  if (/tracking\s*number|shipped|delivered/i.test(lowerText)) {
    antiScore += 25;
  }

  // ── 4. GLOBAL BOOSTERS & STATE A (Tab-Context) ──
  if (/^(no[-_]?reply|verify|auth|security|notification|accounts?)@/i.test(lowerSender)) {
    codeScore += 5;
    linkScore += 5;
  }

  // STATE A: Tab-Context Predictor
  // Helper to extract root domain (e.g. mail.google.com -> google.com)
  const getRootDomain = (hostname: string) => {
    const parts = hostname.split('.');
    if (parts.length <= 2) {
      return hostname;
    } // Already root or TLD
    return parts.slice(-2).join('.');
  };

  if (expectedDomains.length > 0) {
    let domainMatched = false;
    for (const expectedDomain of expectedDomains) {
      const cleanExpected = expectedDomain
        .replace(
          /^(www\.|app\.|auth\.|login\.|secure\.|id\.|sso\.|my\.|portal\.|dashboard\.|accounts\.)/,
          ''
        )
        .toLowerCase();
      const cleanSender =
        lowerSender
          .split('@')
          .pop()
          ?.replace(
            /^(mail\.|notify\.|info\.|secure\.|auth\.|reply\.|accounts\.|accounts-|noreply\.|noreply-|no-reply\.|do-not-reply\.|team\.|security\.|support\.|hello\.|help\.|email\.|e\.|notifications?\.|alerts?\.|verify\.|verification\.|confirmation\.|mailer\.)/,
            ''
          )
          .toLowerCase() || lowerSender;

      const rootExpected = getRootDomain(cleanExpected);
      const rootSender = getRootDomain(cleanSender);

      if (
        rootExpected === rootSender ||
        cleanSender.includes(rootExpected) ||
        cleanExpected.includes(rootSender)
      ) {
        domainMatched = true;
        break;
      }
    }

    if (domainMatched) {
      log.info(`[State A] Domain match detected for ${sender}. Applying massive context boost.`);
      codeScore += 45;
      linkScore += 45;
      // Suppress anti-scores slightly because we expect this email
      antiScore = Math.max(0, antiScore - 20);
    }
  }

  // Verification emails are usually short.
  const wordCount = text.split(/\s+/).length;
  if (wordCount < 80) {
    codeScore += 5;
    linkScore += 5;
  } else if (wordCount > 500) {
    antiScore += 20; // Long emails are rarely pure verification
  }

  return {
    codeScore: Math.max(0, codeScore),
    linkScore: Math.max(0, linkScore),
    antiScore: Math.max(0, antiScore),
    codes: [...new Set([...codes, ...urlCodes.map((u) => u.code)])],
    links,
    urlCodes,
  };
}

// ─── Helpers ───
