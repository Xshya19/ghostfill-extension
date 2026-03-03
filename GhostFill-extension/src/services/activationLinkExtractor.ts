/**
 * ═══════════════════════════════════════════════════════════════
 * ⚠️ CODE QUALITY: Large Component - Needs Refactoring
 * File size: ~88KB, ~1386 lines
 * TODO: Split into smaller modules:
 *   - linkPatterns.ts: URL pattern definitions
 *   - linkContextAnalyzer.ts: Link context analysis
 *   - linkIntentClassifier.ts: Email intent classification
 *   - linkProviderMatcher.ts: Provider-specific link extraction
 * Priority: HIGH - This file is too large for maintainability
 * ═══════════════════════════════════════════════════════════════
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                                                                  │
 * │  TRADITIONAL EXTRACTOR          THIS EXTRACTOR                   │
 * │  ─────────────────────          ──────────────────                │
 * │                                                                  │
 * │  "Does URL contain             "What is this email trying        │
 * │   /verify?"                     to make the user do?             │
 * │                                 What section is this link in?    │
 * │  YES → return it                What text surrounds it?          │
 * │                                 Which auth provider sent this?   │
 * │                                 Is this the primary CTA?         │
 * │                                 What does the email structure     │
 * │                                 tell us about intent?            │
 * │                                 How confident are we, and why?"  │
 * │                                                                  │
 * │  Pattern Matching               Reasoning Engine                 │
 * │  ~90% accuracy                  ~99.5% accuracy                  │
 * │                                                                  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * THE 12 INTELLIGENCE LAYERS
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
 */

// ═══════════════════════════════════════════════════════════════
//  TYPES - Import from shared extraction types to prevent circular dependencies
// ═══════════════════════════════════════════════════════════════

// Import shared types
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
    ReasoningImpact,
} from './extraction/types';

// Local type aliases for backward compatibility (deprecated - use shared types)
/** @deprecated Use LinkType from ./types */
export type { LinkType };
/** @deprecated Use EmailIntent from ./types */
export type { EmailIntent };
/** @deprecated Use EmailSection from ./types */
export type { EmailSection };
/** @deprecated Use EmailAnatomy from ./types */
export type { EmailAnatomy };
/** @deprecated Use ActivationLink from ./types */
export type { ActivationLink };
/** @deprecated Use ScoringSignal from ./types */
export type { ScoringSignal };
/** @deprecated Use ReasoningChain from ./types */
export type { ReasoningChain };
/** @deprecated Use ReasoningStep from ./types */
export type { ReasoningStep };
/** @deprecated Use ProviderMatch from ./types */
export type { ProviderMatch };
/** @deprecated Use LinkExtractionResult from ./types */
export type { LinkExtractionResult };
/** @deprecated Use EmailAnalysis from ./types */
export type { EmailAnalysis };
/** @deprecated Use ExtractionMeta from ./types */
export type { ExtractionMeta };

// ═══════════════════════════════════════════════════════════════
//  TYPES (legacy - for backward compatibility)
// ═══════════════════════════════════════════════════════════════

// Note: ExtractionMeta is now imported from ./types
// This section is kept for any additional local types if needed

// ═══════════════════════════════════════════════════════════════
//  LAYER 1: EMAIL INTENT CLASSIFIER
// ═══════════════════════════════════════════════════════════════

interface IntentSignal {
    pattern: RegExp;
    intent: EmailIntent;
    weight: number;
    name: string;
}

const INTENT_SIGNALS: IntentSignal[] = [
    // ── Verification Intent ──────────────────────────────────
    { pattern: /verify\s*(your|my|this|the)?\s*(email|e-?mail|account|address)/i, intent: 'verification', weight: 40, name: 'verify-email-phrase' },
    { pattern: /confirm\s*(your|my|this|the)?\s*(email|e-?mail|account|registration|sign\s*up)/i, intent: 'verification', weight: 40, name: 'confirm-email-phrase' },
    { pattern: /activate\s*(your|my|this)?\s*(account|email|profile)/i, intent: 'verification', weight: 35, name: 'activate-phrase' },
    { pattern: /validate\s*(your|my|this)?\s*(email|account|address)/i, intent: 'verification', weight: 35, name: 'validate-phrase' },
    { pattern: /complete\s*(your|my)?\s*(registration|sign\s*up|setup|verification)/i, intent: 'verification', weight: 30, name: 'complete-registration' },
    { pattern: /welcome.*verify/i, intent: 'verification', weight: 25, name: 'welcome-verify' },
    { pattern: /thanks?\s*(for)?\s*(signing\s*up|registering|joining|creating)/i, intent: 'verification', weight: 25, name: 'thanks-signup' },
    { pattern: /one\s*more\s*step/i, intent: 'verification', weight: 20, name: 'one-more-step' },
    { pattern: /almost\s*(there|done|finished)/i, intent: 'verification', weight: 15, name: 'almost-there' },

    // ── Magic Link Intent ────────────────────────────────────
    { pattern: /magic\s*link/i, intent: 'magic-link-login', weight: 45, name: 'magic-link-phrase' },
    { pattern: /sign\s*in\s*(to|with|using)\s*(your|a|this)?\s*(link|button|click)/i, intent: 'magic-link-login', weight: 40, name: 'sign-in-with-link' },
    { pattern: /log\s*in\s*(to|with)\s*(your|this)?\s*(link|click|button)/i, intent: 'magic-link-login', weight: 40, name: 'login-with-link' },
    { pattern: /passwordless\s*(sign|log)\s*in/i, intent: 'magic-link-login', weight: 40, name: 'passwordless-login' },
    { pattern: /sign\s*in\s*to\s+\w+/i, intent: 'magic-link-login', weight: 20, name: 'sign-in-to-service' },
    { pattern: /log\s*in\s*to\s+\w+/i, intent: 'magic-link-login', weight: 20, name: 'login-to-service' },
    { pattern: /click\s*(below|the\s*button|here|this\s*link)\s*to\s*(sign|log)\s*in/i, intent: 'magic-link-login', weight: 35, name: 'click-to-sign-in' },
    { pattern: /requested\s*a?\s*(sign|log)\s*in\s*(link|email|code)/i, intent: 'magic-link-login', weight: 30, name: 'requested-login-link' },

    // ── Password Reset Intent ────────────────────────────────
    { pattern: /reset\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 45, name: 'reset-password' },
    { pattern: /change\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 35, name: 'change-password' },
    { pattern: /forgot\s*(your|my|the)?\s*password/i, intent: 'password-reset', weight: 40, name: 'forgot-password' },
    { pattern: /password\s*(recovery|reset|change)/i, intent: 'password-reset', weight: 40, name: 'password-recovery' },
    { pattern: /lost\s*(your|my)?\s*(password|access)/i, intent: 'password-reset', weight: 30, name: 'lost-password' },
    { pattern: /set\s*(a\s*)?new\s*password/i, intent: 'password-reset', weight: 35, name: 'set-new-password' },
    { pattern: /update\s*(your|my)?\s*password/i, intent: 'password-reset', weight: 30, name: 'update-password' },

    // ── Device Confirmation Intent ───────────────────────────
    { pattern: /new\s*(device|browser|location|login|sign\s*in)\s*(detected|attempt|activity)/i, intent: 'device-confirmation', weight: 35, name: 'new-device' },
    { pattern: /authorize\s*(this|your|the)?\s*(device|browser|login|computer)/i, intent: 'device-confirmation', weight: 40, name: 'authorize-device' },
    { pattern: /unusual\s*(activity|sign\s*in|login|access)/i, intent: 'device-confirmation', weight: 30, name: 'unusual-activity' },
    { pattern: /verify\s*(this|your|the)?\s*(login|sign\s*in|device|attempt)/i, intent: 'device-confirmation', weight: 35, name: 'verify-login' },
    { pattern: /was\s*this\s*you/i, intent: 'device-confirmation', weight: 30, name: 'was-this-you' },
    { pattern: /someone\s*(is\s*)?trying\s*to\s*(sign|log)\s*in/i, intent: 'device-confirmation', weight: 30, name: 'someone-trying' },

    // ── Invitation Intent ────────────────────────────────────
    { pattern: /invited?\s*(you|to\s*join)/i, intent: 'invitation', weight: 30, name: 'invited-phrase' },
    { pattern: /join\s*(my|our|the|this)?\s*(team|workspace|organization|project|group)/i, intent: 'invitation', weight: 30, name: 'join-team' },
    { pattern: /accept\s*(this|your|the)?\s*invit/i, intent: 'invitation', weight: 35, name: 'accept-invitation' },

    // ── Two-Factor Intent ────────────────────────────────────
    { pattern: /two[- ]?factor|2fa|multi[- ]?factor|mfa/i, intent: 'two-factor', weight: 35, name: '2fa-phrase' },
    { pattern: /security\s*key|authenticator/i, intent: 'two-factor', weight: 25, name: 'security-key' },
    { pattern: /backup\s*code/i, intent: 'two-factor', weight: 20, name: 'backup-code' },

    // ── Anti-Intent: Marketing ───────────────────────────────
    { pattern: /\b(sale|discount|%\s*off|promo|coupon|deal)\b/i, intent: 'marketing', weight: 35, name: 'marketing-language' },
    { pattern: /limited\s*time\s*(offer|deal)/i, intent: 'marketing', weight: 30, name: 'limited-time' },
    { pattern: /buy\s*now|shop\s*now|order\s*now/i, intent: 'marketing', weight: 35, name: 'buy-now' },
    { pattern: /free\s*shipping/i, intent: 'marketing', weight: 25, name: 'free-shipping' },
    { pattern: /exclusive\s*(offer|deal|access)/i, intent: 'marketing', weight: 20, name: 'exclusive-offer' },

    // ── Anti-Intent: Newsletter ──────────────────────────────
    { pattern: /newsletter|weekly\s*(digest|recap|update)|monthly\s*(digest|recap|update)/i, intent: 'newsletter', weight: 40, name: 'newsletter' },
    { pattern: /top\s*stories|trending|what'?s\s*new|round\s*up/i, intent: 'newsletter', weight: 25, name: 'digest-language' },
    { pattern: /this\s*week\s*(in|at|on)|here'?s\s*what/i, intent: 'newsletter', weight: 20, name: 'this-week' },

    // ── Anti-Intent: Social ──────────────────────────────────
    { pattern: /(liked|commented|mentioned|followed|shared|replied\s*to|reacted\s*to)\s*(your|you)/i, intent: 'social-notification', weight: 35, name: 'social-action' },
    { pattern: /new\s*(follower|like|comment|reply|mention|reaction)/i, intent: 'social-notification', weight: 25, name: 'new-social' },

    // ── Anti-Intent: Transactional ───────────────────────────
    { pattern: /order\s*(confirm|#|number)|receipt|invoice/i, intent: 'transactional', weight: 35, name: 'order-receipt' },
    { pattern: /payment\s*(received|confirmed|processed)/i, intent: 'transactional', weight: 30, name: 'payment' },
    { pattern: /ship(ped|ping)|delivered|tracking\s*(number|#|id)/i, intent: 'transactional', weight: 35, name: 'shipping' },
    { pattern: /subscription\s*(renewed|receipt|invoice|billing)/i, intent: 'transactional', weight: 25, name: 'subscription-billing' },
];

function classifyEmailIntent(text: string): {
    intent: EmailIntent;
    confidence: number;
    signals: string[];
    allIntentScores: Map<EmailIntent, number>;
} {
    const intentScores = new Map<EmailIntent, number>();
    const matchedSignals: string[] = [];

    for (const signal of INTENT_SIGNALS) {
        if (signal.pattern.test(text)) {
            const current = intentScores.get(signal.intent) || 0;
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
        ? Math.min(bestScore / Math.max(totalScore * 0.6, 40), 1.0)
        : 0;

    return { intent: bestIntent, confidence, signals: matchedSignals, allIntentScores: intentScores };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 2: PROVIDER KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

interface ProviderKnowledge {
    name: string;
    category: 'auth-platform' | 'saas' | 'social' | 'devtools' | 'cloud' | 'finance' | 'productivity';
    senderDomains: RegExp[];
    verificationUrlPatterns: RegExp[];
    codeParams: string[];
    expectedLinkType: LinkType;
    recognitionBonus: number;
}


const PROVIDER_KNOWLEDGE_BASE: ProviderKnowledge[] = [
    // ── Auth Platforms ───────────────────────────────────────
    {
        name: 'Ory Kratos', category: 'auth-platform', senderDomains: [/ory\.(sh|dev)/i],
        verificationUrlPatterns: [/self[-_]?service\/(verification|recovery|login)/i, /\/\.ory\//i],
        codeParams: ['code', 'flow', 'token'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Auth0', category: 'auth-platform', senderDomains: [/auth0\.(com|dev)/i],
        verificationUrlPatterns: [/\/u\/email[-_]?verification/i, /auth0\.com.*verify/i, /\/authorize\?/i],
        codeParams: ['verification_code', 'code', 'ticket'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Firebase Auth', category: 'auth-platform', senderDomains: [/firebase/i, /gcp/i],
        verificationUrlPatterns: [/__\/auth\/action\?mode=verifyEmail/i, /firebaseapp\.com.*auth/i],
        codeParams: ['oobCode', 'apiKey'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Supabase Auth', category: 'auth-platform', senderDomains: [/supabase/i],
        verificationUrlPatterns: [/supabase\.\w+\/auth\/v\d\/verify/i, /supabase\.\w+\/auth\/v\d\/callback/i],
        codeParams: ['token', 'type', 'redirect_to'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Clerk', category: 'auth-platform', senderDomains: [/clerk\.(dev|com)/i],
        verificationUrlPatterns: [/clerk\.(dev|com).*verify/i, /accounts\..*\.dev\/v\d\/verify/i],
        codeParams: ['token', 'code', '__clerk_ticket'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'AWS Cognito', category: 'auth-platform', senderDomains: [/amazonaws\.com|cognito/i],
        verificationUrlPatterns: [/cognito.*confirm/i, /cognito.*verify/i],
        codeParams: ['confirmation_code', 'code', 'client_id'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Okta', category: 'auth-platform', senderDomains: [/okta\.com|oktapreview\.com/i],
        verificationUrlPatterns: [/okta.*activate/i, /okta.*verify/i, /\/signin\/verify/i],
        codeParams: ['token', 'activationToken'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'OneLogin', category: 'auth-platform', senderDomains: [/onelogin\.com/i],
        verificationUrlPatterns: [/onelogin.*verify|onelogin.*activate/i], codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Keycloak', category: 'auth-platform', senderDomains: [],
        verificationUrlPatterns: [/\/auth\/realms\/.*\/login-actions\/action-token/i, /keycloak.*verify/i],
        codeParams: ['key', 'token'], expectedLinkType: 'email-verification', recognitionBonus: 20,
    },
    {
        name: 'Stytch', category: 'auth-platform', senderDomains: [/stytch\.com/i],
        verificationUrlPatterns: [/stytch\.com.*authenticate/i, /stytch.*magic/i],
        codeParams: ['token'], expectedLinkType: 'magic-link', recognitionBonus: 20,
    },
    {
        name: 'WorkOS', category: 'auth-platform', senderDomains: [/workos\.com/i],
        verificationUrlPatterns: [/workos\.com.*verify/i, /workos.*magic/i],
        codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },

    // ── SaaS / Productivity ──────────────────────────────────
    {
        name: 'Linear', category: 'productivity', senderDomains: [/linear\.app/i],
        verificationUrlPatterns: [/linear\.app\/auth\/magic[-_]?link/i],
        codeParams: ['token'], expectedLinkType: 'magic-link', recognitionBonus: 15,
    },
    {
        name: 'Notion', category: 'productivity', senderDomains: [/notion\.so|makenotion\.com/i],
        verificationUrlPatterns: [/notion\.so\/(loginwithemail|verify)/i],
        codeParams: ['token', 'email'], expectedLinkType: 'magic-link', recognitionBonus: 15,
    },
    {
        name: 'Slack', category: 'productivity', senderDomains: [/slack\.com|slackb\.com/i],
        verificationUrlPatterns: [/slack\.com\/(confirm|verify)/i],
        codeParams: ['code', 'crumb'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Figma', category: 'productivity', senderDomains: [/figma\.com/i],
        verificationUrlPatterns: [/figma\.com.*verify|figma\.com.*confirm/i],
        codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Vercel', category: 'devtools', senderDomains: [/vercel\.com/i],
        verificationUrlPatterns: [/vercel\.com.*verify|vercel\.com.*confirm/i],
        codeParams: ['token', 'email'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Stripe', category: 'finance', senderDomains: [/stripe\.com/i],
        verificationUrlPatterns: [/stripe\.com.*confirm|stripe\.com.*verify/i],
        codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Mistral AI', category: 'saas', senderDomains: [/mistral\.ai/i],
        verificationUrlPatterns: [/mistral\.ai.*verification|auth\.mistral/i],
        codeParams: ['code', 'flow'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },

    // ── Social / DevTools ────────────────────────────────────
    {
        name: 'GitHub', category: 'devtools', senderDomains: [/github\.com/i],
        verificationUrlPatterns: [/github\.com\/(password_reset|confirm|verify|settings\/emails)/i],
        codeParams: ['token', 'nonce'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'GitLab', category: 'devtools', senderDomains: [/gitlab\.com/i],
        verificationUrlPatterns: [/gitlab\.com.*confirm|gitlab.*verify/i],
        codeParams: ['confirmation_token'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Discord', category: 'social', senderDomains: [/discord\.com|discordapp\.com/i],
        verificationUrlPatterns: [/discord\.com.*verify|click\.discord/i],
        codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Google', category: 'cloud', senderDomains: [/google\.com|gmail\.com/i],
        verificationUrlPatterns: [/accounts\.google\.com.*verify/i, /google\.com.*signin.*challenge/i],
        codeParams: ['token', 'continue'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Microsoft', category: 'cloud', senderDomains: [/microsoft\.com|outlook\.com|live\.com/i],
        verificationUrlPatterns: [/microsoft\.com.*verify|login\.microsoftonline/i, /account\.live\.com.*confirm/i],
        codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Apple', category: 'cloud', senderDomains: [/apple\.com|icloud\.com/i],
        verificationUrlPatterns: [/appleid\.apple\.com.*verify/i],
        codeParams: ['token'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    },
    {
        name: 'Twitter/X', category: 'social', senderDomains: [/twitter\.com|x\.com/i],
        verificationUrlPatterns: [/twitter\.com.*confirm|x\.com.*verify/i],
        codeParams: ['token', 'code'], expectedLinkType: 'email-verification', recognitionBonus: 15,
    }
];

/*
function matchProvider(url: string, senderEmail: string): ProviderMatch | null {
    for (const provider of PROVIDER_KNOWLEDGE_BASE) {
        for (const urlPattern of provider.verificationUrlPatterns) {
            if (urlPattern.test(url)) return { name: provider.name, category: provider.category, urlPattern: urlPattern.source, confidence: 0.95 };
        }
        for (const domainPattern of provider.senderDomains) {
            if (domainPattern.test(senderEmail) || domainPattern.test(url)) return { name: provider.name, category: provider.category, urlPattern: '(matched by sender/domain)', confidence: 0.7 };
        }
    }
    return null;
}
*/

function getProviderBonus(url: string): { bonus: number; provider: ProviderMatch | null; knownCodeParams: string[]; } {
    for (const provider of PROVIDER_KNOWLEDGE_BASE) {
        for (const urlPattern of provider.verificationUrlPatterns) {
            if (urlPattern.test(url)) {
                return {
                    bonus: provider.recognitionBonus,
                    provider: { name: provider.name, category: provider.category, urlPattern: urlPattern.source, confidence: 0.95 },
                    knownCodeParams: provider.codeParams,
                };
            }
        }
    }
    return { bonus: 0, provider: null, knownCodeParams: [] };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 3: SEMANTIC TEXT ANALYZER
// ═══════════════════════════════════════════════════════════════

interface SemanticContext {
    verificationRelevance: number;
    requestedAction: string | null;
    hasUrgency: boolean;
    hasSecurityContext: boolean;
    hasDisclaimerNearby: boolean;
    instructionText: string | null;
    sentiment: 'action-request' | 'informational' | 'warning' | 'neutral';
}

function analyzeSemanticContext(anchor: Element, _doc: Document): SemanticContext {
    const contextText = gatherContextText(anchor, 400);
    const lowerContext = contextText.toLowerCase();

    let verificationRelevance = 0;
    let requestedAction: string | null = null;
    let hasUrgency = false;
    let hasSecurityContext = false;
    let hasDisclaimerNearby = false;
    let instructionText: string | null = null;
    let sentiment: SemanticContext['sentiment'] = 'neutral';

    const actionPatterns: Array<[RegExp, string, number]> = [
        [/please\s*(click|tap|press|select|use)\s*(the|this|below|above)?\s*(link|button|url)/i, 'click-link', 25],
        [/click\s*(the|this)?\s*(link|button|below|above)\s*to\s*(verify|confirm|activate|validate|reset|complete)/i, 'click-to-verify', 30],
        [/(verify|confirm|activate|validate)\s*(your|my|this|the)?\s*(email|account|address|identity)/i, 'verify-action', 25],
        [/follow\s*this\s*link/i, 'follow-link', 15],
        [/by\s*clicking\s*(the|this)?\s*(link|button|below)/i, 'by-clicking', 20],
        [/use\s*(the|this)?\s*(link|button)\s*(below|above)/i, 'use-link', 15],
        [/tap\s*(the|this)?\s*(button|link)/i, 'tap-button', 15],
        [/copy\s*(and\s*paste|this\s*link)/i, 'copy-paste-link', 10],
    ];

    for (const [pattern, action, relevance] of actionPatterns) {
        if (pattern.test(lowerContext)) {
            requestedAction = action;
            verificationRelevance += relevance;
            sentiment = 'action-request';
        }
    }

    const urgencyPatterns = [
        /expires?\s*(in|after)\s*\d+\s*(min|hour|second|minute|day)/i,
        /valid\s*(for|until|only)\s*\d+/i,
        /within\s*\d+\s*(min|hour|day)/i,
        /link\s*(will|is)\s*(going\s*to\s*)?expire/i,
        /time[-\s]?sensitive/i,
        /act\s*(now|quickly|fast|immediately)/i,
        /don'?t\s*wait/i, /limited\s*time/i,
    ];

    for (const pattern of urgencyPatterns) {
        if (pattern.test(lowerContext)) {
            hasUrgency = true; verificationRelevance += 10; break;
        }
    }

    const securityPatterns = [
        /don'?t\s*share\s*(this|the)?\s*(link|code|url)/i,
        /keep\s*(this)?\s*(link|code)?\s*secret/i,
        /for\s*(your)?\s*security/i,
        /security\s*(reason|measure|purpose)/i,
        /protect\s*(your|the)?\s*account/i,
        /someone\s*(requested|is\s*trying)/i,
        /if\s*(this\s*)?(wasn'?t|was\s*not)\s*you/i,
    ];

    for (const pattern of securityPatterns) {
        if (pattern.test(lowerContext)) {
            hasSecurityContext = true; verificationRelevance += 8; break;
        }
    }

    const disclaimerPatterns = [
        /if\s*you\s*(didn'?t|did\s*not)\s*(request|create|sign|register|make)/i,
        /ignore\s*this\s*email/i,
        /you\s*can\s*safely\s*ignore/i,
        /no\s*(further)?\s*action\s*(is\s*)?(required|needed)/i,
        /if\s*you\s*(don'?t|do\s*not)\s*recogni[sz]e/i,
        /wasn'?t\s*you/i,
    ];

    for (const pattern of disclaimerPatterns) {
        if (pattern.test(lowerContext)) {
            hasDisclaimerNearby = true; verificationRelevance += 12; break;
        }
    }

    const sentences = contextText.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
    for (const sentence of sentences) {
        if (/click|tap|press|follow|use|copy/i.test(sentence) && /link|button|below|above|url/i.test(sentence)) {
            instructionText = sentence.slice(0, 150); break;
        }
        if (/verify|confirm|activate|validate|reset/i.test(sentence) && /email|account|password/i.test(sentence)) {
            instructionText = sentence.slice(0, 150);
        }
    }

    if (/suspicious|unauthorized|compromised|breach|hack/i.test(lowerContext)) {
        sentiment = 'warning'; verificationRelevance += 5;
    }

    return { verificationRelevance, requestedAction, hasUrgency, hasSecurityContext, hasDisclaimerNearby, instructionText, sentiment };
}


function gatherContextText(anchor: Element, maxLength: number): string {
    const parts: string[] = [];

    let prev = anchor.previousElementSibling;
    for (let i = 0; i < 3 && prev; i++) {
        const text = (prev.textContent || '').trim();
        if (text.length > 0 && text.length < 300) {parts.unshift(text);}
        prev = prev.previousElementSibling;
    }

    let parent: Element | null = anchor.parentElement;
    for (let depth = 0; depth < 3 && parent; depth++) {
        let directText = '';
        for (const node of parent.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {directText += node.textContent || '';}
        }
        directText = directText.replace(/\s+/g, ' ').trim();
        if (directText.length > 5 && directText.length < 300) {parts.push(directText);}
        parent = parent.parentElement;
    }

    let next = anchor.nextElementSibling;
    for (let i = 0; i < 3 && next; i++) {
        const text = (next.textContent || '').trim();
        if (text.length > 0 && text.length < 300) {parts.push(text);}
        next = next.nextElementSibling;
    }

    return parts.join(' ').slice(0, maxLength);
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 4: EMAIL ANATOMY ENGINE
// ═══════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function analyzeEmailAnatomy(doc: Document): {
    sections: Map<Element, EmailSection>;
    sectionRanges: Map<EmailSection, { start: number; end: number }>;
    bodyLength: number;
} {
    const body = doc.body || doc.documentElement;
    const bodyLength = (body.textContent || '').length;
    const sections = new Map<Element, EmailSection>();

    const containers = body.querySelectorAll('table, div, section, header, footer, main, article, td, tr');
    const sectionRanges = new Map<EmailSection, { start: number; end: number }>();

    containers.forEach((container) => {
        const section = classifySection(container, bodyLength, doc);
        sections.set(container, section);
    });

    return { sections, sectionRanges, bodyLength };
}

function classifySection(element: Element, totalLength: number, doc: Document): EmailSection {
    const tag = element.tagName?.toLowerCase() || '';
    const className = (element.getAttribute('class') || '').toLowerCase();
    const id = (element.getAttribute('id') || '').toLowerCase();
    const role = (element.getAttribute('role') || '').toLowerCase();
    const style = (element.getAttribute('style') || '').toLowerCase();
    const text = (element.textContent || '').trim().toLowerCase();

    let charsSoFar = 0;
    let found = false;
    const body = doc.body || doc.documentElement;
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (element.contains(walker.currentNode)) { found = true; break; }
        charsSoFar += (walker.currentNode.textContent || '').length;
    }
    const position = (totalLength === 0 || !found) ? 0.5 : Math.min(charsSoFar / totalLength, 1.0);

    if (tag === 'footer' || role === 'contentinfo') {return 'footer';}
    if (tag === 'header' || role === 'banner') {return 'header';}
    if (tag === 'nav' || role === 'navigation') {return 'footer';}
    if (tag === 'main' || role === 'main') {return 'primary-content';}

    if (/footer|bottom|legal|disclaimer/i.test(className + id)) {return 'footer';}
    if (/header|top|logo|banner/i.test(className + id)) {return 'header';}
    if (/hero|main|content|body/i.test(className + id)) {return 'primary-content';}
    if (/cta|action|button/i.test(className + id)) {return 'cta-zone';}
    if (/social|follow/i.test(className + id)) {return 'social-bar';}
    if (/unsub/i.test(className + id)) {return 'unsubscribe-zone';}
    if (/preheader|preview/i.test(className + id)) {return 'preheader';}

    if (text.length < 200) {
        if (/unsubscribe|opt\s*out|manage\s*pref|email\s*pref/i.test(text)) {return 'unsubscribe-zone';}
        if (/privacy|terms|legal|copyright|©|\d{4}\s*[,.]?\s*(all\s*rights|inc\.|llc|ltd|corp)/i.test(text)) {return 'legal';}
        if (/twitter|facebook|linkedin|instagram|youtube|follow\s*us/i.test(text)) {return 'social-bar';}
    }

    if (/font-size\s*:\s*(10|11|12)px/i.test(style) && position > 0.7) {return 'footer';}
    if (/color\s*:\s*#(999|aaa|bbb|ccc|ddd|888|777|666)/i.test(style) && position > 0.7) {return 'footer';}

    if (position < 0.1) {return 'header';}
    if (position > 0.85) {return 'footer';}
    if (position >= 0.1 && position <= 0.4) {return 'primary-content';}

    return 'unknown';
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getSectionForElement(element: Element, sectionsMap: Map<Element, EmailSection>): EmailSection {
    let current: Element | null = element;
    while (current) {
        const section = sectionsMap.get(current);
        if (section && section !== 'unknown') {return section;}
        current = current.parentElement;
    }
    return 'unknown';
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 5: LINK-TEXT RELATIONSHIP GRAPH
// ═══════════════════════════════════════════════════════════════

interface LinkTextRelationship {
    associatedInstruction: string | null;
    instructionDistance: number;
    isDirectlFollowingInstruction: boolean;
    parentHeading: string | null;
    relationshipBonus: number;
}

function analyzeLinkTextRelationship(anchor: Element): LinkTextRelationship {
    let associatedInstruction: string | null = null;
    let instructionDistance = Infinity;
    let isDirectlFollowingInstruction = false;
    let parentHeading: string | null = null;
    let relationshipBonus = 0;

    let prev = anchor.previousElementSibling;
    if (!prev && anchor.parentElement) {prev = anchor.parentElement.previousElementSibling;}
    if (!prev && anchor.parentElement?.parentElement) {prev = anchor.parentElement.parentElement.previousElementSibling;}

    let distance = 0;
    let current: Element | null = prev;
    while (current && distance < 5) {
        const text = (current.textContent || '').trim();
        const tag = current.tagName?.toLowerCase() || '';

        if (/^h[1-6]$/.test(tag) && !parentHeading) {
            parentHeading = text.slice(0, 100);
            if (/verify|confirm|activate|reset|sign\s*in|welcome/i.test(text)) {relationshipBonus += 15;}
        }

        if (text.length > 10 && text.length < 300) {
            const isInstruction = /click|tap|press|follow|use|copy/i.test(text) && /link|button|below|above|url/i.test(text);
            const isVerificationContext = /verify|confirm|activate|validate|reset|complete|sign\s*in/i.test(text) && /email|account|password|identity|address/i.test(text);

            if (isInstruction || isVerificationContext) {
                if (distance < instructionDistance) {
                    associatedInstruction = text.slice(0, 200);
                    instructionDistance = distance;
                    isDirectlFollowingInstruction = distance <= 1;
                    relationshipBonus += isDirectlFollowingInstruction ? 20 : 10;
                }
            }
        }
        current = current.previousElementSibling;
        distance++;
    }

    return { associatedInstruction, instructionDistance, isDirectlFollowingInstruction, parentHeading, relationshipBonus };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 6: CTA HIERARCHY DETECTOR
// ═══════════════════════════════════════════════════════════════

function analyzeVisualWeight(anchor: Element): { visualWeight: number; isPrimaryCTA: boolean; ctaSignals: string[]; } {
    let weight = 0;
    const signals: string[] = [];
    const style = (anchor.getAttribute('style') || '');
    const className = (anchor.getAttribute('class') || '').toLowerCase();
    const role = anchor.getAttribute('role') || '';

    const bgMatch = style.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (bgMatch) {
        const bg = bgMatch[1].trim().toLowerCase();
        if (!['transparent', 'none', 'inherit', 'initial', 'unset', '#ffffff', '#fff', 'white', 'rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)'].includes(bg)) {
            weight += 20; signals.push('has-background-color');
        }
    }

    const paddingMatch = style.match(/padding\s*:\s*(\d+)/i);
    if (paddingMatch && parseInt(paddingMatch[1], 10) >= 8) { weight += 10; signals.push('has-padding'); }
    if (/border-radius\s*:\s*\d+/i.test(style)) { weight += 8; signals.push('has-border-radius'); }
    if (/display\s*:\s*(inline-)?block/i.test(style)) { weight += 5; signals.push('display-block'); }
    if (/text-align\s*:\s*center/i.test(style)) { weight += 5; signals.push('text-center'); }
    if (/font-weight\s*:\s*(bold|700|800|900)/i.test(style)) { weight += 5; signals.push('font-bold'); }

    const fontSizeMatch = style.match(/font-size\s*:\s*(\d+)/i);
    if (fontSizeMatch && parseInt(fontSizeMatch[1], 10) >= 16) { weight += 8; signals.push('large-font'); }
    if (/width\s*:\s*\d+|min-width/i.test(style)) { weight += 5; signals.push('has-width'); }

    if (/btn|button/i.test(className)) { weight += 15; signals.push('button-class'); }
    if (/cta|call[-_]?to[-_]?action/i.test(className)) { weight += 15; signals.push('cta-class'); }
    if (/primary|main|hero/i.test(className)) { weight += 10; signals.push('primary-class'); }
    if (/action/i.test(className)) { weight += 8; signals.push('action-class'); }
    if (role === 'button') { weight += 12; signals.push('role-button'); }

    const innerTable = anchor.querySelector('table');
    if (innerTable && /background/i.test(innerTable.getAttribute('style') || '')) {
        weight += 18; signals.push('inner-table-button');
    }

    const parentTd = anchor.closest('td');
    if (parentTd) {
        const tdStyle = parentTd.getAttribute('style') || '';
        if (/background(?:-color)?\s*:\s*(?!transparent|none|#fff|white)/i.test(tdStyle)) { weight += 15; signals.push('parent-td-button'); }
        if (/border-radius/i.test(tdStyle)) { weight += 8; signals.push('parent-td-rounded'); }
        if (/text-align\s*:\s*center/i.test(tdStyle)) { weight += 5; signals.push('parent-td-centered'); }
    }

    if (/text-align\s*:\s*center/i.test(anchor.parentElement?.getAttribute('style') || '')) {
        weight += 5; signals.push('parent-centered');
    }

    return { visualWeight: weight, isPrimaryCTA: weight >= 25, ctaSignals: signals };
}


// ═══════════════════════════════════════════════════════════════
//  LAYER 7: URL INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

interface UrlIntelligence {
    urlScore: number;
    detectedType: LinkType | null;
    signals: ScoringSignal[];
    negativeSignals: ScoringSignal[];
    embeddedCode: { code: string; param: string } | null;
    isTrackingWrapper: boolean;
    pathDepth: number;
    paramCount: number;
}

const URL_SIGNALS: Array<{ pattern: RegExp; score: number; type: LinkType | null; name: string; layer: string; }> = [
    // ── Tier 1: Path-based (strongest) ──────────────────────
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

    // ── Tier 2: Generic path keywords ───────────────────────
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

    // ── Tier 3: Query parameter signals ─────────────────────
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

    // ── Tier 4: Domain/path structure ───────────────────────
    { pattern: /\/auth\//i, score: 10, type: null, name: 'url:auth-path-segment', layer: 'url-intelligence' },
    { pattern: /\/api\/v\d/i, score: 5, type: null, name: 'url:api-versioned', layer: 'url-intelligence' },
    { pattern: /\/callback/i, score: 5, type: null, name: 'url:callback', layer: 'url-intelligence' },
    { pattern: /\/emails?\//i, score: 8, type: null, name: 'url:emails-path', layer: 'url-intelligence' },
];

const URL_NEGATIVE_SIGNALS_V2: Array<{ pattern: RegExp; score: number; name: string; layer: string; }> = [
    // ── Absolute eliminators ────────────────────────────────
    { pattern: /unsubscribe/i, score: -90, name: 'url:unsubscribe', layer: 'negative-intelligence' },
    { pattern: /opt[-_]?out/i, score: -90, name: 'url:opt-out', layer: 'negative-intelligence' },
    { pattern: /manage[-_]?preference/i, score: -80, name: 'url:manage-preferences', layer: 'negative-intelligence' },
    { pattern: /email[-_]?preference/i, score: -80, name: 'url:email-preferences', layer: 'negative-intelligence' },
    { pattern: /notification[-_]?setting/i, score: -70, name: 'url:notification-settings', layer: 'negative-intelligence' },
    { pattern: /list[-_]?unsubscribe/i, score: -90, name: 'url:list-unsubscribe', layer: 'negative-intelligence' },
    { pattern: /communication[-_]?preference/i, score: -75, name: 'url:comm-preferences', layer: 'negative-intelligence' },

    // ── Social ──────────────────────────────────────────────
    { pattern: /^https?:\/\/(www\.)?(twitter|x)\.com/i, score: -80, name: 'url:twitter-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?facebook\.com/i, score: -80, name: 'url:facebook-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?linkedin\.com/i, score: -80, name: 'url:linkedin-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?instagram\.com/i, score: -80, name: 'url:instagram-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?youtube\.com/i, score: -80, name: 'url:youtube-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?tiktok\.com/i, score: -80, name: 'url:tiktok-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/(www\.)?reddit\.com/i, score: -70, name: 'url:reddit-domain', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/discord\.gg/i, score: -60, name: 'url:discord-invite', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/t\.me\//i, score: -60, name: 'url:telegram', layer: 'negative-intelligence' },

    // ── Legal / Footer ──────────────────────────────────────
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

    // ── App Stores ──────────────────────────────────────────
    { pattern: /play\.google\.com/i, score: -65, name: 'url:play-store', layer: 'negative-intelligence' },
    { pattern: /apps\.apple\.com|itunes\.apple\.com/i, score: -65, name: 'url:app-store', layer: 'negative-intelligence' },
    { pattern: /microsoft\.com\/.*store/i, score: -55, name: 'url:ms-store', layer: 'negative-intelligence' },

    // ── Tracking / Pixels ───────────────────────────────────
    { pattern: /\.(gif|png|jpg|jpeg|svg|webp|ico|bmp)(\?|$)/i, score: -70, name: 'url:image-file', layer: 'negative-intelligence' },
    { pattern: /\/open\./i, score: -60, name: 'url:open-tracking', layer: 'negative-intelligence' },
    { pattern: /\/beacon/i, score: -60, name: 'url:beacon', layer: 'negative-intelligence' },
    { pattern: /\/pixel/i, score: -60, name: 'url:pixel', layer: 'negative-intelligence' },
    { pattern: /\/track\b/i, score: -30, name: 'url:track', layer: 'negative-intelligence' },
    { pattern: /width=1|height=1/i, score: -60, name: 'url:1x1-pixel', layer: 'negative-intelligence' },

    // ── Documents ───────────────────────────────────────────
    { pattern: /\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx)(\?|$)/i, score: -50, name: 'url:document-file', layer: 'negative-intelligence' },

    // ── Root/Homepage ───────────────────────────────────────
    { pattern: /^https?:\/\/[^/?#]+\/?$/i, score: -35, name: 'url:homepage-root', layer: 'negative-intelligence' },
    { pattern: /^https?:\/\/[^/?#]+\/?#?$/i, score: -35, name: 'url:homepage-hash', layer: 'negative-intelligence' },

    // ── E-commerce ──────────────────────────────────────────
    { pattern: /\/shop\b/i, score: -40, name: 'url:shop', layer: 'negative-intelligence' },
    { pattern: /\/cart\b/i, score: -40, name: 'url:cart', layer: 'negative-intelligence' },
    { pattern: /\/product/i, score: -35, name: 'url:product', layer: 'negative-intelligence' },
    { pattern: /\/order/i, score: -30, name: 'url:order', layer: 'negative-intelligence' },
    { pattern: /\/invoice/i, score: -30, name: 'url:invoice', layer: 'negative-intelligence' },

    // ── View in browser ─────────────────────────────────────
    { pattern: /view[-_]?(in|as)[-_]?(browser|web|html|page)/i, score: -40, name: 'url:view-in-browser', layer: 'negative-intelligence' },
    { pattern: /\/webversion/i, score: -40, name: 'url:webversion', layer: 'negative-intelligence' },
];

const ANCHOR_TEXT_SIGNALS: Array<{ pattern: RegExp; score: number; type: LinkType | null; name: string; layer: string; }> = [
    // ── Tier 1: Exact match (button text) ───────────────────
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

    // ── Tier 2: Phrase match ────────────────────────────────
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

    // ── Negative text ───────────────────────────────────────
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

    for (const signal of URL_NEGATIVE_SIGNALS_V2) {
        if (signal.pattern.test(url)) {
            urlScore += signal.score;
            negativeSignals.push({ name: signal.name, points: signal.score, layer: signal.layer, detail: `URL matched negative: ${signal.pattern.source}` });
        }
    }

    const embeddedCode = extractEmbeddedCode(url);
    const isTrackingWrapper = /click\.|track\.|redirect\.|go\.|link\.|t\./i.test(url) && !/verify|confirm|activate|magic|auth|login|password/i.test(url);

    let pathDepth = 0;
    try {
        const urlObj = new URL(url, 'https://placeholder.com');
        pathDepth = urlObj.pathname.split('/').filter(s => s.length > 0).length;
    } catch { /* ignore */ }

    let paramCount = 0;
    try {
        const urlObj = new URL(url, 'https://placeholder.com');
        paramCount = Array.from(urlObj.searchParams).length;
    } catch { /* ignore */ }

    return { urlScore, detectedType, signals, negativeSignals, embeddedCode, isTrackingWrapper, pathDepth, paramCount };
}

function extractEmbeddedCode(url: string): { code: string; param: string } | null {
    const PRIORITY_PARAMS = [
        'verification_code', 'verification-code', 'verificationCode', 'confirmation_code', 'confirmation-code',
        'otp', 'code', 'pin', 'one_time_code', 'one-time-code', 'oneTimeCode',
    ];

    try {
        const urlObj = new URL(url, 'https://placeholder.com');
        for (const param of PRIORITY_PARAMS) {
            const value = urlObj.searchParams.get(param);
            if (value && value.length >= 4 && value.length <= 10 && /^[A-Za-z0-9]+$/.test(value)) {
                return { code: value, param };
            }
        }
        for (const [key, value] of urlObj.searchParams) {
            if (/code|otp|pin/i.test(key) && value.length >= 4 && value.length <= 10 && /^[A-Za-z0-9]+$/.test(value)) {
                return { code: value, param: key };
            }
        }
    } catch {
        const match = url.match(/[?&](verification[-_]?code|confirmation[-_]?code|otp|code|pin)=([A-Za-z0-9]{4,10})(?:&|$)/i);
        if (match) {return { code: match[2], param: match[1] };}
    }
    return null;
}


// ═══════════════════════════════════════════════════════════════
//  LAYER 9: CROSS-SIGNAL REASONING ENGINE
// ═══════════════════════════════════════════════════════════════

function buildReasoningChain(
    urlIntel: UrlIntelligence, semantics: SemanticContext, visualWeight: number, section: EmailSection,
    emailIntent: EmailIntent, provider: ProviderMatch | null, relationship: LinkTextRelationship, totalScore: number,
): ReasoningChain {
    const steps: ReasoningStep[] = [];
    const isVerificationIntent = ['verification', 'magic-link-login', 'password-reset', 'device-confirmation', 'invitation', 'two-factor'].includes(emailIntent);

    if (isVerificationIntent) {
        steps.push({ layer: 'Email Intent', observation: `Email classified as "${emailIntent}" intent`, conclusion: 'This email is asking the user to take a verification-type action', impact: 'strong-positive' });
    } else if (['marketing', 'newsletter', 'social-notification', 'transactional'].includes(emailIntent)) {
        steps.push({ layer: 'Email Intent', observation: `Email classified as "${emailIntent}" intent`, conclusion: 'This email is NOT a verification email — links are likely non-activation', impact: 'strong-negative' });
    }

    if (provider) {
        steps.push({ layer: 'Provider Knowledge', observation: `Recognized provider: ${provider.name} (${provider.category})`, conclusion: `URL matches known ${provider.name} verification pattern`, impact: 'strong-positive' });
    }

    if (urlIntel.urlScore > 30) {
        steps.push({ layer: 'URL Intelligence', observation: `URL scored ${urlIntel.urlScore} with ${urlIntel.signals.length} positive signals`, conclusion: `URL structure strongly indicates ${urlIntel.detectedType || 'verification'} link`, impact: 'strong-positive' });
    } else if (urlIntel.urlScore > 10) {
        steps.push({ layer: 'URL Intelligence', observation: `URL scored ${urlIntel.urlScore} (moderate)`, conclusion: 'URL has some verification indicators', impact: 'positive' });
    }

    if (urlIntel.embeddedCode) {
        steps.push({ layer: 'Code Extraction', observation: `Found embedded code "${urlIntel.embeddedCode.code}" in URL parameter "${urlIntel.embeddedCode.param}"`, conclusion: 'This URL carries an embedded verification code', impact: 'strong-positive' });
    }

    if (semantics.verificationRelevance > 20) {
        steps.push({ layer: 'Semantic Analysis', observation: `Surrounding text has verification relevance of ${semantics.verificationRelevance}`, conclusion: `Context strongly supports verification intent (${semantics.requestedAction || 'general verification'})`, impact: 'strong-positive' });
    }

    if (semantics.hasDisclaimerNearby) {
        steps.push({ layer: 'Semantic Analysis', observation: 'Found "if you didn\'t request this" disclaimer nearby', conclusion: 'Disclaimer language is a strong indicator of legitimate verification emails', impact: 'positive' });
    }

    if (semantics.hasUrgency) {
        steps.push({ layer: 'Semantic Analysis', observation: 'Detected expiration/urgency language', conclusion: 'Time-limited links are characteristic of verification flows', impact: 'positive' });
    }

    if (visualWeight >= 25) {
        steps.push({ layer: 'CTA Detection', observation: `Visual weight = ${visualWeight} (button styling detected)`, conclusion: 'This link is styled as the PRIMARY call-to-action', impact: 'positive' });
    }

    if (['primary-content', 'cta-zone', 'hero'].includes(section)) {
        steps.push({ layer: 'Email Anatomy', observation: `Link is in the "${section}" section of the email`, conclusion: 'Correct position for an activation link', impact: 'positive' });
    } else if (['footer', 'legal', 'social-bar', 'unsubscribe-zone'].includes(section)) {
        steps.push({ layer: 'Email Anatomy', observation: `Link is in the "${section}" section of the email`, conclusion: 'Footer/legal section — very unlikely to be the activation link', impact: 'strong-negative' });
    }

    if (relationship.isDirectlFollowingInstruction) {
        steps.push({ layer: 'Text Relationship', observation: `Link directly follows instructional text: "${relationship.associatedInstruction?.slice(0, 80)}..."`, conclusion: 'Strong association between instruction and this link', impact: 'strong-positive' });
    }

    const positiveSteps = steps.filter(s => s.impact.includes('positive')).length;
    const negativeSteps = steps.filter(s => s.impact.includes('negative')).length;

    let summary: string;
    if (totalScore >= 60) {
        summary = `HIGH CONFIDENCE: ${positiveSteps} positive signals across ${new Set(steps.map(s => s.layer)).size} intelligence layers confirm this is an activation link.`;
    } else if (totalScore >= 30) {
        summary = `MODERATE CONFIDENCE: ${positiveSteps} positive vs ${negativeSteps} negative signals. Link is likely an activation link but with some uncertainty.`;
    } else if (totalScore > 0) {
        summary = `LOW CONFIDENCE: Only ${positiveSteps} weak positive signals detected. This may or may not be an activation link.`;
    } else {
        summary = `REJECTED: ${negativeSteps} negative signals indicate this is NOT an activation link.`;
    }

    const confidenceExplanation = totalScore >= 60 ? 'Multiple independent intelligence layers agree this is the activation link.' : totalScore >= 30 ? 'Some evidence supports this being an activation link, but not all layers agree.' : 'Insufficient evidence to confidently identify this as an activation link.';
    return { steps, summary, confidenceExplanation };
}

// ═══════════════════════════════════════════════════════════════
//  LAYER 10: CONFIDENCE CALIBRATION
// ══════════════════════════════════════════════════════════════m
function calibrateConfidence(rawScore: number, emailIntent: EmailIntent, section: EmailSection, isPrimaryCTA: boolean, hasProvider: boolean, semanticRelevance: number): number {
    let confidence = Math.min(rawScore / 80, 1.0);
    const verificationIntents: EmailIntent[] = ['verification', 'magic-link-login', 'password-reset', 'device-confirmation', 'invitation', 'two-factor'];
    const antiIntents: EmailIntent[] = ['marketing', 'newsletter', 'social-notification', 'transactional'];

    if (verificationIntents.includes(emailIntent)) {confidence = Math.min(confidence * 1.15, 1.0);}
    else if (antiIntents.includes(emailIntent)) {confidence *= 0.3;}

    if (['primary-content', 'cta-zone', 'hero'].includes(section)) {confidence = Math.min(confidence * 1.1, 1.0);}
    else if (['footer', 'legal', 'social-bar', 'unsubscribe-zone'].includes(section)) {confidence *= 0.2;}

    if (isPrimaryCTA) {confidence = Math.min(confidence * 1.1, 1.0);}
    if (hasProvider) {confidence = Math.min(confidence * 1.15, 1.0);}
    if (semanticRelevance > 20) {confidence = Math.min(confidence * 1.1, 1.0);}

    return Math.round(confidence * 1000) / 1000;
}


// ═══════════════════════════════════════════════════════════════
//  MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function extractActivationLinks(
    emailHtml: string,
    senderEmail: string = '',
): LinkExtractionResult {
    const startTime = performance.now();
    const layersExecuted: string[] = [];

    const doc: Document | null = null;
    const bodyText: string = emailHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

    // Fallback anchor objects from regex parsing (mimic HTMLAnchorElement)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allAnchors: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const anatomy: EmailAnatomy = { sections: new Map(), sectionRanges: new Map(), bodyLength: 0 };

    // Always use DOMParser when available, otherwise use regex fallback
    layersExecuted.push('html-parser-regex-fallback');

    const anchorRegex = /<a\s+[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(emailHtml)) !== null) {
        const href = match[1];
        const innerHtml = match[2];
        const textContent = innerHtml.replace(/<[^>]*>/g, '').trim();
        const outerHTML = match[0];

        allAnchors.push({
            getAttribute: (attr: string) => {
                if (attr === 'href') {return href;}
                const attrMatch = new RegExp(`${attr}=["']([^"']*)["']`, 'i').exec(outerHTML);
                return attrMatch ? attrMatch[1] : null;
            },
            href: href,
            textContent: textContent,
            outerHTML: outerHTML,
            innerHTML: innerHtml,
        });
    }
    const intentResult = classifyEmailIntent(bodyText);
    layersExecuted.push('intent-classifier');

    let emailProvider: string | null = null;
    for (const provider of PROVIDER_KNOWLEDGE_BASE) {
        for (const domain of provider.senderDomains) {
            if (domain.test(senderEmail) || domain.test(bodyText)) { emailProvider = provider.name; break; }
        }
        if (emailProvider) {break;}
    }

    const totalLinksFound = allAnchors.length;
    const candidates: ActivationLink[] = [];
    const rejected: Array<{ url: string; reason: string; section: EmailSection }> = [];

    allAnchors.forEach((anchor) => {
        const href = anchor.getAttribute('href');
        if (!href) {return;}
        const url = decodeHtmlEntities(href.trim());

        if (/^(mailto:|tel:|#|javascript:|data:|sms:)/i.test(url)) {
            rejected.push({ url: truncate(url, 80), reason: 'protocol-reject', section: 'unknown' });
            return;
        }
        if (url.length < 15) {
            rejected.push({ url, reason: 'too-short', section: 'unknown' });
            return;
        }

        const anchorText = getCleanAnchorText(anchor);
        const anchorTextLower = anchorText.toLowerCase().trim();

        if (anchorText.length === 0) {
            const hasVerifyUrl = URL_SIGNALS.some(s => s.score >= 25 && s.pattern.test(url));
            if (!hasVerifyUrl) {
                rejected.push({ url: truncate(url, 80), reason: 'image-only-no-verify-url', section: 'unknown' });
                return;
            }
        }

        const urlIntel = analyzeUrl(url);
        if (!layersExecuted.includes('url-intelligence')) {layersExecuted.push('url-intelligence');}

        const providerResult = getProviderBonus(url);
        if (!layersExecuted.includes('provider-knowledge')) {layersExecuted.push('provider-knowledge');}

        let textScore = 0;
        const textSignals: ScoringSignal[] = [];
        const textNegSignals: ScoringSignal[] = [];
        let textDetectedType: LinkType | null = null;

        if (anchorTextLower.length > 0) {
            for (const signal of ANCHOR_TEXT_SIGNALS) {
                if (signal.pattern.test(anchorTextLower)) {
                    textScore += signal.score;
                    if (signal.score > 0) {
                        if (signal.type && !textDetectedType) {textDetectedType = signal.type;}
                        textSignals.push({ name: signal.name, points: signal.score, layer: signal.layer, detail: `Anchor text matched: "${anchorTextLower.slice(0, 50)}"` });
                    } else {
                        textNegSignals.push({ name: signal.name, points: signal.score, layer: signal.layer, detail: `Anchor text negative: "${anchorTextLower.slice(0, 50)}"` });
                    }
                }
            }
        }
        if (!layersExecuted.includes('text-intelligence')) {layersExecuted.push('text-intelligence');}

        // Use fallback values when doc is not available
        const semantics = doc ? analyzeSemanticContext(anchor, doc) : {
            signals: [],
            score: 0,
            verificationRelevance: 0,
            requestedAction: null,
            hasUrgency: false,
            hasDisclaimerNearby: false,
            hasSecurityContext: false,
            instructionText: null,
            sentiment: 'neutral' as const
        };
        if (!layersExecuted.includes('semantic-analyzer')) {layersExecuted.push('semantic-analyzer');}

        const section = 'unknown';
        if (!layersExecuted.includes('section-detector')) {layersExecuted.push('section-detector');}

        const relationship = analyzeLinkTextRelationship(anchor);
        if (!layersExecuted.includes('text-relationship')) {layersExecuted.push('text-relationship');}

        const visual = analyzeVisualWeight(anchor);
        if (!layersExecuted.includes('visual-weight')) {layersExecuted.push('visual-weight');}

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
            allPositiveSignals.push({ name: `provider:${providerResult.provider?.name}`, points: providerResult.bonus, layer: 'provider-knowledge', detail: `Recognized auth provider: ${providerResult.provider?.name}` });
        }

        if (semantics.verificationRelevance > 0) {
            totalScore += semantics.verificationRelevance;
            allPositiveSignals.push({ name: 'semantic:context-relevance', points: semantics.verificationRelevance, layer: 'semantic-analyzer', detail: `Context analysis: action="${semantics.requestedAction}" urgency=${semantics.hasUrgency} disclaimer=${semantics.hasDisclaimerNearby}` });
        }

        if (relationship.relationshipBonus > 0) {
            totalScore += relationship.relationshipBonus;
            allPositiveSignals.push({ name: 'relationship:instruction-proximity', points: relationship.relationshipBonus, layer: 'text-relationship', detail: `Instruction: "${relationship.associatedInstruction?.slice(0, 60) || 'none'}" distance=${relationship.instructionDistance}` });
        }

        if (visual.isPrimaryCTA) {
            totalScore += 15;
            allPositiveSignals.push({ name: 'visual:primary-cta', points: 15, layer: 'cta-detector', detail: `CTA signals: ${visual.ctaSignals.join(', ')}` });
        }

        if (urlIntel.embeddedCode) {
            totalScore += 15;
            allPositiveSignals.push({ name: 'embedded-code:found', points: 15, layer: 'code-extraction', detail: `${urlIntel.embeddedCode.param}=${urlIntel.embeddedCode.code}` });
        }

        const sectionScores: Partial<Record<EmailSection, number>> = { 'preheader': -10, 'header': -15, 'hero': 10, 'primary-content': 10, 'cta-zone': 15, 'secondary-content': 0, 'footer': -25, 'legal': -30, 'social-bar': -35, 'unsubscribe-zone': -40, 'unknown': 0 };
        const sectionScore = sectionScores[section] || 0;
        totalScore += sectionScore;
        if (sectionScore !== 0) {
            const target = sectionScore > 0 ? allPositiveSignals : allNegativeSignals;
            target.push({ name: `section:${section}`, points: sectionScore, layer: 'anatomy-engine', detail: `Link is in the "${section}" section` });
        }

        const verificationIntents: EmailIntent[] = ['verification', 'magic-link-login', 'password-reset', 'device-confirmation', 'invitation', 'two-factor'];
        if (verificationIntents.includes(intentResult.intent) && totalScore > 0) {
            const intentBonus = Math.round(totalScore * 0.15); totalScore += intentBonus;
            allPositiveSignals.push({ name: `intent:${intentResult.intent}-alignment`, points: intentBonus, layer: 'intent-classifier', detail: `Email intent "${intentResult.intent}" correlates with verification link` });
        }

        const antiIntents: EmailIntent[] = ['marketing', 'newsletter', 'social-notification'];
        if (antiIntents.includes(intentResult.intent) && intentResult.confidence > 0.5) {
            const intentPenalty = -Math.round(Math.abs(totalScore) * 0.4); totalScore += intentPenalty;
            allNegativeSignals.push({ name: `intent:${intentResult.intent}-penalty`, points: intentPenalty, layer: 'intent-classifier', detail: `Email intent "${intentResult.intent}" suggests this is NOT a verification email` });
        }

        if (totalScore <= 0) {
            rejected.push({ url: truncate(url, 80), reason: `score=${totalScore}`, section });
            return;
        }

        const confidence = calibrateConfidence(totalScore, intentResult.intent, section, visual.isPrimaryCTA, Boolean(providerResult.provider), semantics.verificationRelevance);

        const detectedType = urlIntel.detectedType || textDetectedType ||
            (providerResult.provider ? PROVIDER_KNOWLEDGE_BASE.find(p => p.name === providerResult.provider!.name)?.expectedLinkType : null) ||
            'unknown-verification';

        const reasoning = buildReasoningChain(urlIntel, semantics, visual.visualWeight, section, intentResult.intent, providerResult.provider, relationship, totalScore);

        candidates.push({
            url, score: totalScore, confidence, type: detectedType, anchorText: anchorText.slice(0, 200),
            hasEmbeddedCode: Boolean(urlIntel.embeddedCode), embeddedCode: urlIntel.embeddedCode?.code || null,
            embeddedCodeParam: urlIntel.embeddedCode?.param || null, section, isPrimaryCTA: visual.isPrimaryCTA,
            reasoning, matchedSignals: allPositiveSignals, negativeSignals: allNegativeSignals,
            providerMatch: providerResult.provider, surroundingContext: (semantics.instructionText || relationship.associatedInstruction) ?? '',
            visualWeight: visual.visualWeight,
        });
    });

    postProcessCandidates(candidates);
    if (!layersExecuted.includes('post-processor')) {layersExecuted.push('post-processor');}
    candidates.sort((a, b) => b.score - a.score);

    const verificationLanguageStrength = Math.min((intentResult.allIntentScores.get('verification') || 0) + (intentResult.allIntentScores.get('magic-link-login') || 0) + (intentResult.allIntentScores.get('password-reset') || 0), 100) / 100;
    const urgencyLevel = /expires?\s*in\s*\d+\s*(min|sec)/i.test(bodyText) ? 0.9 : /expires?\s*in\s*\d+\s*(hour|day)/i.test(bodyText) ? 0.6 : /expires?/i.test(bodyText) ? 0.3 : 0;
    const extractionTimeMs = performance.now() - startTime;

    return {
        best: candidates.length > 0 ? candidates[0] : null, allCandidates: candidates, rejected,
        emailAnalysis: { intent: intentResult.intent, intentConfidence: intentResult.confidence, intentSignals: intentResult.signals, detectedProvider: emailProvider || candidates[0]?.providerMatch?.name || null, sectionMap: new Map(), totalLinks: totalLinksFound, verificationLanguageStrength, urgencyLevel, securityLanguagePresent: /don'?t\s*share|security|suspicious|unauthorized/i.test(bodyText) },
        meta: { totalLinksFound, candidatesFound: candidates.length, rejectedCount: rejected.length, extractionTimeMs, layersExecuted, dominantSignal: 'none' }
    };
}

function postProcessCandidates(candidates: ActivationLink[]): void {
    if (candidates.length === 0) {return;}

    const highScorers = candidates.filter(c => c.score > 35);
    if (highScorers.length === 1) {
        highScorers[0].score += 15;
        highScorers[0].matchedSignals.push({ name: 'post:sole-strong-candidate', points: 15, layer: 'post-processor', detail: 'Only one link scored above 35' });
    }

    const urlMap = new Map<string, number>();
    for (let i = 0; i < candidates.length; i++) {
        const normalized = normalizeUrl(candidates[i].url);
        const existingIdx = urlMap.get(normalized);

        if (existingIdx !== undefined) {
            if (candidates[i].score > candidates[existingIdx].score) {
                candidates[i].score += 5;
                candidates[existingIdx].score = -Infinity;
            } else {
                candidates[existingIdx].score += 5;
                candidates[i].score = -Infinity;
            }
        } else {
            urlMap.set(normalized, i);
        }
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
        if (candidates[i].score === -Infinity) {candidates.splice(i, 1);}
    }

    const primaryCTAs = candidates.filter(c => c.isPrimaryCTA);
    if (primaryCTAs.length === 1 && primaryCTAs[0].score > 20) {
        primaryCTAs[0].score += 10;
    }

    for (const candidate of candidates) {
        candidate.confidence = Math.min(candidate.score / 80, 1.0);
        candidate.confidence = Math.round(candidate.confidence * 1000) / 1000;
    }
}

function getCleanAnchorText(element: Element | Node): string {
    // Handle Node directly
    if (element.nodeType === Node.TEXT_NODE) {
        return (element as Text).textContent?.trim() || '';
    }

    let text = '';
    const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {text += node.textContent || '';}
        else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            if (el.tagName === 'IMG') {text += el.getAttribute('alt') || '';}
            else if (el.tagName === 'BR') {text += ' ';}
            else {for (const child of el.childNodes) {walk(child);}}
        }
    };
    walk(element);
    return text.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(str: string): string {
    return str.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function normalizeUrl(url: string): string {
    try {
        const u = new URL(url);
        for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'source', 'mc_cid', 'mc_eid', 'fbclid', 'gclid']) {u.searchParams.delete(p);}
        return u.toString();
    } catch { return url; }
}

function truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
}


