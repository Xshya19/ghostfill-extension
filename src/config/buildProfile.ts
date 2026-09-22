/**
 * The public distribution intentionally excludes real-mail OAuth integrations.
 * Webpack replaces this value at build time; Vitest falls back to the full
 * profile so existing integration tests retain their historical behavior.
 */
const configuredProfile =
  typeof __GHOSTFILL_BUILD_PROFILE__ === 'undefined' ? 'full' : __GHOSTFILL_BUILD_PROFILE__;

export const BUILD_PROFILE = configuredProfile === 'full' ? 'full' : 'public';
export const IS_GMAIL_ENABLED = BUILD_PROFILE === 'full';

const REAL_MAIL_SERVICES = new Set(['gmail', 'zoho', 'microsoft']);

export function isRealMailService(service: unknown): boolean {
  return typeof service === 'string' && REAL_MAIL_SERVICES.has(service);
}

export function isRealMailServiceAvailable(service: unknown): boolean {
  return IS_GMAIL_ENABLED || !isRealMailService(service);
}

export function getEffectiveEmailType(stored: unknown): 'disposable' | 'gmail' {
  return IS_GMAIL_ENABLED && stored === 'gmail' ? 'gmail' : 'disposable';
}

/** Reject saved OAuth accounts when selecting an address for temporary-mail flows. */
export function isTemporaryMailAccount(account: unknown): account is {
  fullEmail: string;
  service: string;
} {
  if (!account || typeof account !== 'object') {
    return false;
  }
  const candidate = account as { fullEmail?: unknown; service?: unknown };
  return (
    typeof candidate.fullEmail === 'string' &&
    candidate.fullEmail.includes('@') &&
    typeof candidate.service === 'string' &&
    !isRealMailService(candidate.service) &&
    !/@(gmail|googlemail)\.com$/i.test(candidate.fullEmail)
  );
}
