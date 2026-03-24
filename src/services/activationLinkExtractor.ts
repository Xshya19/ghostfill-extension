/**
 * ═══════════════════════════════════════════════════════════════
 * 🔗 GhostFill — Activation Link Extractor
 *
 * 12-Layer Intelligence Engine for verification link detection:
 *
 * Layer 1:  Email Intent Classifier
 * Layer 2:  Provider Knowledge Base
 * Layer 3:  Semantic Text Analyzer
 * Layer 4:  Email Anatomy Engine
 * Layer 5:  Link-Text Relationship Graph
 * Layer 6:  CTA Hierarchy Detector
 * Layer 7:  URL Intelligence
 * Layer 8:  Negative Intelligence
 * Layer 9:  Cross-Signal Reasoning Engine
 * Layer 10: Confidence Calibration
 * Layer 11: Embedded Code Extractor
 * Layer 12: Reasoning Chain (Explainable AI)
 * ═══════════════════════════════════════════════════════════════
 */

import type {
  LinkType,
  EmailIntent,
  EmailSection,
  EmailAnatomy,
  ActivationLink,
  ScoringSignal,
  ReasoningChain,
  ReasoningStep,
  ProviderMatch,
  LinkExtractionResult,
  EmailAnalysis,
  ExtractionMeta,
} from './types/extraction.types';

// Re-export types for backward compatibility
export type {
  LinkType,
  EmailIntent,
  EmailSection,
  EmailAnatomy,
  ActivationLink,
  ScoringSignal,
  ReasoningChain,
  ReasoningStep,
  ProviderMatch,
  LinkExtractionResult,
  EmailAnalysis,
  ExtractionMeta,
};

// ═══════════════════════════════════════════════════════════════
//  §0  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_CONTEXT_TEXT_LENGTH = 400;
const MAX_ANCHOR_TEXT_LENGTH = 200;
const MAX_INSTRUCTION_TEXT_LENGTH = 150;
const CONFIDENCE_DENOMINATOR = 80;
const HIGH_SCORE_THRESHOLD = 35;
const SOLE_CANDIDATE_BONUS = 15;
const DUPLICATE_URL_BONUS = 5;
const SINGLE_PRIMARY_CTA_BONUS = 10;
const PRIMARY_CTA_SCORE = 15;
const EMBEDDED_CODE_SCORE = 15;
const INTENT_ALIGNMENT_MULTIPLIER = 0.15;
const ANTI_INTENT_PENALTY_MULTIPLIER = 0.4;
const ANTI_INTENT_CONFIDENCE_THRESHOLD = 0.5;
const MIN_URL_LENGTH = 15;
const TRUNCATE_URL_LENGTH = 80;
const MIN_CODE_LENGTH = 4;
const MAX_CODE_LENGTH = 10;

// ═══════════════════════════════════════════════════════════════
//  §1  LOCAL TYPES
// ═══════════════════════════════════════════════════════════════

interface IntentSignal {
  readonly pattern: RegExp;
  readonly intent: EmailIntent;
  readonly weight: number;
  readonly name: string;
}

interface IntentClassification {
  readonly intent: EmailIntent;
  readonly confidence: number;
  readonly signals: string[];
  readonly allIntentScores: ReadonlyMap<EmailIntent, number>;
}

interface ProviderKnowledge {
  readonly name: string;
  readonly category: 'auth-platform' | 'saas' | 'social' | 'devtools' | 'cloud' | 'finance' | 'productivity';
  readonly senderDomains: readonly RegExp[];
  readonly verificationUrlPatterns: readonly RegExp[];
  readonly codeParams: readonly string[];
  readonly expectedLinkType: LinkType;
  readonly recognitionBonus: number;
}

interface ProviderBonusResult {
  readonly bonus: number;
  readonly provider: ProviderMatch | null;
  readonly knownCodeParams: readonly string[];
}

interface SemanticContext {
  readonly verificationRelevance: number;
  readonly requestedAction: string | null;
  readonly hasUrgency: boolean;
  readonly hasSecurityContext: boolean;
  readonly hasDisclaimerNearby: boolean;
  readonly instructionText: string | null;
  readonly sentiment: 'action-request' | 'informational' | 'warning' | 'neutral';
}

interface LinkTextRelationship {
  readonly associatedInstruction: string | null;
  readonly instructionDistance: number;
  readonly isDirectlyFollowingInstruction: boolean;
  readonly parentHeading: string | null;
  readonly relationshipBonus: number;
}

interface VisualWeightResult {
  readonly visualWeight: number;
  readonly isPrimaryCTA: boolean;
  readonly ctaSignals: string[];
}

interface UrlIntelligence {
  readonly urlScore: number;
  readonly detectedType: LinkType | null;
  readonly signals: ScoringSignal[];
  readonly negativeSignals: ScoringSignal[];
  readonly embeddedCode: EmbeddedCode | null;
  readonly isTrackingWrapper: boolean;
  readonly pathDepth: number;
  readonly paramCount: number;
}

interface EmbeddedCode {
  readonly code: string;
  readonly param: string;
}

interface UrlSignalDef {
  readonly pattern: RegExp;
  readonly score: number;
  readonly type: LinkType | null;
  readonly name: string;
  readonly layer: string;
}

interface NegativeSignalDef {
  readonly pattern: RegExp;
  readonly score: number;
  readonly name: string;
  readonly layer: string;
}

/** Lightweight anchor representation from regex-parsed HTML */
interface ParsedAnchor {
  readonly href: string;
  readonly textContent: string;
  readonly outerHTML: string;
  readonly innerHTML: string;
  getAttribute(attr: string): string | null;
}

// ═══════════════════════════════════════════════════════════════
//  §2  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function truncate(str: string | undefined | null, maxLen: number): string {
  if (!str) {return '';}
  return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}

function clampConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    });
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'ref', 'source', 'mc_cid', 'mc_eid', 'fbclid', 'gclid',
    ];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function safeNewUrl(url: string): URL | null {
  try {
    return new URL(url, 'https://placeholder.com');
  } catch {
    return null;
  }
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function getCleanAnchorText(anchor: ParsedAnchor): string {
  // For regex-parsed anchors, strip tags from innerHTML
  let text = anchor.innerHTML.replace(/<img\s[^>]*alt=["']([^"']*)["'][^>]*>/gi, '$1');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<[^>]*>/g, '');
  return text.replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════
//  §3  LAYER 1: EMAIL INTENT CLASSIFIER
// ═══════════════════════════════════════════════════════════════

const INTENT_SIGNALS: readonly IntentSignal[] = [
  // ── Verification Intent ──
  { pattern: /verify\s*(your|my|this|the)?\s*(email|e-?mail|account|address)/i, intent: 'verification', weight: 40, name: 'verify-email-phrase' },
  { pattern: /confirm\s*(your|my|this|the)?\s*(email|e-?mail|account|registration|sign\s*up)/i, intent: 'verification', weight: 40, name: 'confirm-email-phrase' },
  { pattern: /activate\s*(your|my|this)?\s*(account|email|profile)/i, intent: 'verification', weight: 35, name: 'activate-phrase' },
  { pattern: /validate\s*(your|my|this)?\s*(email|account|address)/i, intent: 'verification', weight: 35, name: 'validate-phrase' },
  { pattern: /complete\s*(your|my)?\s*(registration|sign\s*up|setup|verification)/i, intent: 'verification', weight: 30, name: 'complete-registration' },
  { pattern: /welcome.*verify/i, intent: 'verification', weight: 25, name: 'welcome-verify' },
  { pattern: /thanks?\s*(for)?\s*(signing\s*up|registering|joining|creating)/i, intent: 'verification', weight: 25, name: 'thanks-signup' },
  { pattern: /one\s*more\s*step/i, intent: 'verification', weight: 20, name: 'one-more-step' },
  { pattern: /almost\s*(there|done|finished)/i, intent: 'verification', weight: 15, name: 'almost-there' },

  // ── Magic Link Intent ──
  { pattern: /magic\s*link/i, intent: 'magic-link-login', weight: 45, name: 'magic-link-phrase' },
  { pattern: /sign\s*in\s*(to|with|using)\s*(your|a|this)?\s*(link|button|click)/i, intent: 'magic-link-login', weight: 40, name: 'sign-in-with-link' },
  { pattern: /log\s*in\s*(to|with)\s*(your|this)?\s*(link|click|button)/i, intent: 'magic-link-login', weight: 40, name: 'login-with-link' },
  { pattern: /passwordless\s*(sign|log)\s*in/i, intent: 'magic-link-login', weight: 40, name: 'passwordless-login' },
  { pattern: /sign\s*in\s*to\s+\w+/i, intent: 'magic-link-login', weight: 20, name: 'sign-in-to-service' },
  { pattern: /log\s*in\s*to\s+\w+/i, intent: 'magic-link-login', weight: 20, name: 'login-to-service' },
  { pattern: /click\s*(below|the\s*button|here|this\s*link)\s*to\s*(sign|log)\s*in/i, intent: 'magic-link-login', weight: 35, name: 'click-to-sign-in' },
  { pattern: /requested\s*a?\s*(sign|log)\s*in\s*(link|email|code)/i, intent: 'magic-link-login', weight: 30, name: 'requested-login-link' },

  // ── Password Reset Intent ──
  { pattern: /reset\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 45, name: 'reset-password' },
  { pattern: /change\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 35, name: 'change-password' },
  { pattern: /forgot\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 40, name: 'forgot-password' },
  { pattern: /password\s*(recovery|reset|change)/i, intent: 'password-reset', weight: 40, name: 'password-recovery' },
  { pattern: /lost\s*(your|my)?\s*(password|access)/i, intent: 'password-reset', weight: 30, name: 'lost-password' },
  { pattern: /set\s*(a\s*)?new\s*password/i, intent: 'password-reset', weight: 35, name: 'set-new-password' },
  { pattern: /update\s*(your|my)?\s*password/i, intent: 'password-reset', weight: 30, name: 'update-password' },

  // ── Device Confirmation Intent ──
  { pattern: /new\s*(device|browser|location|login|sign\s*in)\s*(detected|attempt|activity)/i, intent: 'device-confirmation', weight: 35, name: 'new-device' },
  { pattern: /authorize\s*(this|your|the)?\s*(device|browser|login|computer)/i, intent: 'device-confirmation', weight: 40, name: 'authorize-device' },
  { pattern: /unusual\s*(activity|sign\s*in|login|access)/i, intent: 'device-confirmation', weight: 30, name: 'unusual-activity' },
  { pattern: /verify\s*(this|your|the)?\s*(login|sign\s*in|device|attempt)/i, intent: 'device-confirmation', weight: 35, name: 'verify-login' },
  { pattern: /was\s*this\s*you/i, intent: 'device-confirmation', weight: 30, name: 'was-this-you' },
  { pattern: /someone\s*(is\s*)?trying\s*to\s*(sign|log)\s*in/i, intent: 'device-confirmation', weight: 30, name: 'someone-trying' },

  // ── Invitation Intent ──
  { pattern: /invited?\s*(you|to\s*join)/i, intent: 'invitation', weight: 30, name: 'invited-phrase' },
  { pattern: /join\s*(my|our|the|this)?\s*(team|workspace|organization|project|group)/i, intent: 'invitation', weight: 30, name: 'join-team' },
  { pattern: /accept\s*(this|your|the)?\s*invit/i, intent: 'invitation', weight: 35, name: 'accept-invitation' },

  // ── Two-Factor Intent ──
  { pattern: /two[- ]?factor|2fa|multi[- ]?factor|mfa/i, intent: 'two-factor', weight: 35, name: '2fa-phrase' },
  { pattern: /security\s*key|authenticator/i, intent: 'two-factor', weight: 25, name: 'security-key' },
  { pattern: /backup\s*code/i, intent: 'two-factor', weight: 20, name: 'backup-code' },

  // ── Anti-Intent: Marketing ──
  { pattern: /\b(sale|discount|%\s*off|promo|coupon|deal)\b/i, intent: 'marketing', weight: 35, name: 'marketing-language' },
  { pattern: /limited\s*time\s*(offer|deal)/i, intent: 'marketing', weight: 30, name: 'limited-time' },
  { pattern: /buy\s*now|shop\s*now|order\s*now/i, intent: 'marketing', weight: 35, name: 'buy-now' },
  { pattern: /free\s*shipping/i, intent: 'marketing', weight: 25, name: 'free-shipping' },
  { pattern: /exclusive\s*(offer|deal|access)/i, intent: 'marketing', weight: 20, name: 'exclusive-offer' },

  // ── Anti-Intent: Newsletter ──
  { pattern: /newsletter|weekly\s*(digest|recap|update)|monthly\s*(digest|recap|update)/i, intent: 'newsletter', weight: 40, name: 'newsletter' },
  { pattern: /top\s*stories|trending|what'?s\s*new|round\s*up/i, intent: 'newsletter', weight: 25, name: 'digest-language' },
  { pattern: /this\s*week\s*(in|at|on)|here'?s\s*what/i, intent: 'newsletter', weight: 20, name: 'this-week' },

  // ── Anti-Intent: Social ──
  { pattern: /(liked|commented|mentioned|followed|shared|replied\s*to|reacted\s*to)\s*(your|you)/i, intent: 'social-notification', weight: 35, name: 'social-action' },
  { pattern: /new\s*(follower|like|comment|reply|mention|reaction)/i, intent: 'social-notification', weight: 25, name: 'new-social' },

  // ── Anti-Intent: Transactional ──
  { pattern: /order\s*(confirm|#|number)|receipt|invoice/i, intent: 'transactional', weight: 35, name: 'order-receipt' },
  { pattern: /payment\s*(received|confirmed|processed)/i, intent: 'transactional', weight: 30, name: 'payment' },
  { pattern: /ship(ped|ping)|delivered|tracking\s*(number|#|id)/i, intent: 'transactional', weight: 35, name: 'shipping' },
  { pattern: /subscription\s*(renewed|receipt|invoice|billing)/i, intent: 'transactional', weight: 25, name: 'subscription-billing' },
];

function classifyEmailIntent(text: string): IntentClassification {
  const intentScores = new Map<EmailIntent, number>();
  const matchedSignals: string[] = [];

  for (const signal of INTENT_SIGNALS) {
    if (signal.pattern.test(text)) {
      const current = intentScores.get(signal.intent) ?? 0;
      intentScores.set(signal.intent, current + signal.weight);
      matchedSignals.push(`${signal.name}(${signal.intent}:+${signal.weight})`);
    }
  }

  let bestIntent: EmailIntent = 'unknown';
  let bestScore = 0;
  let totalScore = 0;

  for (const [intent, score] of intentScores) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  const confidence = totalScore > 0
    ? clampConfidence(bestScore / Math.max(totalScore * 0.6, 40))
    : 0;

  return { intent: bestIntent, confidence, signals: matchedSignals, allIntentScores: intentScores };
}

// ═══════════════════════════════════════════════════════════════
//  §4  LAYER 2: PROVIDER KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

const PROVIDER_KNOWLEDGE_BASE: readonly ProviderKnowledge[] = [
  // Auth Platforms
  { name: 'Ory Kratos', category: 'auth-platform', senderDomains: [/ory\.(sh|dev)/i], verificationUrlPatterns: [/self[-_]?service\/(verification|recovery|login)/i, /\/\.ory\//i], codeParams: ['code', 'flow', 'token'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Auth0', category: 'auth-platform', senderDomains: [/auth0\.(com|dev)/i], verificationUrlPatterns: [/\/u\/email[-_]?verification/i, /auth0\.com.*verify/i, /\/authorize\?/i], codeParams: ['verification_code', 'code', 'ticket'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Firebase Auth', category: 'auth-platform', senderDomains: [/firebase/i, /gcp/i], verificationUrlPatterns: [/__\/auth\/action\?mode=verifyEmail/i, /firebaseapp\.com.*auth/i], codeParams: ['oobCode', 'apiKey'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Supabase Auth', category: 'auth-platform', senderDomains: [/supabase/i], verificationUrlPatterns: [/supabase\.\w+\/auth\/v\d\/verify/i, /supabase\.\w+\/auth\/v\d\/callback/i], codeParams: ['token', 'type', 'redirect_to'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Clerk', category: 'auth-platform', senderDomains: [/clerk\.(dev|com)/i], verificationUrlPatterns: [/clerk\.(dev|com).*verify/i, /accounts\..*\.dev\/v\d\/verify/i], codeParams: ['token', 'code', '__clerk_ticket'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'AWS Cognito', category: 'auth-platform', senderDomains: [/amazonaws\.com|cognito/i], verificationUrlPatterns: [/cognito.*confirm/i, /cognito.*verify/i], codeParams: ['confirmation_code', 'code', 'client_id'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Okta', category: 'auth-platform', senderDomains: [/okta\.com|oktapreview\.com/i], verificationUrlPatterns: [/okta.*activate/i, /okta.*verify/i, /\/signin\/verify/i], codeParams: ['token', 'activationToken'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'OneLogin', category: 'auth-platform', senderDomains: [/onelogin\.com/i], verificationUrlPatterns: [/onelogin.*verify|onelogin.*activate/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Keycloak', category: 'auth-platform', senderDomains: [], verificationUrlPatterns: [/\/auth\/realms\/.*\/login-actions\/action-token/i, /keycloak.*verify/i], codeParams: ['key', 'token'], expectedLinkType: 'email-verification', recognitionBonus: 20 },
  { name: 'Stytch', category: 'auth-platform', senderDomains: [/stytch\.com/i], verificationUrlPatterns: [/stytch\.com.*authenticate/i, /stytch.*magic/i], codeParams: ['token'], expectedLinkType: 'magic-link', recognitionBonus: 20 },
  { name: 'WorkOS', category: 'auth-platform', senderDomains: [/workos\.com/i], verificationUrlPatterns: [/workos\.com.*verify/i, /workos.*magic/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15 },

  // SaaS / Productivity
  { name: 'Linear', category: 'productivity', senderDomains: [/linear\.app/i], verificationUrlPatterns: [/linear\.app\/auth\/magic[-_]?link/i], codeParams: ['token'], expectedLinkType: 'magic-link', recognitionBonus: 15 },
  { name: 'Notion', category: 'productivity', senderDomains: [/notion\.so|makenotion\.com/i], verificationUrlPatterns: [/notion\.so\/(loginwithemail|verify)/i], codeParams: ['token', 'email'], expectedLinkType: 'magic-link', recognitionBonus: 15 },
  { name: 'Slack', category: 'productivity', senderDomains: [/slack\.com|slackb\.com/i], verificationUrlPatterns: [/slack\.com\/(confirm|verify)/i], codeParams: ['code', 'crumb'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Figma', category: 'productivity', senderDomains: [/figma\.com/i], verificationUrlPatterns: [/figma\.com.*verify|figma\.com.*confirm/i], codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Vercel', category: 'devtools', senderDomains: [/vercel\.com/i], verificationUrlPatterns: [/vercel\.com.*verify|vercel\.com.*confirm/i], codeParams: ['token', 'email'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Stripe', category: 'finance', senderDomains: [/stripe\.com/i], verificationUrlPatterns: [/stripe\.com.*confirm|stripe\.com.*verify/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Mistral AI', category: 'saas', senderDomains: [/mistral\.ai/i], verificationUrlPatterns: [/mistral\.ai.*verification|auth\.mistral/i], codeParams: ['code', 'flow'], expectedLinkType: 'email-verification', recognitionBonus: 15 },

  // Social / DevTools
  { name: 'GitHub', category: 'devtools', senderDomains: [/github\.com/i], verificationUrlPatterns: [/github\.com\/(password_reset|confirm|verify|settings\/emails)/i], codeParams: ['token', 'nonce'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'GitLab', category: 'devtools', senderDomains: [/gitlab\.com/i], verificationUrlPatterns: [/gitlab\.com.*confirm|gitlab.*verify/i], codeParams: ['confirmation_token'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Discord', category: 'social', senderDomains: [/discord\.com|discordapp\.com/i], verificationUrlPatterns: [/discord\.com.*verify|click\.discord/i], codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Google', category: 'cloud', senderDomains: [/google\.com|gmail\.com/i], verificationUrlPatterns: [/accounts\.google\.com.*verify/i, /google\.com.*signin.*challenge/i], codeParams: ['token', 'continue'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Microsoft', category: 'cloud', senderDomains: [/microsoft\.com|outlook\.com|live\.com/i], verificationUrlPatterns: [/microsoft\.com.*verify|login\.microsoftonline/i, /account\.live\.com.*confirm/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Apple', category: 'cloud', senderDomains: [/apple\.com|icloud\.com/i], verificationUrlPatterns: [/appleid\.apple\.com.*verify/i], codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
  { name: 'Twitter/X', category: 'social', senderDomains: [/twitter\.com|x\.com/i], verificationUrlPatterns: [/twitter\.com.*confirm|x\.com.*verify/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15 },
];

function getProviderBonus(url: string): ProviderBonusResult {
  for (const provider of PROVIDER_KNOWLEDGE_BASE) {
    for (const urlPattern of provider.verificationUrlPatterns) {
      if (urlPattern.test(url)) {
        return {
          bonus: provider.recognitionBonus,
          provider: {
            name: provider.name,
            category: provider.category,
            urlPattern: urlPattern.source,
            confidence: 0.95,
          },
          knownCodeParams: provider.codeParams,
        };
      }
    }
  }
  return { bonus: 0, provider: null, knownCodeParams: [] };
}

function detectEmailProvider(senderEmail: string, bodyText: string): string | null {
  for (const provider of PROVIDER_KNOWLEDGE_BASE) {
    for (const domain of provider.senderDomains) {
      if (domain.test(senderEmail) || domain.test(bodyText)) {
        return provider.name;
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  §5  LAYER 3: SEMANTIC TEXT ANALYZER
// ═══════════════════════════════════════════════════════════════

const ACTION_PATTERNS: ReadonlyArray<readonly [RegExp, string, number]> = [
  [/please\s*(click|tap|press|select|use)\s*(the|this|below|above)?\s*(link|button|url)/i, 'click-link', 25],
  [/click\s*(the|this)?\s*(link|button|below|above)\s*to\s*(verify|confirm|activate|validate|reset|complete)/i, 'click-to-verify', 30],
  [/(verify|confirm|activate|validate)\s*(your|my|this|the)?\s*(email|account|address|identity)/i, 'verify-action', 25],
  [/follow\s*this\s*link/i, 'follow-link', 15],
  [/by\s*clicking\s*(the|this)?\s*(link|button|below)/i, 'by-clicking', 20],
  [/use\s*(the|this)?\s*(link|button)\s*(below|above)/i, 'use-link', 15],
  [/tap\s*(the|this)?\s*(button|link)/i, 'tap-button', 15],
  [/copy\s*(and\s*paste|this\s*link)/i, 'copy-paste-link', 10],
];

const URGENCY_PATTERNS: readonly RegExp[] = [
  /expires?\s*(in|after)\s*\d+\s*(min|hour|second|minute|day)/i,
  /valid\s*(for|until|only)\s*\d+/i,
  /within\s*\d+\s*(min|hour|day)/i,
  /link\s*(will|is)\s*(going\s*to\s*)?expire/i,
  /time[-\s]?sensitive/i,
  /act\s*(now|quickly|fast|immediately)/i,
  /don'?t\s*wait/i,
];

const SECURITY_PATTERNS: readonly RegExp[] = [
  /don'?t\s*share\s*(this|the)?\s*(link|code|url)/i,
  /keep\s*(this)?\s*(link|code)?\s*secret/i,
  /for\s*(your)?\s*security/i,
  /security\s*(reason|measure|purpose)/i,
  /protect\s*(your|the)?\s*account/i,
  /someone\s*(requested|is\s*trying)/i,
  /if\s*(this\s*)?(wasn'?t|was\s*not)\s*you/i,
];

const DISCLAIMER_PATTERNS: readonly RegExp[] = [
  /if\s*you\s*(didn'?t|did\s*not)\s*(request|create|sign|register|make)/i,
  /ignore\s*this\s*email/i,
  /you\s*can\s*safely\s*ignore/i,
  /no\s*(further)?\s*action\s*(is\s*)?(required|needed)/i,
  /if\s*you\s*(don'?t|do\s*not)\s*recogni[sz]e/i,
  /wasn'?t\s*you/i,
];

function analyzeSemanticContextFromText(contextText: string): SemanticContext {
  const lowerContext = contextText.toLowerCase();

  let verificationRelevance = 0;
  let requestedAction: string | null = null;
  let hasUrgency = false;
  let hasSecurityContext = false;
  let hasDisclaimerNearby = false;
  let instructionText: string | null = null;
  let sentiment: SemanticContext['sentiment'] = 'neutral';

  for (const [pattern, action, relevance] of ACTION_PATTERNS) {
    if (pattern.test(lowerContext)) {
      requestedAction = action;
      verificationRelevance += relevance;
      sentiment = 'action-request';
    }
  }

  for (const pattern of URGENCY_PATTERNS) {
    if (pattern.test(lowerContext)) {
      hasUrgency = true;
      verificationRelevance += 10;
      break;
    }
  }

  for (const pattern of SECURITY_PATTERNS) {
    if (pattern.test(lowerContext)) {
      hasSecurityContext = true;
      verificationRelevance += 8;
      break;
    }
  }

  for (const pattern of DISCLAIMER_PATTERNS) {
    if (pattern.test(lowerContext)) {
      hasDisclaimerNearby = true;
      verificationRelevance += 12;
      break;
    }
  }

  // Extract instruction sentence
  const sentences = contextText
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  for (const sentence of sentences) {
    if (/click|tap|press|follow|use|copy/i.test(sentence) && /link|button|below|above|url/i.test(sentence)) {
      instructionText = sentence.slice(0, MAX_INSTRUCTION_TEXT_LENGTH);
      break;
    }
    if (/verify|confirm|activate|validate|reset/i.test(sentence) && /email|account|password/i.test(sentence)) {
      instructionText = sentence.slice(0, MAX_INSTRUCTION_TEXT_LENGTH);
    }
  }

  if (/suspicious|unauthorized|compromised|breach|hack/i.test(lowerContext)) {
    sentiment = 'warning';
    verificationRelevance += 5;
  }

  return {
    verificationRelevance,
    requestedAction,
    hasUrgency,
    hasSecurityContext,
    hasDisclaimerNearby,
    instructionText,
    sentiment,
  };
}

// ═══════════════════════════════════════════════════════════════
//  §6  LAYERS 5-6: LINK-TEXT RELATIONSHIP & CTA DETECTION
// ═══════════════════════════════════════════════════════════════

// NOTE: In regex-only mode (no DOM), these return default values.
// Full functionality requires DOM parsing which is handled in
// the offscreen document pipeline.

function defaultLinkTextRelationship(): LinkTextRelationship {
  return {
    associatedInstruction: null,
    instructionDistance: Infinity,
    isDirectlyFollowingInstruction: false,
    parentHeading: null,
    relationshipBonus: 0,
  };
}

function analyzeVisualWeightFromHtml(outerHTML: string): VisualWeightResult {
  let weight = 0;
  const signals: string[] = [];

  // Extract style attribute
  const styleMatch = outerHTML.match(/style=["']([^"']*)["']/i);
  const style = styleMatch?.[1] ?? '';

  // Extract class attribute
  const classMatch = outerHTML.match(/class=["']([^"']*)["']/i);
  const className = (classMatch?.[1] ?? '').toLowerCase();

  // Extract role attribute
  const roleMatch = outerHTML.match(/role=["']([^"']*)["']/i);
  const role = roleMatch?.[1] ?? '';

  // Background color
  const bgMatch = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
  if (bgMatch) {
    const bg = bgMatch[1].trim().toLowerCase();
    const transparentValues = new Set([
      'transparent', 'none', 'inherit', 'initial', 'unset',
      '#ffffff', '#fff', 'white', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)',
    ]);
    if (!transparentValues.has(bg)) {
      weight += 20;
      signals.push('has-background-color');
    }
  }

  // Padding
  const paddingMatch = style.match(/padding\s*:\s*(\d+)/i);
  if (paddingMatch && parseInt(paddingMatch[1], 10) >= 8) {
    weight += 10;
    signals.push('has-padding');
  }

  if (/border-radius\s*:\s*\d+/i.test(style)) { weight += 8; signals.push('has-border-radius'); }
  if (/display\s*:\s*(inline-)?block/i.test(style)) { weight += 5; signals.push('display-block'); }
  if (/text-align\s*:\s*center/i.test(style)) { weight += 5; signals.push('text-center'); }
  if (/font-weight\s*:\s*(bold|700|800|900)/i.test(style)) { weight += 5; signals.push('font-bold'); }

  const fontSizeMatch = style.match(/font-size\s*:\s*(\d+)/i);
  if (fontSizeMatch && parseInt(fontSizeMatch[1], 10) >= 16) { weight += 8; signals.push('large-font'); }

  if (/width\s*:\s*\d+|min-width/i.test(style)) { weight += 5; signals.push('has-width'); }

  // Class-based signals
  if (/btn|button/i.test(className)) { weight += 15; signals.push('button-class'); }
  if (/cta|call[-_]?to[-_]?action/i.test(className)) { weight += 15; signals.push('cta-class'); }
  if (/primary|main|hero/i.test(className)) { weight += 10; signals.push('primary-class'); }
  if (/action/i.test(className)) { weight += 8; signals.push('action-class'); }
  if (role === 'button') { weight += 12; signals.push('role-button'); }

  // Inner table button pattern (common in email HTML)
  if (/<table[^>]*style=["'][^"']*background/i.test(outerHTML)) {
    weight += 18;
    signals.push('inner-table-button');
  }

  return { visualWeight: weight, isPrimaryCTA: weight >= 25, ctaSignals: signals };
}

// ═══════════════════════════════════════════════════════════════
//  §7  LAYER 7-8: URL INTELLIGENCE & NEGATIVE SIGNALS
// ═══════════════════════════════════════════════════════════════

const URL_SIGNALS: readonly UrlSignalDef[] = [
  // Tier 1: Path-based (strongest)
  { pattern: /\/verify[-_]?email/i, score: 50, type: 'email-verification', name: 'url:verify-email-path', layer: 'url-intelligence' },
  { pattern: /\/email[-_]?verification/i, score: 50, type: 'email-verification', name: 'url:email-verification-path', layer: 'url-intelligence' },
  { pattern: /\/confirm[-_]?email/i, score: 50, type: 'email-verification', name: 'url:confirm-email-path', layer: 'url-intelligence' },
  { pattern: /\/confirm[-_]?account/i, score: 45, type: 'account-confirmation', name: 'url:confirm-account-path', layer: 'url-intelligence' },
  { pattern: /\/activate[-_]?account/i, score: 45, type: 'account-confirmation', name: 'url:activate-account-path', layer: 'url-intelligence' },
  { pattern: /\/magic[-_]?link/i, score: 50, type: 'magic-link', name: 'url:magic-link-path', layer: 'url-intelligence' },
  { pattern: /\/passwordless/i, score: 45, type: 'magic-link', name: 'url:passwordless-path', layer: 'url-intelligence' },
  { pattern: /\/password[-_]?reset/i, score: 45, type: 'password-reset', name: 'url:password-reset-path', layer: 'url-intelligence' },
  { pattern: /\/reset[-_]?password/i, score: 45, type: 'password-reset', name: 'url:reset-password-path', layer: 'url-intelligence' },
  { pattern: /\/self[-_]?service\/verification/i, score: 50, type: 'email-verification', name: 'url:ory-kratos-path', layer: 'url-intelligence' },
  { pattern: /\/__\/auth\/action\?mode=verifyEmail/i, score: 50, type: 'email-verification', name: 'url:firebase-verify', layer: 'url-intelligence' },
  { pattern: /\/confirmUser/i, score: 45, type: 'email-verification', name: 'url:confirm-user-path', layer: 'url-intelligence' },
  { pattern: /\/confirm[-_]?signup/i, score: 45, type: 'account-confirmation', name: 'url:confirm-signup-path', layer: 'url-intelligence' },

  // Tier 2: Generic path keywords
  { pattern: /\/verify\b/i, score: 30, type: 'email-verification', name: 'url:verify-path', layer: 'url-intelligence' },
  { pattern: /\/verification\b/i, score: 30, type: 'email-verification', name: 'url:verification-path', layer: 'url-intelligence' },
  { pattern: /\/confirm\b/i, score: 28, type: 'account-confirmation', name: 'url:confirm-path', layer: 'url-intelligence' },
  { pattern: /\/activate\b/i, score: 28, type: 'account-confirmation', name: 'url:activate-path', layer: 'url-intelligence' },
  { pattern: /\/validate\b/i, score: 25, type: 'email-verification', name: 'url:validate-path', layer: 'url-intelligence' },
  { pattern: /\/sign[-_]?in[-_]?token/i, score: 35, type: 'magic-link', name: 'url:sign-in-token', layer: 'url-intelligence' },
  { pattern: /\/login[-_]?token/i, score: 35, type: 'magic-link', name: 'url:login-token', layer: 'url-intelligence' },
  { pattern: /\/auto[-_]?login/i, score: 30, type: 'magic-link', name: 'url:auto-login', layer: 'url-intelligence' },
  { pattern: /\/auth\/action/i, score: 25, type: null, name: 'url:auth-action', layer: 'url-intelligence' },
  { pattern: /\/loginwithemail/i, score: 35, type: 'magic-link', name: 'url:login-with-email', layer: 'url-intelligence' },
  { pattern: /\/authorize[-_]?device/i, score: 35, type: 'device-authorization', name: 'url:authorize-device', layer: 'url-intelligence' },

  // Tier 3: Query parameter signals
  { pattern: /[?&]mode=verifyEmail/i, score: 40, type: 'email-verification', name: 'url:mode-verify-email', layer: 'url-intelligence' },
  { pattern: /[?&]type=email_verification/i, score: 40, type: 'email-verification', name: 'url:type-email-verification', layer: 'url-intelligence' },
  { pattern: /[?&]type=signup/i, score: 35, type: 'account-confirmation', name: 'url:type-signup', layer: 'url-intelligence' },
  { pattern: /[?&]type=recovery/i, score: 35, type: 'password-reset', name: 'url:type-recovery', layer: 'url-intelligence' },
  { pattern: /[?&]action=verify/i, score: 35, type: 'email-verification', name: 'url:action-verify', layer: 'url-intelligence' },
  { pattern: /[?&]verification[-_]?code=/i, score: 30, type: null, name: 'url:has-verification-code', layer: 'url-intelligence' },
  { pattern: /[?&]otp=/i, score: 30, type: null, name: 'url:has-otp-param', layer: 'url-intelligence' },
  { pattern: /[?&]code=[A-Za-z0-9]{4,10}(&|$)/i, score: 22, type: null, name: 'url:has-code-param', layer: 'url-intelligence' },
  { pattern: /[?&]token=[A-Za-z0-9_-]{10,}/i, score: 18, type: null, name: 'url:has-long-token', layer: 'url-intelligence' },
  { pattern: /[?&]oobCode=/i, score: 25, type: null, name: 'url:has-oob-code', layer: 'url-intelligence' },
  { pattern: /[?&]confirmation_token=/i, score: 25, type: null, name: 'url:has-confirmation-token', layer: 'url-intelligence' },
  { pattern: /[?&]activationToken=/i, score: 25, type: null, name: 'url:has-activation-token', layer: 'url-intelligence' },
  { pattern: /[?&]hash=[A-Za-z0-9_-]{10,}/i, score: 15, type: null, name: 'url:has-hash', layer: 'url-intelligence' },
  { pattern: /[?&]nonce=/i, score: 15, type: null, name: 'url:has-nonce', layer: 'url-intelligence' },
  { pattern: /[?&]ticket=/i, score: 15, type: null, name: 'url:has-ticket', layer: 'url-intelligence' },
  { pattern: /[?&]key=[A-Za-z0-9_-]{10,}/i, score: 15, type: null, name: 'url:has-key', layer: 'url-intelligence' },
  { pattern: /[?&]flow=/i, score: 8, type: null, name: 'url:has-flow', layer: 'url-intelligence' },

  // Tier 4: Domain/path structure
  { pattern: /\/auth\//i, score: 10, type: null, name: 'url:auth-path-segment', layer: 'url-intelligence' },
  { pattern: /\/api\/v\d/i, score: 5, type: null, name: 'url:api-versioned', layer: 'url-intelligence' },
  { pattern: /\/callback/i, score: 5, type: null, name: 'url:callback', layer: 'url-intelligence' },
  { pattern: /\/emails?\//i, score: 8, type: null, name: 'url:emails-path', layer: 'url-intelligence' },
];

const URL_NEGATIVE_SIGNALS: readonly NegativeSignalDef[] = [
  // Absolute eliminators
  { pattern: /unsubscribe/i, score: -90, name: 'url:unsubscribe', layer: 'negative-intelligence' },
  { pattern: /opt[-_]?out/i, score: -90, name: 'url:opt-out', layer: 'negative-intelligence' },
  { pattern: /manage[-_]?preference/i, score: -80, name: 'url:manage-preferences', layer: 'negative-intelligence' },
  { pattern: /email[-_]?preference/i, score: -80, name: 'url:email-preferences', layer: 'negative-intelligence' },
  { pattern: /notification[-_]?setting/i, score: -70, name: 'url:notification-settings', layer: 'negative-intelligence' },
  { pattern: /list[-_]?unsubscribe/i, score: -90, name: 'url:list-unsubscribe', layer: 'negative-intelligence' },
  { pattern: /communication[-_]?preference/i, score: -75, name: 'url:comm-preferences', layer: 'negative-intelligence' },

  // Social domains
  { pattern: /^https?:\/\/(www\.)?(twitter|x)\.com/i, score: -80, name: 'url:twitter-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?facebook\.com/i, score: -80, name: 'url:facebook-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?linkedin\.com/i, score: -80, name: 'url:linkedin-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?instagram\.com/i, score: -80, name: 'url:instagram-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?youtube\.com/i, score: -80, name: 'url:youtube-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?tiktok\.com/i, score: -80, name: 'url:tiktok-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/(www\.)?reddit\.com/i, score: -70, name: 'url:reddit-domain', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/discord\.gg/i, score: -60, name: 'url:discord-invite', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/t\.me\//i, score: -60, name: 'url:telegram', layer: 'negative-intelligence' },

  // Legal/Footer
  { pattern: /\/privacy[-_]?policy/i, score: -70, name: 'url:privacy-policy', layer: 'negative-intelligence' },
  { pattern: /\/terms[-_]?(of[-_]?(service|use)|and[-_]?conditions)/i, score: -70, name: 'url:terms', layer: 'negative-intelligence' },
  { pattern: /\/legal\b/i, score: -55, name: 'url:legal', layer: 'negative-intelligence' },
  { pattern: /\/cookie[-_]?policy/i, score: -55, name: 'url:cookie-policy', layer: 'negative-intelligence' },
  { pattern: /\/gdpr/i, score: -55, name: 'url:gdpr', layer: 'negative-intelligence' },
  { pattern: /\/imprint/i, score: -50, name: 'url:imprint', layer: 'negative-intelligence' },
  { pattern: /\/about\b/i, score: -40, name: 'url:about', layer: 'negative-intelligence' },
  { pattern: /\/contact\b/i, score: -40, name: 'url:contact', layer: 'negative-intelligence' },
  { pattern: /\/faq\b/i, score: -40, name: 'url:faq', layer: 'negative-intelligence' },
  { pattern: /\/help\b/i, score: -40, name: 'url:help', layer: 'negative-intelligence' },
  { pattern: /\/support\b/i, score: -40, name: 'url:support', layer: 'negative-intelligence' },
  { pattern: /\/blog\b/i, score: -40, name: 'url:blog', layer: 'negative-intelligence' },
  { pattern: /\/careers?\b/i, score: -40, name: 'url:careers', layer: 'negative-intelligence' },

  // App stores
  { pattern: /play\.google\.com/i, score: -65, name: 'url:play-store', layer: 'negative-intelligence' },
  { pattern: /apps\.apple\.com|itunes\.apple\.com/i, score: -65, name: 'url:app-store', layer: 'negative-intelligence' },
  { pattern: /microsoft\.com\/.*store/i, score: -55, name: 'url:ms-store', layer: 'negative-intelligence' },

  // Tracking/Pixels
  { pattern: /\.(gif|png|jpg|jpeg|svg|webp|ico|bmp)(\?|$)/i, score: -70, name: 'url:image-file', layer: 'negative-intelligence' },
  { pattern: /\/open\./i, score: -60, name: 'url:open-tracking', layer: 'negative-intelligence' },
  { pattern: /\/beacon/i, score: -60, name: 'url:beacon', layer: 'negative-intelligence' },
  { pattern: /\/pixel/i, score: -60, name: 'url:pixel', layer: 'negative-intelligence' },
  { pattern: /\/track\b/i, score: -30, name: 'url:track', layer: 'negative-intelligence' },
  { pattern: /width=1|height=1/i, score: -60, name: 'url:1x1-pixel', layer: 'negative-intelligence' },

  // Documents
  { pattern: /\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx)(\?|$)/i, score: -50, name: 'url:document-file', layer: 'negative-intelligence' },

  // Root/Homepage
  { pattern: /^https?:\/\/[^/?#]+\/?$/i, score: -35, name: 'url:homepage-root', layer: 'negative-intelligence' },
  { pattern: /^https?:\/\/[^/?#]+\/?#?$/i, score: -35, name: 'url:homepage-hash', layer: 'negative-intelligence' },

  // E-commerce
  { pattern: /\/shop\b/i, score: -40, name: 'url:shop', layer: 'negative-intelligence' },
  { pattern: /\/cart\b/i, score: -40, name: 'url:cart', layer: 'negative-intelligence' },
  { pattern: /\/product/i, score: -35, name: 'url:product', layer: 'negative-intelligence' },
  { pattern: /\/order/i, score: -30, name: 'url:order', layer: 'negative-intelligence' },
  { pattern: /\/invoice/i, score: -30, name: 'url:invoice', layer: 'negative-intelligence' },

  // View in browser
  { pattern: /view[-_]?(in|as)[-_]?(browser|web|html|page)/i, score: -40, name: 'url:view-in-browser', layer: 'negative-intelligence' },
  { pattern: /\/webversion/i, score: -40, name: 'url:webversion', layer: 'negative-intelligence' },
];

const ANCHOR_TEXT_SIGNALS: readonly UrlSignalDef[] = [
  // Tier 1: Exact match button text
  { pattern: /^verify\s*(my|your|this|the)?\s*(email|e-?mail)\s*(address)?$/i, score: 50, type: 'email-verification', name: 'text:verify-email-exact', layer: 'text-intelligence' },
  { pattern: /^confirm\s*(my|your|this|the)?\s*(email|e-?mail)\s*(address)?$/i, score: 50, type: 'email-verification', name: 'text:confirm-email-exact', layer: 'text-intelligence' },
  { pattern: /^verify\s*(my|your|this)?\s*account$/i, score: 45, type: 'account-confirmation', name: 'text:verify-account-exact', layer: 'text-intelligence' },
  { pattern: /^confirm\s*(my|your|this)?\s*account$/i, score: 45, type: 'account-confirmation', name: 'text:confirm-account-exact', layer: 'text-intelligence' },
  { pattern: /^activate\s*(my|your|this)?\s*account$/i, score: 45, type: 'account-confirmation', name: 'text:activate-account-exact', layer: 'text-intelligence' },
  { pattern: /^reset\s*(my|your|this)?\s*password$/i, score: 45, type: 'password-reset', name: 'text:reset-password-exact', layer: 'text-intelligence' },
  { pattern: /^sign\s*in\s*to\s+.+$/i, score: 40, type: 'magic-link', name: 'text:sign-in-to-exact', layer: 'text-intelligence' },
  { pattern: /^log\s*in\s*to\s+.+$/i, score: 40, type: 'magic-link', name: 'text:log-in-to-exact', layer: 'text-intelligence' },
  { pattern: /^verify$/i, score: 30, type: null, name: 'text:verify-alone', layer: 'text-intelligence' },
  { pattern: /^confirm$/i, score: 30, type: null, name: 'text:confirm-alone', layer: 'text-intelligence' },
  { pattern: /^activate$/i, score: 30, type: null, name: 'text:activate-alone', layer: 'text-intelligence' },

  // Tier 2: Phrase match
  { pattern: /verify\s*(my|your|this|the)?\s*(email|account|identity|address)/i, score: 40, type: 'email-verification', name: 'text:verify-phrase', layer: 'text-intelligence' },
  { pattern: /confirm\s*(my|your|this|the)?\s*(email|account|registration|sign\s*up|address)/i, score: 40, type: 'account-confirmation', name: 'text:confirm-phrase', layer: 'text-intelligence' },
  { pattern: /activate\s*(my|your|this)?\s*(account|email|profile)/i, score: 35, type: 'account-confirmation', name: 'text:activate-phrase', layer: 'text-intelligence' },
  { pattern: /validate\s*(my|your|this)?\s*(email|account|address)/i, score: 35, type: 'email-verification', name: 'text:validate-phrase', layer: 'text-intelligence' },
  { pattern: /complete\s*(my|your)?\s*(registration|verification|sign\s*up|setup)/i, score: 30, type: 'account-confirmation', name: 'text:complete-phrase', layer: 'text-intelligence' },
  { pattern: /magic\s*link/i, score: 40, type: 'magic-link', name: 'text:magic-link', layer: 'text-intelligence' },
  { pattern: /sign\s*in\s*(with|using)?\s*(this|a|one)?\s*(link|click)/i, score: 35, type: 'magic-link', name: 'text:sign-in-link', layer: 'text-intelligence' },
  { pattern: /reset\s*(my|your)?\s*password/i, score: 35, type: 'password-reset', name: 'text:reset-password', layer: 'text-intelligence' },
  { pattern: /click\s*(here|this|below)\s*to\s*(verify|confirm|activate|validate|reset|complete)/i, score: 30, type: null, name: 'text:click-to-action', layer: 'text-intelligence' },
  { pattern: /yes,?\s*(this|that'?s)\s*(is|was)?\s*me/i, score: 35, type: 'device-authorization', name: 'text:yes-its-me', layer: 'text-intelligence' },
  { pattern: /authorize\s*(this)?\s*(device|login|browser)/i, score: 30, type: 'device-authorization', name: 'text:authorize-device', layer: 'text-intelligence' },
  { pattern: /accept\s*(this)?\s*invit/i, score: 30, type: 'invite-acceptance', name: 'text:accept-invite', layer: 'text-intelligence' },
  { pattern: /join\s*(the|this|my|our)?\s*(team|workspace|org)/i, score: 25, type: 'invite-acceptance', name: 'text:join-team', layer: 'text-intelligence' },
  { pattern: /get\s*started/i, score: 10, type: null, name: 'text:get-started', layer: 'text-intelligence' },
  { pattern: /^continue$/i, score: 5, type: null, name: 'text:continue', layer: 'text-intelligence' },

  // Negative text
  { pattern: /^unsubscribe$/i, score: -90, type: null, name: 'text:unsubscribe', layer: 'text-intelligence' },
  { pattern: /unsubscribe\s*(from|here)/i, score: -90, type: null, name: 'text:unsubscribe-from', layer: 'text-intelligence' },
  { pattern: /opt\s*out/i, score: -80, type: null, name: 'text:opt-out', layer: 'text-intelligence' },
  { pattern: /manage\s*(email\s*)?(preferences|settings)/i, score: -70, type: null, name: 'text:manage-prefs', layer: 'text-intelligence' },
  { pattern: /privacy\s*policy/i, score: -70, type: null, name: 'text:privacy-policy', layer: 'text-intelligence' },
  { pattern: /terms\s*(of\s*)?(service|use)/i, score: -70, type: null, name: 'text:terms', layer: 'text-intelligence' },
  { pattern: /cookie\s*policy/i, score: -55, type: null, name: 'text:cookie-policy', layer: 'text-intelligence' },
  { pattern: /contact\s*us/i, score: -45, type: null, name: 'text:contact-us', layer: 'text-intelligence' },
  { pattern: /help\s*(center|centre)/i, score: -45, type: null, name: 'text:help-center', layer: 'text-intelligence' },
  { pattern: /learn\s*more/i, score: -35, type: null, name: 'text:learn-more', layer: 'text-intelligence' },
  { pattern: /read\s*more/i, score: -35, type: null, name: 'text:read-more', layer: 'text-intelligence' },
  { pattern: /view\s*(in\s*)?(browser|web)/i, score: -40, type: null, name: 'text:view-browser', layer: 'text-intelligence' },
  { pattern: /download\s*(the\s*)?(app|mobile)/i, score: -50, type: null, name: 'text:download-app', layer: 'text-intelligence' },
  { pattern: /follow\s*us/i, score: -60, type: null, name: 'text:follow-us', layer: 'text-intelligence' },
  { pattern: /^(home|blog|about|faq|pricing|features|docs|documentation)$/i, score: -55, type: null, name: 'text:nav-link', layer: 'text-intelligence' },
  { pattern: /^(twitter|facebook|linkedin|instagram|youtube|github|discord)$/i, score: -80, type: null, name: 'text:social-name', layer: 'text-intelligence' },
  { pattern: /report\s*(this|spam|abuse|suspicious)/i, score: -30, type: null, name: 'text:report', layer: 'text-intelligence' },
  { pattern: /^©|^copyright/i, score: -60, type: null, name: 'text:copyright', layer: 'text-intelligence' },
  { pattern: /no\s*longer\s*wish/i, score: -70, type: null, name: 'text:no-longer-wish', layer: 'text-intelligence' },
  { pattern: /trouble\s*(viewing|clicking|seeing)/i, score: -25, type: null, name: 'text:trouble-viewing', layer: 'text-intelligence' },
  { pattern: /view\s*(this\s*)?email\s*(online|in)/i, score: -35, type: null, name: 'text:view-email-online', layer: 'text-intelligence' },
  { pattern: /sent\s*(by|from|to)\s/i, score: -30, type: null, name: 'text:sent-by', layer: 'text-intelligence' },
  { pattern: /all\s*rights\s*reserved/i, score: -50, type: null, name: 'text:all-rights', layer: 'text-intelligence' },
  { pattern: /\d{3,5}\s*([\w\s]+,\s*){1,2}\w{2}\s*\d{5}/i, score: -40, type: null, name: 'text:address-pattern', layer: 'text-intelligence' },
];

function analyzeUrl(url: string): UrlIntelligence {
  let urlScore = 0;
  let detectedType: LinkType | null = null;
  const signals: ScoringSignal[] = [];
  const negativeSignals: ScoringSignal[] = [];

  for (const signal of URL_SIGNALS) {
    if (signal.pattern.test(url)) {
      urlScore += signal.score;
      if (signal.type && !detectedType) {detectedType = signal.type;}
      signals.push({ name: signal.name, points: signal.score, layer: signal.layer, detail: `URL matched: ${signal.pattern.source}` });
    }
  }

  for (const signal of URL_NEGATIVE_SIGNALS) {
    if (signal.pattern.test(url)) {
      urlScore += signal.score;
      negativeSignals.push({ name: signal.name, points: signal.score, layer: signal.layer, detail: `URL negative: ${signal.pattern.source}` });
    }
  }

  const embeddedCode = extractEmbeddedCode(url);

  const isTrackingWrapper =
    /click\.|track\.|redirect\.|go\.|link\.|t\./i.test(url) &&
    !/verify|confirm|activate|magic|auth|login|password/i.test(url);

  const urlObj = safeNewUrl(url);
  const pathDepth = urlObj ? urlObj.pathname.split('/').filter((s) => s.length > 0).length : 0;
  const paramCount = urlObj ? Array.from(urlObj.searchParams).length : 0;

  return { urlScore, detectedType, signals, negativeSignals, embeddedCode, isTrackingWrapper, pathDepth, paramCount };
}

// ═══════════════════════════════════════════════════════════════
//  §8  LAYER 11: EMBEDDED CODE EXTRACTOR
// ═══════════════════════════════════════════════════════════════

const CODE_PRIORITY_PARAMS: readonly string[] = [
  'verification_code', 'verification-code', 'verificationCode',
  'confirmation_code', 'confirmation-code',
  'otp', 'code', 'pin', 'one_time_code', 'one-time-code', 'oneTimeCode',
];

function extractEmbeddedCode(url: string): EmbeddedCode | null {
  const urlObj = safeNewUrl(url);

  if (urlObj) {
    // Check priority params first
    for (const param of CODE_PRIORITY_PARAMS) {
      const value = urlObj.searchParams.get(param);
      if (value && value.length >= MIN_CODE_LENGTH && value.length <= MAX_CODE_LENGTH && /^[A-Za-z0-9]+$/.test(value)) {
        return { code: value, param };
      }
    }
    // Check any param matching code/otp/pin
    for (const [key, value] of urlObj.searchParams) {
      if (/code|otp|pin/i.test(key) && value.length >= MIN_CODE_LENGTH && value.length <= MAX_CODE_LENGTH && /^[A-Za-z0-9]+$/.test(value)) {
        return { code: value, param: key };
      }
    }
  } else {
    // Regex fallback for invalid URLs
    const match = url.match(/[?&](verification[-_]?code|confirmation[-_]?code|otp|code|pin)=([A-Za-z0-9]{4,10})(?:&|$)/i);
    if (match && match[1] && match[2]) {
      return { code: match[2], param: match[1] };
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
//  §9  LAYERS 9-10: REASONING & CALIBRATION
// ═══════════════════════════════════════════════════════════════

const VERIFICATION_INTENTS: ReadonlySet<EmailIntent> = new Set([
  'verification', 'magic-link-login', 'password-reset',
  'device-confirmation', 'invitation', 'two-factor',
]);

const ANTI_INTENTS: ReadonlySet<EmailIntent> = new Set([
  'marketing', 'newsletter', 'social-notification', 'transactional',
]);

const POSITIVE_SECTIONS: ReadonlySet<EmailSection> = new Set([
  'primary-content', 'cta-zone', 'hero',
]);

const NEGATIVE_SECTIONS: ReadonlySet<EmailSection> = new Set([
  'footer', 'legal', 'social-bar', 'unsubscribe-zone',
]);

const SECTION_SCORES: Readonly<Partial<Record<EmailSection, number>>> = {
  preheader: -10, header: -15, hero: 10, 'primary-content': 10,
  'cta-zone': 15, 'secondary-content': 0, footer: -25, legal: -30,
  'social-bar': -35, 'unsubscribe-zone': -40, unknown: 0,
};

function buildReasoningChain(
  urlIntel: UrlIntelligence,
  semantics: SemanticContext,
  visualWeight: number,
  section: EmailSection,
  emailIntent: EmailIntent,
  provider: ProviderMatch | null,
  relationship: LinkTextRelationship,
  totalScore: number
): ReasoningChain {
  const steps: ReasoningStep[] = [];

  if (VERIFICATION_INTENTS.has(emailIntent)) {
    steps.push({ layer: 'Email Intent', observation: `Email classified as "${emailIntent}" intent`, conclusion: 'This email is asking the user to take a verification-type action', impact: 'strong-positive' });
  } else if (ANTI_INTENTS.has(emailIntent)) {
    steps.push({ layer: 'Email Intent', observation: `Email classified as "${emailIntent}" intent`, conclusion: 'This email is NOT a verification email', impact: 'strong-negative' });
  }

  if (provider) {
    steps.push({ layer: 'Provider Knowledge', observation: `Recognized provider: ${provider.name} (${provider.category})`, conclusion: `URL matches known ${provider.name} verification pattern`, impact: 'strong-positive' });
  }

  if (urlIntel.urlScore > 30) {
    steps.push({ layer: 'URL Intelligence', observation: `URL scored ${urlIntel.urlScore} with ${urlIntel.signals.length} positive signals`, conclusion: `URL structure strongly indicates ${urlIntel.detectedType ?? 'verification'} link`, impact: 'strong-positive' });
  } else if (urlIntel.urlScore > 10) {
    steps.push({ layer: 'URL Intelligence', observation: `URL scored ${urlIntel.urlScore} (moderate)`, conclusion: 'URL has some verification indicators', impact: 'positive' });
  }

  if (urlIntel.embeddedCode) {
    steps.push({ layer: 'Code Extraction', observation: `Found embedded code "${urlIntel.embeddedCode.code}" in param "${urlIntel.embeddedCode.param}"`, conclusion: 'This URL carries an embedded verification code', impact: 'strong-positive' });
  }

  if (semantics.verificationRelevance > 20) {
    steps.push({ layer: 'Semantic Analysis', observation: `Surrounding text has verification relevance of ${semantics.verificationRelevance}`, conclusion: `Context strongly supports verification intent (${semantics.requestedAction ?? 'general'})`, impact: 'strong-positive' });
  }

  if (semantics.hasDisclaimerNearby) {
    steps.push({ layer: 'Semantic Analysis', observation: 'Found "if you didn\'t request this" disclaimer', conclusion: 'Strong indicator of legitimate verification email', impact: 'positive' });
  }

  if (semantics.hasUrgency) {
    steps.push({ layer: 'Semantic Analysis', observation: 'Detected expiration/urgency language', conclusion: 'Time-limited links are characteristic of verification flows', impact: 'positive' });
  }

  if (visualWeight >= 25) {
    steps.push({ layer: 'CTA Detection', observation: `Visual weight = ${visualWeight} (button styling detected)`, conclusion: 'This link is styled as the PRIMARY call-to-action', impact: 'positive' });
  }

  if (POSITIVE_SECTIONS.has(section)) {
    steps.push({ layer: 'Email Anatomy', observation: `Link is in the "${section}" section`, conclusion: 'Correct position for an activation link', impact: 'positive' });
  } else if (NEGATIVE_SECTIONS.has(section)) {
    steps.push({ layer: 'Email Anatomy', observation: `Link is in the "${section}" section`, conclusion: 'Very unlikely to be the activation link', impact: 'strong-negative' });
  }

  if (relationship.isDirectlyFollowingInstruction) {
    steps.push({ layer: 'Text Relationship', observation: `Link directly follows instruction: "${relationship.associatedInstruction?.slice(0, 80)}..."`, conclusion: 'Strong association between instruction and this link', impact: 'strong-positive' });
  }

  const positiveSteps = steps.filter((s) => s.impact.includes('positive')).length;
  const negativeSteps = steps.filter((s) => s.impact.includes('negative')).length;
  const layerCount = new Set(steps.map((s) => s.layer)).size;

  let summary: string;
  let confidenceExplanation: string;

  if (totalScore >= 60) {
    summary = `HIGH CONFIDENCE: ${positiveSteps} positive signals across ${layerCount} intelligence layers confirm this is an activation link.`;
    confidenceExplanation = 'Multiple independent intelligence layers agree this is the activation link.';
  } else if (totalScore >= 30) {
    summary = `MODERATE CONFIDENCE: ${positiveSteps} positive vs ${negativeSteps} negative signals.`;
    confidenceExplanation = 'Some evidence supports this being an activation link, but not all layers agree.';
  } else if (totalScore > 0) {
    summary = `LOW CONFIDENCE: Only ${positiveSteps} weak positive signals detected.`;
    confidenceExplanation = 'Insufficient evidence to confidently identify this as an activation link.';
  } else {
    summary = `REJECTED: ${negativeSteps} negative signals indicate this is NOT an activation link.`;
    confidenceExplanation = 'Negative signals outweigh any positive indicators.';
  }

  return { steps, summary, confidenceExplanation };
}

function calibrateConfidence(
  rawScore: number,
  emailIntent: EmailIntent,
  section: EmailSection,
  isPrimaryCTA: boolean,
  hasProvider: boolean,
  semanticRelevance: number
): number {
  let confidence = Math.min(rawScore / CONFIDENCE_DENOMINATOR, 1.0);

  if (VERIFICATION_INTENTS.has(emailIntent)) {
    confidence = Math.min(confidence * 1.15, 1.0);
  } else if (ANTI_INTENTS.has(emailIntent)) {
    confidence *= 0.3;
  }

  if (POSITIVE_SECTIONS.has(section)) {
    confidence = Math.min(confidence * 1.1, 1.0);
  } else if (NEGATIVE_SECTIONS.has(section)) {
    confidence *= 0.2;
  }

  if (isPrimaryCTA) {confidence = Math.min(confidence * 1.1, 1.0);}
  if (hasProvider) {confidence = Math.min(confidence * 1.15, 1.0);}
  if (semanticRelevance > 20) {confidence = Math.min(confidence * 1.1, 1.0);}

  return clampConfidence(confidence);
}

// ═══════════════════════════════════════════════════════════════
//  §10  HTML PARSER
// ═══════════════════════════════════════════════════════════════

const REJECTED_PROTOCOLS = /^(mailto:|tel:|#|javascript:|data:|sms:)/i;

function parseAnchorsFromHtml(emailHtml: string): ParsedAnchor[] {
  const anchors: ParsedAnchor[] = [];
  const anchorRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchorRegex.exec(emailHtml)) !== null) {
    const href = match[1] ?? '';
    const innerHTML = match[2] ?? '';
    const outerHTML = match[0];
    const textContent = innerHTML.replace(/<[^>]*>/g, '').trim();

    anchors.push({
      href,
      textContent,
      outerHTML,
      innerHTML,
      getAttribute(attr: string): string | null {
        if (attr === 'href') {return href;}
        const attrMatch = new RegExp(`${attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=["']([^"']*)["']`, 'i').exec(outerHTML);
        return attrMatch ? attrMatch[1] : null;
      },
    });
  }

  return anchors;
}

// ═══════════════════════════════════════════════════════════════
//  §11  POST-PROCESSOR
// ═══════════════════════════════════════════════════════════════

function postProcessCandidates(candidates: ActivationLink[]): void {
  if (candidates.length === 0) {return;}

  // Bonus for sole strong candidate
  const highScorers = candidates.filter((c) => c.score > HIGH_SCORE_THRESHOLD);
  if (highScorers.length === 1) {
    highScorers[0].score += SOLE_CANDIDATE_BONUS;
    highScorers[0].matchedSignals.push({
      name: 'post:sole-strong-candidate',
      points: SOLE_CANDIDATE_BONUS,
      layer: 'post-processor',
      detail: `Only one link scored above ${HIGH_SCORE_THRESHOLD}`,
    });
  }

  // Deduplicate URLs (keep higher-scoring variant)
  const urlMap = new Map<string, number>();
  const toRemove = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    const normalized = normalizeUrl(candidates[i].url);
    const existingIdx = urlMap.get(normalized);

    if (existingIdx !== undefined) {
      if (candidates[i].score > candidates[existingIdx].score) {
        candidates[i].score += DUPLICATE_URL_BONUS;
        toRemove.add(existingIdx);
      } else {
        candidates[existingIdx].score += DUPLICATE_URL_BONUS;
        toRemove.add(i);
      }
    } else {
      urlMap.set(normalized, i);
    }
  }

  // Remove duplicates in reverse order to preserve indices
  const removeIndices = Array.from(toRemove).sort((a, b) => b - a);
  for (const idx of removeIndices) {
    candidates.splice(idx, 1);
  }

  // Bonus for sole primary CTA
  const primaryCTAs = candidates.filter((c) => c.isPrimaryCTA);
  if (primaryCTAs.length === 1 && primaryCTAs[0].score > 20) {
    primaryCTAs[0].score += SINGLE_PRIMARY_CTA_BONUS;
  }

  // Recalibrate confidence
  for (const candidate of candidates) {
    candidate.confidence = clampConfidence(candidate.score / CONFIDENCE_DENOMINATOR);
  }
}

// ═══════════════════════════════════════════════════════════════
//  §12  MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function extractActivationLinks(
  emailHtml: string,
  senderEmail: string = ''
): LinkExtractionResult {
  const startTime = performance.now();
  const layersExecuted: string[] = ['html-parser-regex'];

  const bodyText = stripHtmlTags(emailHtml);

  // ── Layer 1: Intent classification ──
  const intentResult = classifyEmailIntent(bodyText);
  layersExecuted.push('intent-classifier');

  // ── Layer 2: Provider detection ──
  const emailProvider = detectEmailProvider(senderEmail, bodyText);
  layersExecuted.push('provider-knowledge');

  // ── Parse anchors ──
  const allAnchors = parseAnchorsFromHtml(emailHtml);
  const totalLinksFound = allAnchors.length;

  // ── Semantic context from full body text ──
  const bodySemantics = analyzeSemanticContextFromText(bodyText.slice(0, MAX_CONTEXT_TEXT_LENGTH * 3));
  layersExecuted.push('semantic-analyzer');

  const candidates: ActivationLink[] = [];
  const rejected: Array<{ url: string; reason: string; section: EmailSection }> = [];

  // ── Score each anchor ──
  for (const anchor of allAnchors) {
    const href = anchor.href;
    if (!href) { continue; }

    const url = decodeHtmlEntities(href.trim());

    // Protocol filter
    if (REJECTED_PROTOCOLS.test(url)) {
      rejected.push({ url: truncate(url, TRUNCATE_URL_LENGTH), reason: 'protocol-reject', section: 'unknown' });
      continue;
    }

    if (url.length < MIN_URL_LENGTH) {
      rejected.push({ url, reason: 'too-short', section: 'unknown' });
      continue;
    }

    const anchorText = getCleanAnchorText(anchor);
    const anchorTextLower = anchorText.toLowerCase().trim();

    // Empty text with no verification URL = skip
    if (anchorText.length === 0) {
      const hasVerifyUrl = URL_SIGNALS.some((s) => s.score >= 25 && s.pattern.test(url));
      if (!hasVerifyUrl) {
        rejected.push({ url: truncate(url, TRUNCATE_URL_LENGTH), reason: 'image-only-no-verify-url', section: 'unknown' });
        continue;
      }
    }

    // ── Layer 7: URL Intelligence ──
    const urlIntel = analyzeUrl(url);

    // ── Layer 2: Provider bonus ──
    const providerResult = getProviderBonus(url);

    // ── Layer 5: Anchor text signals ──
    let textScore = 0;
    const textSignals: ScoringSignal[] = [];
    const textNegSignals: ScoringSignal[] = [];
    let textDetectedType: LinkType | null = null;

    if (anchorTextLower.length > 0) {
      for (const signal of ANCHOR_TEXT_SIGNALS) {
        if (signal.pattern.test(anchorTextLower)) {
          textScore += signal.score;
          const target = signal.score > 0 ? textSignals : textNegSignals;
          if (signal.score > 0 && signal.type && !textDetectedType) {
            textDetectedType = signal.type;
          }
          target.push({
            name: signal.name,
            points: signal.score,
            layer: signal.layer,
            detail: `Anchor text: "${anchorTextLower.slice(0, 50)}"`,
          });
        }
      }
    }

    // ── Layer 6: Visual weight ──
    const visual = analyzeVisualWeightFromHtml(anchor.outerHTML);

    // ── Layer 5: Link-text relationship (limited in regex mode) ──
    const relationship = defaultLinkTextRelationship();

    // Use body-level semantics (best we can do without DOM)
    const semantics = bodySemantics;
    const section: EmailSection = 'unknown';

    // ── Composite scoring ──
    let totalScore = 0;
    const allPositiveSignals: ScoringSignal[] = [];
    const allNegativeSignals: ScoringSignal[] = [];

    totalScore += urlIntel.urlScore;
    allPositiveSignals.push(...urlIntel.signals);
    allNegativeSignals.push(...urlIntel.negativeSignals);

    totalScore += textScore;
    allPositiveSignals.push(...textSignals);
    allNegativeSignals.push(...textNegSignals);

    if (providerResult.bonus > 0) {
      totalScore += providerResult.bonus;
      allPositiveSignals.push({
        name: `provider:${providerResult.provider?.name}`,
        points: providerResult.bonus,
        layer: 'provider-knowledge',
        detail: `Recognized: ${providerResult.provider?.name}`,
      });
    }

    if (semantics.verificationRelevance > 0) {
      totalScore += semantics.verificationRelevance;
      allPositiveSignals.push({
        name: 'semantic:context-relevance',
        points: semantics.verificationRelevance,
        layer: 'semantic-analyzer',
        detail: `action="${semantics.requestedAction}" urgency=${semantics.hasUrgency} disclaimer=${semantics.hasDisclaimerNearby}`,
      });
    }

    if (relationship.relationshipBonus > 0) {
      totalScore += relationship.relationshipBonus;
      allPositiveSignals.push({
        name: 'relationship:instruction-proximity',
        points: relationship.relationshipBonus,
        layer: 'text-relationship',
        detail: `Instruction: "${relationship.associatedInstruction?.slice(0, 60) ?? 'none'}"`,
      });
    }

    if (visual.isPrimaryCTA) {
      totalScore += PRIMARY_CTA_SCORE;
      allPositiveSignals.push({
        name: 'visual:primary-cta',
        points: PRIMARY_CTA_SCORE,
        layer: 'cta-detector',
        detail: `CTA signals: ${visual.ctaSignals.join(', ')}`,
      });
    }

    if (urlIntel.embeddedCode) {
      totalScore += EMBEDDED_CODE_SCORE;
      allPositiveSignals.push({
        name: 'embedded-code:found',
        points: EMBEDDED_CODE_SCORE,
        layer: 'code-extraction',
        detail: `${urlIntel.embeddedCode.param}=${urlIntel.embeddedCode.code}`,
      });
    }

    // Section score
    const sectionScore = SECTION_SCORES[section] ?? 0;
    totalScore += sectionScore;
    if (sectionScore !== 0) {
      const target = sectionScore > 0 ? allPositiveSignals : allNegativeSignals;
      target.push({ name: `section:${section}`, points: sectionScore, layer: 'anatomy-engine', detail: `Link in "${section}" section` });
    }

    // Intent alignment
    if (VERIFICATION_INTENTS.has(intentResult.intent) && totalScore > 0) {
      const intentBonus = Math.round(totalScore * INTENT_ALIGNMENT_MULTIPLIER);
      totalScore += intentBonus;
      allPositiveSignals.push({
        name: `intent:${intentResult.intent}-alignment`,
        points: intentBonus,
        layer: 'intent-classifier',
        detail: `Email intent "${intentResult.intent}" correlates with verification link`,
      });
    }

    // Anti-intent penalty
    if (ANTI_INTENTS.has(intentResult.intent) && intentResult.confidence > ANTI_INTENT_CONFIDENCE_THRESHOLD) {
      const intentPenalty = -Math.round(Math.abs(totalScore) * ANTI_INTENT_PENALTY_MULTIPLIER);
      totalScore += intentPenalty;
      allNegativeSignals.push({
        name: `intent:${intentResult.intent}-penalty`,
        points: intentPenalty,
        layer: 'intent-classifier',
        detail: `Email intent "${intentResult.intent}" suggests NOT a verification email`,
      });
    }

    // Reject non-positive scores
    if (totalScore <= 0) {
      rejected.push({ url: truncate(url, TRUNCATE_URL_LENGTH), reason: `score=${totalScore}`, section });
      continue;
    }

    // Calibrate confidence
    const confidence = calibrateConfidence(
      totalScore,
      intentResult.intent,
      section,
      visual.isPrimaryCTA,
      Boolean(providerResult.provider),
      semantics.verificationRelevance
    );

    // Determine detected type
    const detectedType =
      urlIntel.detectedType ??
      textDetectedType ??
      (providerResult.provider
        ? PROVIDER_KNOWLEDGE_BASE.find((p) => p.name === providerResult.provider!.name)?.expectedLinkType ?? null
        : null) ??
      'unknown-verification';

    // Build reasoning
    const reasoning = buildReasoningChain(
      urlIntel, semantics, visual.visualWeight, section,
      intentResult.intent, providerResult.provider, relationship, totalScore
    );

    candidates.push({
      url,
      score: totalScore,
      confidence,
      type: detectedType,
      anchorText: anchorText.slice(0, MAX_ANCHOR_TEXT_LENGTH),
      hasEmbeddedCode: Boolean(urlIntel.embeddedCode),
      embeddedCode: urlIntel.embeddedCode?.code ?? null,
      embeddedCodeParam: urlIntel.embeddedCode?.param ?? null,
      section,
      isPrimaryCTA: visual.isPrimaryCTA,
      reasoning,
      matchedSignals: allPositiveSignals,
      negativeSignals: allNegativeSignals,
      providerMatch: providerResult.provider,
      surroundingContext: (semantics.instructionText ?? relationship.associatedInstruction) ?? '',
      visualWeight: visual.visualWeight,
    });
  }

  // Ensure layer tracking is complete
  if (!layersExecuted.includes('url-intelligence')) {layersExecuted.push('url-intelligence');}
  if (!layersExecuted.includes('text-intelligence')) {layersExecuted.push('text-intelligence');}
  if (!layersExecuted.includes('visual-weight')) {layersExecuted.push('visual-weight');}

  // Post-process and sort
  postProcessCandidates(candidates);
  layersExecuted.push('post-processor');
  candidates.sort((a, b) => b.score - a.score);

  // Compute email analysis metrics
  const verificationLanguageStrength = clampConfidence(
    ((intentResult.allIntentScores.get('verification') ?? 0) +
      (intentResult.allIntentScores.get('magic-link-login') ?? 0) +
      (intentResult.allIntentScores.get('password-reset') ?? 0)) / 100
  );

  const urgencyLevel = /expires?\s*in\s*\d+\s*(min|sec)/i.test(bodyText)
    ? 0.9
    : /expires?\s*in\s*\d+\s*(hour|day)/i.test(bodyText)
      ? 0.6
      : /expires?/i.test(bodyText)
        ? 0.3
        : 0;

  const extractionTimeMs = performance.now() - startTime;

  return {
    best: candidates.length > 0 ? candidates[0] : null,
    allCandidates: candidates,
    rejected,
    emailAnalysis: {
      intent: intentResult.intent,
      intentConfidence: intentResult.confidence,
      intentSignals: intentResult.signals,
      detectedProvider: emailProvider ?? candidates[0]?.providerMatch?.name ?? null,
      sectionMap: new Map(),
      totalLinks: totalLinksFound,
      verificationLanguageStrength,
      urgencyLevel,
      securityLanguagePresent: /don'?t\s*share|security|suspicious|unauthorized/i.test(bodyText),
    },
    meta: {
      totalLinksFound,
      candidatesFound: candidates.length,
      rejectedCount: rejected.length,
      extractionTimeMs,
      layersExecuted,
      dominantSignal: candidates[0]?.matchedSignals[0]?.name ?? 'none',
    },
  };
}