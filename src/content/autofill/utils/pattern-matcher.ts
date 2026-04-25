/**
 * NEGATIVE PATTERN MATCHER
 * Helps filter out non-OTP fields (emails, search bars, etc.) to reduce noise.
 */
export class NegativePatternMatcher {
  private static readonly NON_OTP_PATTERNS: readonly RegExp[] = [
    /email|mail/i,
    /search/i,
    /address|street|city|state|country|zip|postal/i,
    /name|first|last|full|middle/i,
    /card|cvv|ccv|cvc|expir|credit|debit/i,
    /promo|coupon|discount|gift|voucher|referral/i,
    /comment|message|note|description|bio/i,
    /url|website|link|domain/i,
    /company|organization|org/i,
    /quantity|amount|price|total|subtotal/i,
    /date|month|year|day/i,
    /ssn|social|tax|national/i,
    /routing|account.*number|iban|swift|bic/i,
  ];

  static isLikelyNotOTP(input: HTMLInputElement): boolean {
    const nameId = `${input.name} ${input.id}`.toLowerCase();
    const combined = `${nameId} ${input.placeholder} ${input.autocomplete}`.toLowerCase();
    const type = input.type.toLowerCase();

    if (['email', 'search', 'url', 'date', 'month'].includes(type)) {
      return true;
    }

    // Fix phone guard: exclude phone only if it's a standard-length field.
    // Legitimate split-digit OTPs often use type="tel" but with maxLength=1.
    if (
      (/phone|tel|mobile/i.test(nameId) || type === 'tel') &&
      (input.maxLength > 4 || input.maxLength === -1)
    ) {
      return true;
    }

    for (const pattern of this.NON_OTP_PATTERNS) {
      if (pattern.test(combined)) {
        // Double check: if it matches a negative pattern but is also explicitly called "otp", allow it.
        if (/otp|code/i.test(nameId) && !/card|cvv|promo/i.test(nameId)) {
          continue;
        }
        return true;
      }
    }
    return false;
  }

  static isOTPCompatibleType(input: HTMLInputElement): boolean {
    const type = input.type.toLowerCase();
    return ['text', 'tel', 'number', 'password', ''].includes(type);
  }
}
