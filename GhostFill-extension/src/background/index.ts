// Background Service Worker - Entry Point

import { initServiceWorker } from './serviceWorker';
import { setupContextMenu } from './contextMenu';
import { setupMessageHandler } from './messageHandler';
import { setupAlarms } from './alarms';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

const log = createLogger('Background');

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
    log.debug('Extension installed', { reason: details.reason });

    // Initialize core systems
    await initServiceWorker();
    await setupContextMenu();
    await setupAlarms();

    // Clear old data and regenerate on BOTH install AND update
    if (details.reason === 'install' || details.reason === 'update') {
        const { identityService } = await import('../services/identityService');
        const { emailService } = await import('../services/emailServices');
        const { storageService } = await import('../services/storageService');

        // CLEAR OLD DATA - Fresh start
        log.info('🧹 Clearing old data for fresh start...');
        try {
            await chrome.storage.local.clear();
            log.info('✅ Storage cleared successfully');
        } catch (e) {
            log.warn('Failed to clear storage', e);
        }

        // AUTO-MAGIC: Generate identity AND email immediately
        log.info('🚀 Generating fresh identity and email...');
        const identity = identityService.generateIdentity();
        await identityService.saveIdentity(identity);

        // Also generate email so user doesn't have to click "Generate"
        try {
            const email = await emailService.generateEmail();
            log.info('Auto-generated email', { email: email.fullEmail });
        } catch (error) {
            log.warn('Failed to auto-generate email, user will need to generate manually', error);
        }

        // Only open onboarding on fresh install, not update
        if (details.reason === 'install') {
            chrome.tabs.create({
                url: chrome.runtime.getURL('options.html?welcome=true'),
            });
        }
    }
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
    log.debug('Extension started');
    await initServiceWorker();
    await setupContextMenu();
    await setupAlarms();
});

// Setup message handling
setupMessageHandler();

// =============================================================================
// ON-DEMAND POLLING: Email checking only starts when user clicks floating button
// This prevents rate limiting and saves resources
// NOTE: Alarms are already set up in onInstalled and onStartup handlers above
// =============================================================================
log.info('📧 On-demand email polling mode - waiting for user action');

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
    log.debug('Command received', { command });

    switch (command) {
        case 'generate-email': {
            const { emailService } = await import('../services/emailServices');
            const email = await emailService.generateEmail();

            // Copy to clipboard and notify
            const { clipboardService } = await import('../services/clipboardService');
            await clipboardService.copyEmail(email.fullEmail);

            const { notifySuccess } = await import('./notifications');
            notifySuccess('GhostFill: Email Generated', `${email.fullEmail} copied to clipboard!`);
            break;
        }

        case 'generate-password': {
            const { passwordService } = await import('../services/passwordService');
            const result = await passwordService.generate();

            const { clipboardService: clipboard } = await import('../services/clipboardService');
            await clipboard.copyPassword(result.password);

            const { notifySuccess } = await import('./notifications');
            notifySuccess('GhostFill: Password Generated', 'Secure password copied to clipboard!');
            break;
        }

        case 'auto-fill': {
            // Send message to active tab to trigger auto-fill
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                await safeSendTabMessage(tab.id, { action: 'FILL_FORM' });
            }
            break;
        }
    }
});

log.debug('Background script loaded');

// ========================
// PERFORMANCE REPORT UTILITIES (Developer Access)
// ========================
// To view performance report, open Service Worker console and type:
//   printPerformanceReport()
// Or to get raw data:
//   getPerformanceReport()

// Expose performance service for DevTools access
(async () => {
    try {
        const { performanceService } = await import('../services/performanceService');

        // Make functions globally accessible in service worker console
        (globalThis as typeof globalThis & Record<string, any>).printPerformanceReport = () => performanceService.printReport();
        (globalThis as typeof globalThis & Record<string, any>).getPerformanceReport = () => performanceService.generateReport();
        (globalThis as typeof globalThis & Record<string, any>).resetPerformanceMetrics = () => performanceService.reset();

        log.debug('📊 Performance utilities available: printPerformanceReport(), getPerformanceReport(), resetPerformanceMetrics()');
    } catch (e) {
        log.warn('Performance service not loaded', e);
    }
})();
