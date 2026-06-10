/**
 * gmailSessionService — Zero-setup Gmail integration
 *
 * Detects the user's Gmail address using multiple strategies, in order:
 *   1. chrome.identity.getProfileUserInfo() — Chrome only, instant, no setup
 *   2. Content script on open Gmail tab — reads DOM (works in Brave too)
 *   3. Fetch Gmail Atom feed via open tab — same-site fetch bypasses Brave cookie blocks
 *   4. Fetch Gmail Atom feed — uses existing browser session cookies
 *   5. Manual input fallback
 */
import { createLogger } from '../utils/logger';

const log = createLogger('GmailSessionService');

export interface GmailSessionProfile {
  email: string;
  name?: string;
  picture?: string;
  source: 'chrome-identity' | 'gmail-tab' | 'atom-feed' | 'manual';
}

export interface AtomFeedEmail {
  id: string;
  title: string;
  summary: string;
  from: string;
  fromEmail: string;
  date: string;
  dateMs: number;
  link: string;
}

interface AtomFeedResult {
  email: string | null;
  emails: AtomFeedEmail[];
}

/** Regex-based fallback for service worker contexts where DOMParser is unavailable. */
function parseAtomFeedRegex(xml: string): AtomFeedResult {
  // Extract author email
  const authorMatch = xml.match(/<feed[^>]*>[\s\S]*?<author>\s*<email>([^<]+)<\/email>/i);
  const email = authorMatch?.[1]?.trim() || null;

  // Extract entries
  const emails: AtomFeedEmail[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entry = entryMatch[1]!;
    const getId = (s: string) => s.match(/<id>([^<]*)<\/id>/i)?.[1] ?? '';
    const getTag = (s: string, tag: string) =>
      s.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'))?.[1] ?? '';

    const id = getId(entry);
    const title = getTag(entry, 'title') || '(No Subject)';
    const summary = getTag(entry, 'summary').trim();
    const dateStr = getTag(entry, 'modified') || getTag(entry, 'issued');
    const fromName = entry.match(/<author>\s*<name>([^<]*)<\/name>/i)?.[1] ?? '';
    const fromEmail = entry.match(/<author>\s*<email>([^<]*)<\/email>/i)?.[1] ?? '';
    const link = entry.match(/<link[^>]+href="([^"]+)"/i)?.[1] ?? '';
    const msgIdMatch = id.match(/message_id=([^&]+)/);
    const msgId = msgIdMatch?.[1] ?? id;

    emails.push({
      id: msgId,
      title,
      summary,
      from: fromName || fromEmail,
      fromEmail,
      date: dateStr,
      dateMs: dateStr ? new Date(dateStr).getTime() : Date.now(),
      link,
    });
  }

  return { email, emails };
}

/** Parse a Gmail Atom feed XML document into the logged-in email + unread entries. */
function parseAtomFeed(xml: string): AtomFeedResult {
  // FIX #25: DOMParser is unavailable in MV3 service workers.
  // Use regex-based parsing as fallback.
  if (typeof DOMParser === 'undefined') {
    return parseAtomFeedRegex(xml);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  // Extract author email (the logged-in user)
  const authorEmail = doc.querySelector('feed > author > email')?.textContent || null;

  // Extract unread emails
  const emails: AtomFeedEmail[] = [];
  doc.querySelectorAll('entry').forEach((entry) => {
    const id = entry.querySelector('id')?.textContent || '';
    const title = entry.querySelector('title')?.textContent || '(No Subject)';
    const summary = entry.querySelector('summary')?.textContent || '';
    const dateStr =
      entry.querySelector('modified')?.textContent ||
      entry.querySelector('issued')?.textContent ||
      '';
    const fromName = entry.querySelector('author > name')?.textContent || '';
    const fromEmail = entry.querySelector('author > email')?.textContent || '';
    const link = entry.querySelector('link')?.getAttribute('href') || '';
    const msgIdMatch = id.match(/message_id=([^&]+)/);
    const msgId = msgIdMatch && msgIdMatch[1] ? msgIdMatch[1] : id;

    emails.push({
      id: msgId,
      title,
      summary: summary.trim(),
      from: fromName || fromEmail,
      fromEmail,
      date: dateStr,
      dateMs: dateStr ? new Date(dateStr).getTime() : Date.now(),
      link,
    });
  });

  return { email: authorEmail, emails };
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

// ─── Strategy 3: Gmail Atom Feed Via Tab (Same-Site Fetch) ──────────────
// Injects a fetch request directly inside an active Gmail tab.
// Bypasses third-party cookie blocking policies in Brave and standard browsers.
export async function fetchAtomFeedViaTab(tabId: number): Promise<AtomFeedResult> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async () => {
        try {
          const res = await fetch('https://mail.google.com/mail/feed/atom', {
            headers: { Accept: 'application/atom+xml, application/xml, text/xml, */*' },
          });
          if (!res.ok) {
            return null;
          }
          return await res.text();
        } catch {
          return null;
        }
      },
    });
    const xml = results?.[0]?.result;
    if (!xml || typeof xml !== 'string') {
      return { email: null, emails: [] };
    }
    return parseAtomFeed(xml);
  } catch (e) {
    log.warn('fetchAtomFeedViaTab failed', e);
    return { email: null, emails: [] };
  }
}

// ─── Strategy 4: Gmail Atom Feed (Session Cookie Background Fetch) ─────────
// Fetches the Atom feed from the background service worker.
// Fallback if no Gmail tab is open.
export async function fetchAtomFeed(): Promise<AtomFeedResult> {
  try {
    const response = await fetch('https://mail.google.com/mail/feed/atom', {
      credentials: 'include', // Uses existing Gmail session cookies
      headers: { Accept: 'application/atom+xml, application/xml, text/xml, */*' },
    });
    if (response.status === 401 || response.status === 403) {
      log.info('Atom feed: not logged into Gmail');
      return { email: null, emails: [] };
    }
    if (!response.ok) {
      log.warn('Atom feed returned', response.status);
      return { email: null, emails: [] };
    }
    const xml = await response.text();
    const result = parseAtomFeed(xml);
    if (result.email) {
      log.info('✅ Gmail session active, user email detected via Atom feed', {
        authorEmail: result.email,
      });
    }
    return result;
  } catch (e) {
    log.warn('Atom feed fetch failed', e);
    return { email: null, emails: [] };
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

  // Strategy 2: If a Gmail tab is open, use DOM extraction and tab-based feed fetch (Brave-compatible)
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
        // Try tab-based Atom feed same-site fetch (bypasses Brave cookie block)
        const { email: tabFeedEmail } = await fetchAtomFeedViaTab(tabId);
        if (tabFeedEmail) {
          return { email: tabFeedEmail, source: 'atom-feed' };
        }
      }
    } catch (e) {
      log.warn('Tab-based session detection failed', e);
    }
  }

  // Strategy 3: Standard background Atom feed fetch via cookies (Chrome/Edge fallback)
  const { email: atomEmail } = await fetchAtomFeed();
  if (atomEmail) {
    return { email: atomEmail, source: 'atom-feed' };
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
