/**
 * Gmail Alias Generation Engine — hardened version
 *
 * Fixes:
 * - Uses crypto randomness instead of Math.random when available.
 * - Randomized aliases now include a random plus-tag, so same-site aliases do not
 *   collide after dot variations repeat.
 * - Keeps deterministic aliases stable for previews/revisits.
 * - Normalizes/validates Gmail addresses and domains consistently.
 */

export interface AliasHistoryItem {
  alias: string;
  originalEmail: string;
  type: 'combined';
  website: string;
  createdAt: number;
}

const RESERVED_DOMAIN_LABEL = 'general';
const RANDOM_TAG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const RANDOM_TAG_LENGTH = 5;
const MAX_DOT_SLOTS = 20;

const COMMON_SECOND_LEVEL_TLDS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'gov',
  'mil',
  'net',
  'nom',
  'org',
]);

// ── Hashing ──────────────────────────────────────────────────────────

/** djb2-style hash returned as an unsigned 32-bit integer. */
export function stringHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

// ── Randomness ───────────────────────────────────────────────────────

function secureRandomInt(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
    return 0;
  }

  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    // Non-security fallback for test/legacy contexts only.
    return Math.floor(Math.random() * maxExclusive);
  }

  // Rejection sampling avoids modulo bias.
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  const buf = new Uint32Array(1);

  let val = 0;
  do {
    cryptoObj.getRandomValues(buf);
    val = buf[0] ?? 0;
  } while (val >= limit);

  return val % maxExclusive;
}

function secureRandomString(length: number, alphabet = RANDOM_TAG_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[secureRandomInt(alphabet.length)];
  }
  return out;
}

// ── DOT Trick ────────────────────────────────────────────────────────

export function getDotVariation(username: string, index: number): string {
  const clean = normalizeGmailUsername(username);
  const slots = clean.length - 1;
  if (slots <= 0) {
    return clean;
  }

  const usableSlots = Math.min(slots, MAX_DOT_SLOTS);
  const maxCombos = 2 ** usableSlots;
  const pick = Math.trunc(Math.abs(index)) % maxCombos;

  let result = '';
  for (let i = 0; i < clean.length; i++) {
    result += clean[i];
    if (i < usableSlots && (pick & (1 << i)) !== 0) {
      result += '.';
    }
  }
  return result;
}

// ── Gmail detection & normalisation ──────────────────────────────────

export function isGmail(email: string): boolean {
  const parts = String(email).trim().split('@');
  if (parts.length !== 2) {
    return false;
  }
  const domain = parts[1]?.toLowerCase().trim();
  return domain === 'gmail.com' || domain === 'googlemail.com';
}

export function normalizeGmailUsername(username: string): string {
  return String(username)
    .toLowerCase()
    .replace(/\+.*$/, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseEmail(email: string): { username: string; domain: string } | null {
  const [username, domain, ...extra] = String(email).trim().split('@');
  if (!username || !domain || extra.length > 0) {
    return null;
  }
  return { username, domain: domain.toLowerCase() };
}

// ── Domain helpers ───────────────────────────────────────────────────

export function normalizeAliasDomain(domain: string): string {
  const trimmed = String(domain || '')
    .trim()
    .toLowerCase();
  if (!trimmed) {
    return RESERVED_DOMAIN_LABEL;
  }

  try {
    // chrome://, about:, file:, and extension pages should not become labels.
    if (/^(chrome|chrome-extension|edge|brave|about|file):/i.test(trimmed)) {
      return RESERVED_DOMAIN_LABEL;
    }

    const parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return normalizeHostname(parsed.hostname);
  } catch {
    return normalizeHostname(trimmed.split(/[/?#]/)[0] || '');
  }
}

export function getAliasPlusSuffix(domain: string): string {
  const cleanDomain = normalizeAliasDomain(domain);
  const parts = cleanDomain.split('.').filter(Boolean);
  let brandName = parts[0] || RESERVED_DOMAIN_LABEL;

  if (parts.length > 1) {
    const secondLevel = parts[parts.length - 2];
    if (
      parts.length > 2 &&
      secondLevel &&
      COMMON_SECOND_LEVEL_TLDS.has(secondLevel) &&
      secondLevel.length <= 3
    ) {
      brandName = parts[parts.length - 3] || RESERVED_DOMAIN_LABEL;
    } else {
      brandName = secondLevel || RESERVED_DOMAIN_LABEL;
    }
  }

  return brandName.replace(/[^a-z0-9]/g, '').slice(0, 15) || RESERVED_DOMAIN_LABEL;
}

// ── Alias generators ─────────────────────────────────────────────────

export function getDeterministicCombinedAlias(email: string, domain: string): string {
  const parsed = parseEmail(email);
  if (!parsed || !isGmail(email)) {
    return email;
  }

  const normalizedUsername = normalizeGmailUsername(parsed.username);
  if (!normalizedUsername) {
    return email;
  }

  const cleanDomain = normalizeAliasDomain(domain);
  const dotPart = getDotVariation(normalizedUsername, stringHash(cleanDomain));
  const plusSuffix = getAliasPlusSuffix(cleanDomain);

  return `${dotPart}+${plusSuffix}@${parsed.domain}`;
}

export function getRandomizedGmailAlias(email: string, domain: string): string {
  const parsed = parseEmail(email);
  if (!parsed || !isGmail(email)) {
    return email;
  }

  const normalizedUsername = normalizeGmailUsername(parsed.username);
  if (!normalizedUsername) {
    return email;
  }

  const maxDotCombinations =
    2 ** Math.min(Math.max(normalizedUsername.length - 1, 0), MAX_DOT_SLOTS);
  const randomDotIndex = secureRandomInt(maxDotCombinations);
  const dotVariedUsername = getDotVariation(normalizedUsername, randomDotIndex);

  const brandLabel = getAliasPlusSuffix(domain).slice(0, 12);
  const randomTag = secureRandomString(RANDOM_TAG_LENGTH);

  return `${dotVariedUsername}+${brandLabel}${randomTag}@${parsed.domain}`;
}

// ── Internal ─────────────────────────────────────────────────────────

function normalizeHostname(hostname: string): string {
  return (
    String(hostname || '')
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/:\d+$/, '')
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/^\.+|\.+$/g, '')
      .replace(/\.+/g, '.') || RESERVED_DOMAIN_LABEL
  );
}
