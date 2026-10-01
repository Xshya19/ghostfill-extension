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

const AUTOMATED_LOCAL_PART =
  /^(?:bounces?|mailer|mail|no[-_ ]?reply|noreply|notifications?|support|info|hello|accounts?|security|team)(?:[+._-]|$)/i;
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

function toSafeString(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object' || depth > 2) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? toSafeString(value[0], depth + 1) : '';
  }
  const objectValue = value as Record<string, unknown>;
  const name = objectValue.name || objectValue.displayName || objectValue.fromName;
  const address = objectValue.address || objectValue.email || objectValue.fromEmail;
  if (typeof name === 'string' && name.trim()) {
    return typeof address === 'string' && address.includes('@') ? `${name} <${address}>` : name;
  }
  for (const key of ['text', 'address', 'email', 'fromEmail', 'from', 'value']) {
    const source = toSafeString(objectValue[key], depth + 1);
    if (source) {
      return source;
    }
  }
  return '';
}

/** RFC 2047 display names; native TextDecoder supports the sender's charset. */
function decodeDisplayName(value: string): string {
  return value
    .replace(/(\?=)\s+(?==\?)/g, '$1')
    .replace(
      /=\?([^?\s]+)\?([BQ])\?([^?]*)\?=/gi,
      (word, charset: string, encoding: string, text: string) => {
        try {
          const binary =
            encoding.toUpperCase() === 'B'
              ? atob(text)
              : text
                  .replace(/_/g, ' ')
                  .replace(/=([0-9a-f]{2})/gi, (_, hex: string) =>
                    String.fromCharCode(parseInt(hex, 16))
                  );
          return new TextDecoder(charset, { fatal: true }).decode(
            Uint8Array.from(binary, (character) => character.charCodeAt(0))
          );
        } catch {
          return word;
        }
      }
    );
}

function cleanDisplayName(value: string): string {
  return (
    decodeDisplayName(value)
      .replace(/<[^>]*>/g, '')
      // eslint-disable-next-line no-control-regex -- Strip untrusted header control and bidi characters.
      .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
      .replace(/^['"]|['"]$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 254)
  );
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
  const raw = toSafeString(value).slice(0, 4096).trim();
  const angleMatch = /^(.*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/s.exec(raw);
  const emailMatch = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(angleMatch?.[2] ?? raw);
  const email = (emailMatch?.[0] ?? '').trim().toLowerCase();
  const displayName = cleanDisplayName(
    angleMatch?.[1] ?? (email ? raw.replace(emailMatch?.[0] ?? '', '') : raw)
  );
  const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
  const rootDomain = domain ? getRootDomain(domain) : '';

  return { displayName, email, domain, rootDomain };
}

function isUsefulDisplayName(displayName: string, email: string): boolean {
  if (
    /^(?:unknown(?: sender)?|sender unavailable|\?|null|undefined)?$/i.test(displayName) ||
    /^=\?/.test(displayName) ||
    /^(?:bounces?|mailer(?:-daemon)?|no[-_ ]?reply|noreply)(?:[+._-]|$)/i.test(displayName)
  ) {
    return false;
  }
  if (!displayName || !displayName.includes('@')) {
    return Boolean(displayName);
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

/** Preserve provider metadata through ingestion, storage, and popup rendering. */
export function getSenderSource(displayName?: unknown, address?: unknown): string {
  const named = parseEmailIdentity(displayName);
  const sender = parseEmailIdentity(address);
  const email = sender.email || named.email;
  const name = isUsefulDisplayName(named.displayName, named.email)
    ? named.displayName
    : sender.displayName || named.displayName;
  return name && email ? `${name} <${email}>` : email || name || 'Unknown Sender';
}

function getMessageHosts(website?: string | null, content = ''): string[] {
  const sites: string[] = [];
  const addSite = (source: string) => {
    try {
      const url = new URL(source);
      if (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password
      ) {
        sites.push(url.hostname.toLowerCase());
      }
    } catch {
      /* Invalid links are not identity evidence. */
    }
  };
  if (website) {
    addSite(website);
  }
  const body = typeof content === 'string' ? content : '';
  for (const match of body.slice(0, 100_000).matchAll(/https?:\/\/[^\s<>"'\])}]+/gi)) {
    addSite(match[0]);
    if (sites.length >= 50) {
      break;
    }
  }
  return sites;
}

/** Display evidence only: inferred product names never establish sender trust. */
export function getSenderLabel(
  value: unknown,
  subject?: unknown,
  website?: string | null,
  content = ''
): string {
  const identity = parseEmailIdentity(value);
  if (isUsefulDisplayName(identity.displayName, identity.email)) {
    return identity.displayName;
  }
  const subjectText = decodeDisplayName(toSafeString(subject).slice(0, 500));
  const subjectName = (host: string): string => {
    const stem = getRootDomain(host).split('.')[0] || '';
    if (!stem || !/[a-z]/i.test(stem)) {
      return '';
    }
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').exec(subjectText)?.[0] || '';
  };
  // A product mentioned in the subject must also have a real website in the
  // message. Ambiguous subjects do not choose between competing products.
  const products = new Map<string, string>();
  for (const host of getMessageHosts(website, content)) {
    const name = subjectName(host);
    const root = getRootDomain(host);
    if (
      name &&
      (subjectText.toLowerCase().includes(root) ||
        (name.length >= 3 &&
          !/^(?:mail|help|support|login|signin|verify|account|security|code|email|cdn|image|static|auth)$/i.test(
            name
          )))
    ) {
      products.set(root, name);
    }
  }
  if (products.size === 1) {
    return products.values().next().value!;
  }
  return identity.rootDomain
    ? subjectName(identity.rootDomain) ||
        titleCaseBrand(identity.rootDomain.split('.')[0] || '') ||
        'Unknown sender'
    : 'Unknown sender';
}

export function getSenderEmail(value: unknown): string {
  return parseEmailIdentity(value).email;
}

export function getSenderDomain(value: unknown): string {
  return parseEmailIdentity(value).rootDomain;
}

/** Mail servers often have no website; prefer the sender's product domain. */
export function getSenderLogoDomains(
  value: unknown,
  website?: string | null,
  content = ''
): string[] {
  const sender = parseEmailIdentity(value);
  const sites = getMessageHosts(website, content);
  const label = sender.displayName.toLowerCase();
  const brand = label.replace(/[^a-z0-9]/g, '');
  // Match the real website in the message rather than inventing brand.com or
  // using an unrelated delivery provider / social link as the sender's logo.
  const productSite = sites.find((host) => {
    const name = getRootDomain(host)
      .split('.')[0]
      ?.replace(/[^a-z0-9]/g, '');
    return name && name.length >= 3 && name === brand;
  });
  let domain = productSite || sender.domain || '';
  if (!domain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(sender.displayName)) {
    domain = sender.displayName.toLowerCase();
  }
  const root = getRootDomain(domain);
  const canonical =
    root === 'qwenlm.ai' || root === 'qwen.ai' || (!sender.domain && /^qwen(?: ai)?$/.test(label))
      ? 'chat.qwen.ai'
      : root === 'notion.so' || root === 'notion.com' || (!sender.domain && label === 'notion')
        ? 'www.notion.com'
        : root === 'mistral.ai' || (!sender.domain && /^mistral(?: ai)?$/.test(label))
          ? 'mistral.ai'
          : root;
  const blockedTlds = new Set([
    'example',
    'home',
    'internal',
    'invalid',
    'lan',
    'local',
    'localhost',
    'test',
  ]);
  return [...new Set([canonical, root, domain])].filter(
    (host) =>
      host.length <= 253 &&
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(
        host
      ) &&
      !blockedTlds.has(host.split('.').pop() ?? '')
  );
}

export function isAutomatedSender(value: unknown): boolean {
  const identity = parseEmailIdentity(value);
  const localPart = identity.email.split('@')[0] ?? identity.displayName;
  return AUTOMATED_LOCAL_PART.test(localPart);
}
