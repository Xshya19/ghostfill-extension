/**
 * A code immediately following an authentication label is stronger evidence
 * than a product name, date, or unrelated number elsewhere in the email.
 * Keep this conservative: it is used to resolve extractor disagreements.
 */
export function extractExplicitVerificationCode(body: string): string | null {
  if (!body) {
    return null;
  }

  const labeledCode = /\b(?:your\s+(?:(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time)\s+)?(?:code|otp|passcode|pin)|(?:verification|security|confirmation|authentication|login|sign[ -]?in|one[ -]?time)\s+(?:code|otp|passcode|pin))\s*(?:is\s*)?(?::|=|#|[-–—])?\s*(\d{4,8})(?!\d)/gi;
  const match = labeledCode.exec(body.slice(0, 20_000));
  return match?.[1] ?? null;
}

/** A domain name in the subject is an identity, not the email's code. */
export function isSubjectDomainToken(code: string, subject: string): boolean {
  if (!/[a-z]/i.test(code) || !subject) {
    return false;
  }
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\.[a-z]{2,}\\b`, 'i').test(subject);
}
