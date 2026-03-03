// ═══════════════════════════════════════════════════════════════════════
//  GHOSTFILL SHARED EXTRACTION TYPES
//  Centralized type definitions to prevent circular dependencies
//  Version: 2.0.0 - Consolidated & Optimized
// ═══════════════════════════════════════════════════════════════════════
//
//  ARCHITECTURE NOTES:
//  - This file should ONLY contain type definitions (no runtime code)
//  - All extraction modules import types from here (never from each other)
//  - This breaks potential circular dependencies
//
//  DEPENDENCY RULE:
//  types/extraction.types.ts ← All other service files
//  (Types file imports NOTHING from services/)
//
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
//  CORE ENUMS & UNION TYPES
// ───────────────────────────────────────────────────────────────────────

/** Email intent classification - unified across all extractors */
export type EmailIntent =
    | 'verification'
    | 'activation'
    | 'magic-link'
    | 'magic-link-login'
    | 'password-reset'
    | 'device-confirmation'
    | 'two-factor'
    | '2fa'
    | 'invitation'
    | 'account-update'
    | 'transactional'
    | 'marketing'
    | 'newsletter'
    | 'social-notification'
    | 'notification'
    | 'other'
    | 'unknown';

/** OTP/Code type classification */
export type CodeType =
    | 'otp'
    | 'verification-code'
    | 'confirmation-code'
    | 'security-code'
    | 'login-code'
    | 'two-factor-code'
    | 'password-reset-code'
    | 'pin'
    | 'magic-code'
    | 'url-embedded-code'
    | 'unknown-code';

/** Code format classification */
export type CodeFormat =
    | 'numeric'          // 482910
    | 'alphanumeric'     // A8F29K
    | 'dash-separated'   // 483-291 or A8F-29K
    | 'space-separated'  // 483 291
    | 'formatted'        // General formatted
    | 'mixed';           // Unusual format

/** OTP extraction strategy identification */
export type ExtractionStrategy =
    | 'explicit-label'          // "Your code is: 482910"
    | 'action-instruction'      // "Enter 482910 to verify"
    | 'html-prominent'          // <strong>482910</strong>
    | 'standalone-line'         // Code on its own line
    | 'url-parameter'           // ?code=482910
    | 'structured-container'    // Inside a styled code box
    | 'proximity-inference';    // Near verification language

/** Link/Activation type classification */
export type LinkType =
    | 'email-verification'
    | 'magic-link'
    | 'account-confirmation'
    | 'password-reset'
    | 'device-authorization'
    | 'identity-verification'
    | 'two-factor-setup'
    | 'invite-acceptance'
    | 'unknown-verification';

/** Pattern strength for matching algorithms */
export type PatternStrength = 'strong' | 'medium' | 'weak';

/** OTP format (legacy alias for CodeFormat) */
export type OTPFormat = CodeFormat;

/** Email category for classification results */
export type EmailCategory = 'otp' | 'link' | 'both' | 'none';

/** Email section for structural analysis */
export type EmailSection =
    | 'preheader'
    | 'header'
    | 'hero'
    | 'primary-content'
    | 'body-primary'
    | 'body-secondary'
    | 'cta-zone'
    | 'cta'
    | 'secondary-content'
    | 'footer'
    | 'legal'
    | 'social-bar'
    | 'unsubscribe-zone'
    | 'sidebar'
    | 'unknown';

/** Anti-pattern severity for rejection logic */
export type AntiPatternSeverity = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** Impact level for reasoning steps */
export type ReasoningImpact = 'strong-positive' | 'positive' | 'neutral' | 'negative' | 'strong-negative';

/** Provider category for knowledge base */
export type ProviderCategory =
    | 'auth-platform'
    | 'saas'
    | 'social'
    | 'devtools'
    | 'cloud'
    | 'finance'
    | 'productivity'
    | 'communication'
    | 'entertainment'
    | 'e-commerce'
    | 'banking'
    | 'cryptocurrency';

// ───────────────────────────────────────────────────────────────────────
//  CORE DATA INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** Extracted OTP/Code from email */
export interface ExtractedOTP {
    /** The clean, fill-ready code (dashes/spaces stripped) */
    code: string;
    /** The original raw code as found in the email */
    rawCode: string;
    /** Confidence score (0-100) */
    score: number;
    /** Calibrated confidence (0-1) */
    confidence: number;
    /** What type of code this is */
    type: CodeType;
    /** Code format */
    format: CodeFormat;
    /** How the code was found */
    strategy: ExtractionStrategy;
    /** Number of digits in the code */
    length: number;
    /** The surrounding text context */
    context: string;
    /** The label that preceded the code (if any) */
    label: string | null;
    /** Whether the code came from a URL parameter */
    fromUrl: boolean;
    /** URL parameter name (if from URL) */
    urlParam: string | null;
    /** Full URL (if from URL) */
    sourceUrl: string | null;
    /** How visually prominent the code is (0-100) */
    visualProminence: number;
    /** Provider match (if recognized) */
    providerMatch: ProviderOTPMatch | null;
    /** Scoring signals */
    matchedSignals: OTPSignal[];
    /** Why other candidates were rejected over this one */
    antiSignals: OTPSignal[];
    /** Reasoning chain */
    reasoning: OTPReasoningChain;
}

/** Extracted link from email (simplified) */
export interface ExtractedLink {
    url: string;
    confidence: number;
    type: EmailIntent | LinkType;
    anchorText: string;
    context: string;
}

/** Activation link with full analysis */
export interface ActivationLink {
    url: string;
    score: number;
    confidence: number;
    type: LinkType | EmailIntent;
    anchorText: string;
    hasEmbeddedCode: boolean;
    embeddedCode: string | null;
    embeddedCodeParam: string | null;
    section: EmailSection;
    isPrimaryCTA: boolean;
    reasoning: ReasoningChain;
    matchedSignals: ScoringSignal[];
    negativeSignals: ScoringSignal[];
    providerMatch: ProviderMatch | null;
    surroundingContext: string;
    visualWeight: number;
}

/** Unified extraction result */
export interface ExtractionResult {
    intent: EmailIntent;
    otp: ExtractedOTP | null;
    link: ExtractedLink | ActivationLink | null;
    debugInfo: {
        provider: string | null;
        intentSignals: string[];
        contextValidated: boolean;
        crossValidation?: string;
        zones?: string[];
        thresholds?: { otp: number; link: number };
        timings?: Record<string, number>;
        urlsFound?: number;
        rejectedOtps?: Array<{ code: string; reason: string }>;
        rejectedLinks?: Array<{ url: string; reason: string }>;
        intentScores?: Record<string, number>;
        patternsMatched?: string[];
        providerConfidence?: number;
        signalDensity?: number;
        extractionQuality?: 'high' | 'medium' | 'low';
        secondaryIntent?: EmailIntent | null;
    };
}

/** OTP extraction result with full analysis */
export interface OTPExtractionResult {
    /** The single best OTP code (null if none found) */
    best: ExtractedOTP | null;
    /** All candidate codes ranked by score */
    allCandidates: ExtractedOTP[];
    /** All rejected number-like strings with reasons */
    rejected: Array<{ value: string; reason: string; context: string }>;
    /** Email-level analysis */
    emailAnalysis: OTPEmailAnalysis;
    /** Performance and debug metadata */
    meta: OTPExtractionMeta;
}

/** Link extraction result with full analysis */
export interface LinkExtractionResult {
    best: ActivationLink | null;
    allCandidates: ActivationLink[];
    rejected: Array<{ url: string; reason: string; section: EmailSection }>;
    emailAnalysis: EmailAnalysis;
    meta: ExtractionMeta;
}

// ───────────────────────────────────────────────────────────────────────
//  PROVIDER KNOWLEDGE INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** Provider knowledge for OTP/link detection */
export interface ProviderKnowledge {
    name: string;
    domains: string[];
    senderPatterns: RegExp[];
    subjectPatterns: RegExp[];
    emailIntent: EmailIntent;
    otpLength?: number;
    otpFormat?: OTPFormat;
    linkPatterns: RegExp[];
    commonPhrases: string[];
    brandColors?: string[];
    confidence: number;
    industry?: string;
    country?: string;
}

/** Provider knowledge for link detection */
export interface ProviderLinkKnowledge {
    name: string;
    category: ProviderCategory;
    senderDomains: RegExp[];
    verificationUrlPatterns: RegExp[];
    codeParams: string[];
    expectedLinkType: LinkType;
    recognitionBonus: number;
}

/** Provider OTP match result */
export interface ProviderOTPMatch {
    name: string;
    expectedLength: number;
    expectedFormat: CodeFormat;
    confidence: number;
}

/** Provider match result for links */
export interface ProviderMatch {
    name: string;
    category: ProviderCategory | string;
    urlPattern: string;
    confidence: number;
}

// ───────────────────────────────────────────────────────────────────────
//  SCORING & SIGNAL INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** OTP scoring signal */
export interface OTPSignal {
    name: string;
    points: number;
    layer: string;
    detail: string;
}

/** Generic scoring signal */
export interface ScoringSignal {
    name: string;
    points: number;
    layer: string;
    detail: string;
}

/** Intent signal for classification */
export interface IntentSignal {
    type: string;
    source: string;
    detail: string;
    weight: number;
}

/** Context keyword for matching */
export interface ContextKeyword {
    keyword: string;
    weight: number;
    strength: PatternStrength;
    category: string;
}

/** Anti-pattern for rejection */
export interface AntiPattern {
    pattern: RegExp;
    name: string;
    reject: boolean;
    description: string;
    severity: AntiPatternSeverity;
}

/** OTP pattern for matching */
export interface OtpPattern {
    pattern: RegExp;
    name: string;
    baseConfidence: number;
    minLength: number;
    maxLength: number;
    isNumeric: boolean;
    providers?: string[];
    description: string;
}

/** Link pattern for matching */
export interface LinkPattern {
    pattern: RegExp;
    name: string;
    baseConfidence: number;
    type: EmailIntent;
    description: string;
}

// ───────────────────────────────────────────────────────────────────────
//  REASONING & ANALYSIS INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** OTP reasoning chain */
export interface OTPReasoningChain {
    steps: OTPReasoningStep[];
    summary: string;
    confidenceExplanation: string;
}

/** OTP reasoning step */
export interface OTPReasoningStep {
    layer: string;
    observation: string;
    conclusion: string;
    impact: ReasoningImpact;
}

/** Generic reasoning chain */
export interface ReasoningChain {
    steps: ReasoningStep[];
    summary: string;
    confidenceExplanation: string;
}

/** Generic reasoning step */
export interface ReasoningStep {
    layer: string;
    observation: string;
    conclusion: string;
    impact: ReasoningImpact;
}

/** OTP email analysis */
export interface OTPEmailAnalysis {
    intent: EmailIntent;
    intentConfidence: number;
    intentSignals: string[];
    detectedProvider: string | null;
    hasExpirationLanguage: boolean;
    hasSecurityLanguage: boolean;
    hasDontShareLanguage: boolean;
    estimatedCodeLength: number | null;
    codeWordUsed: string | null;
    totalNumbersFound: number;
}

/** Email analysis for link extraction */
export interface EmailAnalysis {
    intent: EmailIntent;
    intentConfidence: number;
    intentSignals: string[];
    detectedProvider: string | null;
    sectionMap: Map<EmailSection, { startPercent: number; endPercent: number }>;
    totalLinks: number;
    verificationLanguageStrength: number;
    urgencyLevel: number;
    securityLanguagePresent: boolean;
}

/** Email anatomy for structural analysis */
export interface EmailAnatomy {
    sections: Map<unknown, EmailSection>;
    sectionRanges: Map<EmailSection, { start: number; end: number }>;
    bodyLength: number;
}

/** Context validation result */
export interface ContextValidation {
    isValid: boolean;
    score: number;
    matchedKeywords: Array<{ keyword: string; weight: number; strength: string }>;
    semanticDistance: number;
    relationshipGraph: RelationshipGraph;
}

/** Relationship graph for context */
export interface RelationshipGraph {
    hasInstructionVerb: boolean;
    hasUrgencyIndicator: boolean;
    hasValidityPeriod: boolean;
    hasSecurityWarning: boolean;
    hasCTAProximity: boolean;
    hasCodeLabel: boolean;
}

/** Cross-validation result */
export interface CrossValidationResult {
    otpAndLinkCoexist: boolean;
    preferOTP: boolean;
    preferLink: boolean;
    reason: string;
    otpInLinkUrl: boolean;
    linkContainsOTP: boolean;
}

// ───────────────────────────────────────────────────────────────────────
//  META & PERFORMANCE INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** OTP extraction metadata */
export interface OTPExtractionMeta {
    totalNumbersScanned: number;
    candidatesFound: number;
    rejectedCount: number;
    extractionTimeMs: number;
    layersExecuted: string[];
    dominantStrategy: ExtractionStrategy | null;
}

/** Link extraction metadata */
export interface ExtractionMeta {
    totalLinksFound: number;
    candidatesFound: number;
    rejectedCount: number;
    extractionTimeMs: number;
    layersExecuted: string[];
    dominantSignal: string;
}

// ───────────────────────────────────────────────────────────────────────
//  CLASSIFICATION INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** GhostCore classification result */
export interface ClassificationResult {
    type: EmailCategory;
    confidence: number;          // 0-1
    code?: string;               // Extracted OTP code
    link?: string;               // Verification link URL
    debug?: string;              // Human-readable reasoning
    engine: 'ghost-core';
}

/** Smart detection service result */
export interface DetectionResult {
    type: 'otp' | 'link' | 'both' | 'none';
    code?: string;
    link?: string;
    confidence: number;
    engine: 'ghost-core' | 'intelligent';
    debug?: string;
}

// ───────────────────────────────────────────────────────────────────────
//  INTERNAL PROCESSING INTERFACES (for extractor implementations)
// ───────────────────────────────────────────────────────────────────────

/** Email zone for structural analysis */
export interface EmailZone {
    zone: EmailSection;
    content: string;
    htmlContent: string;
    weight: number;
    startIndex: number;
    endIndex: number;
}

/** OTP candidate for ranking */
export interface OTPCandidate {
    code: string;
    rawMatch: string;
    confidence: number;
    zone: EmailSection;
    zoneWeight: number;
    patternName: string;
    patternConfidence: number;
    contextScore: number;
    semanticDistance: number;
    antiPatternResult: AntiPatternResult;
    providerMatch: boolean;
    lengthMatch: boolean;
    formatMatch: boolean;
    surroundingText: string;
    instructionVerb: string | null;
    validityPeriod: string | null;
    securityWarning: boolean;
    isolationScore: number;
}

/** Link candidate for ranking */
export interface LinkCandidate {
    url: string;
    originalUrl: string;
    confidence: number;
    zone: EmailSection;
    zoneWeight: number;
    type: EmailIntent;
    anchorText: string;
    anchorHtml: string;
    isCTA: boolean;
    isInline: boolean;
    patternName: string | null;
    contextScore: number;
    semanticDistance: number;
    urlComplexity: number;
    hasAuthToken: boolean;
    paramAnalysis: URLParamAnalysis;
    domainTrust: number;
    surroundingText: string;
}

/** URL parameter analysis */
export interface URLParamAnalysis {
    hasToken: boolean;
    hasCode: boolean;
    hasExpiry: boolean;
    hasSignature: boolean;
    hasUserId: boolean;
    tokenLength: number;
    totalParams: number;
    suspiciousParams: string[];
}

/** Anti-pattern result */
export interface AntiPatternResult {
    isRejected: boolean;
    reason: string;
    severity: AntiPatternSeverity;
    pattern: string;
}

/** Intent result */
export interface IntentResult {
    intent: EmailIntent;
    confidence: number;
    signals: IntentSignal[];
    scores: Record<string, number>;
    secondaryIntent: EmailIntent | null;
}

/** Raw candidate for extraction */
export interface RawCandidate {
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

/** Semantic context analysis */
export interface SemanticContext {
    verificationRelevance: number;
    requestedAction: string | null;
    hasUrgency: boolean;
    hasSecurityContext: boolean;
    hasDisclaimerNearby: boolean;
    instructionText: string | null;
    sentiment: 'action-request' | 'informational' | 'warning' | 'neutral';
}

// ───────────────────────────────────────────────────────────────────────
//  SERVICE CONFIGURATION INTERFACES
// ───────────────────────────────────────────────────────────────────────

/** Encrypted cache entry structure */
export interface EncryptedCacheEntry {
    encryptedData: string;
    iv: string;
    timestamp: number;
    ttl: number;
}

/** Form analysis result */
export interface FormAnalysisResult {
    success: boolean;
    email?: string;
    password?: string;
    otp?: string;
    submit?: string;
}

// ───────────────────────────────────────────────────────────────────────
//  KNOWLEDGE BASE STRUCTURE
// ───────────────────────────────────────────────────────────────────────

/** Knowledge base container */
export interface KnowledgeBaseStructure {
    providers: ProviderKnowledge[];
    otpPatterns: OtpPattern[];
    antiPatterns: AntiPattern[];
    contextKeywords: ContextKeyword[];
    linkPatterns: LinkPattern[];
}

// ───────────────────────────────────────────────────────────────────────
//  FUNCTION TYPE INTERFACES (for dependency injection)
// ───────────────────────────────────────────────────────────────────────

/** OTP extraction function signature */
export interface OtpExtractorFn {
    (html: string, subject?: string, sender?: string): OTPExtractionResult;
}

/** Link extraction function signature */
export interface LinkExtractorFn {
    (html: string, subject?: string, sender?: string): LinkExtractionResult;
}

/** Unified extraction function signature */
export interface UnifiedExtractorFn {
    (subject: string, textBody: string, htmlBody?: string, sender?: string): ExtractionResult;
}

/** Classification function signature */
export interface ClassifierFn {
    (
        subject: string,
        textBody: string,
        htmlBody?: string,
        sender?: string,
        expectedDomains?: string[]
    ): ClassificationResult;
}
