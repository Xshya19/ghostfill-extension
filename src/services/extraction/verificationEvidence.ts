import { normalizeForExtraction } from './domEngine';
import { decodeHtmlEntities, stripHtmlPreserveStructure } from './zoneAnalyzer';

// Shape, styling, sender identity, and extractor agreement are not evidence of
// authentication. Require human-readable code instructions near the candidate.
const CODE_INSTRUCTIONS =
  /\b(?:otp|passcode|(?:verification|security|confirmation|authentication|authorization|validation|access|login|sign[ -]?in|sign[ -]?up|registration|one[ -]?time|2fa|mfa)\s+(?:code|pin|password)|your\s+(?:\w+\s+){0,3}(?:code|pin)|(?:enter|use|type|input|copy|paste)\s+(?:(?:this|the|your)\s+)?code|code\s+(?:is|expires))\b|\b(?:code|pin)\s*[:=]|\bcode\s+(?=[a-z0-9]{0,10}\d)[a-z0-9]{4,12}\b|(?:验证码|認証コード|確認コード|인증\s*코드|कोड|ओटीपी|رمز|كود|código|c[oó]d\.?\s*de\s*verifica|code de|sicherheitscode|bestätigungscode|einmalpasswort)/i;
const NON_CODE_LABEL =
  /\b(?:postal|zip|pmb|order|invoice|receipt|tracking|customer|member|account\s+(?:number|id))\s*(?:code|number|no\.?|id|#|is|:|\s)*$/i;

export function visibleVerificationText(text: string): string {
  // Decode before stripping formatting: numeric HTML entities (e.g. &#8203;)
  // otherwise look like four-digit codes to regex scanners.
  return normalizeForExtraction(decodeHtmlEntities(stripHtmlPreserveStructure(text)))
    .replace(/(?:https?:\/\/|www\.)[^\s<>"']+/gi, ' ')
    .replace(/\b[^\s<>]+@[^\s<>]+\b/g, ' ');
}

export function hasVerificationCodeEvidence(
  code: string,
  subject: string,
  body: string,
  html = ''
): boolean {
  return createVerificationCodeEvidence(subject, body, html)(code);
}

/** Request-scoped evidence: reuse normalization and agreement checks without retaining email text. */
export function createVerificationCodeEvidence(
  subject: string,
  body: string,
  html = ''
): (code: string) => boolean {
  const sources = [...new Set([body, html, subject])];
  const visible = new Map<string, string>();
  const results = new Map<string, boolean>();
  const getVisible = (source: string): string => {
    if (!visible.has(source)) {
      visible.set(source, visibleVerificationText(source));
    }
    return visible.get(source)!;
  };
  let subjectHasInstructions: boolean | undefined;

  return (code: string): boolean => {
    if (!/^[a-z0-9]{4,12}$/i.test(code)) {
      return false;
    }
    const normalizedCode = code.toLowerCase();
    const cached = results.get(normalizedCode);
    if (cached !== undefined) {
      return cached;
    }
    subjectHasInstructions ??= CODE_INSTRUCTIONS.test(getVisible(subject));
    const escaped = [...code].join('[-\\s]?');
    const candidate = new RegExp(`(?:^|[^a-z0-9])(${escaped})(?![a-z0-9])`, 'gi');
    for (const source of sources) {
      const text = getVisible(source);
      candidate.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = candidate.exec(text))) {
        const index = match.index + match[0].length - match[1]!.length;
        const before = text.slice(Math.max(0, index - 80), index);
        // A postal/address or account identifier stays metadata even when the
        // subject mentions signing in. A directly labeled code can still be 94105.
        if (NON_CODE_LABEL.test(before) || /\b[A-Z]{2}\s+$/.test(before)) {
          continue;
        }
        const local = text.slice(Math.max(0, index - 160), index + match[1]!.length + 120);
        if (subjectHasInstructions || CODE_INSTRUCTIONS.test(local)) {
          results.set(normalizedCode, true);
          return true;
        }
      }
    }
    results.set(normalizedCode, false);
    return false;
  };
}
