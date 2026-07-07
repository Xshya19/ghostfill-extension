import type { OtpPattern } from '../../types/extraction.types';

export const OTP_PATTERN_DATABASE: OtpPattern[] = [
  // ══════════════════════════════════════════════════════════════
  //  HIGH-SIGNAL EXPLICIT LABEL PATTERNS (run FIRST, highest priority)
  //  These include surrounding context — near-impossible to false-positive on.
  // ══════════════════════════════════════════════════════════════
  {
    // "code: 123456", "otp: 123456", "verification code: 123456"
    pattern: /\b(?:code|otp|pin|passcode|token|verification\s+code|security\s+code|confirmation\s+code|auth(?:entication)?\s+code)\s*[:\s=]\s*(\d{4,8})\b/gi,
    name: 'colon-prefixed-label',
    baseConfidence: 97,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Explicit label with colon/equals prefix (code: 123456)',
  },
  {
    // "Your code is 123456", "your OTP is 123456", "Your verification code is 123456"
    pattern: /\byour\s+(?:\w+\s+){0,3}(?:code|otp|pin|passcode|token)\s+is\s+(\d{4,8})\b/gi,
    name: 'your-code-is',
    baseConfidence: 97,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Your [X] is [code] pattern',
  },
  {
    // "123456 is your code", "123456 is your OTP"
    pattern: /\b(\d{4,8})\s+is\s+your\s+(?:\w+\s+){0,2}(?:code|otp|pin|passcode|verification|confirmation)\b/gi,
    name: 'code-is-yours',
    baseConfidence: 97,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: '[code] is your [X] pattern',
  },
  {
    // "Enter 123456 to verify/confirm/log in"
    pattern: /\b(?:enter|use|type|input|submit|provide|copy)\s+(\d{4,8})\s+to\s+(?:verify|confirm|log\s*in|sign\s*in|authenticate|validate|complete|access|continue)\b/gi,
    name: 'enter-to-verify',
    baseConfidence: 97,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Enter [code] to [action] pattern',
  },
  {
    // Bracket-wrapped: [123456], (123456), {123456}
    // Very common in marketing platform transactional emails
    pattern: /[\[({]\s*(\d{4,8})\s*[\])}]/g,
    name: 'bracket-wrapped',
    baseConfidence: 88,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Bracket-wrapped code [123456] or (123456)',
  },
  {
    // Alphanumeric with explicit label: "code: ABC123", "token: XY9Z44"
    pattern: /\b(?:code|otp|pin|passcode|token|verification\s+code)\s*[:\s=]\s*([A-Z0-9]{4,10})\b/gi,
    name: 'colon-prefixed-alphanumeric',
    baseConfidence: 94,
    minLength: 4,
    maxLength: 10,
    isNumeric: false,
    description: 'Explicit label with alphanumeric code',
  },
  {
    // "Use code ABC123" or "Enter code XY9844"
    pattern: /\b(?:enter|use|type|input)\s+(?:the\s+)?(?:code|otp|pin)\s+([A-Z0-9]{4,10})\b/gi,
    name: 'use-code-alphanumeric',
    baseConfidence: 93,
    minLength: 4,
    maxLength: 10,
    isNumeric: false,
    description: 'Use/enter code [alphanumeric]',
  },
  {
    // "Your verification code: 123456" — common SaaS format
    pattern: /(?:verification|confirmation|security|one.?time|login|sign.?in)\s+code\s*[-:–—]\s*(\d{4,8})\b/gi,
    name: 'type-prefixed-code',
    baseConfidence: 96,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Type-prefixed code (verification code: 123456)',
  },

  // ══════════════════════════════════════════════════════════════
  //  HTML STRUCTURAL PATTERNS
  //  Match codes inside specific HTML elements.
  //  Run against raw htmlBody.
  // ══════════════════════════════════════════════════════════════
  {
    // Standalone number in a <td> or <th> cell — very common in email templates
    pattern: /<(?:td|th)[^>]*>\s*(\d{4,8})\s*<\/(?:td|th)>/gi,
    name: 'td-isolated-number',
    baseConfidence: 90,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Number isolated in <td>/<th> cell',
  },
  {
    // Number in center-aligned paragraph
    pattern: /<p[^>]*(?:align\s*=\s*["']center["']|text-align\s*:\s*center)[^>]*>\s*(\d{4,8})\s*<\/p>/gi,
    name: 'centered-paragraph-number',
    baseConfidence: 88,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Number in center-aligned paragraph',
  },
  {
    // Number in heading tags — h1/h2/h3 in emails is a very strong signal
    pattern: /<h[123][^>]*>\s*(\d{4,8})\s*<\/h[123]>/gi,
    name: 'heading-isolated-number',
    baseConfidence: 95,
    minLength: 4,
    maxLength: 8,
    isNumeric: true,
    description: 'Number isolated in heading tag',
  },

  // ══════════════════════════════════════════════════════════════
  //  STANDARD NUMERIC PATTERNS
  // ══════════════════════════════════════════════════════════════
  {
    pattern: /\b\d{4}\b/g,
    name: '4-digit-numeric',
    baseConfidence: 65,
    minLength: 4,
    maxLength: 4,
    isNumeric: true,
    providers: ['SMS', 'Telegram', 'Banking'],
    description: '4-digit numeric code',
  },
  {
    // Raised from 60 → 75: WhatsApp, Telegram, Snapchat use 5-digit codes
    pattern: /\b\d{5}\b/g,
    name: '5-digit-numeric',
    baseConfidence: 75,
    minLength: 5,
    maxLength: 5,
    isNumeric: true,
    providers: ['Telegram', 'WhatsApp', 'Snapchat'],
    description: '5-digit numeric code',
  },
  {
    // Raised from 80 → 92: by far the most common OTP length
    pattern: /\b\d{6}\b/g,
    name: '6-digit-numeric',
    baseConfidence: 92,
    minLength: 6,
    maxLength: 6,
    isNumeric: true,
    providers: ['Google', 'Microsoft', 'Apple', 'Amazon', 'GitHub', 'Twitter', 'Discord', 'Stripe'],
    description: '6-digit numeric code (most common)',
  },
  {
    pattern: /\b\d{7}\b/g,
    name: '7-digit-numeric',
    baseConfidence: 50,
    minLength: 7,
    maxLength: 7,
    isNumeric: true,
    providers: ['Banking'],
    description: '7-digit numeric code',
  },
  {
    pattern: /\b\d{8}\b/g,
    name: '8-digit-numeric',
    baseConfidence: 55,
    minLength: 8,
    maxLength: 8,
    isNumeric: true,
    providers: ['Banking'],
    description: '8-digit numeric code',
  },

  // ══════════════════════════════════════════════════════════════
  //  FORMATTED PATTERNS (with separators)
  // ══════════════════════════════════════════════════════════════
  {
    pattern: /\b\d{3}[-\s]\d{3}\b/g,
    name: '3-3-formatted',
    baseConfidence: 85,
    minLength: 7,
    maxLength: 7,
    isNumeric: true,
    description: '3-3 formatted (123-456)',
  },
  {
    pattern: /\b\d{4}[-\s]\d{4}\b/g,
    name: '4-4-formatted',
    baseConfidence: 72,
    minLength: 9,
    maxLength: 9,
    isNumeric: true,
    description: '4-4 formatted (1234-5678)',
  },
  {
    pattern: /\b\d{2}[-\s]\d{2}[-\s]\d{2}\b/g,
    name: '2-2-2-formatted',
    baseConfidence: 70,
    minLength: 8,
    maxLength: 8,
    isNumeric: true,
    description: '2-2-2 formatted (12-34-56)',
  },
  {
    // 3-3-3 formatted: 123 456 789 — common in UK/EU banking
    pattern: /\b\d{3}[-\s]\d{3}[-\s]\d{3}\b/g,
    name: '3-3-3-formatted',
    baseConfidence: 72,
    minLength: 11,
    maxLength: 11,
    isNumeric: true,
    description: '3-3-3 formatted (123-456-789)',
  },

  // ══════════════════════════════════════════════════════════════
  //  ALPHANUMERIC PATTERNS
  // ══════════════════════════════════════════════════════════════
  {
    pattern: /\b[A-Z0-9]{6}\b/g,
    name: '6-char-alphanumeric',
    baseConfidence: 62,
    minLength: 6,
    maxLength: 6,
    isNumeric: false,
    description: '6-character uppercase alphanumeric',
  },
  {
    pattern: /\b[A-Z0-9]{8}\b/g,
    name: '8-char-alphanumeric',
    baseConfidence: 58,
    minLength: 8,
    maxLength: 8,
    isNumeric: false,
    description: '8-character uppercase alphanumeric',
  },

  // ══════════════════════════════════════════════════════════════
  //  PROVIDER-SPECIFIC PATTERNS (HIGHEST CONFIDENCE)
  // ══════════════════════════════════════════════════════════════
  {
    pattern: /\bG-\d{6}\b/g,
    name: 'google-prefix',
    baseConfidence: 99,
    minLength: 8,
    maxLength: 8,
    isNumeric: false,
    providers: ['Google'],
    description: 'Google-specific (G-123456)',
  },
  {
    pattern: /\bMSFT\d{6}\b/g,
    name: 'microsoft-prefix',
    baseConfidence: 99,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Microsoft'],
    description: 'Microsoft-specific',
  },
  {
    pattern: /\bAAPL\d{6}\b/g,
    name: 'apple-prefix',
    baseConfidence: 98,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Apple'],
    description: 'Apple-specific',
  },
  {
    pattern: /\bAMZN\d{6}\b/g,
    name: 'amazon-prefix',
    baseConfidence: 98,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Amazon'],
    description: 'Amazon-specific',
  },
  {
    pattern: /\bFB-\d{6}\b/g,
    name: 'facebook-prefix',
    baseConfidence: 98,
    minLength: 9,
    maxLength: 9,
    isNumeric: false,
    providers: ['Facebook'],
    description: 'Facebook-specific',
  },
  {
    pattern: /\bGH-\d{6}\b/g,
    name: 'github-prefix',
    baseConfidence: 98,
    minLength: 9,
    maxLength: 9,
    isNumeric: false,
    providers: ['GitHub'],
    description: 'GitHub-specific',
  },
  {
    pattern: /\bPYPL\d{6}\b/g,
    name: 'paypal-prefix',
    baseConfidence: 98,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['PayPal'],
    description: 'PayPal-specific',
  },
  {
    pattern: /\bTLM\d{5}\b/g,
    name: 'telegram-prefix',
    baseConfidence: 98,
    minLength: 8,
    maxLength: 8,
    isNumeric: false,
    providers: ['Telegram'],
    description: 'Telegram-specific',
  },
  {
    pattern: /\bWA-\d{6}\b/g,
    name: 'whatsapp-prefix',
    baseConfidence: 98,
    minLength: 9,
    maxLength: 9,
    isNumeric: false,
    providers: ['WhatsApp'],
    description: 'WhatsApp-specific',
  },
  {
    pattern: /\bUBR\d{6}\b/g,
    name: 'uber-prefix',
    baseConfidence: 95,
    minLength: 9,
    maxLength: 9,
    isNumeric: false,
    providers: ['Uber'],
    description: 'Uber-specific',
  },
  {
    pattern: /\bABNB\d{6}\b/g,
    name: 'airbnb-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Airbnb'],
    description: 'Airbnb-specific',
  },
  {
    pattern: /\bNFLX\d{6}\b/g,
    name: 'netflix-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Netflix'],
    description: 'Netflix-specific',
  },
  {
    pattern: /\bCOIN\d{6}\b/g,
    name: 'coinbase-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Coinbase'],
    description: 'Coinbase-specific',
  },
  {
    pattern: /\bSWGY\d{6}\b/g,
    name: 'swiggy-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Swiggy'],
    description: 'Swiggy-specific',
  },
  {
    pattern: /\bZMTO\d{6}\b/g,
    name: 'zomato-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Zomato'],
    description: 'Zomato-specific',
  },
  {
    pattern: /\bFLPK\d{6}\b/g,
    name: 'flipkart-prefix',
    baseConfidence: 95,
    minLength: 10,
    maxLength: 10,
    isNumeric: false,
    providers: ['Flipkart'],
    description: 'Flipkart-specific',
  },
  {
    pattern: /\bPAYTM\d{6}\b/g,
    name: 'paytm-prefix',
    baseConfidence: 95,
    minLength: 11,
    maxLength: 11,
    isNumeric: false,
    providers: ['Paytm'],
    description: 'Paytm-specific',
  },
];



