const PROMO_CONTEXT_RE = /(?:\b(?:promo|coupon|discount|voucher|referral|checkout)\b|%\s*off)/i;

const TRIVIAL_SEQUENCE_RE =
  /^(?:(\d)\1{3,}|0123\d*|1234\d*|2345\d*|3456\d*|4567\d*|5678\d*|6789\d*|9876\d*|8765\d*|7654\d*|6543\d*|5432\d*|4321\d*|3210\d*)$/;

function isValidExplicitCode(
  candidate: string,
  text: string,
  matchStart: number,
  matchLen: number
): boolean {
  if (!/\d/.test(candidate)) {
    return false;
  }
  const hasLetters = /[A-Za-z]/.test(candidate);
  if (hasLetters) {
    const hasUpper = /[A-Z]/.test(candidate);
    const hasTwoDigits = /(?:\d.*){2,}/.test(candidate);
    if (!hasUpper && !hasTwoDigits) {
      return false;
    }
  } else if (candidate.length > 8) {
    return false;
  }
  if (TRIVIAL_SEQUENCE_RE.test(candidate)) {
    return false;
  }
  const aroundStart = Math.max(0, matchStart - 50);
  const aroundEnd = Math.min(text.length, matchStart + matchLen + 50);
  if (PROMO_CONTEXT_RE.test(text.slice(aroundStart, aroundEnd))) {
    return false;
  }
  return true;
}

/**
 * A code immediately following an authentication label is stronger evidence
 * than a product name, date, or unrelated number elsewhere in the email.
 * Keep this conservative: it is used to resolve extractor disagreements.
 */
export function extractExplicitVerificationCode(body: string): string | null {
  if (!body) {
    return null;
  }

  const slice = body.slice(0, 20_000);
  const labeledCode =
    /\b(?:your\s+(?:(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time)\s+)?(?:code|otp|passcode|pin)|(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time)\s+(?:code|otp|passcode|pin))\s*(?:is\s*)?(?::|=|#|[-–—])?\s*([A-Za-z0-9]{4,10})(?![A-Za-z0-9])/gi;

  let match: RegExpExecArray | null;
  while ((match = labeledCode.exec(slice)) !== null) {
    const candidate = match[1];
    if (candidate && isValidExplicitCode(candidate, slice, match.index, match[0].length)) {
      return candidate;
    }
  }
  return null;
}

/** A domain name in the subject is an identity, not the email's code. */
export function isSubjectDomainToken(code: string, subject: string): boolean {
  if (!/[a-z]/i.test(code) || !subject) {
    return false;
  }
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\.[a-z]{2,}\\b`, 'i').test(subject);
}
