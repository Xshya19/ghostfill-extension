// LLM Service - Clean Groq API Implementation
// Uses Llama 3.1 8B Instant (560 tokens/sec) - NO REGEX

import { createLogger } from '../utils/logger';

const log = createLogger('LLMService');

// Groq API Config
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
// NOTE: API key is loaded from user settings - no hardcoded key for security
const MODEL = 'llama-3.1-8b-instant';

export interface EmailParseResult {
    verificationType: 'code' | 'link' | 'both' | 'none';
    code?: string;
    link?: string;
    confidence: number;
}

export interface LinkClassification {
    url: string;
    type: 'verification' | 'marketing' | 'spam' | 'unknown';
    confidence: number;
    reason?: string;
}

class LLMService {
    private cache = new Map<string, { result: any; timestamp: number }>();
    private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour
    private readonly MAX_CACHE_SIZE = 100; // Prevent unbounded cache growth
    private apiKey: string | null = null;
    private lastRateLimitTime = 0;
    private readonly RATE_LIMIT_COOLDOWN = 60 * 1000; // 1 minute cooldown after rate limit

    constructor() {
        // Listen for storage changes to invalidate cached API key
        if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName === 'local' && changes.settings) {
                    const newApiKey = changes.settings.newValue?.llmApiKey;
                    const oldApiKey = changes.settings.oldValue?.llmApiKey;
                    if (newApiKey !== oldApiKey) {
                        log.info('API key changed, invalidating cache');
                        this.apiKey = null; // Force re-fetch on next call
                        this.cache.clear(); // Clear results cache as they may be from different key
                    }
                }
            });
        }
    }

    /**
     * Get API key from settings (with cache invalidation support)
     */
    private async getApiKey(): Promise<string | null> {
        if (this.apiKey) return this.apiKey;
        
        try {
            const result = await chrome.storage.local.get('settings');
            if (result.settings?.llmApiKey) {
                this.apiKey = result.settings.llmApiKey;
                return this.apiKey;
            }
        } catch (e) {
            log.debug('Failed to get API key from settings');
        }
        return null;
    }

    /**
     * Clean up expired cache entries to prevent memory leaks
     */
    private cleanupCache(): void {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.CACHE_TTL) {
                this.cache.delete(key);
            }
        }
        // If still over limit, remove oldest entries
        if (this.cache.size > this.MAX_CACHE_SIZE) {
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, this.cache.size - this.MAX_CACHE_SIZE);
            toRemove.forEach(([key]) => this.cache.delete(key));
        }
    }

    // Simple hash for cache keys
    private hash(str: string): string {
        let hash = 0;
        for (let i = 0; i < Math.min(str.length, 500); i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    /**
     * Parse email to extract OTP code or activation link - AI ONLY
     */
    async parseEmail(emailBody: string, subject: string): Promise<EmailParseResult> {
        // Check cache
        const cacheKey = `email:${this.hash(emailBody + subject)}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            log.debug('Returning cached result');
            return cached.result;
        }

        try {
            const body = emailBody.substring(0, 8000);
            
            // Aggressive HTML stripping
            let cleanBody = body
                // Remove entire style blocks (with content)
                .replace(/<style[\s\S]*?<\/style>/gi, '')
                // Remove entire script blocks
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                // Remove head section
                .replace(/<head[\s\S]*?<\/head>/gi, '')
                // Remove HTML comments
                .replace(/<!--[\s\S]*?-->/g, '')
                // Remove all remaining HTML tags
                .replace(/<[^>]+>/g, ' ')
                // Decode HTML entities
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&quot;/gi, '"')
                .replace(/&#\d+;/g, ' ')
                // Remove CSS-like content that leaked through
                .replace(/[a-z-]+\s*:\s*[^;]+;/gi, '')
                .replace(/\{[^}]*\}/g, '')
                // Clean up whitespace
                .replace(/\s+/g, ' ')
                .trim()
                .substring(0, 2000);
            
            // Debug: Log what we're sending to AI
            log.debug('Email content for AI (first 500 chars):', cleanBody.substring(0, 500));
            
            const prompt = `Extract from this email: verification code OR activation link.

EMAIL:
Subject: ${subject}
Content: ${cleanBody}

RULES:
1. VERIFICATION CODE = short 4-10 digit/character code
2. ACTIVATION LINK = URL with verify/confirm/activate/token/auth

IMPORTANT: Return only content that ACTUALLY exists in the email above. Never return examples.

JSON (pick one):
{"verificationType":"code","code":"REAL_CODE_FROM_EMAIL","confidence":0.9}
{"verificationType":"link","link":"REAL_URL_FROM_EMAIL","confidence":0.9}
{"verificationType":"none","confidence":0.1}`;

            log.info('🤖 Calling Groq LLM for email parsing');
            const response = await this.callGroq(prompt);
            
            if (!response) {
                log.warn('No response from Groq');
                return { verificationType: 'none', confidence: 0 };
            }

            log.debug('Groq response:', response);
            const result = this.parseJSON(response);
            if (!result) {
                log.warn('Failed to parse JSON from response');
                return { verificationType: 'none', confidence: 0 };
            }

            // Build result
            const finalResult: EmailParseResult = {
                verificationType: result.verificationType || 'none',
                confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
            };

            // Validate code (4-10 alphanumeric)
            if (result.code) {
                const cleanCode = String(result.code).replace(/[\s\-\.]/g, '').trim();
                if (/^[A-Z0-9]{4,10}$/i.test(cleanCode)) {
                    finalResult.code = cleanCode;
                    log.info('✅ OTP extracted', { code: cleanCode });
                } else {
                    log.warn('Code failed validation', { code: cleanCode });
                }
            }

            // Validate link
            if (result.link && result.link.startsWith('http')) {
                finalResult.link = result.link;
                log.info('✅ Link extracted');
            }

            // Fix type based on what we found
            if (finalResult.code && finalResult.link) {
                finalResult.verificationType = 'both';
            } else if (finalResult.code) {
                finalResult.verificationType = 'code';
            } else if (finalResult.link) {
                finalResult.verificationType = 'link';
            } else {
                finalResult.verificationType = 'none';
            }

            // Cache
            this.cache.set(cacheKey, { result: finalResult, timestamp: Date.now() });
            return finalResult;

        } catch (error) {
            log.error('LLM parsing failed', error);
            return { verificationType: 'none', confidence: 0 };
        }
    }

    /**
     * Analyze DOM to find form fields - AI ONLY
     */
    async analyzeDOM(dom: string): Promise<{
        email?: string;
        password?: string;
        submit?: string;
        confidence: number;
    }> {
        try {
            const prompt = `Find form field CSS selectors in this HTML.
            
HTML: ${dom.substring(0, 1500)}

Return JSON only:
{"email":"#email-selector","password":"#password-selector","submit":"#submit-selector","confidence":0.8}
If no form: {"confidence":0}
JSON:`;

            const response = await this.callGroq(prompt);
            if (!response) return { confidence: 0 };

            const result = this.parseJSON(response);
            return result || { confidence: 0 };

        } catch (error) {
            log.error('DOM analysis failed', error);
            return { confidence: 0 };
        }
    }

    /**
     * Classify links as verification or marketing - AI ONLY
     */
    async classifyLinks(emailBody: string, links: string[]): Promise<LinkClassification[]> {
        if (links.length === 0) return [];

        try {
            const prompt = `Classify these links from an email as "verification" or "marketing".

Links: ${links.slice(0, 5).join('\n')}

Email context: ${emailBody.substring(0, 500)}

Return JSON array:
[{"url":"...","type":"verification","confidence":0.9}]
JSON:`;

            const response = await this.callGroq(prompt);
            if (!response) {
                return links.map(url => ({ url, type: 'unknown' as const, confidence: 0.3 }));
            }

            const result = this.parseJSON(response);
            if (Array.isArray(result)) {
                return result;
            }
            
            return links.map(url => ({ url, type: 'unknown' as const, confidence: 0.3 }));

        } catch (error) {
            log.error('Link classification failed', error);
            return links.map(url => ({ url, type: 'unknown' as const, confidence: 0.3 }));
        }
    }

    /**
     * Call Groq API
     */
    private async callGroq(prompt: string): Promise<string | null> {
        try {
            const apiKey = await this.getApiKey();
            if (!apiKey) {
                log.debug('No API key configured - LLM features disabled');
                return null;
            }

            const response = await fetch(GROQ_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [
                        { role: 'system', content: 'You are a JSON API. Respond with ONLY valid JSON. No explanations, no markdown, no text - just JSON.' },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 200,
                    temperature: 0
                })
            });

            if (!response.ok) {
                log.error('Groq API error', { status: response.status });
                return null;
            }

            const data = await response.json();
            const content = data.choices?.[0]?.message?.content;
            
            if (!content) {
                log.warn('Empty response from Groq');
                return null;
            }

            log.info('✅ Groq response received');
            return content;

        } catch (error) {
            log.error('Groq API call failed', error);
            return null;
        }
    }

    /**
     * Parse JSON from LLM response
     */
    private parseJSON(response: string): any {
        try {
            return JSON.parse(response.trim());
        } catch {
            // Try to extract JSON from markdown
            const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                try { return JSON.parse(jsonMatch[1].trim()); } catch {}
            }
            
            // Try to find JSON object/array
            const match = response.match(/[\[{][\s\S]*[\]}]/);
            if (match) {
                try { return JSON.parse(match[0]); } catch {}
            }
            
            return null;
        }
    }

    // Compatibility methods
    async init(): Promise<void> { log.info('LLM Service initialized (Groq)'); }
    async ensureInitialized(): Promise<void> { this.cleanupCache(); }
    isAvailable(): boolean { return true; }
    
    /**
     * Update API key (used when settings change externally)
     */
    setApiKey(key: string): void {
        if (key && key.length > 10) {
            this.apiKey = key;
            log.debug('API key updated via setApiKey');
        } else {
            this.apiKey = null;
            log.debug('API key cleared via setApiKey');
        }
    }

    /**
     * Clear API key cache (for security - call on logout/clear data)
     */
    clearApiKey(): void {
        this.apiKey = null;
        this.cache.clear();
        log.info('API key and cache cleared');
    }
}

export const llmService = new LLMService();
