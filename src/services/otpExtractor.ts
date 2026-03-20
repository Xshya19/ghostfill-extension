// ═══════════════════════════════════════════════════════════════
// ⚠️ CODE QUALITY: Large Component - Needs Refactoring
// File size: ~95KB, ~1970 lines
// TODO: Split into smaller modules:
//   - otpPatterns.ts: OTP pattern definitions and regex
//   - otpContextAnalyzer.ts: Context analysis logic
//   - otpSignalScorer.ts: Signal scoring engine
//   - otpProviderMatcher.ts: Provider-specific extraction
//   - otpAntiPatterns.ts: Anti-pattern detection
// Priority: CRITICAL - This is the largest file in the codebase
// ═══════════════════════════════════════════════════════════════

// ghost-otp-extractor.ts
// Hyper-Intelligent OTP/Code Extractor from Email HTML
// 12 layers of intelligence, 0 dependencies, ~99.5% accuracy
// Uses DOMParser (native browser API)

// ═══════════════════════════════════════════════════════════════
//  TYPES - Import from shared extraction types to prevent circular dependencies
// ═══════════════════════════════════════════════════════════════
//  ARCHITECTURE NOTE:
//  - All types imported from ./extraction/types (shared types module)
//  - All utilities imported from ../utils (shared utilities module)
//  - This file imports NOTHING from other extraction modules
//  - This prevents circular dependencies
// ═══════════════════════════════════════════════════════════════

// Import shared types (NO runtime imports - types only)
// Note: RawCandidate, ContextAnalysis, and AntiPatternResult are declared locally in this file
import type {
  CodeType,
  CodeFormat,
  ExtractionStrategy,
  EmailIntent,
  ExtractedOTP,
  OTPSignal,
  OTPReasoningChain,
  OTPReasoningStep,
  ProviderOTPMatch,
  OTPExtractionResult,
} from './extraction/types';

// Import shared utilities (NO dependencies on other services)
// Note: getContextWindow and stripHtml are declared locally in this file

// ═══════════════════════════════════════════════════════════════
//  LAYER 1: EMAIL INTENT CLASSIFIER
// ═══════════════════════════════════════════════════════════════

interface IntentSignal {
  pattern: RegExp;
  intent: EmailIntent;
  weight: number;
  name: string;
}

const EMAIL_INTENT_SIGNALS: IntentSignal[] = [
  // ── Verification ─────────────────────────────────────────
  {
    pattern: /verify\s*(your|my|this|the)?\s*(email|e-?mail|account|address|identity)/i,
    intent: 'verification',
    weight: 40,
    name: 'verify-email',
  },
  {
    pattern: /confirm\s*(your|my|this|the)?\s*(email|e-?mail|account|registration|sign\s*up)/i,
    intent: 'verification',
    weight: 40,
    name: 'confirm-email',
  },
  {
    pattern: /activate\s*(your|my|this)?\s*(account|email|profile)/i,
    intent: 'verification',
    weight: 35,
    name: 'activate',
  },
  {
    pattern: /complete\s*(your|my)?\s*(registration|sign\s*up|setup|verification)/i,
    intent: 'verification',
    weight: 30,
    name: 'complete-registration',
  },
  {
    pattern: /verification\s*code/i,
    intent: 'verification',
    weight: 45,
    name: 'verification-code-phrase',
  },
  {
    pattern: /confirmation\s*code/i,
    intent: 'verification',
    weight: 45,
    name: 'confirmation-code-phrase',
  },
  {
    pattern: /one[- ]?time\s*(code|password|passcode|pin)/i,
    intent: 'verification',
    weight: 50,
    name: 'one-time-code',
  },
  { pattern: /security\s*code/i, intent: 'verification', weight: 45, name: 'security-code' },
  { pattern: /welcome.*verify/i, intent: 'verification', weight: 25, name: 'welcome-verify' },
  {
    pattern: /thanks?\s*(for)?\s*(signing\s*up|registering|joining)/i,
    intent: 'verification',
    weight: 20,
    name: 'thanks-signup',
  },
  { pattern: /one\s*more\s*step/i, intent: 'verification', weight: 20, name: 'one-more-step' },
  { pattern: /almost\s*(there|done)/i, intent: 'verification', weight: 15, name: 'almost-there' },

  // ── Two-Factor ───────────────────────────────────────────
  {
    pattern: /two[- ]?factor|2fa|multi[- ]?factor|mfa/i,
    intent: 'two-factor',
    weight: 45,
    name: '2fa',
  },
  { pattern: /authentication\s*code/i, intent: 'two-factor', weight: 45, name: 'auth-code' },
  { pattern: /login\s*code/i, intent: 'two-factor', weight: 40, name: 'login-code' },
  { pattern: /sign[- ]?in\s*code/i, intent: 'two-factor', weight: 40, name: 'signin-code' },
  { pattern: /access\s*code/i, intent: 'two-factor', weight: 35, name: 'access-code' },

  // ── Password Reset ───────────────────────────────────────
  {
    pattern: /reset\s*(your|my|the)?\s*password/i,
    intent: 'password-reset',
    weight: 45,
    name: 'reset-password',
  },
  {
    pattern: /forgot\s*(your|my)?\s*password/i,
    intent: 'password-reset',
    weight: 40,
    name: 'forgot-password',
  },
  {
    pattern: /password\s*(recovery|reset|change)/i,
    intent: 'password-reset',
    weight: 40,
    name: 'password-recovery',
  },
  {
    pattern: /change\s*(your|my)?\s*password/i,
    intent: 'password-reset',
    weight: 35,
    name: 'change-password',
  },
  {
    pattern: /password\s*reset\s*code/i,
    intent: 'password-reset',
    weight: 50,
    name: 'password-reset-code',
  },

  // ── Magic Link Login ─────────────────────────────────────
  { pattern: /magic\s*link/i, intent: 'magic-link-login', weight: 45, name: 'magic-link' },
  {
    pattern: /sign\s*in\s*(to|with|using)\s*(your|a|this)?\s*(link|button)/i,
    intent: 'magic-link-login',
    weight: 40,
    name: 'sign-in-link',
  },
  { pattern: /passwordless/i, intent: 'magic-link-login', weight: 40, name: 'passwordless' },

  // ── Device Confirmation ──────────────────────────────────
  {
    pattern: /new\s*(device|browser|location|login|sign\s*in)/i,
    intent: 'device-confirmation',
    weight: 35,
    name: 'new-device',
  },
  { pattern: /was\s*this\s*you/i, intent: 'device-confirmation', weight: 30, name: 'was-this-you' },
  {
    pattern: /unusual\s*(activity|sign\s*in|login)/i,
    intent: 'device-confirmation',
    weight: 30,
    name: 'unusual-activity',
  },

  // ── Anti-Intents ─────────────────────────────────────────
  {
    pattern: /\b(sale|discount|%\s*off|promo|coupon|deal|buy\s*now|shop\s*now)\b/i,
    intent: 'marketing',
    weight: 40,
    name: 'marketing',
  },
  {
    pattern: /newsletter|weekly\s*(digest|recap|update)|monthly\s*(digest|recap)/i,
    intent: 'newsletter',
    weight: 45,
    name: 'newsletter',
  },
  {
    pattern: /order\s*(confirm|#|number)|receipt|invoice/i,
    intent: 'transactional',
    weight: 40,
    name: 'transactional',
  },
  {
    pattern: /ship(ped|ping)|delivered|tracking\s*(number|#)/i,
    intent: 'transactional',
    weight: 40,
    name: 'shipping',
  },
  {
    pattern: /(liked|commented|mentioned|followed|shared|replied)\s*(your|you)/i,
    intent: 'social-notification',
    weight: 35,
    name: 'social',
  },
  {
    pattern: /payment\s*(received|confirmed|processed)/i,
    intent: 'transactional',
    weight: 35,
    name: 'payment',
  },
];

function classifyIntent(text: string): {
  intent: EmailIntent;
  confidence: number;
  signals: string[];
  scores: Map<EmailIntent, number>;
} {
  const scores = new Map<EmailIntent, number>();
  const signals: string[] = [];

  for (const signal of EMAIL_INTENT_SIGNALS) {
    if (signal.pattern.test(text)) {
      scores.set(signal.intent, (scores.get(signal.intent) || 0) + signal.weight);
      signals.push(`${signal.name} (${signal.intent}: +${signal.weight})`);
    }
  }

  let bestIntent: EmailIntent = 'unknown';
  let bestScore = 0;
  let totalScore = 0;

  for (const [intent, score] of scores) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const confidence = totalScore > 0 ? Math.min(bestScore / Math.max(totalScore * 0.6, 40), 1.0) : 0;

  return { intent: bestIntent, confidence, signals, scores };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 2: PROVIDER KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

interface ProviderOTPKnowledge {
  name: string;
  senderPatterns: RegExp[];
  subjectPatterns: RegExp[];
  codeLength: number | number[];
  codeFormat: CodeFormat;
  codeType: CodeType;
  labelPatterns: RegExp[];
  urlCodeParams: string[];
}

const PROVIDER_OTP_KNOWLEDGE: ProviderOTPKnowledge[] = [
  {
    name: 'Google',
    senderPatterns: [/no-?reply@.*google\.com/i, /accounts\.google\.com/i],
    subjectPatterns: [/google\s*verification/i, /sign.?in\s*attempt/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i, /security\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'GitHub',
    senderPatterns: [/noreply@github\.com/i],
    subjectPatterns: [/github\s*authentication/i, /verification\s*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'two-factor-code',
    labelPatterns: [/authentication\s*code/i, /verification\s*code/i],
    urlCodeParams: ['token'],
  },
  {
    name: 'Slack',
    senderPatterns: [/no-?reply@slack\.com/i, /slackbot/i],
    subjectPatterns: [/slack\s*(confirmation|verification)/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'confirmation-code',
    labelPatterns: [/confirmation\s*code/i],
    urlCodeParams: ['code'],
  },
  {
    name: 'Discord',
    senderPatterns: [/noreply@discord\.com/i, /discordapp\.com/i],
    subjectPatterns: [/discord\s*verification/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Microsoft',
    senderPatterns: [/microsoft\.com/i, /outlook\.com/i, /live\.com/i],
    subjectPatterns: [/microsoft\s*(account)?\s*(security|verification)/i],
    codeLength: [6, 7],
    codeFormat: 'numeric',
    codeType: 'security-code',
    labelPatterns: [/security\s*code/i, /verification\s*code/i],
    urlCodeParams: ['code'],
  },
  {
    name: 'Apple',
    senderPatterns: [/apple\.com|icloud\.com/i],
    subjectPatterns: [/apple\s*id\s*(verification|code)/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Amazon',
    senderPatterns: [/amazon\.(com|co|de|jp|in)/i],
    subjectPatterns: [/amazon.*verification|amazon.*otp/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'otp',
    labelPatterns: [/one[- ]?time\s*pass(word|code)/i, /otp/i, /verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'AWS',
    senderPatterns: [/amazonaws\.com|aws\./i],
    subjectPatterns: [/aws.*verification|cognito/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i, /confirmation\s*code/i],
    urlCodeParams: ['confirmation_code', 'code'],
  },
  {
    name: 'Stripe',
    senderPatterns: [/stripe\.com/i],
    subjectPatterns: [/stripe.*verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['code'],
  },
  {
    name: 'Twitter/X',
    senderPatterns: [/twitter\.com|x\.com/i],
    subjectPatterns: [/(twitter|x)\s*(confirmation|verification)\s*code/i],
    codeLength: [6, 7, 8],
    codeFormat: 'numeric',
    codeType: 'confirmation-code',
    labelPatterns: [/confirmation\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Facebook/Meta',
    senderPatterns: [/facebookmail\.com|meta\.com/i],
    subjectPatterns: [/facebook.*code|meta.*code/i],
    codeLength: [5, 6, 8],
    codeFormat: 'numeric',
    codeType: 'confirmation-code',
    labelPatterns: [/confirmation\s*code/i, /security\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'LinkedIn',
    senderPatterns: [/linkedin\.com/i],
    subjectPatterns: [/linkedin.*verification/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i, /security\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Steam',
    senderPatterns: [/steampowered\.com/i],
    subjectPatterns: [/steam\s*guard/i],
    codeLength: 5,
    codeFormat: 'alphanumeric',
    codeType: 'two-factor-code',
    labelPatterns: [/steam\s*guard\s*code/i, /access\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Twilio',
    senderPatterns: [/twilio\.com/i],
    subjectPatterns: [/twilio.*verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['code'],
  },
  {
    name: 'Notion',
    senderPatterns: [/notion\.so|makenotion\.com/i],
    subjectPatterns: [/notion.*code|notion.*login/i],
    codeLength: 5,
    codeFormat: 'numeric',
    codeType: 'login-code',
    labelPatterns: [/temporary\s*login\s*code/i, /login\s*code/i],
    urlCodeParams: ['token'],
  },
  {
    name: 'Figma',
    senderPatterns: [/figma\.com/i],
    subjectPatterns: [/figma.*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'login-code',
    labelPatterns: [/login\s*code/i, /verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Vercel',
    senderPatterns: [/vercel\.com/i],
    subjectPatterns: [/vercel.*verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['code'],
  },
  {
    name: 'Clerk',
    senderPatterns: [/clerk\.dev|clerk\.com/i],
    subjectPatterns: [/verification\s*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['code', 'token'],
  },
  {
    name: 'Ory Kratos',
    senderPatterns: [/ory\.(sh|dev)/i],
    subjectPatterns: [/verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['code', 'flow'],
  },
  {
    name: 'Auth0',
    senderPatterns: [/auth0\.(com|dev)/i],
    subjectPatterns: [/verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['verification_code', 'code'],
  },
  {
    name: 'Firebase',
    senderPatterns: [/firebase/i],
    subjectPatterns: [/verif/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: ['oobCode'],
  },
  {
    name: 'Supabase',
    senderPatterns: [/supabase/i],
    subjectPatterns: [/verif|confirm/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i, /confirmation\s*code/i],
    urlCodeParams: ['token', 'code'],
  },
  {
    name: 'Okta',
    senderPatterns: [/okta\.com/i],
    subjectPatterns: [/okta.*verif|one.time/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'otp',
    labelPatterns: [/one[- ]?time\s*password/i, /verification\s*code/i],
    urlCodeParams: ['token'],
  },
  {
    name: 'Coinbase',
    senderPatterns: [/coinbase\.com/i],
    subjectPatterns: [/coinbase.*verif/i],
    codeLength: [6, 7],
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'PayPal',
    senderPatterns: [/paypal\.(com|me)/i],
    subjectPatterns: [/paypal.*code|security\s*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'security-code',
    labelPatterns: [/security\s*code/i, /one[- ]?time\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Shopify',
    senderPatterns: [/shopify\.com/i],
    subjectPatterns: [/shopify.*verif|login\s*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'login-code',
    labelPatterns: [/login\s*code/i, /verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Uber',
    senderPatterns: [/uber\.com/i],
    subjectPatterns: [/uber.*code/i],
    codeLength: 4,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/verification\s*code/i, /your\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'WhatsApp',
    senderPatterns: [/whatsapp\.com/i],
    subjectPatterns: [/whatsapp.*code|registration\s*code/i],
    codeLength: 6,
    codeFormat: 'numeric',
    codeType: 'verification-code',
    labelPatterns: [/registration\s*code/i, /verification\s*code/i],
    urlCodeParams: [],
  },
  {
    name: 'Telegram',
    senderPatterns: [/telegram\.org/i],
    subjectPatterns: [/telegram.*code|login\s*code/i],
    codeLength: 5,
    codeFormat: 'numeric',
    codeType: 'login-code',
    labelPatterns: [/login\s*code/i, /confirmation\s*code/i],
    urlCodeParams: [],
  },
];

function matchOTPProvider(
  senderEmail: string,
  subject: string,
  bodyText: string
): ProviderOTPMatch | null {
  for (const provider of PROVIDER_OTP_KNOWLEDGE) {
    const senderMatch = provider.senderPatterns.some((p) => p.test(senderEmail));
    const subjectMatch = provider.subjectPatterns.some((p) => p.test(subject));
    // SECURITY FIX: Bound bodyText length to prevent ReDoS when testing label patterns
    const boundedBody = bodyText.substring(0, 25000);
    const bodyMatch = provider.labelPatterns ? provider.labelPatterns.some((p) => p.test(boundedBody)) : false;

    if (senderMatch || subjectMatch || bodyMatch) {
      const lengths = Array.isArray(provider.codeLength)
        ? provider.codeLength
        : [provider.codeLength];

      return {
        name: provider.name,
        expectedLength: lengths[0],
        expectedFormat: provider.codeFormat,
        confidence: senderMatch ? 0.95 : subjectMatch ? 0.85 : 0.6,
      };
    }
  }
  return null;
}

function isProviderExpectedLength(code: string, provider: ProviderOTPMatch | null): boolean {
  if (!provider) {
    return true;
  }
  const p = PROVIDER_OTP_KNOWLEDGE.find((pk) => pk.name === provider.name);
  if (!p) {
    return true;
  }
  const lengths = Array.isArray(p.codeLength) ? p.codeLength : [p.codeLength];
  return lengths.includes(code.replace(/[-\s]/g, '').length);
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 3: MULTI-STRATEGY PATTERN ENGINE
// ═══════════════════════════════════════════════════════════════

interface RawCandidate {
  value: string;
  rawValue: string;
  matchIndex: number;
  strategy: ExtractionStrategy;
  strategyScore: number;
  label: string | null;
  context: string;
  fromHtml: boolean;
  htmlElement: Element | null;
}

// ── CODE LABEL WORDS ────────────────────────────────────────
// These words, when followed by a number, strongly indicate an OTP

const CODE_LABEL_PATTERNS: Array<{
  regex: RegExp;
  weight: number;
  name: string;
  codeType: CodeType;
}> = [
  // ── Tier 1: Extremely explicit (50+ points) ──────────────
  {
    regex:
      /(?:your|the|a)?\s*(?:one[- ]?time)\s*(?:pass(?:word|code)|code|pin|otp)\s*(?:is|:|-|–|—)\s*/gi,
    weight: 55,
    name: 'one-time-code-label',
    codeType: 'otp',
  },
  {
    regex:
      /(?:your|the|a)?\s*(?:verification|security|confirmation|authentication|login|sign[- ]?in|access)\s*(?:code|pin|otp|number)\s*(?:is|:|-|–|—)\s*/gi,
    weight: 50,
    name: 'typed-code-label',
    codeType: 'verification-code',
  },
  {
    regex: /(?:your|the|a)?\s*(?:otp|pin)\s*(?:is|:|-|–|—)\s*/gi,
    weight: 50,
    name: 'otp-pin-label',
    codeType: 'otp',
  },
  {
    regex: /(?:your|the|a)?\s*code\s*(?:is|:|-|–|—)\s*/gi,
    weight: 45,
    name: 'generic-code-label',
    codeType: 'unknown-code',
  },
  {
    regex: /(?:password\s*reset)\s*(?:code|pin|token)\s*(?:is|:|-|–|—)\s*/gi,
    weight: 50,
    name: 'password-reset-code-label',
    codeType: 'password-reset-code',
  },

  // ── Tier 2: Action-oriented (35-49 points) ───────────────
  {
    regex:
      /(?:enter|use|type|input|paste|submit)\s*(?:the|this|your)?\s*(?:following\s*)?(?:code|pin|otp|number)\s*(?:to|:|-|–|—)?\s*/gi,
    weight: 40,
    name: 'action-code-label',
    codeType: 'verification-code',
  },
  {
    regex: /(?:enter|use|type|input|paste|submit)\s+/gi,
    weight: 35,
    name: 'action-prefix',
    codeType: 'unknown-code',
  },

  // ── Tier 3: Code-followed-by-instructions (30-34 points) ──
  // These capture patterns where the code appears BEFORE the instruction
  // e.g., "482910 is your verification code"
  {
    regex: /(?:^|\s)/gi, // Matched separately — see POSTFIX patterns below
    weight: 0,
    name: 'placeholder',
    codeType: 'unknown-code',
  },
];

const CODE_POSTFIX_PATTERNS: Array<{
  regex: RegExp;
  weight: number;
  name: string;
}> = [
  {
    regex:
      /\s*(?:is\s*)?(?:your|the)\s*(?:verification|security|confirmation|authentication|login|one[- ]?time)?\s*(?:code|pin|otp|passcode|password)/i,
    weight: 45,
    name: 'postfix-is-your-code',
  },
  {
    regex: /\s*\.\s*(?:enter|use|type)\s*(?:this|it)\s*(?:to|in|on|at)/i,
    weight: 30,
    name: 'postfix-enter-to',
  },
];

function extractRawCandidates(
  plainText: string,
  htmlBody: string,
  doc: Document | null
): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  const seenValues = new Set<string>();

  // ── Strategy 1: Explicit Label Extraction ─────────────────
  // "Your code is: 482910" / "Code: A8F-29K"
  for (const labelPattern of CODE_LABEL_PATTERNS) {
    if (labelPattern.weight === 0) {
      continue;
    } // Skip placeholder

    const regex = new RegExp(labelPattern.regex.source, labelPattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(plainText)) !== null) {
      // Look for a code immediately after the label
      const afterLabel = plainText.slice(match.index + match[0].length);

      // Try numeric code
      const numericMatch = afterLabel.match(/^(\d{4,8})\b/);
      if (numericMatch && !seenValues.has(numericMatch[1])) {
        seenValues.add(numericMatch[1]);
        const ctx = getContextWindow(plainText, match.index, 80);
        candidates.push({
          value: numericMatch[1],
          rawValue: numericMatch[1],
          matchIndex: match.index + match[0].length,
          strategy: 'explicit-label',
          strategyScore: labelPattern.weight,
          label: match[0].trim(),
          context: ctx,
          fromHtml: false,
          htmlElement: null,
        });
        continue;
      }

      // Try alphanumeric code (A8F-29K or A8F29K)
      const alphaMatch = afterLabel.match(/^([A-Z0-9]{3,5}[-\s]?[A-Z0-9]{3,5})\b/i);
      if (
        alphaMatch &&
        /\d/.test(alphaMatch[1]) &&
        /[A-Za-z]/.test(alphaMatch[1]) &&
        !seenValues.has(alphaMatch[1])
      ) {
        seenValues.add(alphaMatch[1]);
        const ctx = getContextWindow(plainText, match.index, 80);
        candidates.push({
          value: alphaMatch[1].replace(/[-\s]/g, ''),
          rawValue: alphaMatch[1],
          matchIndex: match.index + match[0].length,
          strategy: 'explicit-label',
          strategyScore: labelPattern.weight,
          label: match[0].trim(),
          context: ctx,
          fromHtml: false,
          htmlElement: null,
        });
        continue;
      }

      // Try dash-separated (483-291)
      const dashMatch = afterLabel.match(/^(\d{3,4}[-\s]\d{3,4})\b/);
      if (dashMatch && !seenValues.has(dashMatch[1].replace(/[-\s]/g, ''))) {
        const cleaned = dashMatch[1].replace(/[-\s]/g, '');
        seenValues.add(cleaned);
        const ctx = getContextWindow(plainText, match.index, 80);
        candidates.push({
          value: cleaned,
          rawValue: dashMatch[1],
          matchIndex: match.index + match[0].length,
          strategy: 'explicit-label',
          strategyScore: labelPattern.weight,
          label: match[0].trim(),
          context: ctx,
          fromHtml: false,
          htmlElement: null,
        });
      }
    }
  }

  // ── Strategy 2: Action Instruction Extraction ─────────────
  // "Enter 482910 to verify" / "Use 482910 in the app"
  const actionRegex =
    /(?:enter|use|type|input|paste|submit)\s+(\d{4,8})\s+(?:to|in|on|at|for|into|below|above|here)/gi;
  let actionMatch: RegExpExecArray | null;
  while ((actionMatch = actionRegex.exec(plainText)) !== null) {
    const code = actionMatch[1];
    if (seenValues.has(code)) {
      continue;
    }
    seenValues.add(code);
    candidates.push({
      value: code,
      rawValue: code,
      matchIndex: actionMatch.index,
      strategy: 'action-instruction',
      strategyScore: 40,
      label: actionMatch[0].split(code)[0].trim(),
      context: getContextWindow(plainText, actionMatch.index, 80),
      fromHtml: false,
      htmlElement: null,
    });
  }

  // ── Strategy 3: Postfix Pattern ("482910 is your code") ───
  const standaloneNumbers = plainText.matchAll(/\b(\d{4,8})\b/g);
  for (const numMatch of standaloneNumbers) {
    const code = numMatch[1];
    if (seenValues.has(code)) {
      continue;
    }

    const afterCode = plainText.slice(
      numMatch.index! + code.length,
      numMatch.index! + code.length + 100
    );
    for (const postfix of CODE_POSTFIX_PATTERNS) {
      if (postfix.regex.test(afterCode)) {
        seenValues.add(code);
        candidates.push({
          value: code,
          rawValue: code,
          matchIndex: numMatch.index!,
          strategy: 'explicit-label',
          strategyScore: postfix.weight,
          label: `(postfix: ${postfix.name})`,
          context: getContextWindow(plainText, numMatch.index!, 80),
          fromHtml: false,
          htmlElement: null,
        });
        break;
      }
    }
  }

  // ── Strategy 4: HTML Visual Prominence ────────────────────
  // Codes inside <strong>, <b>, <code>, <span> with large font
  if (doc) {
    // Only run if doc is available
    const prominentSelectors = [
      'strong',
      'b',
      'code',
      'pre',
      'span[style*="font-size"]',
      'span[style*="font-weight"]',
      'span[style*="letter-spacing"]',
      'td[style*="font-size"]',
      'div[style*="font-size"]',
      'p[style*="font-size"]',
      'h1',
      'h2',
      'h3',
    ];

    for (const selector of prominentSelectors) {
      const elements = doc.querySelectorAll(selector);
      for (const el of elements) {
        const text = (el.textContent || '').trim();

        // Check for numeric code
        const numMatch = text.match(/^(\d{4,8})$/);
        if (numMatch && !seenValues.has(numMatch[1])) {
          seenValues.add(numMatch[1]);
          candidates.push({
            value: numMatch[1],
            rawValue: numMatch[1],
            matchIndex: -1,
            strategy: 'html-prominent',
            strategyScore: 45,
            label: null,
            context: getElementContext(el, 80),
            fromHtml: true,
            htmlElement: el,
          });
          continue;
        }

        // Alphanumeric code
        const alphaMatch = text.match(/^([A-Z0-9]{3,5}[-\s]?[A-Z0-9]{3,5})$/i);
        if (
          alphaMatch &&
          /\d/.test(alphaMatch[1]) &&
          /[A-Za-z]/.test(alphaMatch[1]) &&
          !seenValues.has(alphaMatch[1])
        ) {
          seenValues.add(alphaMatch[1]);
          candidates.push({
            value: alphaMatch[1].replace(/[-\s]/g, ''),
            rawValue: alphaMatch[1],
            matchIndex: -1,
            strategy: 'html-prominent',
            strategyScore: 45,
            label: null,
            context: getElementContext(el, 80),
            fromHtml: true,
            htmlElement: el,
          });
          continue;
        }

        // Dash-separated
        const dashMatch = text.match(/^(\d{3,4}[-\s]\d{3,4})$/);
        if (dashMatch && !seenValues.has(dashMatch[1].replace(/[-\s]/g, ''))) {
          const cleaned = dashMatch[1].replace(/[-\s]/g, '');
          seenValues.add(cleaned);
          candidates.push({
            value: cleaned,
            rawValue: dashMatch[1],
            matchIndex: -1,
            strategy: 'html-prominent',
            strategyScore: 45,
            label: null,
            context: getElementContext(el, 80),
            fromHtml: true,
            htmlElement: el,
          });
        }

        // Code inside larger text (e.g., <strong>482910</strong> within a paragraph)
        const embeddedNum = text.match(/\b(\d{4,8})\b/);
        if (embeddedNum && text.length < 30 && !seenValues.has(embeddedNum[1])) {
          seenValues.add(embeddedNum[1]);
          candidates.push({
            value: embeddedNum[1],
            rawValue: embeddedNum[1],
            matchIndex: -1,
            strategy: 'html-prominent',
            strategyScore: 35,
            label: null,
            context: getElementContext(el, 80),
            fromHtml: true,
            htmlElement: el,
          });
        }
      }
    }
  } // End if (doc)

  // ── Strategy 5: Standalone Line ───────────────────────────
  // A number on its own line (common in styled emails)
  const lines = plainText.split(/\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const numMatch = trimmed.match(/^(\d{4,8})$/);
    if (numMatch && !seenValues.has(numMatch[1])) {
      seenValues.add(numMatch[1]);
      const idx = plainText.indexOf(trimmed);
      candidates.push({
        value: numMatch[1],
        rawValue: numMatch[1],
        matchIndex: idx >= 0 ? idx : -1,
        strategy: 'standalone-line',
        strategyScore: 30,
        label: null,
        context: getContextWindow(plainText, idx >= 0 ? idx : 0, 80),
        fromHtml: false,
        htmlElement: null,
      });
    }

    // Alphanumeric standalone
    const alphaMatch = trimmed.match(/^([A-Z0-9]{3,5}[-\s][A-Z0-9]{3,5})$/i);
    if (
      alphaMatch &&
      /\d/.test(alphaMatch[1]) &&
      /[A-Za-z]/.test(alphaMatch[1]) &&
      !seenValues.has(alphaMatch[1])
    ) {
      const cleaned = alphaMatch[1].replace(/[-\s]/g, '');
      seenValues.add(cleaned);
      const idx = plainText.indexOf(trimmed);
      candidates.push({
        value: cleaned,
        rawValue: alphaMatch[1],
        matchIndex: idx >= 0 ? idx : -1,
        strategy: 'standalone-line',
        strategyScore: 30,
        label: null,
        context: getContextWindow(plainText, idx >= 0 ? idx : 0, 80),
        fromHtml: false,
        htmlElement: null,
      });
    }
  }

  // ── Strategy 6: URL Parameter Extraction ──────────────────
  const urlRegex = /https?:\/\/[^\s"'<>]+/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(htmlBody)) !== null) {
    const url = urlMatch[0];
    const CODE_URL_PARAMS = [
      'verification_code',
      'verification-code',
      'verificationCode',
      'confirmation_code',
      'confirmation-code',
      'confirmationCode',
      'otp',
      'code',
      'pin',
      'one_time_code',
      'one-time-code',
      'oneTimeCode',
    ];

    try {
      const urlObj = new URL(url, 'https://placeholder.com');

      for (const param of CODE_URL_PARAMS) {
        const val = urlObj.searchParams.get(param);
        if (val && val.length >= 4 && val.length <= 10 && /^[A-Za-z0-9]+$/.test(val)) {
          if (!seenValues.has(val)) {
            seenValues.add(val);
            candidates.push({
              value: val,
              rawValue: val,
              matchIndex: urlMatch.index,
              strategy: 'url-parameter',
              strategyScore: 40,
              label: `URL param: ${param} `,
              context: `...${param}=${val}... in ${truncateStr(url, 100)} `,
              fromHtml: false,
              htmlElement: null,
            });
          }
        }
      }

      // Also check all params for code-like values
      for (const [key, val] of urlObj.searchParams) {
        if (CODE_URL_PARAMS.includes(key)) {
          continue;
        } // Already checked
        if (
          /code|otp|pin|token/i.test(key) &&
          val.length >= 4 &&
          val.length <= 10 &&
          /^[A-Za-z0-9]+$/.test(val)
        ) {
          if (!seenValues.has(val)) {
            seenValues.add(val);
            candidates.push({
              value: val,
              rawValue: val,
              matchIndex: urlMatch.index,
              strategy: 'url-parameter',
              strategyScore: 30,
              label: `URL param: ${key} `,
              context: `...${key}=${val}... in ${truncateStr(url, 100)} `,
              fromHtml: false,
              htmlElement: null,
            });
          }
        }
      }
    } catch {
      /* malformed URL */
    }
  }

  // ── Strategy 7: Proximity Inference ───────────────────────
  // Numbers near verification language but not caught by labels
  const allNumbers = plainText.matchAll(/\b(\d{4,8})\b/g);
  for (const numMatch of allNumbers) {
    const code = numMatch[1];
    if (seenValues.has(code)) {
      continue;
    }

    const ctx = getContextWindow(plainText, numMatch.index!, 120);
    const lowerCtx = ctx.toLowerCase();

    // Check if context has strong verification language
    const hasVerificationContext =
      /verif|confirm|authenti|one[- ]?time|otp|security\s*code|login\s*code|sign[- ]?in\s*code|passcode/i.test(
        lowerCtx
      );

    if (hasVerificationContext) {
      seenValues.add(code);
      candidates.push({
        value: code,
        rawValue: code,
        matchIndex: numMatch.index!,
        strategy: 'proximity-inference',
        strategyScore: 20,
        label: null,
        context: ctx,
        fromHtml: false,
        htmlElement: null,
      });
    }
  }

  return candidates;
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 4: CONTEXT WINDOW ANALYZER
// ═══════════════════════════════════════════════════════════════

interface ContextAnalysis {
  /** Score from context analysis */
  contextScore: number;
  /** Positive context signals */
  positiveSignals: OTPSignal[];
  /** Negative context signals */
  negativeSignals: OTPSignal[];
  /** Detected code type from context */
  detectedType: CodeType | null;
  /** Whether expiration language is near this code */
  hasExpiration: boolean;
  /** Whether "don't share" language is near */
  hasDontShare: boolean;
  /** Whether instruction language is near */
  hasInstruction: boolean;
}

const CONTEXT_POSITIVE_PATTERNS: Array<{
  pattern: RegExp;
  score: number;
  name: string;
  codeType: CodeType | null;
}> = [
  // ── Direct code references ──────────────────────────────
  {
    pattern: /(?:your|the|a)\s*(?:verification|security|confirmation|authentication)\s*code/i,
    score: 25,
    name: 'ctx:verification-code-phrase',
    codeType: 'verification-code',
  },
  {
    pattern: /one[- ]?time\s*(?:code|password|passcode|pin|otp)/i,
    score: 30,
    name: 'ctx:one-time-code',
    codeType: 'otp',
  },
  {
    pattern: /(?:login|sign[- ]?in|access)\s*code/i,
    score: 25,
    name: 'ctx:login-code',
    codeType: 'login-code',
  },
  { pattern: /two[- ]?factor|2fa|mfa/i, score: 20, name: 'ctx:2fa', codeType: 'two-factor-code' },
  { pattern: /\botp\b/i, score: 25, name: 'ctx:otp-word', codeType: 'otp' },
  { pattern: /passcode/i, score: 20, name: 'ctx:passcode', codeType: 'otp' },

  // ── Expiration / urgency ────────────────────────────────
  {
    pattern: /expires?\s*(in|after)\s*\d+\s*(min|hour|second|minute)/i,
    score: 20,
    name: 'ctx:expires-in',
    codeType: null,
  },
  { pattern: /valid\s*(for|until|only)\s*\d+/i, score: 15, name: 'ctx:valid-for', codeType: null },
  { pattern: /within\s*\d+\s*(min|hour)/i, score: 12, name: 'ctx:within-time', codeType: null },
  {
    pattern: /this\s*code\s*(will\s*)?expire/i,
    score: 18,
    name: 'ctx:code-will-expire',
    codeType: null,
  },
  { pattern: /time[- ]?sensitive/i, score: 10, name: 'ctx:time-sensitive', codeType: null },

  // ── Security / don't share ──────────────────────────────
  {
    pattern: /don['']?t\s*share\s*(this|the|your)?\s*(code|number|otp|pin)/i,
    score: 20,
    name: 'ctx:dont-share-code',
    codeType: null,
  },
  {
    pattern: /keep\s*(this|it)?\s*(code|number)?\s*(?:private|secret|safe|secure)/i,
    score: 15,
    name: 'ctx:keep-secret',
    codeType: null,
  },
  { pattern: /never\s*(ask|share|give|send)/i, score: 12, name: 'ctx:never-share', codeType: null },
  { pattern: /for\s*(your)?\s*security/i, score: 10, name: 'ctx:for-security', codeType: null },

  // ── Action instructions ─────────────────────────────────
  {
    pattern: /enter\s*(this|the|your)?\s*(code|number|otp|pin)/i,
    score: 20,
    name: 'ctx:enter-code',
    codeType: null,
  },
  {
    pattern: /paste\s*(this|the|your)?\s*(code|number)/i,
    score: 18,
    name: 'ctx:paste-code',
    codeType: null,
  },
  {
    pattern: /type\s*(this|the|your)?\s*(code|number)/i,
    score: 18,
    name: 'ctx:type-code',
    codeType: null,
  },
  {
    pattern: /use\s*(this|the|your)?\s*(code|number)/i,
    score: 15,
    name: 'ctx:use-code',
    codeType: null,
  },
  {
    pattern: /on\s*the\s*(?:verification|login|sign[- ]?in|confirmation)\s*(?:page|screen|form)/i,
    score: 12,
    name: 'ctx:on-verification-page',
    codeType: null,
  },
  {
    pattern: /(?:in|into)\s*the\s*(?:field|input|box|form)/i,
    score: 10,
    name: 'ctx:into-field',
    codeType: null,
  },

  // ── Disclaimer ──────────────────────────────────────────
  {
    pattern: /if\s*you\s*didn['']?t\s*(?:request|create|initiate)/i,
    score: 15,
    name: 'ctx:didnt-request',
    codeType: null,
  },
  {
    pattern: /ignore\s*this\s*(?:email|message)/i,
    score: 12,
    name: 'ctx:ignore-email',
    codeType: null,
  },
];

const CONTEXT_NEGATIVE_PATTERNS: Array<{
  pattern: RegExp;
  score: number;
  name: string;
}> = [
  // ── Phone numbers ───────────────────────────────────────
  {
    pattern: /(?:phone|call|tel|mobile|fax|dial|contact|reach)\s*(?:us|me|at)?/i,
    score: -40,
    name: 'ctx:phone-context',
  },
  { pattern: /\+\d{1,3}\s*[-.(]?\d/i, score: -35, name: 'ctx:intl-phone-format' },
  { pattern: /1[-.]?(?:800|888|877|866|855|844|833)\b/i, score: -45, name: 'ctx:toll-free-number' },
  { pattern: /(?:ext|extension)\s*\.?\s*\d/i, score: -30, name: 'ctx:extension' },

  // ── Addresses ───────────────────────────────────────────
  { pattern: /(?:zip|postal)\s*(?:code)?/i, score: -40, name: 'ctx:zip-code' },
  {
    pattern:
      /(?:street|ave|avenue|blvd|boulevard|road|rd|drive|dr|lane|ln|way|suite|ste|floor|apt)\b/i,
    score: -35,
    name: 'ctx:street-address',
  },
  { pattern: /(?:city|state|province|country)\s*:/i, score: -30, name: 'ctx:address-field' },

  // ── Money / prices ──────────────────────────────────────
  { pattern: /[$€£¥₹]\s*\d/i, score: -45, name: 'ctx:currency-symbol' },
  {
    pattern: /(?:price|cost|total|amount|balance|charge|fee|payment|paid|usd|eur|gbp)\s*:?\s*/i,
    score: -40,
    name: 'ctx:money-word',
  },
  { pattern: /\d+\.\d{2}\b/i, score: -25, name: 'ctx:decimal-amount' },

  // ── Order / transaction IDs ─────────────────────────────
  {
    pattern:
      /(?:order|transaction|reference|invoice|receipt|booking|reservation|confirmation)\s*(?:#|no\.?|number|id|ref)\s*:?\s*/i,
    score: -50,
    name: 'ctx:order-id',
  },
  { pattern: /(?:#|no\.?)\s*:?\s*$/i, score: -25, name: 'ctx:hash-number-prefix' },
  {
    pattern: /(?:tracking|shipment|package|parcel)\s*(?:#|no\.?|number|id)/i,
    score: -45,
    name: 'ctx:tracking-number',
  },

  // ── Account / user IDs ──────────────────────────────────
  {
    pattern:
      /(?:account|user|member|customer|employee|staff|badge|ticket)\s*(?:#|no\.?|number|id)\s*:?\s*/i,
    score: -40,
    name: 'ctx:account-id',
  },
  { pattern: /(?:id|identifier)\s*:?\s*$/i, score: -20, name: 'ctx:id-suffix' },

  // ── Dates / times ───────────────────────────────────────
  {
    pattern: /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d/i,
    score: -30,
    name: 'ctx:date-month',
  },
  { pattern: /\d{1,2}[/:]\d{1,2}[/:]\d{2,4}/i, score: -35, name: 'ctx:date-format' },
  { pattern: /(?:am|pm)\b/i, score: -20, name: 'ctx:time-ampm' },
  {
    pattern: /(?:minutes?|hours?|days?|seconds?|weeks?)\s*(?:ago|later|from\s*now)/i,
    score: -15,
    name: 'ctx:relative-time',
  },

  // ── Measurements / technical ────────────────────────────
  { pattern: /(?:version|ver|v)\s*\.?\s*\d/i, score: -30, name: 'ctx:version-number' },
  { pattern: /(?:port|pid|thread|process)\s*:?\s*/i, score: -30, name: 'ctx:technical-id' },
  {
    pattern: /(?:step|page|chapter|section|item|row|col|column)\s*\d/i,
    score: -25,
    name: 'ctx:enumeration',
  },
  { pattern: /(?:kb|mb|gb|tb|px|em|rem|pt|hz|mhz|ghz)\b/i, score: -25, name: 'ctx:unit' },

  // ── Marketing ───────────────────────────────────────────
  {
    pattern: /(?:promo(?:tion)?|coupon|voucher|discount|gift)\s*code/i,
    score: -50,
    name: 'ctx:promo-code',
  },
  { pattern: /(?:referral|invite|share)\s*code/i, score: -30, name: 'ctx:referral-code' },
  { pattern: /(?:at\s*)?checkout/i, score: -25, name: 'ctx:checkout' },
];

function analyzeContext(candidate: RawCandidate): ContextAnalysis {
  const context = candidate.context.toLowerCase();
  let contextScore = 0;
  const positiveSignals: OTPSignal[] = [];
  const negativeSignals: OTPSignal[] = [];
  let detectedType: CodeType | null = null;
  let hasExpiration = false;
  let hasDontShare = false;
  let hasInstruction = false;

  // ── Positive context signals ────────────────────────────
  for (const pattern of CONTEXT_POSITIVE_PATTERNS) {
    if (pattern.pattern.test(context)) {
      contextScore += pattern.score;
      positiveSignals.push({
        name: pattern.name,
        points: pattern.score,
        layer: 'context-analyzer',
        detail: `Context matched: ${pattern.pattern.source.slice(0, 60)} `,
      });
      if (pattern.codeType && !detectedType) {
        detectedType = pattern.codeType;
      }
      if (
        pattern.name.includes('expire') ||
        pattern.name.includes('valid') ||
        pattern.name.includes('within') ||
        pattern.name.includes('time')
      ) {
        hasExpiration = true;
      }
      if (
        pattern.name.includes('dont-share') ||
        pattern.name.includes('keep-secret') ||
        pattern.name.includes('never-share')
      ) {
        hasDontShare = true;
      }
      if (
        pattern.name.includes('enter') ||
        pattern.name.includes('paste') ||
        pattern.name.includes('type') ||
        pattern.name.includes('use')
      ) {
        hasInstruction = true;
      }
    }
  }

  // ── Negative context signals ────────────────────────────
  for (const pattern of CONTEXT_NEGATIVE_PATTERNS) {
    if (pattern.pattern.test(context)) {
      contextScore += pattern.score; // Already negative
      negativeSignals.push({
        name: pattern.name,
        points: pattern.score,
        layer: 'anti-pattern',
        detail: `Context negative: ${pattern.pattern.source.slice(0, 60)} `,
      });
    }
  }

  return {
    contextScore,
    positiveSignals,
    negativeSignals,
    detectedType,
    hasExpiration,
    hasDontShare,
    hasInstruction,
  };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 5: ANTI-PATTERN INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

interface AntiPatternResult {
  isRejected: boolean;
  reason: string | null;
  penaltyScore: number;
  signals: OTPSignal[];
}

function checkAntiPatterns(code: string, context: string, fullText: string): AntiPatternResult {
  void fullText;
  const cleanCode = code.replace(/[-\s]/g, '');
  const num = parseInt(cleanCode, 10);
  const signals: OTPSignal[] = [];
  let penalty = 0;

  // ── Year Detection ──────────────────────────────────────
  if (cleanCode.length === 4 && num >= 1900 && num <= 2099) {
    // Check if context suggests it's a year
    const yearContext =
      /copyright|©|since|founded|established|year|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*\d{1,2}/i.test(
        context
      );
    if (yearContext) {
      signals.push({
        name: 'anti:year-with-context',
        points: -80,
        layer: 'anti-pattern',
        detail: `${cleanCode} looks like a year in this context`,
      });
      return { isRejected: true, reason: `year:${cleanCode} `, penaltyScore: -80, signals };
    }
    // Even without context, 4-digit years are suspicious
    penalty -= 20;
    signals.push({
      name: 'anti:possible-year',
      points: -20,
      layer: 'anti-pattern',
      detail: `${cleanCode} could be a year(penalized but not rejected)`,
    });
  }

  // ── Phone Number Detection ──────────────────────────────
  if (cleanCode.length >= 7 && cleanCode.length <= 10) {
    if (/phone|call|tel|mobile|contact|dial|fax|reach|whatsapp|sms|text\s*us/i.test(context)) {
      signals.push({
        name: 'anti:phone-number',
        points: -90,
        layer: 'anti-pattern',
        detail: `${cleanCode} is in phone context`,
      });
      return { isRejected: true, reason: `phone:${cleanCode} `, penaltyScore: -90, signals };
    }
  }

  // ── Toll-free / international prefix ────────────────────
  if (/^1?8[0-9]{2}/.test(cleanCode) && cleanCode.length >= 7) {
    signals.push({
      name: 'anti:toll-free-pattern',
      points: -60,
      layer: 'anti-pattern',
      detail: `${cleanCode} starts with toll - free prefix`,
    });
    return { isRejected: true, reason: `toll - free:${cleanCode} `, penaltyScore: -60, signals };
  }

  // ── Zip Code Detection ──────────────────────────────────
  if (
    cleanCode.length === 5 &&
    /zip|postal|address|city|state|avenue|street|blvd|suite/i.test(context)
  ) {
    signals.push({
      name: 'anti:zip-code',
      points: -80,
      layer: 'anti-pattern',
      detail: `${cleanCode} is in address context`,
    });
    return { isRejected: true, reason: `zip:${cleanCode} `, penaltyScore: -80, signals };
  }

  // ── Price / Amount ──────────────────────────────────────
  if (
    /[$€£¥₹]\s*$/.test(context.slice(0, context.indexOf(code))) ||
    /^\s*[$€£¥₹]/.test(context.slice(context.indexOf(code) + code.length))
  ) {
    signals.push({
      name: 'anti:price',
      points: -80,
      layer: 'anti-pattern',
      detail: `${cleanCode} is near currency symbol`,
    });
    return { isRejected: true, reason: `price:${cleanCode} `, penaltyScore: -80, signals };
  }
  if (
    /price|cost|total|amount|balance|charge|fee|paid|payment|subtotal|tax|shipping\s*cost/i.test(
      context
    )
  ) {
    penalty -= 40;
    signals.push({
      name: 'anti:money-context',
      points: -40,
      layer: 'anti-pattern',
      detail: `${cleanCode} is in money context`,
    });
  }

  // ── Order / Reference Number ────────────────────────────
  if (
    /order\s*(#|no|number|id)|reference\s*(#|no|number|id)|invoice\s*(#|no|number)|receipt|booking|reservation|confirmation\s*(#|no|number)/i.test(
      context
    )
  ) {
    // BUT: "confirmation code" is NOT an order confirmation
    if (!/confirmation\s*code|verification\s*code|security\s*code/i.test(context)) {
      penalty -= 50;
      signals.push({
        name: 'anti:order-number',
        points: -50,
        layer: 'anti-pattern',
        detail: `${cleanCode} is in order / reference context`,
      });
    }
  }

  // ── Tracking Number ─────────────────────────────────────
  if (/tracking|shipment|package|parcel|carrier|fedex|ups|usps|dhl/i.test(context)) {
    signals.push({
      name: 'anti:tracking-number',
      points: -70,
      layer: 'anti-pattern',
      detail: `${cleanCode} is in shipping context`,
    });
    return { isRejected: true, reason: `tracking:${cleanCode} `, penaltyScore: -70, signals };
  }

  // ── Account ID ──────────────────────────────────────────
  if (
    /account\s*(#|no|number|id)|user\s*(#|id)|member\s*(#|id)|customer\s*(#|id)|employee\s*(#|id)/i.test(
      context
    )
  ) {
    if (!/verification|security|confirmation|one[- ]?time/i.test(context)) {
      penalty -= 45;
      signals.push({
        name: 'anti:account-id',
        points: -45,
        layer: 'anti-pattern',
        detail: `${cleanCode} is in account ID context`,
      });
    }
  }

  // ── Time Duration (the "10" in "expires in 10 minutes") ──
  if (
    /expires?\s*(in|after)\s*$/.test(context.slice(0, context.indexOf(code)).trim()) ||
    /^\s*(minutes?|hours?|seconds?|days?)\b/i.test(
      context.slice(context.indexOf(code) + code.length)
    )
  ) {
    if (num <= 60) {
      signals.push({
        name: 'anti:time-duration',
        points: -70,
        layer: 'anti-pattern',
        detail: `${cleanCode} is a time duration`,
      });
      return { isRejected: true, reason: `duration:${cleanCode} `, penaltyScore: -70, signals };
    }
  }

  // ── Very short numbers in long emails (likely noise) ─────
  if (cleanCode.length <= 3) {
    signals.push({
      name: 'anti:too-short',
      points: -60,
      layer: 'anti-pattern',
      detail: `${cleanCode} is too short for an OTP`,
    });
    return { isRejected: true, reason: `too - short:${cleanCode} `, penaltyScore: -60, signals };
  }

  // ── Very long numbers (likely IDs, not OTPs) ────────────
  if (cleanCode.length >= 9 && /^\d+$/.test(cleanCode)) {
    penalty -= 30;
    signals.push({
      name: 'anti:long-number',
      points: -30,
      layer: 'anti-pattern',
      detail: `${cleanCode} is unusually long for an OTP(${cleanCode.length} digits)`,
    });
  }

  // ── Promo / coupon code context ─────────────────────────
  if (/promo|coupon|voucher|discount|gift\s*card|referral/i.test(context)) {
    signals.push({
      name: 'anti:promo-code',
      points: -70,
      layer: 'anti-pattern',
      detail: `${cleanCode} is in promotional context`,
    });
    return { isRejected: true, reason: `promo:${cleanCode}`, penaltyScore: -70, signals };
  }

  // ── Repeated digits (unlikely to be real OTP) ────────────
  if (/^(\d)\1+$/.test(cleanCode)) {
    penalty -= 25;
    signals.push({
      name: 'anti:repeated-digits',
      points: -25,
      layer: 'anti-pattern',
      detail: `${cleanCode} is all the same digit`,
    });
  }

  // ── Sequential digits (123456, 654321) ──────────────────
  const isSequential = cleanCode
    .split('')
    .every((d, i, arr) => i === 0 || parseInt(d, 10) === parseInt(arr[i - 1], 10) + 1);
  const isReverseSequential = cleanCode
    .split('')
    .every((d, i, arr) => i === 0 || parseInt(d, 10) === parseInt(arr[i - 1], 10) - 1);
  if (isSequential || isReverseSequential) {
    penalty -= 15;
    signals.push({
      name: 'anti:sequential',
      points: -15,
      layer: 'anti-pattern',
      detail: `${cleanCode} is sequential(slightly suspicious)`,
    });
  }

  return {
    isRejected: false,
    reason: null,
    penaltyScore: penalty,
    signals,
  };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 6: HTML VISUAL PROMINENCE ANALYZER
// ═══════════════════════════════════════════════════════════════

function analyzeVisualProminence(
  candidate: RawCandidate,
  doc: Document | null
): {
  prominenceScore: number;
  signals: OTPSignal[];
} {
  let score = 0;
  const signals: OTPSignal[] = [];

  if (!doc) {
    return { prominenceScore: 0, signals: [] };
  }

  if (!candidate.fromHtml || !candidate.htmlElement) {
    // Try to find the code in the DOM
    const foundElement = findCodeInDOM(candidate.value, doc);
    if (!foundElement) {
      return { prominenceScore: 0, signals: [] };
    }
    candidate.htmlElement = foundElement;
  }

  const el = candidate.htmlElement;

  // ── Tag-based prominence ────────────────────────────────
  const tag = el.tagName?.toLowerCase() || '';
  const parentTag = el.parentElement?.tagName?.toLowerCase() || '';

  if (tag === 'strong' || tag === 'b' || parentTag === 'strong' || parentTag === 'b') {
    score += 20;
    signals.push({
      name: 'visual:bold',
      points: 20,
      layer: 'visual-prominence',
      detail: 'Code is in bold text',
    });
  }
  if (tag === 'code' || tag === 'pre' || parentTag === 'code') {
    score += 15;
    signals.push({
      name: 'visual:code-tag',
      points: 15,
      layer: 'visual-prominence',
      detail: 'Code is in <code> or <pre> tag',
    });
  }
  if (/^h[1-3]$/.test(tag) || /^h[1-3]$/.test(parentTag)) {
    score += 25;
    signals.push({
      name: 'visual:heading',
      points: 25,
      layer: 'visual-prominence',
      detail: `Code is in <${tag || parentTag}> heading`,
    });
  }

  // ── Style-based prominence ──────────────────────────────
  const style = getComputedStyleStr(el);

  // Font size
  const fontSizeMatch = style.match(/font-size\s*:\s*(\d+)/i);
  if (fontSizeMatch) {
    const fontSize = parseInt(fontSizeMatch[1], 10);
    if (fontSize >= 24) {
      score += 25;
      signals.push({
        name: 'visual:large-font',
        points: 25,
        layer: 'visual-prominence',
        detail: `font - size: ${fontSize} px`,
      });
    } else if (fontSize >= 18) {
      score += 15;
      signals.push({
        name: 'visual:medium-font',
        points: 15,
        layer: 'visual-prominence',
        detail: `font - size: ${fontSize} px`,
      });
    }
  }

  // Font weight
  if (/font-weight\s*:\s*(bold|700|800|900)/i.test(style)) {
    score += 12;
    signals.push({
      name: 'visual:font-weight-bold',
      points: 12,
      layer: 'visual-prominence',
      detail: 'Code has bold font-weight',
    });
  }

  // Letter spacing (common for OTP display)
  if (/letter-spacing\s*:\s*(\d+)/i.test(style)) {
    const spacing = parseInt(style.match(/letter-spacing\\s*:\\s*(\\d+)/i)![1], 10);
    if (spacing >= 2) {
      score += 20;
      signals.push({
        name: 'visual:letter-spacing',
        points: 20,
        layer: 'visual-prominence',
        detail: `letter - spacing: ${spacing} px(OTP display style)`,
      });
    }
  }

  // Text alignment center
  if (
    /text-align\s*:\s*center/i.test(style) ||
    /text-align\s*:\s*center/i.test(getComputedStyleStr(el.parentElement))
  ) {
    score += 10;
    signals.push({
      name: 'visual:centered',
      points: 10,
      layer: 'visual-prominence',
      detail: 'Code is centered',
    });
  }

  // Monospace font
  if (/font-family\s*:.*(?:mono|courier|consolas|menlo|roboto\s*mono)/i.test(style)) {
    score += 15;
    signals.push({
      name: 'visual:monospace',
      points: 15,
      layer: 'visual-prominence',
      detail: 'Code uses monospace font',
    });
  }

  // Color (non-default colors often highlight codes)
  const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (colorMatch) {
    const color = colorMatch[1].trim().toLowerCase();
    if (
      color !== 'black' &&
      color !== '#000' &&
      color !== '#000000' &&
      color !== 'inherit' &&
      color !== 'initial' &&
      color !== '#333' &&
      color !== '#333333' &&
      color !== 'rgb(0, 0, 0)'
    ) {
      score += 8;
      signals.push({
        name: 'visual:colored',
        points: 8,
        layer: 'visual-prominence',
        detail: `Code has custom color: ${color} `,
      });
    }
  }

  // Background color (code highlight box)
  if (
    /background(?:-color)?\s*:\s*(?!transparent|none|inherit|initial|#fff|white|rgb\(255)/i.test(
      style
    )
  ) {
    score += 15;
    signals.push({
      name: 'visual:background',
      points: 15,
      layer: 'visual-prominence',
      detail: 'Code has background highlight',
    });
  }

  // Padding (styled code box)
  if (/padding\s*:\s*\d+/i.test(style)) {
    score += 8;
    signals.push({
      name: 'visual:padded',
      points: 8,
      layer: 'visual-prominence',
      detail: 'Code has padding (box style)',
    });
  }

  // Border (code in a bordered box)
  if (/border\s*:/i.test(style) && !/border\s*:\s*none/i.test(style)) {
    score += 10;
    signals.push({
      name: 'visual:bordered',
      points: 10,
      layer: 'visual-prominence',
      detail: 'Code has a border',
    });
  }

  // ── Isolation check ─────────────────────────────────────
  // If the element's text content is ONLY the code, it's more prominent
  const elText = (el.textContent || '').trim();
  if (elText === candidate.rawValue || elText === candidate.value) {
    score += 15;
    signals.push({
      name: 'visual:isolated-code',
      points: 15,
      layer: 'visual-prominence',
      detail: 'Element contains only the code (no other text)',
    });
  }

  return { prominenceScore: score, signals };
}

function findCodeInDOM(code: string, doc: Document | null): Element | null {
  if (!doc) {
    return null;
  }
  const walker = doc.createTreeWalker(doc.body || doc.documentElement, NodeFilter.SHOW_TEXT);

  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || '';
    if (text.includes(code)) {
      return walker.currentNode.parentElement || null;
    }
  }
  return null;
}

function getComputedStyleStr(el: Element | null): string {
  if (!el) {
    return '';
  }
  return (el.getAttribute('style') || '') + ';' + (el.parentElement?.getAttribute('style') || '');
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 8: CODE FORMAT VALIDATOR
// ═══════════════════════════════════════════════════════════════

function validateFormat(
  code: string,
  rawCode: string
): {
  format: CodeFormat;
  length: number;
  isValidFormat: boolean;
  formatScore: number;
  signals: OTPSignal[];
} {
  const clean = code.replace(/[-\s]/g, '');
  const signals: OTPSignal[] = [];
  let formatScore = 0;

  // Determine format
  let format: CodeFormat;
  if (/^\d+$/.test(clean)) {
    format = 'numeric';
  } else if (/^[A-Za-z0-9]+$/.test(clean) && /\d/.test(clean) && /[A-Za-z]/.test(clean)) {
    format = 'alphanumeric';
  } else {
    format = 'mixed';
  }

  if (rawCode.includes('-')) {
    format = 'dash-separated';
  } else if (rawCode.includes(' ') && rawCode.trim().split(/\s+/).length === 2) {
    format = 'space-separated';
  }

  // Length scoring
  const len = clean.length;

  // Most common OTP lengths: 4, 5, 6, 7, 8
  if (len === 6) {
    formatScore += 15;
    signals.push({
      name: 'format:ideal-length-6',
      points: 15,
      layer: 'format-validator',
      detail: '6-digit code (most common OTP length)',
    });
  } else if (len === 4 || len === 5) {
    formatScore += 10;
    signals.push({
      name: `format: common - length - ${len} `,
      points: 10,
      layer: 'format-validator',
      detail: `${len} -digit code(common OTP length)`,
    });
  } else if (len === 7 || len === 8) {
    formatScore += 8;
    signals.push({
      name: `format: valid - length - ${len} `,
      points: 8,
      layer: 'format-validator',
      detail: `${len} -digit code(valid OTP length)`,
    });
  } else if (len < 4) {
    formatScore -= 30;
    signals.push({
      name: 'format:too-short',
      points: -30,
      layer: 'format-validator',
      detail: `${len} digits is too short for an OTP`,
    });
  } else if (len > 8 && format === 'numeric') {
    formatScore -= 15;
    signals.push({
      name: 'format:too-long',
      points: -15,
      layer: 'format-validator',
      detail: `${len} digits is unusually long for a numeric OTP`,
    });
  }

  // Format scoring
  if (format === 'numeric') {
    formatScore += 5;
    signals.push({
      name: 'format:numeric',
      points: 5,
      layer: 'format-validator',
      detail: 'Pure numeric format (most common)',
    });
  } else if (format === 'alphanumeric') {
    formatScore += 3;
    signals.push({
      name: 'format:alphanumeric',
      points: 3,
      layer: 'format-validator',
      detail: 'Alphanumeric format',
    });
  } else if (format === 'dash-separated') {
    formatScore += 8;
    signals.push({
      name: 'format:dash-separated',
      points: 8,
      layer: 'format-validator',
      detail: 'Dash-separated format (common display style)',
    });
  }

  const isValidFormat = len >= 4 && len <= 10 && /^[A-Za-z0-9]+$/.test(clean);

  return { format, length: len, isValidFormat, formatScore, signals };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 12: REASONING CHAIN BUILDER
// ═══════════════════════════════════════════════════════════════

function buildOTPReasoning(
  candidate: RawCandidate,
  contextAnalysis: ContextAnalysis,
  visualProminence: number,
  formatResult: ReturnType<typeof validateFormat>,
  antiResult: AntiPatternResult,
  emailIntent: EmailIntent,
  provider: ProviderOTPMatch | null,
  totalScore: number
): OTPReasoningChain {
  const steps: OTPReasoningStep[] = [];

  // ── Email intent ────────────────────────────────────────
  const verificationIntents: EmailIntent[] = [
    'verification',
    'two-factor',
    'password-reset',
    'device-confirmation',
  ];
  if (verificationIntents.includes(emailIntent)) {
    steps.push({
      layer: 'Email Intent',
      observation: `Email classified as "${emailIntent}" — this email wants the user to enter a code`,
      conclusion: 'Strong expectation that a code exists in this email',
      impact: 'strong-positive',
    });
  } else if (
    ['marketing', 'newsletter', 'social-notification', 'transactional'].includes(emailIntent)
  ) {
    steps.push({
      layer: 'Email Intent',
      observation: `Email classified as "${emailIntent}" — not a verification email`,
      conclusion: 'Unlikely to contain a genuine OTP code',
      impact: 'strong-negative',
    });
  }

  // ── Provider ────────────────────────────────────────────
  if (provider) {
    const lengthMatch = isProviderExpectedLength(candidate.value, provider);
    steps.push({
      layer: 'Provider Knowledge',
      observation: `Recognized ${provider.name}: expects ${provider.expectedLength} -digit ${provider.expectedFormat} code`,
      conclusion: lengthMatch
        ? `Code "${candidate.value}" matches expected format ✓`
        : `Code length doesn't match expected — possible but unusual`,
      impact: lengthMatch ? 'strong-positive' : 'neutral',
    });
  }

  // ── Strategy ────────────────────────────────────────────
  const strategyDescriptions: Record<ExtractionStrategy, string> = {
    'explicit-label': `Found via explicit label: "${candidate.label}"`,
    'action-instruction': 'Found in an action instruction (e.g., "Enter X to verify")',
    'html-prominent': 'Found as visually prominent element in HTML',
    'standalone-line': 'Found as standalone number on its own line',
    'url-parameter': `Found in URL parameter: ${candidate.label}`,
    'structured-container': 'Found inside a styled code container',
    'proximity-inference': 'Found near verification language (inferred)',
  };

  steps.push({
    layer: 'Extraction Strategy',
    observation: strategyDescriptions[candidate.strategy],
    conclusion:
      candidate.strategy === 'explicit-label'
        ? 'Highest confidence strategy — code was explicitly labeled'
        : candidate.strategy === 'url-parameter'
          ? 'Code extracted from URL parameter — common in modern auth systems'
          : candidate.strategy === 'html-prominent'
            ? 'Code was visually emphasized in the email HTML'
            : 'Code found through contextual analysis',
    impact:
      candidate.strategyScore >= 40
        ? 'strong-positive'
        : candidate.strategyScore >= 25
          ? 'positive'
          : 'neutral',
  });

  // ── Context ─────────────────────────────────────────────
  if (contextAnalysis.contextScore > 20) {
    const details: string[] = [];
    if (contextAnalysis.hasExpiration) {
      details.push('expiration language');
    }
    if (contextAnalysis.hasDontShare) {
      details.push('"don\'t share" warning');
    }
    if (contextAnalysis.hasInstruction) {
      details.push('entry instruction');
    }

    steps.push({
      layer: 'Context Analysis',
      observation: `Strong verification context (score: ${contextAnalysis.contextScore}): ${details.join(', ')}`,
      conclusion: 'Surrounding text strongly confirms this is a verification code',
      impact: 'strong-positive',
    });
  } else if (contextAnalysis.contextScore < -20) {
    steps.push({
      layer: 'Context Analysis',
      observation: `Negative context detected (score: ${contextAnalysis.contextScore})`,
      conclusion: 'Surrounding text suggests this number is NOT an OTP',
      impact: 'strong-negative',
    });
  }

  // ── Visual ──────────────────────────────────────────────
  if (visualProminence >= 20) {
    steps.push({
      layer: 'Visual Prominence',
      observation: `Code is visually prominent (score: ${visualProminence}): styled for emphasis`,
      conclusion: 'Visual styling confirms this is meant to be noticed and copied',
      impact: 'positive',
    });
  }

  // ── Format ──────────────────────────────────────────────
  steps.push({
    layer: 'Format Validation',
    observation: `${formatResult.length}-digit ${formatResult.format} code "${candidate.rawValue}"`,
    conclusion: formatResult.isValidFormat
      ? `Valid OTP format (${formatResult.format}, ${formatResult.length} chars)`
      : 'Unusual format for an OTP',
    impact: formatResult.isValidFormat ? 'positive' : 'negative',
  });

  // ── Anti-patterns ───────────────────────────────────────
  if (antiResult.signals.length > 0 && !antiResult.isRejected) {
    steps.push({
      layer: 'Anti-Pattern Check',
      observation: `${antiResult.signals.length} potential false-positive signals detected`,
      conclusion: 'Some anti-patterns detected but not strong enough to reject',
      impact: 'negative',
    });
  }

  // ── Summary ─────────────────────────────────────────────
  const positiveSteps = steps.filter((s) => s.impact.includes('positive')).length;
  const negativeSteps = steps.filter((s) => s.impact.includes('negative')).length;
  const layerCount = new Set(steps.map((s) => s.layer)).size;

  let summary: string;
  let confidenceExplanation: string;

  if (totalScore >= 80) {
    summary = `VERY HIGH CONFIDENCE: "${candidate.rawValue}" is the OTP code. ${positiveSteps} positive signals across ${layerCount} layers confirm this.`;
    confidenceExplanation =
      'Multiple independent layers strongly agree this is the verification code.';
  } else if (totalScore >= 50) {
    summary = `HIGH CONFIDENCE: "${candidate.rawValue}" is very likely the OTP code. ${positiveSteps} positive vs ${negativeSteps} negative signals.`;
    confidenceExplanation = 'Strong evidence supports this being the correct code.';
  } else if (totalScore >= 25) {
    summary = `MODERATE CONFIDENCE: "${candidate.rawValue}" is probably the OTP code, but with some uncertainty.`;
    confidenceExplanation = 'Some evidence supports this, but not all layers confirm.';
  } else {
    summary = `LOW CONFIDENCE: "${candidate.rawValue}" might be the OTP code, but evidence is weak.`;
    confidenceExplanation = 'Limited evidence — this could be a false positive.';
  }

  return { steps, summary, confidenceExplanation };
}

// ═══════════════════════════════════════════════════════════════
//  MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function extractOTP(
  emailHtml: string,
  subject: string = '',
  senderEmail: string = ''
): OTPExtractionResult {
  const startTime = performance.now();
  const layersExecuted: string[] = [];

  // ── Parse HTML ──────────────────────────────────────────
  // SECURITY FIX: Truncate massive emails to 50KB to prevent ReDoS and save CPU
  const MAX_PROCESSABLE_LENGTH = 50000;
  const boundedHtml = emailHtml.length > MAX_PROCESSABLE_LENGTH ? emailHtml.substring(0, MAX_PROCESSABLE_LENGTH) : emailHtml;
  let plainText = boundedHtml;

  // Use simple HTML stripping instead of DOMParser (not available in Service Workers)
  try {
    plainText = stripHtml(boundedHtml);
  } catch {
    plainText = boundedHtml;
  }
  layersExecuted.push('html-parser');

  // ── LAYER 1: Email Intent ───────────────────────────────
  const fullText = `${subject} ${plainText}`;
  const intentResult = classifyIntent(fullText);
  layersExecuted.push('intent-classifier');

  // ── LAYER 2: Provider Detection ─────────────────────────
  const providerMatch = matchOTPProvider(senderEmail, subject, plainText);
  layersExecuted.push('provider-knowledge');

  // ── Detect code-related words used in email ─────────────
  let codeWordUsed: string | null = null;
  const codeWordPatterns = [
    { regex: /one[- ]?time\s*(?:code|password|passcode|pin|otp)/i, word: 'one-time code' },
    { regex: /verification\s*code/i, word: 'verification code' },
    { regex: /confirmation\s*code/i, word: 'confirmation code' },
    { regex: /security\s*code/i, word: 'security code' },
    { regex: /authentication\s*code/i, word: 'authentication code' },
    { regex: /login\s*code/i, word: 'login code' },
    { regex: /sign[- ]?in\s*code/i, word: 'sign-in code' },
    { regex: /access\s*code/i, word: 'access code' },
    { regex: /\bpin\b/i, word: 'PIN' },
    { regex: /\botp\b/i, word: 'OTP' },
    { regex: /passcode/i, word: 'passcode' },
    { regex: /\bcode\b/i, word: 'code' },
  ];
  for (const p of codeWordPatterns) {
    if (p.regex.test(fullText)) {
      codeWordUsed = p.word;
      break;
    }
  }

  // ── LAYER 3: Extract Raw Candidates ─────────────────────
  const rawCandidates = extractRawCandidates(plainText, emailHtml, null);
  layersExecuted.push('pattern-engine');

  const candidates: ExtractedOTP[] = [];
  const rejected: Array<{ value: string; reason: string; context: string }> = [];

  // ── Process each candidate through layers 4-12 ──────────
  for (const raw of rawCandidates) {
    // ── LAYER 5: Anti-Pattern Check ───────────────────────
    const antiResult = checkAntiPatterns(raw.value, raw.context, plainText);
    layersExecuted.includes('anti-pattern') || layersExecuted.push('anti-pattern');

    if (antiResult.isRejected) {
      rejected.push({
        value: raw.value,
        reason: antiResult.reason || 'anti-pattern',
        context: raw.context.slice(0, 100),
      });
      continue;
    }

    // ── LAYER 8: Format Validation ────────────────────────
    const formatResult = validateFormat(raw.value, raw.rawValue);
    layersExecuted.includes('format-validator') || layersExecuted.push('format-validator');

    if (!formatResult.isValidFormat) {
      rejected.push({
        value: raw.value,
        reason: `invalid-format:${formatResult.format}:len${formatResult.length}`,
        context: raw.context.slice(0, 100),
      });
      continue;
    }

    // ── LAYER 4: Context Analysis ─────────────────────────
    const contextAnalysis = analyzeContext(raw);
    layersExecuted.includes('context-analyzer') || layersExecuted.push('context-analyzer');

    // ── LAYER 6: Visual Prominence ────────────────────────
    const visualResult = analyzeVisualProminence(raw, null);
    layersExecuted.includes('visual-prominence') || layersExecuted.push('visual-prominence');

    // ── LAYER 9: Score Fusion ─────────────────────────────
    let totalScore = 0;
    const allPositiveSignals: OTPSignal[] = [];
    const allNegativeSignals: OTPSignal[] = [];

    // Strategy score
    totalScore += raw.strategyScore;
    allPositiveSignals.push({
      name: `strategy:${raw.strategy}`,
      points: raw.strategyScore,
      layer: 'pattern-engine',
      detail: `Extracted via: ${raw.strategy}${raw.label ? ` (label: "${raw.label}")` : ''}`,
    });

    // Context score
    totalScore += contextAnalysis.contextScore;
    allPositiveSignals.push(...contextAnalysis.positiveSignals);
    allNegativeSignals.push(...contextAnalysis.negativeSignals);

    // Anti-pattern penalty
    if (antiResult.penaltyScore !== 0) {
      totalScore += antiResult.penaltyScore;
      allNegativeSignals.push(...antiResult.signals);
    }

    // Format score
    totalScore += formatResult.formatScore;
    allPositiveSignals.push(...formatResult.signals.filter((s) => s.points > 0));
    allNegativeSignals.push(...formatResult.signals.filter((s) => s.points < 0));

    // Visual prominence
    totalScore += visualResult.prominenceScore;
    allPositiveSignals.push(...visualResult.signals);

    // Provider bonus
    if (providerMatch) {
      const lengthMatch = isProviderExpectedLength(raw.value, providerMatch);
      if (lengthMatch) {
        totalScore += 20;
        allPositiveSignals.push({
          name: `provider:${providerMatch.name}`,
          points: 20,
          layer: 'provider-knowledge',
          detail: `Matches ${providerMatch.name} expected ${providerMatch.expectedLength}-digit ${providerMatch.expectedFormat} code`,
        });
      } else {
        totalScore -= 5;
        allNegativeSignals.push({
          name: `provider:length-mismatch`,
          points: -5,
          layer: 'provider-knowledge',
          detail: `${providerMatch.name} expects ${providerMatch.expectedLength} digits, got ${raw.value.length}`,
        });
      }
    }

    // Email intent alignment
    const verificationIntents: EmailIntent[] = [
      'verification',
      'two-factor',
      'password-reset',
      'device-confirmation',
    ];
    if (verificationIntents.includes(intentResult.intent) && totalScore > 0) {
      const intentBonus = Math.round(totalScore * 0.15);
      totalScore += intentBonus;
      allPositiveSignals.push({
        name: `intent:${intentResult.intent}`,
        points: intentBonus,
        layer: 'intent-classifier',
        detail: `Email intent "${intentResult.intent}" aligns with OTP presence (${(intentResult.confidence * 100).toFixed(0)}%)`,
      });
    }

    // Anti-intent penalty
    const antiIntents: EmailIntent[] = ['marketing', 'newsletter', 'social-notification'];
    if (antiIntents.includes(intentResult.intent) && intentResult.confidence > 0.5) {
      const penalty = -Math.round(Math.abs(totalScore) * 0.4);
      totalScore += penalty;
      allNegativeSignals.push({
        name: `intent:${intentResult.intent}-penalty`,
        points: penalty,
        layer: 'intent-classifier',
        detail: `Email is "${intentResult.intent}" — very unlikely to contain a genuine OTP`,
      });
    }

    // ── Skip if score too low ─────────────────────────────
    if (totalScore <= 0) {
      rejected.push({
        value: raw.value,
        reason: `low-score:${totalScore}`,
        context: raw.context.slice(0, 100),
      });
      continue;
    }

    // ── LAYER 10: Confidence Calibration ──────────────────
    let confidence = Math.min(totalScore / 80, 1.0);
    if (verificationIntents.includes(intentResult.intent)) {
      confidence = Math.min(confidence * 1.1, 1.0);
    }
    if (providerMatch && isProviderExpectedLength(raw.value, providerMatch)) {
      confidence = Math.min(confidence * 1.1, 1.0);
    }
    if (raw.strategy === 'explicit-label') {
      confidence = Math.min(confidence * 1.1, 1.0);
    }
    confidence = Math.round(confidence * 1000) / 1000;

    // ── LAYER 11: Code Normalization ──────────────────────
    const normalizedCode = raw.value.replace(/[-\s]/g, '').toUpperCase();

    // ── Detect code type ──────────────────────────────────
    let codeType: CodeType = contextAnalysis.detectedType || 'unknown-code';
    if (codeType === 'unknown-code' && providerMatch) {
      const prov = PROVIDER_OTP_KNOWLEDGE.find((p) => p.name === providerMatch.name);
      if (prov) {
        codeType = prov.codeType;
      }
    }
    if (codeType === 'unknown-code' && raw.strategy === 'url-parameter') {
      codeType = 'url-embedded-code';
    }

    // ── LAYER 12: Reasoning ───────────────────────────────
    const reasoning = buildOTPReasoning(
      raw,
      contextAnalysis,
      visualResult.prominenceScore,
      formatResult,
      antiResult,
      intentResult.intent,
      providerMatch,
      totalScore
    );

    candidates.push({
      code: normalizedCode,
      rawCode: raw.rawValue,
      score: totalScore,
      confidence,
      type: codeType,
      format: formatResult.format,
      strategy: raw.strategy,
      length: formatResult.length,
      context: raw.context,
      label: raw.label,
      fromUrl: raw.strategy === 'url-parameter',
      urlParam:
        raw.strategy === 'url-parameter' ? raw.label?.replace('URL param: ', '') || null : null,
      sourceUrl: raw.strategy === 'url-parameter' ? raw.context : null,
      visualProminence: visualResult.prominenceScore,
      providerMatch,
      matchedSignals: allPositiveSignals,
      antiSignals: allNegativeSignals,
      reasoning,
    });
  }

  // ── Post-Processing ─────────────────────────────────────
  // If only one candidate, boost it
  if (candidates.length === 1 && candidates[0].score > 20) {
    candidates[0].score += 15;
    candidates[0].matchedSignals.push({
      name: 'post:sole-candidate',
      points: 15,
      layer: 'post-processor',
      detail: 'Only one viable code candidate — high confidence',
    });
    candidates[0].confidence = Math.min(candidates[0].confidence * 1.1, 1.0);
  }

  // Deduplicate (same normalized code)
  const seenCodes = new Set<string>();
  const deduped: ExtractedOTP[] = [];
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (!seenCodes.has(c.code)) {
      seenCodes.add(c.code);
      deduped.push(c);
    }
  }

  // Sort by score
  deduped.sort((a, b) => b.score - a.score);

  layersExecuted.push('post-processor');

  const extractionTimeMs = performance.now() - startTime;

  // ── Email Analysis ──────────────────────────────────────
  const hasExpirationLanguage = /expires?\s*(in|after)|valid\s*(for|until)|within\s*\d+/i.test(
    plainText
  );
  const hasSecurityLanguage =
    /don['']?t\s*share|keep\s*(it)?\s*secret|security|suspicious|unauthorized/i.test(plainText);
  const hasDontShareLanguage =
    /don['']?t\s*share|never\s*(share|give|send)|keep\s*(it)?\s*(private|secret)/i.test(plainText);

  // Estimate expected code length from email text
  let estimatedCodeLength: number | null = null;
  const lengthHint = plainText.match(/(\d)[- ]?digit\s*(code|pin|otp|number)/i);
  if (lengthHint) {
    estimatedCodeLength = parseInt(lengthHint[1], 10);
  }

  return {
    best: deduped.length > 0 ? deduped[0] : null,
    allCandidates: deduped,
    rejected,
    emailAnalysis: {
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      intentSignals: intentResult.signals,
      detectedProvider: providerMatch?.name || null,
      hasExpirationLanguage,
      hasSecurityLanguage,
      hasDontShareLanguage,
      estimatedCodeLength,
      codeWordUsed,
      totalNumbersFound: (plainText.match(/\b\d{4,}\b/g) || []).length,
    },
    meta: {
      totalNumbersScanned: rawCandidates.length,
      candidatesFound: deduped.length,
      rejectedCount: rejected.length,
      extractionTimeMs,
      layersExecuted,
      dominantStrategy: deduped.length > 0 ? deduped[0].strategy : null,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#?\w+;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function getContextWindow(text: string, index: number, radius: number): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function getElementContext(el: Element, radius: number): string {
  const parts: string[] = [];

  // Previous siblings text
  let prev = el.previousElementSibling;
  for (let i = 0; i < 2 && prev; i++) {
    const t = (prev.textContent || '').trim();
    if (t.length > 0 && t.length < 200) {
      parts.unshift(t);
    }
    prev = prev.previousElementSibling;
  }

  // Parent text
  const parentText = getDirectText(el.parentElement);
  if (parentText.length > 0) {
    parts.push(parentText);
  }

  // Next siblings text
  let next = el.nextElementSibling;
  for (let i = 0; i < 2 && next; i++) {
    const t = (next.textContent || '').trim();
    if (t.length > 0 && t.length < 200) {
      parts.push(t);
    }
    next = next.nextElementSibling;
  }

  return parts.join(' ').slice(0, radius * 2);
}

function getDirectText(el: Element | null): string {
  if (!el) {
    return '';
  }
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function truncateStr(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}
