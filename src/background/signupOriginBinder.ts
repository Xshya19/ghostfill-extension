// ═══════════════════════════════════════════════════════════════════════
//  SIGNUP-ORIGIN BINDER
// ═══════════════════════════════════════════════════════════════════════
// Why this exists (2026-11-14): the verification-link auto-open is, by
// design, bound to the site the user signed up on (fail-closed without
// that context — security fix). The generation-time context was the only
// place this binding happened, so when the popup was open on a
// non-signup tab (or a chrome:// page) at generation time, the account
// never acquired an origin and EVERY later verification link degraded
// to "show-review" — the user reported the link never opening.
//
// The fix: learn the origin at USE time from the sender tab of the
// high-signal messages the page itself produces (identity fill,
// registration form submission, OTP page detection). The tab URL is
// browser-provided and unforgeable — the payload's own `url` fields are
// page-controlled and therefore NOT trusted here.
//
// Binding semantics: latest-wins. The disposable address can be reused
// across signups; the most recent site the ghost email was used on is
// the one a verification link must bind to. Real-mail (Gmail OAuth)
// accounts are never rebound.
// ───────────────────────────────────────────────────────────────────────

import { isTemporaryMailAccount } from '../config/buildProfile';
import { storageService } from '../services/storageService';
import { createLogger } from '../utils/logger';

const log = createLogger('SignupOriginBinder');

/** http(s) origin of a tab URL, or null when there is no usable origin. */
export function originFromTabUrl(tabUrl: unknown): string | null {
  if (typeof tabUrl !== 'string' || tabUrl.length === 0) {
    return null;
  }
  try {
    const url = new URL(tabUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Bind the disposable account's `originUrl` to the given tab's origin.
 * No-ops for tab-less messages (popup-originated runtime messages), for
 * origins already stored, and for real-mail accounts.
 */
export async function maybeBindSignupOrigin(
  tabUrl: unknown,
  reason: string
): Promise<string | null> {
  const origin = originFromTabUrl(tabUrl);
  if (!origin) {
    return null;
  }
  let bound = false;
  try {
    // currentEmail first (Temp Mail sessions), then disposableEmail
    // (Gmail-preferred sessions keep the account only there).
    for (const key of ['currentEmail', 'disposableEmail'] as const) {
      const account = await storageService.get(key);
      if (!isTemporaryMailAccount(account)) {
        continue;
      }
      const stored = (account as { originUrl?: unknown }).originUrl;
      if (stored === origin) {
        return origin; // already bound — avoid a redundant write
      }
      (account as { originUrl?: string }).originUrl = origin;
      await storageService.set(key, account);
      bound = true;
    }
  } catch (error) {
    // Never block the fill/submit/detect flow on a bookkeeping write.
    log.warn('Failed to bind signup origin', { reason, error: String(error) });
    return null;
  }
  if (bound) {
    log.info('🔐 Signup origin bound from tab context', { origin, reason });
  }
  return origin;
}

/** The tab URL carried by a content-script message, if any. */
export function senderTabUrl(sender: {
  tab?: { url?: string | undefined } | undefined;
  url?: string | undefined;
}): string | undefined {
  // sender.tab.url is browser-provided; sender.url (frame URL) is the
  // fallback for framed pages. Never use payload-supplied URLs.
  return sender.tab?.url ?? sender.url;
}
