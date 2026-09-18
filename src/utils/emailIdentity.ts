/**
 * Stable, human-readable sender identity for inbox rows, notifications, and
 * avatars. Providers frequently send machine-generated addresses such as
 * bounce+token@service.example; exposing that local part as the sender makes
 * the product look broken even when the message is valid.
 */

export interface ParsedEmailIdentity {
  readonly displayName: string;
  readonly email: string;
  readonly domain: string;
  readonly rootDomain: string;
}

const AUTOMATED_LOCAL_PART = /^(?:bounce|mailer|mail|no[-_ ]?reply|noreply|notifications?|notification|support|info|hello|accounts?|security|team)(?:[+._-]|$)/i;
const COMMON_SECOND_LEVEL_DOMAINS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'mil',
  'net',
  'nom',
  'org',
  'sch',
]);

// Keep this list intentionally small and high-confidence. The fallback below
// still turns an unknown domain into a readable brand name.
const KNOWN_BRANDS: Readonly<Record<string, string>> = {
  'apple.com': 'Apple',
  'github.com': 'GitHub',
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'notion.so': 'Notion',
  'openai.com': 'OpenAI',
  'qwen.ai': 'Qwen',
  'qwenlm.ai': 'Qwen',
  'slack.com': 'Slack',
  'vercel.com': 'Vercel',
};

function toSafeString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    for (const key of ['text', 'email', 'address', 'from', 'value']) {
      if (typeof objectValue[key] === 'string') {
        return objectValue[key] as string;
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function cleanDisplayName(value: string): string {
  return value
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getRootDomain(domain: string): string {
  const parts = domain.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }

  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (last && secondLast && COMMON_SECOND_LEVEL_DOMAINS.has(secondLast)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function parseEmailIdentity(value: unknown): ParsedEmailIdentity {
  const raw = toSafeString(value).trim();
  const angleMatch = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/.exec(raw);
  const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(
    angleMatch?.[2] ?? raw
  );
  const email = (emailMatch?.[0] ?? '').trim().toLowerCase();
  const displayName = cleanDisplayName(angleMatch?.[1] ?? (email ? raw.replace(emailMatch?.[0] ?? '', '') : raw));
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  const rootDomain = domain ? getRootDomain(domain) : '';

  return { displayName, email, domain, rootDomain };
}

function isUsefulDisplayName(displayName: string, email: string): boolean {
  if (!displayName || !displayName.includes('@')) {
    return Boolean(displayName) && !AUTOMATED_LOCAL_PART.test(displayName);
  }
  return displayName !== email && !AUTOMATED_LOCAL_PART.test(displayName.split('@')[0] ?? '');
}

function titleCaseBrand(value: string): string {
  const normalized = value.replace(/[^a-z0-9]+/gi, ' ').trim();
  if (!normalized) {
    return '';
  }
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/** Return the company/provider label users should see instead of a bounce token. */
export function getSenderLabel(value: unknown, subject?: unknown): string {
  const identity = parseEmailIdentity(value);
  if (isUsefulDisplayName(identity.displayName, identity.email)) {
    return identity.displayName;
  }

  if (identity.rootDomain) {
    const knownBrand = KNOWN_BRANDS[identity.rootDomain];
    if (knownBrand) {
      return knownBrand;
    }
    const rootParts = identity.rootDomain.split('.');
    const rootName = rootParts[0] ?? '';
    const subjectText = toSafeString(subject);
    const subjectBrand = rootName && new RegExp(`\\b${rootName.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\b`, 'i').test(subjectText)
      ? rootName
      : '';
    return titleCaseBrand(subjectBrand || rootName) || 'Unknown sender';
  }

  if (AUTOMATED_LOCAL_PART.test(identity.displayName)) {
    return 'Unknown sender';
  }

  const fallback = titleCaseBrand(identity.displayName || toSafeString(value));
  return fallback || 'Unknown sender';
}

export function getSenderEmail(value: unknown): string {
  return parseEmailIdentity(value).email;
}

export function getSenderDomain(value: unknown): string {
  return parseEmailIdentity(value).rootDomain;
}

export function isAutomatedSender(value: unknown): boolean {
  const identity = parseEmailIdentity(value);
  const localPart = identity.email.split('@')[0] ?? identity.displayName;
  return AUTOMATED_LOCAL_PART.test(localPart);
}
