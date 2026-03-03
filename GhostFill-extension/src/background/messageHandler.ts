// ═══════════════════════════════════════════════════════════════
// ⚠️ CODE QUALITY: Large Component - Needs Refactoring
// File size: ~43KB, ~1191 lines
// TODO: Split into smaller modules:
//   - emailHandlers.ts: Email-related message handlers
//   - passwordHandlers.ts: Password-related message handlers
//   - otpHandlers.ts: OTP-related message handlers
//   - settingsHandlers.ts: Settings-related message handlers
//   - rateLimiter.ts: Rate limiting logic (extracted)
// Priority: MEDIUM - Core routing file, but handlers could be modular
// ═══════════════════════════════════════════════════════════════

// Message Handler - Routes messages between components
// ═══════════════════════════════════════════════════════════════════
// SECURITY HARDENED: Input validation, rate limiting, schema validation
// ═══════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { emailService } from '../services/emailServices';
import { identityService } from '../services/identityService';
import { linkService } from '../services/linkService';
import { otpService } from '../services/otpService';
import { passwordService } from '../services/passwordService';
import { smartDetectionService } from '../services/smartDetectionService';
import { storageService } from '../services/storageService';
import { ExtensionMessage, ExtensionResponse, UserSettings } from '../types';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

import { updateOTPMenuItem } from './contextMenu';
import { notifyNewEmail, requestNotificationPermission } from './notifications';
import { startFastOTPPolling, stopFastOTPPolling, startEmailPolling } from './pollingManager';

// SECURITY FIX: Import Zod for strict schema validation

const log = createLogger('MessageHandler');

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Zod Schema Validation for All Message Payloads
// ═══════════════════════════════════════════════════════════════════

/**
 * Email prefix validation schema
 * @security Alphanumeric only, max 20 chars, prevents injection
 */
const EmailPrefixSchema = z.string()
    .min(1, 'Email prefix must be at least 1 character')
    .max(20, 'Email prefix must be at most 20 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Email prefix must be alphanumeric only');

/**
 * Domain allowlist - Only known good domains
 * @security Prevents SSRF and malicious domain injection
 */
const ALLOWED_DOMAINS = [
    '1secmail.com', '1secmail.net', '1secmail.org',
    'mail.tm', 'mail.gw',
    'tmailor.com',
    'maildrop.cc',
    'dropmail.me',
    'guerrillamail.com',
    'tempmail.lol',
] as const;

const DomainSchema = z.enum(ALLOWED_DOMAINS);

/**
 * Email service allowlist
 * @security Only allow configured email services
 */
const EmailServiceSchema = z.enum(['tempmail', 'mailtm', 'mailgw', 'dropmail', 'guerrilla', 'templol', 'tmailor', 'maildrop', 'custom']);

/**
 * Generate email payload schema
 */
const GenerateEmailSchema = z.object({
    service: EmailServiceSchema.optional(),
    prefix: EmailPrefixSchema.optional(),
    domain: DomainSchema.optional(),
});

/**
 * OTP validation schema
 * @security Alphanumeric only, 4-10 chars, uppercase
 */
const OTPSchema = z.string()
    .min(4, 'OTP must be at least 4 characters')
    .max(10, 'OTP must be at most 10 characters')
    .regex(/^[A-Za-z0-9]+$/, 'OTP must be alphanumeric only')
    .transform(val => val.toUpperCase());

/**
 * CSS selector validation schema
 * @security Prevents DOM injection via malicious selectors
 */
const CssSelectorSchema = z.string()
    .min(1, 'Selector cannot be empty')
    .max(200, 'Selector must be at most 200 characters')
    .refine(
        (s) => !s.includes('javascript:') &&
            !s.includes('data:') &&
            !s.includes('expression(') &&
            !s.includes('onclick') &&
            !s.includes('onerror') &&
            !s.includes('onload'),
        'Selector contains dangerous patterns'
    );

/**
 * Read email payload schema
 */
const ReadEmailSchema = z.object({
    emailId: z.union([z.string(), z.number()]),
    login: z.string().email('Invalid email format'),
    domain: DomainSchema,
    service: z.enum(['tempmail', 'mailtm']),
});

/**
 * Save password payload schema
 * @security Password length limits, website URL validation
 */
const SavePasswordSchema = z.object({
    password: z.string().min(4, 'Password too short').max(256, 'Password too long'),
    website: z.string().min(1, 'Website required').max(500, 'Website URL too long'),
});

/**
 * Extract OTP payload schema
 */
const ExtractOTPSchema = z.object({
    text: z.string().min(1, 'Text required').max(50000, 'Text too long'),
});

/**
 * Fill OTP payload schema
 */
const FillOTPSchema = z.object({
    otp: OTPSchema,
    fieldSelectors: z.array(CssSelectorSchema).max(20, 'Too many selectors'),
});

/**
 * Settings update schema
 * @security Only allow known settings keys, validate values
 * FIX: Added all missing settings fields that were being rejected by validation
 */
const SettingsUpdateSchema = z.object({
    // Password settings
    passwordDefaults: z.object({
        length: z.number().min(8).max(64).optional(),
        uppercase: z.boolean().optional(),
        lowercase: z.boolean().optional(),
        numbers: z.boolean().optional(),
        symbols: z.boolean().optional(),
        excludeAmbiguous: z.boolean().optional(),
        excludeSimilar: z.boolean().optional(),
    }).optional(),

    // Email settings
    preferredEmailService: z.enum(['1secmail', 'mailgw', 'mailtm', 'dropmail', 'guerrilla', 'tempmail', 'templol', 'tmailor', 'maildrop', 'custom']).optional(),
    autoCheckInbox: z.boolean().optional(),
    checkIntervalSeconds: z.number().min(3).max(60).optional(),

    // UI settings
    darkMode: z.union([z.boolean(), z.literal('system')]).optional(),
    showFloatingButton: z.boolean().optional(),
    floatingButtonPosition: z.enum(['right', 'left']).optional(),

    // Behavior settings
    autoFillOTP: z.boolean().optional(),
    keyboardShortcuts: z.boolean().optional(),
    notifications: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    autoConfirmLinks: z.boolean().optional(),

    // Privacy settings
    saveHistory: z.boolean().optional(),
    historyRetentionDays: z.number().min(1).max(365).optional(),
    clearOnClose: z.boolean().optional(),

    // Advanced settings
    debugMode: z.boolean().optional(),
    analyticsEnabled: z.boolean().optional(),
    useLLMParser: z.boolean().optional(),

    // Custom domain settings (API keys excluded for security - stored in session only)
    customDomain: z.string().max(253).optional(),
    customDomainUrl: z.string().url().optional(),
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Rate Limiting Implementation
// ═══════════════════════════════════════════════════════════════════

interface RateLimitEntry {
    count: number;
    firstAttempt: number;
    violations: number;
    blockedUntil?: number;
}

interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    blockDurationMs: number;
}

/**
 * Rate limit configurations per action type
 * @security Prevents abuse and DoS attacks
 */
const RATE_LIMITS: Record<string, RateLimitConfig> = {
    // Email operations (external calls should be limited, internal fast)
    'GENERATE_EMAIL': { maxRequests: 10, windowMs: 60000, blockDurationMs: 60000 },
    'GET_CURRENT_EMAIL': { maxRequests: 100, windowMs: 60000, blockDurationMs: 120000 },
    'CHECK_INBOX': { maxRequests: 10, windowMs: 60000, blockDurationMs: 60000 },

    // Password operations (local)
    'GENERATE_PASSWORD': { maxRequests: 100, windowMs: 60000, blockDurationMs: 60000 },
    'SAVE_PASSWORD': { maxRequests: 100, windowMs: 60000, blockDurationMs: 60000 },

    // Identity operations (frequent from content scripts)
    'GET_IDENTITY': { maxRequests: 200, windowMs: 60000, blockDurationMs: 60000 },
    'GENERATE_IDENTITY': { maxRequests: 30, windowMs: 60000, blockDurationMs: 60000 },

    // OTP operations (local logic)
    'EXTRACT_OTP': { maxRequests: 50, windowMs: 60000, blockDurationMs: 60000 },
    'FILL_OTP': { maxRequests: 50, windowMs: 60000, blockDurationMs: 60000 },

    // Settings
    'UPDATE_SETTINGS': { maxRequests: 50, windowMs: 60000, blockDurationMs: 60000 },
};

/**
 * Rate limit state per sender
 */
const rateLimitState = new Map<string, Map<string, RateLimitEntry>>();

/**
 * Check and update rate limit for a sender
 * @security Implements exponential backoff for repeated violations
 */
function checkRateLimit(senderId: string, action: string): { allowed: boolean; retryAfter?: number; violationCount?: number } {
    const config = RATE_LIMITS[action];
    if (!config) {
        return { allowed: true }; // No rate limit for this action
    }

    const now = Date.now();

    // Get or create sender's rate limit map
    if (!rateLimitState.has(senderId)) {
        rateLimitState.set(senderId, new Map());
    }
    const senderLimits = rateLimitState.get(senderId)!;

    // Get or create entry for this action
    if (!senderLimits.has(action)) {
        senderLimits.set(action, { count: 0, firstAttempt: now, violations: 0 });
    }
    const entry = senderLimits.get(action)!;

    // Check if currently blocked
    if (entry.blockedUntil && now < entry.blockedUntil) {
        return {
            allowed: false,
            retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
            violationCount: entry.violations
        };
    }

    // Reset window if expired
    if (now - entry.firstAttempt > config.windowMs) {
        entry.count = 0;
        entry.firstAttempt = now;
        entry.blockedUntil = undefined;
    }

    // Increment count
    entry.count++;

    // Check if exceeded
    if (entry.count > config.maxRequests) {
        entry.violations++;

        // Exponential backoff: block duration doubles with each violation
        const backoffMultiplier = Math.pow(2, Math.min(entry.violations - 1, 5)); // Cap at 32x
        entry.blockedUntil = now + (config.blockDurationMs * backoffMultiplier);

        // Log violation
        log.warn('Rate limit exceeded', {
            senderId,
            action,
            violations: entry.violations,
            blockDuration: entry.blockedUntil - now,
        });

        return {
            allowed: false,
            retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
            violationCount: entry.violations
        };
    }

    return { allowed: true, violationCount: entry.violations };
}

/**
 * Clean up old rate limit entries (call periodically)
 */
function cleanupRateLimits(): void {
    const now = Date.now();
    const maxAge = 3600000; // 1 hour

    for (const [senderId, limits] of rateLimitState.entries()) {
        for (const [action, entry] of limits.entries()) {
            if (now - entry.firstAttempt > maxAge) {
                limits.delete(action);
            }
        }
        if (limits.size === 0) {
            rateLimitState.delete(senderId);
        }
    }
}

// Clean up rate limits every 10 minutes
setInterval(cleanupRateLimits, 600000);

// ═══════════════════════════════════════════════════════════════════
// SECURITY: Input Validation Helpers (Legacy + Zod)
// ═══════════════════════════════════════════════════════════════════

/**
 * Get sender ID for rate limiting
 */
function getSenderId(sender: chrome.runtime.MessageSender): string {
    return `tab:${sender.tab?.id || 'popup'}:${sender.url || 'unknown'}`;
}

// Configuration
const MESSAGE_TIMEOUT_MS = 60000; // 60 second timeout for all messages to accommodate network delays

/**
 * Setup message handler
 * @security Added rate limiting check before processing any message
 * @fix CRITICAL: Added timeout protection to prevent hanging responses
 */
export function setupMessageHandler(): void {
    chrome.runtime.onMessage.addListener(
        (message: ExtensionMessage, sender, sendResponse) => {
            const action = message?.action || 'UNKNOWN';
            const senderId = getSenderId(sender);
            const senderTabId = sender.tab?.id || 'popup';
            const startTime = Date.now();

            log.debug('Message received', { action, from: senderTabId });

            // CRITICAL FIX: Wrap everything in try-catch to ensure we ALWAYS send a response
            try {
                // SECURITY FIX: Check rate limit before processing
                const rateLimitResult = checkRateLimit(senderId, action);

                if (!rateLimitResult.allowed) {
                    log.warn('Rate limit blocked message', {
                        action,
                        retryAfter: rateLimitResult.retryAfter,
                        violations: rateLimitResult.violationCount,
                    });
                    sendResponse({
                        success: false,
                        error: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfter} seconds.`,
                        rateLimited: true,
                        retryAfter: rateLimitResult.retryAfter,
                        action,
                    });
                    return false; // Don't keep channel open for rate-limited requests
                }

                // CRITICAL FIX: Create a timeout promise to prevent hanging
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const timeoutPromise = new Promise<ExtensionResponse>((_, reject) => {
                    timeoutId = setTimeout(() => {
                        log.error('Message handler timeout', {
                            action,
                            elapsed: Date.now() - startTime,
                            sender: senderTabId
                        });
                        reject(new Error(`Message handler timeout after ${MESSAGE_TIMEOUT_MS}ms`));
                    }, MESSAGE_TIMEOUT_MS);
                });

                // Handle async with timeout race
                Promise.race([handleMessage(message, sender), timeoutPromise])
                    .then((response) => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        const elapsed = Date.now() - startTime;
                        log.debug('Message handled successfully', { action, elapsed, from: senderTabId });

                        // Ensure response has action for debugging
                        const responseWithAction = {
                            ...response,
                            action,
                            elapsed,
                        };
                        sendResponse(responseWithAction);
                    })
                    .catch((error) => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                        const errorMsg = error instanceof Error ? error.message : String(error);
                        const elapsed = Date.now() - startTime;

                        log.error('Message handling failed', {
                            action,
                            error: errorMsg,
                            elapsed,
                            from: senderTabId,
                            stack: error instanceof Error ? error.stack : undefined,
                        });

                        sendResponse({
                            success: false,
                            error: errorMsg,
                            action,
                            elapsed,
                        });
                    });

                return true; // Keep channel open for async response

            } catch (error) {
                // CRITICAL FALLBACK: This should never happen, but if it does, send error response
                const errorMsg = error instanceof Error ? error.message : String(error);
                log.error('CRITICAL: Message handler threw synchronously', {
                    action,
                    error: errorMsg,
                    from: senderTabId,
                });

                try {
                    sendResponse({
                        success: false,
                        error: `Critical handler error: ${errorMsg}`,
                        action,
                        critical: true,
                    });
                } catch (sendError) {
                    // If we can't even send the error response, log it
                    log.error('CRITICAL: Failed to send error response', sendError);
                }

                return false;
            }
        }
    );

    log.debug('Message handler setup complete with rate limiting and timeout protection');
}

/**
 * Route message to appropriate handler
 * @security All handlers now use Zod schema validation
 */
async function handleMessage(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
    switch (message.action) {
        // Email actions
        case 'GENERATE_EMAIL': {
            return handleGenerateEmail(message);
        }

        case 'GET_CURRENT_EMAIL': {
            return handleGetCurrentEmail();
        }

        case 'CHECK_INBOX': {
            return handleCheckInbox();
        }

        case 'READ_EMAIL': {
            return handleReadEmail(message);
        }

        case 'GET_EMAIL_HISTORY': {
            return handleGetEmailHistory();
        }

        // Password actions
        case 'GENERATE_PASSWORD': {
            return handleGeneratePassword(message);
        }

        case 'GET_PASSWORD_HISTORY': {
            return handleGetPasswordHistory();
        }

        case 'SAVE_PASSWORD': {
            return handleSavePassword(message);
        }

        // Identity actions
        case 'GET_IDENTITY': {
            return handleGetIdentity();
        }

        case 'GENERATE_IDENTITY': {
            return handleGenerateIdentity();
        }

        case 'REFRESH_IDENTITY': {
            return handleRefreshIdentity();
        }

        // OTP actions
        case 'EXTRACT_OTP': {
            return handleExtractOTP(message);
        }

        case 'GET_LAST_OTP': {
            return handleGetLastOTP();
        }

        case 'FILL_OTP': {
            return handleFillOTP(message, sender);
        }

        case 'OTP_PAGE_DETECTED': {
            return handleOTPPageDetected(message, sender);
        }

        case 'OTP_PAGE_LEFT': {
            return handleOTPPageLeft(sender);
        }

        // Settings actions
        case 'GET_SETTINGS': {
            return handleGetSettings();
        }

        case 'UPDATE_SETTINGS': {
            return handleUpdateSettings(message);
        }

        // Clipboard operations (from content script)
        case 'CLIPBOARD_OPERATION_FAILED': {
            return handleClipboardOperationFailed(message);
        }

        // Form detection (from content script)
        case 'DETECT_FORMS':
            return { success: true }; // Handled by content script

        case 'ANALYZE_DOM': {
            return handleAnalyzeDOM(message);
        }



        default:
            log.warn('Unknown message action', { action: message.action });
            return { success: false, error: 'Unknown action' };
    }
}

async function handleAnalyzeDOM(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const payload = (message as { payload?: { simplifiedDOM?: string } }).payload;
        const simplifiedDOM = payload?.simplifiedDOM || '';
        log.debug('ANALYZE_DOM: using Smart Detection on DOM text');

        // Use deep semantic DOM understanding if possible
        const result = await smartDetectionService.analyzeForm(simplifiedDOM);

        return {
            success: true,
            ...(result as unknown as Record<string, unknown>)
        };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error('handleAnalyzeDOM failed', error);
        return { success: false, error: msg };
    }
}

// Email Handlers

/**
 * Handle generate email request
 * @security Zod schema validation for all inputs
 */
async function handleGenerateEmail(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        log.info('📧 Handling GENERATE_EMAIL request...');

        // SECURITY FIX: Validate payload with Zod schema
        const payload = (message as { payload?: Record<string, unknown> }).payload || {};
        log.debug('Payload:', payload);

        const validatedPayload = GenerateEmailSchema.parse(payload);
        log.debug('Validated payload:', validatedPayload);

        log.info('Calling emailService.generateEmail...');
        const email = await emailService.generateEmail(validatedPayload);
        log.info('✅ Email generated successfully:', email.fullEmail);

        // Request notification permission when email is generated
        await requestNotificationPermission().catch(e => log.warn('Failed to request notification permission', e));

        // Start email polling to check for incoming emails
        startEmailPolling();
        log.debug('Email polling started');

        return { success: true, email };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? (error.stack || 'No stack trace') : 'No stack trace';
        log.error('❌ Error generating email:', {
            error: errorMsg,
            stack: errorStack.substring(0, 500),
        });
        return { success: false, error: errorMsg };
    }
}

async function handleGetCurrentEmail(): Promise<ExtensionResponse> {
    try {
        const email = await emailService.getCurrentEmail();
        return { success: true, email: email || undefined };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

async function handleCheckInbox(): Promise<ExtensionResponse> {
    try {
        const currentEmail = await emailService.getCurrentEmail();
        if (!currentEmail) {
            return { success: false, error: 'No active email' };
        }

        const emails = await emailService.checkInbox(currentEmail);

        for (const email of emails) {
            if (!email.read && (email.body || email.htmlBody)) {
                const detection = await smartDetectionService.detect(
                    email.subject,
                    email.body,
                    email.htmlBody,
                    email.from
                );

                if ((detection.type === 'otp' || detection.type === 'both') && detection.code) {
                    email.otpExtracted = detection.code;
                    await otpService.saveLastOTP(
                        detection.code,
                        'email',
                        email.from,
                        email.subject,
                        detection.confidence
                    );
                    await updateOTPMenuItem();
                    await notifyNewEmail(email.from, email.subject, detection.code);

                }

                // Link notification (tab already opened by pollingManager)
                if ((detection.type === 'link' || detection.type === 'both') && detection.link) {
                    await notifyNewEmail(email.from, email.subject, undefined, detection.link);
                }

                // If no OTP and no link, just notify new email
                if (detection.type === 'none') {
                    await notifyNewEmail(email.from, email.subject);
                }
            }
        }

        return { success: true, emails };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Handle read email request
 * @security Zod schema validation for email ID, login, domain, service
 */
async function handleReadEmail(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        // SECURITY FIX: Validate payload with Zod schema
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        if (!payload) {
            return { success: false, error: 'Missing payload' };
        }
        const validatedPayload = ReadEmailSchema.parse(payload);

        const currentEmail = await emailService.getCurrentEmail();

        if (!currentEmail) {
            return { success: false, error: 'No active email' };
        }

        const email = await emailService.readEmail(
            validatedPayload.emailId,
            currentEmail
        );

        // Extract OTP using Tri-State Engine
        let otp: string | undefined;

        const detection = await smartDetectionService.detect(
            email.subject,
            email.body,
            email.htmlBody,
            email.from
        );

        if ((detection.type === 'otp' || detection.type === 'both') && detection.code) {
            otp = detection.code;
            await otpService.saveLastOTP(otp, 'email', email.from, email.subject, detection.confidence);
            await updateOTPMenuItem();
        }

        // Check for activation links
        await linkService.handleNewEmail(email);

        return { success: true, email, otp };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

async function handleGetEmailHistory(): Promise<{ success: boolean; history?: unknown[]; error?: string }> {
    try {
        const history = await emailService.getHistory();
        return { success: true, history };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

// Password Handlers
async function handleGeneratePassword(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        const options = payload || {};

        log.debug('handleGeneratePassword: received options', options);

        const result = passwordService.generate(options);

        log.debug('handleGeneratePassword: generated result', {
            hasPassword: !!result?.password,
            passwordLength: result?.password?.length,
            hasStrength: result?.strength !== undefined,
            hasEntropy: result?.strength?.entropy !== undefined,
        });

        // Ensure result has required fields
        if (!result || typeof result.password !== 'string' || result.password.length === 0) {
            log.error('handleGeneratePassword: password service returned invalid result');
            return {
                success: false,
                error: 'Password generation failed: invalid result from service'
            };
        }

        return {
            success: true,
            result: {
                password: result.password,
                strength: result.strength ?? { score: 0, level: 'weak' as const, entropy: 0, crackTime: 'unknown', suggestions: [] },
                options: result.options,
                generatedAt: result.generatedAt ?? Date.now(),
            }
        };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log.error('handleGeneratePassword failed', { error: errorMsg, stack: error instanceof Error ? error.stack : undefined });
        return {
            success: false,
            error: `Password generation failed: ${errorMsg}`
        };
    }
}

async function handleGetPasswordHistory(): Promise<{ success: boolean; history?: unknown[]; error?: string }> {
    try {
        const history = await passwordService.getHistory();
        return { success: true, history };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Handle save password request
 * @security Zod schema validation for password and website
 */
async function handleSavePassword(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        // SECURITY FIX: Validate payload with Zod schema
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        if (!payload) {
            return { success: false, error: 'Missing payload' };
        }
        const validatedPayload = SavePasswordSchema.parse(payload);

        await passwordService.saveToHistory(validatedPayload.password, validatedPayload.website);
        return { success: true };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: `Validation error: ${error.issues.map(e => e.message).join(', ')}` };
        }
        return { success: false, error: (error as Error).message };
    }
}

// Identity Handlers

/**
 * Generate a secure random number using Web Crypto API
 * Uses rejection sampling to avoid modulo bias
 */
function getSecureRandom(max: number): number {
    const array = new Uint32Array(1);
    const maxRange = 0xFFFFFFFF - (0xFFFFFFFF % max);
    let value;
    do {
        crypto.getRandomValues(array);
        value = array[0];
    } while (value >= maxRange);
    return value % max;
}

/**
 * Generate a cryptographically secure fallback identity
 * Used when identity service is unavailable
 */
function generateFallbackIdentity(): {
    firstName: string;
    lastName: string;
    fullName: string;
    username: string;
    emailPrefix: string;
    email: string;
    password: string;
    _fallback: boolean;
    _warning: string;
} {
    const randomSuffix1 = getSecureRandom(100000).toString().padStart(5, '0');
    const randomSuffix2 = getSecureRandom(100000).toString().padStart(5, '0');
    const randomSuffix3 = getSecureRandom(100000).toString().padStart(5, '0');

    // Generate secure random password using typed array (more efficient)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    const passwordChars = new Array<string>(16);
    const randomValues = new Uint32Array(16);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 16; i++) {
        passwordChars[i] = chars[randomValues[i] % chars.length];
    }

    const validDomains = ['maildrop.cc', 'tmailor.com', 'guerrillamail.com'];
    const selectedDomain = validDomains[getSecureRandom(validDomains.length)];

    return {
        firstName: 'Ghost',
        lastName: 'User',
        fullName: 'Ghost User',
        username: 'ghost' + randomSuffix1,
        emailPrefix: 'ghost' + randomSuffix2,
        email: 'ghost' + randomSuffix3 + '@' + selectedDomain,
        password: passwordChars.join(''),
        _fallback: true,
        _warning: 'No email service available - please generate a new identity'
    };
}

/**
 * Identity retrieval strategy result
 */
interface IdentityResult {
    success: boolean;
    identity?: import('../services/identityService').IdentityProfile & { email: string; password: string };
    error?: string;
    source: 'existing' | 'generated' | 'fallback';
}

/**
 * Attempt to retrieve existing identity
 */
async function tryGetExistingIdentity(): Promise<IdentityResult> {
    try {
        const identity = await identityService.getCompleteIdentity();
        if (identity) {
            log.info('Returning existing identity', { email: identity.email });
            // Start email polling to check for incoming emails
            try {
                startEmailPolling();
            } catch (pollError) {
                log.warn('Failed to start email polling', pollError);
                // Non-fatal - continue with identity
            }
            return { success: true, identity, source: 'existing' };
        }
        return { success: false, error: 'No existing identity found', source: 'existing' };
    } catch (error) {
        log.warn('getCompleteIdentity failed', error);
        return { success: false, error: (error as Error).message, source: 'existing' };
    }
}

/**
 * Attempt to generate new identity
 */
async function tryGenerateIdentity(): Promise<IdentityResult> {
    try {
        const newIdentity = identityService.generateIdentity();
        await identityService.saveIdentity(newIdentity);
        const completeIdentity = await identityService.getCompleteIdentity();
        if (completeIdentity) {
            log.info('Generated new identity', { email: completeIdentity.email });
            // Start email polling to check for incoming emails
            try {
                startEmailPolling();
            } catch (pollError) {
                log.warn('Failed to start email polling', pollError);
                // Non-fatal - continue with identity
            }
            return { success: true, identity: completeIdentity, source: 'generated' };
        }
        return { success: false, error: 'Generated identity not retrievable', source: 'generated' };
    } catch (error) {
        log.warn('Identity generation failed', error);
        return { success: false, error: (error as Error).message, source: 'generated' };
    }
}

/**
 * Get identity with cascading fallback strategy
 * Strategy: Existing -> Generate New -> Fallback
 */
async function handleGetIdentity(): Promise<ExtensionResponse> {
    log.info('Getting identity for autofill');

    // Strategy 1: Try existing identity
    const existingResult = await tryGetExistingIdentity();
    if (existingResult.success) {
        return { success: true, identity: existingResult.identity };
    }

    // Strategy 2: Try generating new identity
    const generatedResult = await tryGenerateIdentity();
    if (generatedResult.success) {
        return { success: true, identity: generatedResult.identity };
    }

    // Strategy 3: Last resort - fallback identity
    log.warn('Using fallback identity - identity service unavailable', {
        existingError: existingResult.error,
        generatedError: generatedResult.error
    });
    const fallbackIdentity = generateFallbackIdentity();
    return { success: true, identity: fallbackIdentity };
}



async function handleGenerateIdentity(): Promise<ExtensionResponse> {
    try {
        const identity = identityService.generateIdentity();
        await identityService.saveIdentity(identity);
        return { success: true, identity };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

async function handleRefreshIdentity(): Promise<ExtensionResponse> {
    try {
        const identity = await identityService.refreshIdentity();
        return { success: true, identity };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Handle extract OTP request
 * @security Zod schema validation for text input
 */
async function handleExtractOTP(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        // SECURITY FIX: Validate payload with Zod schema
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        if (!payload) {
            return { success: false, error: 'Missing payload' };
        }
        const validatedPayload = ExtractOTPSchema.parse(payload);

        // Use AI extraction instead of regex
        const detection = await smartDetectionService.detect('', validatedPayload.text);

        if ((detection.type === 'otp' || detection.type === 'both') && detection.code) {
            return { success: true, otp: detection.code, confidence: detection.confidence };
        }

        return { success: false, error: 'No OTP found' };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: `Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}` };
        }
        return { success: false, error: (error as Error).message };
    }
}

async function handleGetLastOTP(): Promise<{ success: boolean; lastOTP?: unknown; error?: string }> {
    try {
        const lastOTP = await otpService.getLastOTP();
        return { success: true, lastOTP };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Handle fill OTP request
 * @security Zod schema validation for OTP and field selectors
 */
async function handleFillOTP(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
    try {
        // SECURITY FIX: Validate payload with Zod schema
        const payload = (message as { payload?: Record<string, unknown> }).payload;
        if (!payload) {
            return { success: false, error: 'Missing payload' };
        }
        const validatedPayload = FillOTPSchema.parse(payload);

        // Forward to content script
        if (sender.tab?.id) {
            await safeSendTabMessage(sender.tab.id, {
                action: 'FILL_OTP',
                payload: {
                    otp: validatedPayload.otp,
                    fieldSelectors: validatedPayload.fieldSelectors
                },
            });
        }

        await otpService.markAsUsed();
        return { success: true };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: `Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}` };
        }
        return { success: false, error: (error as Error).message };
    }
}

// Settings Handlers
async function handleGetSettings(): Promise<{ success: boolean; settings?: unknown; error?: string }> {
    try {
        const settings = await storageService.getSettings();
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

/**
 * Handle update settings request
 * @security Zod schema validation for settings updates
 */
async function handleUpdateSettings(message: ExtensionMessage): Promise<{ success: boolean; settings?: unknown; error?: string }> {
    try {
        // SECURITY FIX: Validate payload with Zod schema
        const updates = (message as { payload?: Record<string, unknown> }).payload || {};
        const validatedUpdates = SettingsUpdateSchema.parse(updates) as Partial<UserSettings>;
        const settings = await storageService.updateSettings(validatedUpdates);
        return { success: true, settings };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: `Validation error: ${error.issues.map((e: z.ZodIssue) => e.message).join(', ')}` };
        }
        return { success: false, error: (error as Error).message };
    }
}

// FIX Issue 8: Handle clipboard operation failures from content script
function handleClipboardOperationFailed(message: ExtensionMessage): ExtensionResponse {
    const payload = (message as { payload?: { element?: string; failureType?: string; timestamp?: number } }).payload;

    log.warn('📋 Clipboard operation failed', {
        element: payload?.element || 'unknown',
        failureType: payload?.failureType || 'unknown',
        timestamp: payload?.timestamp || Date.now()
    });

    // Note: We log the failure but don't show a notification to avoid spam
    // The content script handles user-facing error messages

    return { success: true };
}

// OTP Page Detection Handlers
function handleOTPPageDetected(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
): ExtensionResponse {
    const tabId = sender.tab?.id;
    if (!tabId) {
        return { success: false, error: 'No tab ID' };
    }

    const payload = (message as unknown as { payload: { url: string; fieldCount: number; fieldSelectors: string[] } }).payload;

    log.info('OTP page detected', { tabId, url: payload.url, fieldCount: payload.fieldCount });

    // Start fast polling for this tab
    startFastOTPPolling(tabId, payload.url, payload.fieldSelectors);

    return { success: true };
}

function handleOTPPageLeft(sender: chrome.runtime.MessageSender): ExtensionResponse {
    const tabId = sender.tab?.id;
    if (!tabId) {
        return { success: false, error: 'No tab ID' };
    }

    log.debug('OTP page left', { tabId });

    // Stop fast polling for this tab
    stopFastOTPPolling(tabId);

    return { success: true };
}

/**
 * Dump message-router stats to the console (for dev tools).
 * Called by background/index.ts dumpAllStats().
 */
export function dumpRouterStats(): void {
    log.info('📨 Message Router Stats');
    log.info('Handler: active');
}
