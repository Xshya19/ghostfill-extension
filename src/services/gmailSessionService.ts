/**
 * gmailSessionService — Zero-setup Gmail integration
 *
 * Detects the user's Gmail address using reliable browser-supported sources:
 *   1. chrome.identity.getProfileUserInfo() — Chrome only, instant, no setup
 *   2. Content script on open Gmail tab — reads DOM (works in Brave too)
 *   3. Manual input fallback
 */
import { createLogger } from '../utils/logger';

const log = createLogger('GmailSessionService');

export interface GmailSessionProfile {
  email: string;
  name?: string;
  picture?: string;
  source: 'chrome-identity' | 'gmail-tab' | 'manual';
}

// ─── Strategy 1: Chrome Identity API ─────────────────────────
// Uses the Google account signed into Chrome. Zero setup. Instant.
// Does NOT work in Brave (returns empty string).
export async function detectViaProfileUserInfo(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.identity?.getProfileUserInfo) {
      resolve(null);
      return;
    }
    try {
      chrome.identity.getProfileUserInfo(
        { accountStatus: 'ANY' as chrome.identity.AccountStatus },
        (info) => {
          if (chrome.runtime.lastError) {
            log.warn('getProfileUserInfo error', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          if (info?.email && info.email.includes('@')) {
            log.info('✅ Auto-detected Google account via Chrome identity', { email: info.email });
            resolve(info.email);
          } else {
            log.info('Chrome identity: no signed-in Google account detected');
            resolve(null);
          }
        }
      );
    } catch (e) {
      log.warn('getProfileUserInfo threw', e);
      resolve(null);
    }
  });
}

// ─── Strategy 2: Gmail Tab Content Script ────────────────────────
// Injects a lightweight script into an open Gmail tab to extract the email
// from the DOM. Works in Brave and any Chromium browser.
export async function detectViaGmailTab(): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return null;
  }
  try {
    const gmailTabs = await chrome.tabs.query({
      url: ['https://mail.google.com/*', 'https://inbox.google.com/*'],
    });
    if (gmailTabs.length === 0) {
      log.info('No Gmail tab open — cannot detect via DOM');
      return null;
    }
    const tab = gmailTabs[0];
    if (!tab || !tab.id) {
      return null;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Strategy A: aria-label on account menu button (most stable)
        const accountBtn = document.querySelector(
          '[aria-label*="@gmail.com"], [aria-label*="@googlemail.com"]'
        );
        if (accountBtn) {
          const label = accountBtn.getAttribute('aria-label') || '';
          const match = label.match(/[\w.+-]+@[\w.-]+\.\w+/);
          if (match) {
            return match[0];
          }
        }
        // Strategy B: meta tag with account info
        const metas = document.querySelectorAll('meta[name]');
        for (const meta of metas) {
          const content = meta.getAttribute('content') || '';
          const emailMatch = content.match(/[\w.+-]+@gmail\.com/i);
          if (emailMatch) {
            return emailMatch[0];
          }
        }
        // Strategy C: search all elements for email-like text in aria-labels
        const allWithAria = document.querySelectorAll('[aria-label]');
        for (const el of allWithAria) {
          const label = el.getAttribute('aria-label') || '';
          const emailMatch = label.match(/[\w.+-]+@[\w.-]+\.\w+/);
          if (emailMatch && (emailMatch[0].includes('gmail') || emailMatch[0].includes('google'))) {
            return emailMatch[0];
          }
        }
        // Strategy D: Read from page title pattern "Gmail - email@gmail.com"
        const titleMatch = document.title.match(/[\w.+-]+@[\w.-]+\.\w+/);
        if (titleMatch) {
          return titleMatch[0];
        }
        // Strategy E: look in inline scripts for global account data
        try {
          const scripts = document.querySelectorAll('script');
          for (const s of scripts) {
            const text = s.textContent || '';
            if (text.includes('@gmail.com')) {
              const emailMatch = text.match(/"([\w.+-]+@gmail\.com)"/);
              if (emailMatch) {
                return emailMatch[1];
              }
            }
          }
        } catch {
          /* Intentionally ignored */
        }
        return null;
      },
    });
    const email = results?.[0]?.result;
    if (email && typeof email === 'string' && email.includes('@')) {
      log.info('✅ Auto-detected Gmail via tab DOM injection', { email });
      return email;
    }
    return null;
  } catch (e) {
    log.warn('Gmail tab detection failed', e);
    return null;
  }
}

// ─── Master Auto-Detect ─────────────────────────────────
// Tries all strategies in order and returns the first successful result.
export async function autoDetectGmailAccount(): Promise<GmailSessionProfile | null> {
  // Strategy 1: Chrome identity (fastest, works in Chrome)
  const chromeEmail = await detectViaProfileUserInfo();
  if (chromeEmail) {
    return { email: chromeEmail, source: 'chrome-identity' };
  }

  // Strategy 2: If a Gmail tab is open, use DOM extraction.
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    try {
      const gmailTabs = await chrome.tabs.query({
        url: ['https://mail.google.com/*', 'https://inbox.google.com/*'],
      });
      const tabId = gmailTabs[0]?.id;
      if (tabId) {
        // Try DOM parsing
        const tabEmail = await detectViaGmailTab();
        if (tabEmail) {
          return { email: tabEmail, source: 'gmail-tab' };
        }
      }
    } catch (e) {
      log.warn('Tab-based session detection failed', e);
    }
  }

  log.info('All auto-detect strategies exhausted — no active Gmail session');
  return null;
}

// ─── Open Gmail in new tab (for compose/send without API) ─────────────
export function openGmailCompose(opts?: { to?: string; subject?: string; body?: string }): void {
  const params = new URLSearchParams();
  if (opts?.to) {
    params.set('to', opts.to);
  }
  if (opts?.subject) {
    params.set('su', opts.subject);
  }
  if (opts?.body) {
    params.set('body', opts.body);
  }
  const url = 'https://mail.google.com/mail/?view=cm&fs=1&' + params.toString();
  // FIX #26: `window` is undefined in service workers
  chrome.tabs.create({ url }).catch(() => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      log.warn('Cannot open Gmail compose: no tabs API and no window context');
    }
  });
}

export function openGmailSearch(query: string): void {
  const url = 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(query);
  // FIX #26: `window` is undefined in service workers
  chrome.tabs.create({ url }).catch(() => {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    } else {
      log.warn('Cannot open Gmail search: no tabs API and no window context');
    }
  });
}
