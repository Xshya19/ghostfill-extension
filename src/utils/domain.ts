/**
 * Domain utilities — TLD-aware registrable-domain helpers.
 *
 * Replaces the audit-flagged `string.includes('google.com')` pattern that
 * matched `attacker@google.com.phishing.tk`. (audit §5.18)
 *
 * The Public Suffix List is *not* loaded (would be a runtime dependency);
 * a small static set of common second-level TLDs (`co.uk`, `com.au`, ...) is
 * handled, and unknown multi-part TLDs are best-effort reduced to their
 * last two labels. For risk decisions (audit §5.17 / §5.23) this is far
 * safer than `includes()`; it is not a substitute for PSL.
 */

/** Common multi-label public suffixes we care about (lowercase, no dot). */
const COMMON_SECOND_LEVEL_TLDS = new Set<string>([
  'co.uk',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.za',
  'co.in',
  'com.au',
  'com.br',
  'com.cn',
  'com.mx',
  'com.tr',
  'com.tw',
  'com.sg',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'ne.jp',
  'or.jp',
]);

/** True when `s` looks like an IP literal (v4 or bracketed v6). */
export function isIpLiteral(s: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) {
    return true;
  }
  if (/^\[.*\]$/.test(s)) {
    return true;
  }
  return false;
}

/**
 * Return the registrable ("root") domain of a hostname, or the input if it
 * can't be parsed. Lowercase, no trailing dot. For `a.b.c.example.co.uk`
 * returns `example.co.uk`. For `attacker.google.com.phishing.tk` returns
 * `attacker.google.com.phishing.tk` (no recognised public suffix -> last
 * two labels, which is intentionally distinct from `google.com`).
 */
export function rootDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || isIpLiteral(host)) {
    return host;
  }

  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }

  const lastTwo = parts.slice(-2).join('.');
  const tld = parts.slice(-2).join('.'); // e.g. "co.uk"
  if (COMMON_SECOND_LEVEL_TLDS.has(tld) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return lastTwo;
}

/**
 * True iff `hostname` is `root` or a direct subdomain of `root` (one level
 * only). e.g. `accounts.google.com` is a subdomain of `google.com`; the
 * safe lookalike `google.com.attacker.com` is NOT.
 */
export function isSubdomainOf(hostname: string, root: string): boolean {
  if (!hostname || !root) {
    return false;
  }
  const h = hostname.toLowerCase().replace(/\.$/, '');
  const r = root.toLowerCase().replace(/\.$/, '');
  if (h === r) {
    return true;
  }
  return h.endsWith('.' + r);
}

/** True iff two hostnames share the same registrable root. */
export function sameRootDomain(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return rootDomain(a) === rootDomain(b);
}

/**
 * Extract a bare email address from a `from` header that may be either
 * `"Name <user@host>"` or just `"user@host"`. Returns empty string on
 * garbage input. Used by provider detector + sender domain matchers.
 */
export function extractEmailAddress(from: string): string {
  if (!from || typeof from !== 'string') {
    return '';
  }
  const angle = from.match(/<([^>]+@[^>]+)>/);
  if (angle && angle[1]) {
    return angle[1].trim().toLowerCase();
  }
  const bare = from.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return bare && bare[0] ? bare[0].toLowerCase() : '';
}

/** Return just the host portion of an email address (lowercase). */
export function emailHost(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) {
    return '';
  }
  return email.slice(at + 1).toLowerCase();
}
