// src/services/extraction/linkScorer.ts
// ═══════════════════════════════════════════════════════════════════════
//  LINK SCORING UTILITIES
//  Reusable scoring functions for link evaluation
// ═══════════════════════════════════════════════════════════════════════

import type { ProviderKnowledge, EmailIntent, URLParamAnalysis } from './types';

// ═══════════════════════════════════════════════════════════════════════
//  SCORING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const SCORING = {
    // Base scores
    baseScore: 40,
    knowledgeBasePattern: 70,
    urlKeywordActivation: 70,
    urlKeywordReset: 70,
    urlKeywordMagic: 68,

    // Bonuses
    ctaButton: 20,
    anchorKeyword: 15,
    paramToken: 12,
    paramCode: 8,
    paramSignature: 8,
    paramExpiry: 5,
    longToken: 5,
    contextBonusMax: 15,
    domainTrustMax: 10,
    intentAlignment: 15,
    providerPattern: 20,
    zoneCta: 15,

    // Penalties
    zoneFooter: 18,

    // Zone weight multiplier
    zoneWeightBase: 0.55,
    zoneWeightFactor: 0.45,
} as const;

// ═══════════════════════════════════════════════════════════════════════
//  URL KEYWORD DETECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detects intent from URL keywords
 * @param url - The URL to analyze
 * @returns Detected intent and confidence
 */
export function detectIntentFromUrl(url: string): {
    intent: EmailIntent;
    confidence: number;
    patternName: string;
} {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _lower = url.toLowerCase();

    if (/verify|activate|confirm|registration|signup|auth|login|sso/i.test(url) && /token|code|key|ticket|sig|secret/i.test(url)) {
        return { intent: 'activation', confidence: SCORING.urlKeywordActivation + 5, patternName: 'url-kw-activation-strong' };
    }

    if (/verify|activate|confirm|registration|signup/i.test(url)) {
        return { intent: 'activation', confidence: SCORING.urlKeywordActivation, patternName: 'url-kw-activation' };
    }

    if (/reset|recover|password|forgot/i.test(url)) {
        return { intent: 'password-reset', confidence: SCORING.urlKeywordReset, patternName: 'url-kw-reset' };
    }

    if (/magic(?:-link)?|passwordless|signin[-_]?link/i.test(url)) {
        return { intent: 'activation', confidence: SCORING.urlKeywordMagic, patternName: 'url-kw-magic' };
    }

    return { intent: 'other', confidence: 0, patternName: '' };
}

// ═══════════════════════════════════════════════════════════════════════
//  ANCHOR TEXT SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Scores anchor text for CTA relevance
 * @param anchorText - The anchor text
 * @param isCTA - Whether it's a CTA button
 * @returns Score bonus and detected intent
 */
export function scoreAnchorText(anchorText: string, isCTA: boolean): {
    bonus: number;
    intent: EmailIntent | null;
} {
    if (!anchorText) { return { bonus: 0, intent: null }; }

    const lower = anchorText.toLowerCase();
    let bonus = 0;
    let intent: EmailIntent | null = null;

    if (isCTA) {
        bonus = SCORING.ctaButton;
        if (/verify|confirm|activate|complete|get started|click here/i.test(lower)) {
            bonus += SCORING.anchorKeyword;
            intent = 'activation';
        } else if (/reset|change|set.*password/i.test(lower)) {
            bonus += SCORING.anchorKeyword;
            intent = 'password-reset';
        }
    } else if (/verify|confirm|activate|click here|get started|complete/i.test(lower)) {
        bonus = 10;
        intent = 'activation';
    }

    return { bonus, intent };
}

// ═══════════════════════════════════════════════════════════════════════
//  PARAMETER SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculates score bonus from URL parameters
 * @param paramAnalysis - URL parameter analysis result
 * @returns Score bonus
 */
export function scoreUrlParams(paramAnalysis: URLParamAnalysis): number {
    let bonus = 0;

    if (paramAnalysis.hasToken) { bonus += SCORING.paramToken; }
    if (paramAnalysis.hasCode) { bonus += SCORING.paramCode; }
    if (paramAnalysis.hasSignature) { bonus += SCORING.paramSignature; }
    if (paramAnalysis.hasExpiry) { bonus += SCORING.paramExpiry; }
    if (paramAnalysis.tokenLength > 20) { bonus += SCORING.longToken; }

    return bonus;
}

// ═══════════════════════════════════════════════════════════════════════
//  INTENT ALIGNMENT SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculates score bonus for intent alignment
 * @param detectedType - The detected link type
 * @param emailIntent - The classified email intent
 * @param hasAuthToken - Whether URL has auth token
 * @returns Score bonus
 */
export function scoreIntentAlignment(
    detectedType: EmailIntent,
    emailIntent: EmailIntent,
    hasAuthToken: boolean
): number {
    if (detectedType === emailIntent) {
        return SCORING.intentAlignment;
    }

    if (detectedType === 'other' && emailIntent === 'activation' && hasAuthToken) {
        return 10;
    }

    return 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  ZONE SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calculates zone-based score adjustment
 * @param zone - The zone type
 * @param zoneWeight - The zone weight
 * @param baseConfidence - Base confidence before zone adjustment
 * @returns Adjusted confidence
 */
export function applyZoneScoring(zone: string, zoneWeight: number, baseConfidence: number): number {
    let adjusted = baseConfidence;

    if (zone === 'cta') {
        adjusted += SCORING.zoneCta;
    } else if (zone === 'footer') {
        adjusted -= SCORING.zoneFooter;
    }

    // Apply zone weight multiplier
    adjusted *= SCORING.zoneWeightBase + zoneWeight * SCORING.zoneWeightFactor;

    return Math.min(Math.max(adjusted, 0), 100);
}

// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER MATCH SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Checks if URL matches provider patterns
 * @param url - The URL to check
 * @param provider - Provider knowledge
 * @returns True if matched
 */
export function matchesProviderPattern(url: string, provider: ProviderKnowledge | null): boolean {
    if (!provider?.linkPatterns) { return false; }

    return provider.linkPatterns.some((p) => {
        p.lastIndex = 0;
        return p.test(url);
    });
}

// ═══════════════════════════════════════════════════════════════════════
//  COMPOSITE SCORING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Link scoring factors for detailed analysis
 */
export interface LinkScoreFactors {
    baseScore: number;
    knowledgeBaseBonus: number;
    urlKeywordBonus: number;
    anchorBonus: number;
    paramBonus: number;
    intentBonus: number;
    contextBonus: number;
    domainTrustBonus: number;
    providerBonus: number;
    zoneAdjustment: number;
    finalScore: number;
}

/**
 * Calculates detailed link scoring breakdown
 * @param options - Scoring options
 * @returns Detailed score factors
 */
export function calculateLinkScoreBreakdown(options: {
    baseConfidence: number;
    hasKnowledgeBasePattern: boolean;
    urlIntent: { intent: EmailIntent; confidence: number };
    anchorBonus: number;
    paramBonus: number;
    intentBonus: number;
    contextScore: number;
    domainTrust: number;
    hasProviderMatch: boolean;
    zone: string;
    zoneWeight: number;
}): LinkScoreFactors {
    const {
        baseConfidence,
        hasKnowledgeBasePattern,
        urlIntent,
        anchorBonus,
        paramBonus,
        intentBonus,
        contextScore,
        domainTrust,
        hasProviderMatch,
        zone,
        zoneWeight,
    } = options;

    // Start with base or knowledge base score
    let score = hasKnowledgeBasePattern ? SCORING.knowledgeBasePattern : baseConfidence;

    // Add URL keyword bonus if no knowledge base pattern
    if (!hasKnowledgeBasePattern && urlIntent.confidence > 0) {
        score = urlIntent.confidence;
    }

    const knowledgeBaseBonus = hasKnowledgeBasePattern ? SCORING.knowledgeBasePattern - baseConfidence : 0;
    const urlKeywordBonus = !hasKnowledgeBasePattern ? urlIntent.confidence - baseConfidence : 0;

    // Add bonuses
    score += anchorBonus;
    score += paramBonus;
    score += intentBonus;

    // Context bonus (capped)
    const contextBonus = Math.min(contextScore / 4, SCORING.contextBonusMax);
    score += contextBonus;

    // Domain trust bonus (capped)
    const domainTrustBonus = Math.min(domainTrust / 5, SCORING.domainTrustMax);
    score += domainTrustBonus;

    // Provider pattern bonus
    const providerBonus = hasProviderMatch ? SCORING.providerPattern : 0;
    score += providerBonus;

    // Pre-zone score
    const preZoneScore = score;

    // Apply zone adjustment
    score = applyZoneScoring(zone, zoneWeight, score);

    return {
        baseScore: baseConfidence,
        knowledgeBaseBonus,
        urlKeywordBonus,
        anchorBonus,
        paramBonus,
        intentBonus,
        contextBonus,
        domainTrustBonus,
        providerBonus,
        zoneAdjustment: score - preZoneScore,
        finalScore: score,
    };
}
