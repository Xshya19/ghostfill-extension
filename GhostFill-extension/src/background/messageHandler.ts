// Message Handler - Routes messages between components

import { createLogger } from '../utils/logger';
import { ExtensionMessage, ExtensionResponse } from '../types';
import { emailService } from '../services/emailServices';
import { passwordService } from '../services/passwordService';
import { otpService } from '../services/otpService';
import { storageService } from '../services/storageService';
import { identityService } from '../services/identityService';
import { updateOTPMenuItem } from './contextMenu';
import { startFastOTPPolling, stopFastOTPPolling } from './alarms';
import { linkService } from '../services/linkService';
import { safeSendTabMessage } from '../utils/messaging';
import { notifyNewEmail } from './notifications';
import { llmService } from '../services/llmService';

const log = createLogger('MessageHandler');

/**
 * Setup message handler
 */
export function setupMessageHandler(): void {
    chrome.runtime.onMessage.addListener(
        (message: ExtensionMessage, sender, sendResponse) => {
            log.debug('Message received', { action: message.action, from: sender.tab?.id || 'popup' });

            // Handle async
            handleMessage(message, sender)
                .then(sendResponse)
                .catch((error) => {
                    log.error('Message handling failed', error);
                    sendResponse({ success: false, error: error.message });
                });

            return true; // Keep channel open for async response
        }
    );

    log.debug('Message handler setup complete');
}

/**
 * Route message to appropriate handler
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
            return handleCheckInbox(message);
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
    log.debug('========================================');
    log.debug('🎯 ANALYZE_DOM MESSAGE RECEIVED IN BACKGROUND');
    log.debug('========================================');

    try {
        // Step 1: Extract payload
        let simplifiedDOM: string;
        try {
            simplifiedDOM = (message as { payload: { simplifiedDOM: string } }).payload?.simplifiedDOM || '';
            log.debug('📄 Step 1 OK: Simplified DOM length:', simplifiedDOM.length);
        } catch (e) {
            console.error('❌ Step 1 FAILED (payload extraction):', e);
            throw e;
        }

        // Step 2: llmService is now statically imported
        log.debug('📦 Step 2 OK: llmService available (static import)');

        // Step 3: Ensure initialized (wrapped separately)
        try {
            await llmService.ensureInitialized();
            log.debug('✅ Step 3 OK: llmService initialized');
        } catch (e) {
            console.error('❌ Step 3 FAILED (ensureInitialized):', e);
            throw e;
        }

        // Step 4: Call analyzeDOM
        try {
            log.debug('🚀 Step 4: Calling llmService.analyzeDOM()...');
            const result = await llmService.analyzeDOM(simplifiedDOM);
            log.debug('✅ Step 4 OK: analyzeDOM completed:', result);
            return { success: true, ...result };
        } catch (e) {
            console.error('❌ Step 4 FAILED (analyzeDOM):', e);
            throw e;
        }

    } catch (error: unknown) {
        // Detailed error extraction for DOMException and other errors
        const errorDetails = {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            code: (error as Error & { code?: string })?.code,
            stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
        };
        console.error('❌ handleAnalyzeDOM DETAILED ERROR:', errorDetails);
        return { success: false, error: errorDetails.message || 'Unknown error' };
    }
}

// Email Handlers
async function handleGenerateEmail(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const payload = (message as { payload?: { service?: 'tempmail' | 'mailtm'; prefix?: string; domain?: string } }).payload || {};
        const email = await emailService.generateEmail(payload);
        return { success: true, email };
    } catch (error) {
        return { success: false, error: (error as Error).message };
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

async function handleCheckInbox(_message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const currentEmail = await emailService.getCurrentEmail();
        if (!currentEmail) {
            return { success: false, error: 'No active email' };
        }

        const emails = await emailService.checkInbox(currentEmail);

        // Extract OTPs from new emails
        for (const email of emails) {
            if (!email.read && email.body) {
                const otpMatch = await otpService.extractFromEmail(email.body, email.htmlBody, email.subject);
                if (otpMatch) {
                    email.otpExtracted = otpMatch.extractedValue;
                    await otpService.saveLastOTP(
                        otpMatch.extractedValue,
                        'email',
                        email.from,
                        email.subject,
                        otpMatch.confidence
                    );
                    await updateOTPMenuItem();
                    // 🔔 INSTANT NOTIFICATION - Alert user immediately
                    await notifyNewEmail(email.from, email.subject, otpMatch.extractedValue);
                }

                // Check for activation links
                await linkService.handleNewEmail(email);
            }
        }

        return { success: true, emails };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

async function handleReadEmail(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const { emailId } = (message as { payload: { emailId: string | number; login: string; domain: string; service: 'tempmail' | 'mailtm' } }).payload;
        const currentEmail = await emailService.getCurrentEmail();

        if (!currentEmail) {
            return { success: false, error: 'No active email' };
        }

        const email = await emailService.readEmail(emailId, currentEmail);

        // Extract OTP
        let otp: string | undefined;
        const otpMatch = await otpService.extractFromEmail(email.body, email.htmlBody, email.subject);
        if (otpMatch) {
            otp = otpMatch.extractedValue;
            await otpService.saveLastOTP(otp, 'email', email.from, email.subject, otpMatch.confidence);
            await updateOTPMenuItem();
            // 🔔 INSTANT NOTIFICATION - Alert user immediately
            await notifyNewEmail(email.from, email.subject, otp);
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
        const options = (message as { payload?: object }).payload || {};
        const result = passwordService.generate(options);
        return { success: true, result };
    } catch (error) {
        return { success: false, error: (error as Error).message };
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

async function handleSavePassword(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const { password, website } = (message as { payload: { password: string; website: string } }).payload;
        await passwordService.saveToHistory(password, website);
        return { success: true };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
}

// Identity Handlers
async function handleGetIdentity(): Promise<ExtensionResponse> {
    try {
        const identity = await identityService.getCompleteIdentity();
        if (identity) {
            log.info('Returning identity for autofill', { email: identity.email });
            
            // START email polling when user autofills (on-demand mode)
            const { startEmailPolling } = await import('./alarms');
            startEmailPolling();
            
            return { success: true, identity };
        }
    } catch (error) {
        log.warn('getCompleteIdentity failed, trying fallback', error);
    }

    // Auto-generate if no identity exists
    try {
        const newIdentity = identityService.generateIdentity();
        await identityService.saveIdentity(newIdentity);
        const completeIdentity = await identityService.getCompleteIdentity();
        if (completeIdentity) {
            log.info('Generated new identity for autofill', { email: completeIdentity.email });
            return { success: true, identity: completeIdentity };
        }
    } catch (error) {
        log.warn('Identity generation failed, using hardcoded fallback', error);
    }

    // GUARANTEED FALLBACK: Always return SOMETHING so autofill works
    // Generate cryptographically secure random values
    const getSecureRandom = (max: number): number => {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        return array[0] % max;
    };
    
    const randomNum = getSecureRandom(10000).toString().padStart(4, '0');
    const randomSuffix1 = getSecureRandom(100000).toString().padStart(5, '0');
    const randomSuffix2 = getSecureRandom(100000).toString().padStart(5, '0');
    const randomSuffix3 = getSecureRandom(100000).toString().padStart(5, '0');
    
    // Generate a truly random password with mixed characters
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let fallbackPassword = '';
    for (let i = 0; i < 16; i++) {
        fallbackPassword += chars[getSecureRandom(chars.length)];
    }
    
    const fallbackIdentity = {
        firstName: 'Ghost',
        lastName: 'User',
        fullName: 'Ghost User',
        username: 'ghost' + randomSuffix1,
        emailPrefix: 'ghost' + randomSuffix2,
        email: 'ghost' + randomSuffix3 + '@tempmail.com',
        password: fallbackPassword
    };
    log.info('Using guaranteed fallback identity');
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

// OTP Handlers
async function handleExtractOTP(message: ExtensionMessage): Promise<ExtensionResponse> {
    try {
        const { text } = (message as { payload: { text: string } }).payload;
        // Use AI extraction instead of regex
        const match = await otpService.extractFromEmail(text, undefined, '');

        if (match) {
            return { success: true, otp: match.extractedValue, confidence: match.confidence };
        }

        return { success: false, error: 'No OTP found' };
    } catch (error) {
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

async function handleFillOTP(
    message: ExtensionMessage,
    sender: chrome.runtime.MessageSender
): Promise<ExtensionResponse> {
    try {
        const { otp, fieldSelectors } = (message as { payload: { otp: string; fieldSelectors: string[] } }).payload;

        // Forward to content script
        if (sender.tab?.id) {
            await safeSendTabMessage(sender.tab.id, {
                action: 'FILL_OTP',
                payload: { otp, fieldSelectors },
            });
        }

        await otpService.markAsUsed();
        return { success: true };
    } catch (error) {
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

async function handleUpdateSettings(message: ExtensionMessage): Promise<{ success: boolean; settings?: unknown; error?: string }> {
    try {
        const updates = (message as { payload?: object }).payload || {};
        const settings = await storageService.updateSettings(updates);
        return { success: true, settings };
    } catch (error) {
        return { success: false, error: (error as Error).message };
    }
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
