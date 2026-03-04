// src/services/extraction/providerDetector.ts
// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER DETECTION ENGINE
//  Multi-signal fuzzy scoring for email provider identification
// ═══════════════════════════════════════════════════════════════════════

import { createLogger } from '../../utils/logger';
import { KnowledgeBase } from '../knowledgeBase';

import type { ProviderKnowledge, ProviderDetectionResult } from './types';

const log = createLogger('ProviderDetector');

// ═══════════════════════════════════════════════════════════════════════
//  SCORING CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

const SCORING = {
    // Provider detection weights
    domainMatch: 50,
    senderPattern: 40,
    subjectPattern: 30,
    phraseMatch: 10,
    urlDomainMatch: 20,
    brandNameMatch: 15,
    maxPhraseBonus: 30,
} as const;

// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER DETECTION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detects the email provider using multi-signal fuzzy scoring
 *
 * Analyzes multiple signals to identify the sender:
 * - Domain matching against known provider domains
 * - Sender email pattern matching
 * - Subject line patterns
 * - Common phrases in email body
 * - URL domain matching
 * - Brand name mentions
 *
 * @param senderEmail - The sender's email address
 * @param subject - The email subject line
 * @param body - The email body content
 * @param urls - Array of URLs found in the email
 * @returns Provider detection result with confidence score
 *
 * @example
 * ```typescript
 * const result = detectProvider(
 *   'noreply@google.com',
 *   'Your verification code',
 *   'Your Google verification code is 123456',
 *   ['https://accounts.google.com/...']
 * );
 * // Returns: { provider: {...}, confidence: 95, signals: ['domain', 'sender'] }
 * ```
 */
export function detectProvider(
    senderEmail: string,
    subject: string,
    body: string,
    urls: string[]
): ProviderDetectionResult {
    const fullText = `${senderEmail} ${subject} ${body}`.toLowerCase();
    const scores: Array<{ provider: ProviderKnowledge; score: number; signals: string[] }> = [];

    for (const provider of KnowledgeBase.providers) {
        let score = 0;
        const signals: string[] = [];

        // Domain match - check if sender email contains provider domain
        if (provider.domains.some((d) => senderEmail.toLowerCase().includes(d))) {
            score += SCORING.domainMatch;
            signals.push('domain');
        }

        // Sender pattern - match against known sender patterns
        if (provider.senderPatterns.some((p) => p.test(senderEmail))) {
            score += SCORING.senderPattern;
            signals.push('sender');
        }

        // Subject pattern - match against known subject patterns
        if (provider.subjectPatterns.some((p) => p.test(subject))) {
            score += SCORING.subjectPattern;
            signals.push('subject');
        }

        // Common phrases - count phrase matches in full text
        const phraseHits = provider.commonPhrases.filter((p) =>
            fullText.includes(p.toLowerCase())
        ).length;
        if (phraseHits > 0) {
            score += Math.min(phraseHits * SCORING.phraseMatch, SCORING.maxPhraseBonus);
            signals.push(`phrases(${phraseHits})`);
        }

        // URL domain - check if any URLs contain provider domain
        for (const url of urls) {
            try {
                const u = new URL(url);
                if (provider.domains.some((d) => u.hostname.includes(d))) {
                    score += SCORING.urlDomainMatch;
                    signals.push('url');
                    break;
                }
            } catch {
                // Skip invalid URLs
            }
        }

        // Brand name - check if provider name is mentioned
        if (fullText.includes(provider.name.toLowerCase())) {
            score += SCORING.brandNameMatch;
            signals.push('brand');
        }

        if (score > 0) {
            scores.push({ provider, score, signals });
        }
    }

    // No provider matched
    if (scores.length === 0) {
        return { provider: null, confidence: 0, signals: [] };
    }

    // Sort by score and return best match
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0];
    const confidence = Math.min(best.score, 100);

    log.info(`Provider: ${best.provider.name} (${confidence}%) [${best.signals.join(', ')}]`);

    return { provider: best.provider, confidence, signals: best.signals };
}

/**
 * Checks if a provider matches given criteria
 * @param provider - The provider to check
 * @param senderEmail - The sender's email address
 * @param urls - Array of URLs to check
 * @returns True if provider matches
 */
export function providerMatches(
    provider: ProviderKnowledge,
    senderEmail: string,
    urls: string[]
): boolean {
    // Check domain match
    if (provider.domains.some((d) => senderEmail.toLowerCase().includes(d))) {
        return true;
    }

    // Check sender pattern
    if (provider.senderPatterns.some((p) => p.test(senderEmail))) {
        return true;
    }

    // Check URL domains
    for (const url of urls) {
        try {
            const u = new URL(url);
            if (provider.domains.some((d) => u.hostname.includes(d))) {
                return true;
            }
        } catch {
            // Skip invalid URLs
        }
    }

    return false;
}

/**
 * Gets the expected OTP configuration for a provider
 * @param provider - The provider knowledge
 * @returns OTP length and format if known
 */
export function getProviderOtpConfig(provider: ProviderKnowledge | null): {
    length?: number;
    format?: 'numeric' | 'alphanumeric';
} {
    if (!provider) {
        return {};
    }

    return {
        length: provider.otpLength,
        format: provider.otpFormat as 'numeric' | 'alphanumeric' | undefined,
    };
}
