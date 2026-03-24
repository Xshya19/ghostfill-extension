// Data Formatters
import {
  formatFileSize,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  pluralize,
} from './core';

export {
  formatFileSize,
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  pluralize,
};


/**
 * Format password strength as text
 */
export function formatPasswordStrength(score: number): string {
  if (score < 20) {
    return 'Very Weak';
  }
  if (score < 40) {
    return 'Weak';
  }
  if (score < 60) {
    return 'Fair';
  }
  if (score < 80) {
    return 'Strong';
  }
  return 'Very Strong';
}

/**
 * Format crack time estimate
 */
export function formatCrackTime(seconds: number): string {
  if (seconds < 1) {
    return 'instant';
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)} seconds`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} minutes`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} hours`;
  }
  if (seconds < 2592000) {
    return `${Math.floor(seconds / 86400)} days`;
  }
  if (seconds < 31536000) {
    return `${Math.floor(seconds / 2592000)} months`;
  }
  if (seconds < 3153600000) {
    return `${Math.floor(seconds / 31536000)} years`;
  }
  if (seconds < 3153600000000) {
    return `${Math.floor(seconds / 3153600000)} centuries`;
  }
  return 'forever';
}

/**
 * Format email address for display (truncate if too long)
 */
export function formatEmailDisplay(email: string, maxLength: number = 30): string {
  if (email.length <= maxLength) {
    return email;
  }

  const [local, domain] = email.split('@');
  if (!domain) {
    return email.substring(0, maxLength) + '...';
  }

  const availableForLocal = maxLength - domain.length - 4; // 4 for "...@"
  if (availableForLocal < 3) {
    return email.substring(0, maxLength - 3) + '...';
  }

  return local.substring(0, availableForLocal) + '...@' + domain;
}


/**
 * Format OTP for display (add spaces for readability)
 */
export function formatOTP(otp: string): string {
  // If it's 6 digits, format as 123 456
  if (/^\d{6}$/.test(otp)) {
    return otp.substring(0, 3) + ' ' + otp.substring(3);
  }
  // If it's 8 digits, format as 1234 5678
  if (/^\d{8}$/.test(otp)) {
    return otp.substring(0, 4) + ' ' + otp.substring(4);
  }
  return otp;
}

/**
 * Format domain for display (remove www)
 */
export function formatDomain(domain: string): string {
  return domain.replace(/^www\./i, '');
}

/**
 * Mask password for display
 */
export function maskPassword(
  password: string,
  showFirst: number = 2,
  showLast: number = 2
): string {
  if (password.length <= showFirst + showLast + 2) {
    return '•'.repeat(password.length);
  }

  const first = password.substring(0, showFirst);
  const last = password.substring(password.length - showLast);
  const middle = '•'.repeat(Math.min(password.length - showFirst - showLast, 8));

  return first + middle + last;
}

/**
 * Format entropy in bits
 */
export function formatEntropy(entropy: number): string {
  return `${Math.round(entropy)} bits`;
}


/**
 * Extract OTP/verification code from text
 *
 * Uses context-aware extraction to avoid false positives like:
 * - Years (2024, 2023)
 * - Prices (₹12500, $99.99)
 * - Order numbers, tracking numbers, phone numbers
 * - IP addresses, CSS values, dates, times
 *
 * Only extracts numbers that appear near OTP-related keywords
 * like "code", "verify", "otp", "pin", "verification", etc.
 */
export function extractOTP(text: string): string | null {
  if (!text) {
    return null;
  }

  const lowerText = text.toLowerCase();

  // OTP context keywords - must appear near the code
  const otpKeywords = [
    'verification code',
    'verify code',
    'security code',
    'confirmation code',
    'authentication code',
    'one time',
    'one-time',
    'otp',
    'passcode',
    'code is',
    'code:',
    'pin is',
    'pin:',
    'your code',
    'the code',
    'enter code',
    'use code',
    'type code',
    'input code',
    'login code',
    'sign in code',
    'access code',
    '2fa code',
    'password reset',
    'recovery code',
    'code to verify',
    'code for',
  ];

  // Anti-patterns - reject these common false positives
  const antiPatterns = [
    { name: 'year', regex: /^(?:19|20)\d{2}$/ },
    { name: 'price-currency', regex: /^[$€£¥₹]/ },
    { name: 'ip-address', regex: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/ },
    { name: 'css-hex', regex: /^#[0-9a-f]{3,8}$/i },
    { name: 'css-value', regex: /^\d+(?:px|em|rem|pt|%)$/ },
    { name: 'date', regex: /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/ },
    { name: 'time', regex: /^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]m)?$/i },
    { name: 'phone', regex: /^[+]?\d[\d\s()-]{9,14}$/ },
    { name: 'repeated', regex: /^(\d)\1{3,}$/ },
    { name: 'all-zeros', regex: /^0+$/ },
  ];

  // Check if text has OTP-related context
  const hasOTPContext = otpKeywords.some((keyword) => lowerText.includes(keyword));

  // If no OTP context, don't extract (avoids false positives from random emails)
  if (!hasOTPContext) {
    return null;
  }

  // Find all 4-8 digit numbers
  const numberRegex = /\b(\d{4,8})\b/g;
  const candidates: Array<{ value: string; index: number; context: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = numberRegex.exec(text)) !== null) {
    const value = match[1];
    const index = match.index;

    // Get context window around the number (80 chars before and after)
    const contextStart = Math.max(0, index - 80);
    const contextEnd = Math.min(text.length, index + value.length + 80);
    const context = text.substring(contextStart, contextEnd).toLowerCase();

    candidates.push({ value, index, context });
  }

  if (candidates.length === 0) {
    return null;
  }

  // Score and filter candidates
  const scoredCandidates = candidates
    .filter(({ value, context }) => {
      // Check anti-patterns
      for (const anti of antiPatterns) {
        if (anti.regex.test(value)) {
          return false;
        }
      }

      // Check for price/currency context
      if (/[$€£¥₹]|price|cost|total|amount|fee|usd|eur/i.test(context)) {
        return false;
      }

      // Check for order/tracking context
      if (
        /(?:order|tracking|shipment|package|delivery|fedex|ups|usps|dhl)\s*(?:#|number|no)/i.test(
          context
        )
      ) {
        return false;
      }

      // Check for reference/invoice context
      if (
        /(?:reference|ref|ticket|case|invoice|receipt|transaction)\s*(?:#|number|no|id)/i.test(
          context
        )
      ) {
        return false;
      }

      // Check for account/member context
      if (/(?:account|acct|member|customer|user|client)\s*(?:#|number|no|id)/i.test(context)) {
        return false;
      }

      // Check for zip/postal context
      if (/(?:zip|postal|area)\s*(?:code)?/i.test(context)) {
        return false;
      }

      return true;
    })
    .map(({ value, index, context }) => {
      let score = 50; // Base score

      // Bonus for OTP keywords in context
      for (const keyword of otpKeywords) {
        if (context.includes(keyword)) {
          score += 15;
          break;
        }
      }

      // Bonus for instruction verbs
      if (/(?:enter|use|type|input|provide|submit|copy|paste)/i.test(context)) {
        score += 10;
      }

      // Bonus for validity period mentions
      if (/(?:valid for|expires? in|good for|active for|\d+\s*(?:min|hour))/i.test(context)) {
        score += 8;
      }

      // Bonus for security warnings
      if (/(?:do not share|don't share|never share|confidential)/i.test(context)) {
        score += 8;
      }

      // Prefer 6-digit codes (most common OTP length)
      if (value.length === 6) {
        score += 5;
      }

      // Penalize codes in footer-like context
      if (/(?:unsubscribe|privacy policy|terms|copyright|footer)/i.test(context)) {
        score -= 20;
      }

      return { value, score, index };
    })
    .filter((c) => c.score >= 60) // Minimum threshold
    .sort((a, b) => b.score - a.score);

  if (scoredCandidates.length === 0) {
    return null;
  }

  return scoredCandidates[0].value;
}

/**
 * Extract activation/verification link from email body
 *
 * Matches:
 * 1. URLs with verification-related keywords (verify, confirm, activate, etc.)
 * 2. URLs with token-like query parameters (?t=, ?token=, ?key=, ?code=, etc.)
 * 3. URLs from known email/auth providers with opaque tokens
 * 4. The most prominent link in verification-context emails
 *
 * Handles opaque tokens like: https://app.example.com/a/b?t=abc123xyz
 */
export function extractActivationLink(text: string): string | null {
  if (!text) {
    return null;
  }

  const lowerText = text.toLowerCase();

  // Known auth/email provider domains that commonly send verification emails
  const knownProviderDomains = [
    'google.com',
    'gmail.com',
    'accounts.google.com',
    'microsoft.com',
    'live.com',
    'outlook.com',
    'account.microsoft.com',
    'apple.com',
    'icloud.com',
    'appleid.apple.com',
    'amazon.com',
    'amazonaws.com',
    'github.com',
    'gitlab.com',
    'facebook.com',
    'facebookmail.com',
    'meta.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'slack.com',
    'discord.com',
    'notion.so',
    'vercel.com',
    'netlify.com',
    'stripe.com',
    'shopify.com',
    'auth0.com',
    'okta.com',
    'onelogin.com',
  ];

  // Token-like query parameter patterns
  const tokenParamPatterns = [
    '[?&]t=',
    '[?&]token=',
    '[?&]key=',
    '[?&]code=',
    '[?&]auth=',
    '[?&]access_token=',
    '[?&]id_token=',
    '[?&]verification=',
    '[?&]verify=',
    '[?&]confirm=',
    '[?&]activation=',
    '[?&]activate=',
    '[?&]v=',
    '[?&]hash=',
    '[?&]sig=',
    '[?&]signature=',
    '[?&]uuid=',
    '[?&]uid=',
    '[?&]user=',
    '[?&]flow=',
    '[?&]oobcode=',
    '[?&]continue=',
  ];

  // Verification-related URL keywords (original patterns)
  const verificationKeywords = [
    'verify',
    'confirm',
    'activate',
    'token',
    'auth',
    'click',
    'register',
    'validate',
    'approve',
    'accept',
    'complete',
    'signup',
    'signin',
    'sign-in',
    'login',
    'log-in',
    'password-reset',
    'email-verify',
    'account-verify',
    'two-factor',
    '2fa',
  ];

  // Extract all URLs from text
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const allUrls: Array<{ url: string; score: number }> = [];

  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(text)) !== null) {
    const url = urlMatch[0];
    const lowerUrl = url.toLowerCase();
    let score = 50; // Base score

    // Check for verification keywords in URL
    for (const keyword of verificationKeywords) {
      if (lowerUrl.includes(keyword)) {
        score += 25;
        break;
      }
    }

    // Check for token-like query parameters
    for (const pattern of tokenParamPatterns) {
      if (lowerUrl.includes(pattern)) {
        score += 20;

        // Extra bonus for known providers with tokens
        for (const domain of knownProviderDomains) {
          if (lowerUrl.includes(domain)) {
            score += 15;
            break;
          }
        }
        break;
      }
    }

    // Check if URL is from a known provider
    for (const domain of knownProviderDomains) {
      if (lowerUrl.includes(domain)) {
        score += 10;
        break;
      }
    }

    // Bonus if email has verification context
    if (
      lowerText.includes('verify') ||
      lowerText.includes('confirm') ||
      lowerText.includes('activate') ||
      lowerText.includes('welcome')
    ) {
      score += 10;
    }

    // Penalize obvious non-verification URLs
    if (/(?:unsubscribe|preferences|settings|profile|dashboard|home|index)/i.test(lowerUrl)) {
      score -= 30;
    }

    // Penalize image/media URLs
    if (/(?:\.png|\.jpg|\.jpeg|\.gif|\.svg|\.webp|\/images?\/|\/assets?\/)/i.test(lowerUrl)) {
      score -= 25;
    }

    // Penalize tracking/analytics URLs
    if (/(?:tracking|analytics|pixel|beacon|click-tracker)/i.test(lowerUrl)) {
      score -= 30;
    }

    allUrls.push({ url, score });
  }

  if (allUrls.length === 0) {
    return null;
  }

  // Filter to only reasonably-scored URLs
  const candidates = allUrls.filter((u) => u.score >= 60);

  if (candidates.length === 0) {
    // If no high-scoring candidates but we have URLs and verification context,
    // return the first URL that looks like it could be a token URL
    if (
      lowerText.includes('verify') ||
      lowerText.includes('confirm') ||
      lowerText.includes('click') ||
      lowerText.includes('activate')
    ) {
      // Look for URLs with query parameters that could be tokens
      for (const { url } of allUrls) {
        const hasTokenParam = tokenParamPatterns.some((p) => url.toLowerCase().includes(p));
        const hasQueryParam = /[?&][a-z]+=[a-z0-9_-]+/i.test(url);
        if (hasTokenParam || (hasQueryParam && url.length > 30)) {
          return url;
        }
      }
    }
    return null;
  }

  // Sort by score and return the best match
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].url;
}
