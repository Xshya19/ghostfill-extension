// Alarms - Scheduled Tasks

import { createLogger } from '../utils/logger';
import { emailService } from '../services/emailServices';
import { otpService } from '../services/otpService';
import { linkService } from '../services/linkService';
import { storageService } from '../services/storageService';
import { updateOTPMenuItem } from './contextMenu';
import { safeSendTabMessage } from '../utils/messaging';
import { notifyNewEmail } from './notifications';
import { passwordService } from '../services/passwordService';

const log = createLogger('Alarms');

const ALARM_NAMES = {
    CHECK_INBOX: 'check-inbox',
    FAST_CHECK_INBOX: 'fast-check-inbox',
    CLEANUP: 'cleanup',
} as const;

// Track tabs waiting for OTP
const otpWaitingTabs: Map<number, { url: string; fieldSelectors: string[] }> = new Map();

/**
 * Setup alarms - ON-DEMAND MODE
 * Email polling only starts when user triggers autofill
 */
export async function setupAlarms(): Promise<void> {
    // Clear existing alarms
    await chrome.alarms.clearAll();

    // NO automatic check-inbox alarm - polling starts when user autofills
    // This prevents rate limiting and saves resources

    // Setup daily cleanup only
    chrome.alarms.create(ALARM_NAMES.CLEANUP, {
        periodInMinutes: 60 * 24, // 24 hours
    });

    // NOTE: Alarm listener is registered at module level (below) for MV3 compliance
    // NOTE: MV3 service workers don't support 'unload' events - intervals are auto-cleaned on worker termination

    log.info('Alarms setup complete (on-demand mode)');
}

// Track email polling interval with proper types
let emailPollingInterval: ReturnType<typeof setInterval> | null = null;
let emailPollingTimeout: ReturnType<typeof setTimeout> | null = null;
let emailPollingActive = false;

/**
 * Start email polling - called when user autofills a form
 * Checks inbox every 10 seconds until OTP/link is found
 */
export function startEmailPolling(): void {
    if (emailPollingActive) {
        log.debug('Email polling already active');
        return;
    }

    emailPollingActive = true;
    log.info('📧 Email polling STARTED (triggered by autofill)');

    // Immediate check
    checkInboxAlarm();

    // Then check every 10 seconds (prevents rate limiting)
    emailPollingInterval = setInterval(() => {
        checkInboxAlarm();
    }, 10000); // 10 seconds

    // Auto-stop after 2 minutes to prevent indefinite polling
    emailPollingTimeout = setTimeout(() => {
        stopEmailPolling();
    }, 120000); // 2 minutes max
}

/**
 * Stop email polling - called when OTP is filled or link is opened
 */
export function stopEmailPolling(): void {
    // Always clear resources even if not marked active (defensive cleanup)
    if (emailPollingInterval) {
        clearInterval(emailPollingInterval);
        emailPollingInterval = null;
    }
    
    if (emailPollingTimeout) {
        clearTimeout(emailPollingTimeout);
        emailPollingTimeout = null;
    }
    
    if (emailPollingActive) {
        emailPollingActive = false;
        // Also clear the fast-check-inbox Chrome alarm
        chrome.alarms.clear(ALARM_NAMES.FAST_CHECK_INBOX);
        log.info('📧 Email polling STOPPED');
    }
}

// Track fast polling interval with proper type
let fastPollingInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start fast OTP polling for a specific tab
 */
export function startFastOTPPolling(tabId: number, url: string, fieldSelectors: string[]): void {
    otpWaitingTabs.set(tabId, { url, fieldSelectors });

    // Create fast polling alarm if not exists
    chrome.alarms.get(ALARM_NAMES.FAST_CHECK_INBOX, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(ALARM_NAMES.FAST_CHECK_INBOX, {
                periodInMinutes: 0.1, // ~6 seconds (minimum stable)
            });
            log.info('Fast OTP polling alarm created', { tabId, url });
        }
    });

    // Use interval for faster 1.5s polling (aggressive but safe)
    if (!fastPollingInterval) {
        fastPollingInterval = setInterval(() => {
            if (otpWaitingTabs.size > 0) {
                checkInboxForOTP();
            } else {
                // Clean up when no tabs waiting
                if (fastPollingInterval) {
                    clearInterval(fastPollingInterval);
                    fastPollingInterval = null;
                }
            }
        }, 1500); // 1.5-second check for ultra-fast response
        log.info('Fast OTP interval started (1.5s)');
    }

    // Trigger immediate check
    checkInboxForOTP();
}

/**
 * Stop fast OTP polling for a specific tab
 */
export function stopFastOTPPolling(tabId: number): void {
    otpWaitingTabs.delete(tabId);

    // If no more tabs waiting, clear fast polling
    if (otpWaitingTabs.size === 0) {
        if (fastPollingInterval) {
            clearInterval(fastPollingInterval);
            fastPollingInterval = null;
        }
        chrome.alarms.clear(ALARM_NAMES.FAST_CHECK_INBOX);
        log.info('Fast OTP polling stopped');
    }
}

/**
 * Get tabs waiting for OTP
 */
export function getOTPWaitingTabs(): Map<number, { url: string; fieldSelectors: string[] }> {
    return otpWaitingTabs;
}

/**
 * Check inbox specifically for OTP (fast polling)
 */
async function checkInboxForOTP(): Promise<void> {
    if (otpWaitingTabs.size === 0) return;

    try {
        const currentEmail = await emailService.getCurrentEmail();
        if (!currentEmail) return;

        const cachedInbox = await emailService.getCachedInbox();
        const emails = await emailService.checkInbox(currentEmail);

        // Check for new emails
        const newEmails = emails.filter(
            (email) => !cachedInbox.find((cached) => cached.id === email.id)
        );

        for (const email of newEmails) {
            const fullEmail = await emailService.readEmail(email.id, currentEmail);

            // 🤖 AGENT 2: Extract OTP FIRST (priority over link activation)
            let otpCode: string | null = null;
            let confidence = 0;

            try {
                const otpMatch = await otpService.extractFromEmail(fullEmail.body, fullEmail.htmlBody, fullEmail.subject);
                if (otpMatch) {
                    otpCode = otpMatch.extractedValue;
                    confidence = otpMatch.confidence;
                }
            } catch (err) {
                log.warn('OTP extraction failed', err);
            }

            // 🔗 LINK ACTIVATION - ALWAYS process activation links (independent of OTP)
            // Note: OTP detection can have false positives, so we don't skip link processing
            try {
                await linkService.handleNewEmail(fullEmail);
            } catch (linkError) {
                log.warn('Link activation processing failed', linkError);
            }

            // Process found OTP
            if (otpCode) {
                await otpService.saveLastOTP(
                    otpCode,
                    'email',
                    fullEmail.from,
                    fullEmail.subject,
                    confidence
                );
                await updateOTPMenuItem();

            // TARGETED: Only send OTP to specifically tracked OTP-waiting tabs
                // This prevents cross-contamination when multiple sites are waiting for OTPs
                let autoFilled = false;
                const tabsToRemove: number[] = [];

                log.info('🎯 OTP found, checking for waiting tabs', { 
                    otpCode, 
                    waitingTabsCount: otpWaitingTabs.size,
                    waitingTabs: Array.from(otpWaitingTabs.keys())
                });

                for (const [tabId, tabInfo] of otpWaitingTabs) {
                    try {
                        await safeSendTabMessage(tabId, {
                            action: 'AUTO_FILL_OTP',
                            payload: {
                                otp: otpCode,
                                source: 'email',
                                confidence: confidence,
                            },
                        });
                        log.info('OTP sent to tracked tab', { tabId, url: tabInfo.url, otp: otpCode });
                        autoFilled = true;
                        
                        // STOP email polling - OTP was successfully filled
                        stopEmailPolling();
                        
                        // Mark for removal after successful fill
                        tabsToRemove.push(tabId);
                    } catch (error) {
                        log.warn('Failed to send OTP to tab', { tabId, error });
                        tabsToRemove.push(tabId);
                    }
                }

                // Clean up filled/errored tabs
                tabsToRemove.forEach(tabId => otpWaitingTabs.delete(tabId));

                // 🔔 ONLY notify if NOT auto-filled (avoid notification spam)
                if (!autoFilled) {
                    await notifyNewEmail(fullEmail.from, fullEmail.subject, otpCode);
                }
            }
        }
    } catch (error) {
        log.warn('Fast OTP check failed', error);
    }
}

/**
 * Handle alarm triggers
 */
async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
    log.debug('Alarm triggered', { name: alarm.name });

    switch (alarm.name) {
        case ALARM_NAMES.CHECK_INBOX:
            await checkInboxAlarm();
            break;

        case ALARM_NAMES.FAST_CHECK_INBOX:
            await checkInboxForOTP();
            break;

        case ALARM_NAMES.CLEANUP:
            await cleanupAlarm();
            break;
    }
}

/**
 * Check inbox for new emails
 */
export async function checkInboxAlarm(): Promise<void> {
    try {
        const settings = await storageService.getSettings();

        // Only check if auto-check is enabled
        if (!settings.autoCheckInbox) {
            return;
        }

        const currentEmail = await emailService.getCurrentEmail();
        if (!currentEmail) {
            return;
        }

        const cachedInbox = await emailService.getCachedInbox();
        const emails = await emailService.checkInbox(currentEmail);

        // Check for new emails
        const newEmails = emails.filter(
            (email) => !cachedInbox.find((cached) => cached.id === email.id)
        );

        if (newEmails.length > 0) {
            log.info('New emails received', { count: newEmails.length });

            // Extract OTPs and notify
            for (const email of newEmails) {
                // Get full email content
                const fullEmail = await emailService.readEmail(email.id, currentEmail);

                // Run Silent Fetch (Background Verification)
                await linkService.handleNewEmail(fullEmail);

                // Extract OTP
                const otpMatch = await otpService.extractFromEmail(fullEmail.body, fullEmail.htmlBody, fullEmail.subject);

                if (otpMatch) {
                    await otpService.saveLastOTP(
                        otpMatch.extractedValue,
                        'email',
                        fullEmail.from,
                        fullEmail.subject,
                        otpMatch.confidence
                    );
                    await updateOTPMenuItem();

                    // 🎯 AUTOFILL: Send OTP to waiting tabs
                    let autoFilled = false;
                    const tabsToRemove: number[] = [];

                    log.info('🎯 checkInboxAlarm: OTP found, sending to waiting tabs', { 
                        otpCode: otpMatch.extractedValue, 
                        waitingTabsCount: otpWaitingTabs.size,
                        waitingTabs: Array.from(otpWaitingTabs.keys())
                    });

                    for (const [tabId, tabInfo] of otpWaitingTabs) {
                        try {
                            await safeSendTabMessage(tabId, {
                                action: 'AUTO_FILL_OTP',
                                payload: {
                                    otp: otpMatch.extractedValue,
                                    source: 'email',
                                    confidence: otpMatch.confidence,
                                },
                            });
                            log.info('OTP sent to tracked tab', { tabId, url: tabInfo.url, otp: otpMatch.extractedValue });
                            autoFilled = true;
                            
                            // STOP email polling - OTP was successfully filled
                            stopEmailPolling();
                            
                            // Mark for removal after successful fill
                            tabsToRemove.push(tabId);
                        } catch (error) {
                            log.warn('Failed to send OTP to tab', { tabId, error });
                            tabsToRemove.push(tabId);
                        }
                    }

                    // Clean up filled/errored tabs
                    tabsToRemove.forEach(tabId => otpWaitingTabs.delete(tabId));

                    // Show notification with OTP ONLY if NOT auto-filled
                    if (!autoFilled && settings.notifications) {
                        chrome.notifications.create({
                            type: 'basic',
                            iconUrl: chrome.runtime.getURL('assets/icons/icon.png'),
                            title: `OTP Received: ${otpMatch.extractedValue}`,
                            message: `From: ${fullEmail.from}\n${fullEmail.subject}`,
                            priority: 2,
                            requireInteraction: true,
                        });

                        // Play sound if enabled
                        if (settings.soundEnabled) {
                            // Note: Audio playback in service workers is limited
                            // This would need to be handled via offscreen document
                        }
                    }
                } else if (settings.notifications) {
                    // Notify about new email without OTP
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: chrome.runtime.getURL('assets/icons/icon.png'),
                        title: 'New Email',
                        message: `From: ${email.from}\n${email.subject}`,
                    });
                }
            }
        }
    } catch (error) {
        log.warn('Inbox check failed', error);
    }
}

/**
 * Cleanup old data
 */
async function cleanupAlarm(): Promise<void> {
    try {
        const settings = await storageService.getSettings();
        const retentionMs = settings.historyRetentionDays * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - retentionMs;

        // Clean email history
        const emailHistory = await emailService.getHistory();
        const filteredEmails = emailHistory.filter((item) => item.createdAt > cutoff);
        if (filteredEmails.length < emailHistory.length) {
            await storageService.set('emailHistory', filteredEmails);
            log.info('Cleaned email history', { removed: emailHistory.length - filteredEmails.length });
        }

        // Clean password history
        const passwordHistory = await passwordService.getHistory();
        const filteredPasswords = passwordHistory.filter((item) => item.createdAt > cutoff);
        if (filteredPasswords.length < passwordHistory.length) {
            await storageService.set('passwordHistory', filteredPasswords);
            log.info('Cleaned password history', { removed: passwordHistory.length - filteredPasswords.length });
        }

        log.info('Cleanup complete');
    } catch (error) {
        log.error('Cleanup failed', error);
    }
}

// =============================================================================
// MV3 CRITICAL: Register alarm listener at MODULE LEVEL (synchronous)
// This ensures the service worker wakes up when alarms fire
// =============================================================================
chrome.alarms.onAlarm.addListener(handleAlarm);
log.debug('Alarm listener registered at module level');

// =============================================================================
// TAB CLEANUP: Remove closed tabs from OTP waiting list
// This prevents memory leaks when users close tabs without completing OTP flow
// =============================================================================
chrome.tabs.onRemoved.addListener((tabId) => {
    if (otpWaitingTabs.has(tabId)) {
        log.debug('Tab closed, removing from OTP waiting list', { tabId });
        otpWaitingTabs.delete(tabId);
        
        // If no more tabs waiting, stop polling
        if (otpWaitingTabs.size === 0) {
            stopEmailPolling();
            if (fastPollingInterval) {
                clearInterval(fastPollingInterval);
                fastPollingInterval = null;
            }
            chrome.alarms.clear(ALARM_NAMES.FAST_CHECK_INBOX);
        }
    }
});
