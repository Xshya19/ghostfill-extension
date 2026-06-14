import type {
  EmailDecision,
  EmailDecisionAction,
  EmailDecisionPurpose,
  EmailDecisionRisk,
  EmailIntent,
  ExtractionResult,
} from './types/extraction.types';

interface DecisionInput {
  extraction: ExtractionResult;
  sender?: string;
  expectedDomains?: string[];
}

const SUSPICIOUS_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'buzz', 'top', 'xyz']);
const COMMON_SECOND_LEVEL_TLDS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'mil', 'net', 'org']);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return value > 1 ? clamp01(value / 100) : clamp01(value);
}

function mapPurpose(intent: EmailIntent): EmailDecisionPurpose {
  switch (intent) {
    case 'verification':
      return 'verification';
    case 'activation':
    case 'account-update':
      return 'activation';
    case 'magic-link':
    case 'magic-link-login':
      return 'magic-login';
    case 'password-reset':
      return 'password-reset';
    case 'two-factor':
    case '2fa':
    case 'device-confirmation':
      return 'two-factor';
    case 'invitation':
      return 'invitation';
    case 'transactional':
      return 'transactional';
    case 'marketing':
      return 'marketing';
    case 'newsletter':
      return 'newsletter';
    case 'social-notification':
      return 'social-notification';
    default:
      return 'unknown';
  }
}

function rootDomain(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) {
    return parts.join('.');
  }

  const secondLevel = parts[parts.length - 2];
  if (secondLevel && COMMON_SECOND_LEVEL_TLDS.has(secondLevel) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function senderRoot(sender?: string): string | null {
  if (!sender) {
    return null;
  }
  const match = sender.match(/[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/i);
  return match?.[1] ? rootDomain(match[1]) : null;
}

function expectedRootSet(expectedDomains: string[] | undefined): Set<string> {
  const roots = new Set<string>();
  for (const domain of expectedDomains ?? []) {
    try {
      const host = domain.includes('://') ? new URL(domain).hostname : domain;
      if (host.includes('.')) {
        roots.add(rootDomain(host));
      }
    } catch {
      if (domain.includes('.')) {
        roots.add(rootDomain(domain));
      }
    }
  }
  return roots;
}

function getLinkTrust(link: ExtractionResult['link']): number | null {
  if (link && 'domainTrust' in link && typeof link.domainTrust === 'number') {
    return link.domainTrust;
  }
  return null;
}

function scoreSecurityRisk(extraction: ExtractionResult): {
  points: number;
  reasons: string[];
  warnings: string[];
} {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let points = 0;

  const risk = extraction.debugInfo.securityRisk;
  if (risk === 'high') {
    points += 50;
    warnings.push('email-security-risk-high');
  } else if (risk === 'medium') {
    points += 22;
    warnings.push('email-security-risk-medium');
  }

  const urlsFound = extraction.debugInfo.urlsFound ?? 0;
  if (urlsFound > 15) {
    points += 25;
    warnings.push('many-links-in-email');
  } else if (urlsFound > 5) {
    points += 12;
    reasons.push('moderate-link-density');
  }

  const link = extraction.link;
  if (!link?.url) {
    return { points, reasons, warnings };
  }

  const trust = getLinkTrust(link);
  if (typeof trust === 'number') {
    if (trust < 20) {
      points += 35;
      warnings.push('link-domain-trust-very-low');
    } else if (trust < 40) {
      points += 18;
      warnings.push('link-domain-trust-low');
    } else if (trust >= 70) {
      reasons.push('link-domain-trust-high');
    }
  }

  try {
    const url = new URL(link.url);
    const host = url.hostname.toLowerCase();
    const labels = host.split('.');
    const tld = labels[labels.length - 1] ?? '';

    if (url.protocol !== 'https:') {
      points += url.protocol === 'http:' ? 18 : 45;
      warnings.push('non-https-link');
    }
    if (url.username || url.password) {
      points += 45;
      warnings.push('link-contains-credentials');
    }
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost')
    ) {
      points += 60;
      warnings.push('localhost-link');
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      points += 45;
      warnings.push('raw-ip-link');
    }
    if (labels.some((label) => label.startsWith('xn--'))) {
      points += 45;
      warnings.push('punycode-domain');
    }
    if (SUSPICIOUS_TLDS.has(tld)) {
      points += 25;
      warnings.push('suspicious-tld');
    }
    if (labels.length > 6) {
      points += 10;
      reasons.push('deep-subdomain-chain');
    }
  } catch {
    points += 60;
    warnings.push('malformed-link');
  }

  return { points, reasons, warnings };
}

function scoreDomainContext(input: DecisionInput): {
  points: number;
  reasons: string[];
  warnings: string[];
} {
  const link = input.extraction.link;
  if (!link?.url) {
    return { points: 0, reasons: [], warnings: [] };
  }

  try {
    const linkRoot = rootDomain(new URL(link.url).hostname);
    const sender = senderRoot(input.sender);
    const expectedRoots = expectedRootSet(input.expectedDomains);
    const reasons: string[] = [];
    const warnings: string[] = [];
    let points = 0;

    if (sender && sender === linkRoot) {
      reasons.push('sender-domain-matches-link');
    } else if (sender) {
      points += 10;
      reasons.push('sender-domain-differs-from-link');
    }

    if (expectedRoots.size > 0) {
      if (expectedRoots.has(linkRoot)) {
        reasons.push('link-matches-current-site-context');
      } else {
        points += 12;
        warnings.push('link-does-not-match-current-site-context');
      }
    }

    return { points, reasons, warnings };
  } catch {
    return { points: 25, reasons: [], warnings: ['link-domain-context-unreadable'] };
  }
}

function chooseRisk(points: number): EmailDecisionRisk {
  if (points >= 60) {
    return 'high';
  }
  if (points >= 30) {
    return 'medium';
  }
  return 'low';
}

function actionIncludesLink(action: EmailDecisionAction): boolean {
  return action === 'open-link' || action === 'fill-otp-and-open-link';
}

function chooseAction(
  extraction: ExtractionResult,
  purpose: EmailDecisionPurpose,
  risk: EmailDecisionRisk,
  confidence: number
): EmailDecisionAction {
  const hasOTP = Boolean(extraction.otp);
  const hasLink = Boolean(extraction.link);

  if (risk === 'high' && hasLink && !hasOTP) {
    return 'show-review';
  }

  if (hasOTP && hasLink) {
    return risk === 'low' && confidence >= 0.7 ? 'fill-otp-and-open-link' : 'fill-otp';
  }

  if (hasOTP) {
    return confidence >= 0.45 ? 'fill-otp' : 'show-review';
  }

  if (hasLink) {
    return risk === 'low' && confidence >= 0.65 ? 'open-link' : 'show-review';
  }

  if (
    purpose === 'marketing' ||
    purpose === 'newsletter' ||
    purpose === 'transactional' ||
    purpose === 'social-notification'
  ) {
    return 'ignore';
  }

  return 'ignore';
}

export function assessEmailDecision(input: DecisionInput): EmailDecision {
  const { extraction } = input;
  const purpose = mapPurpose(extraction.intent);
  const reasons: string[] = [`intent:${extraction.intent}`];
  const warnings: string[] = [];

  if (extraction.debugInfo.provider) {
    reasons.push(`provider:${extraction.debugInfo.provider}`);
  }

  if (extraction.otp) {
    reasons.push(`otp:${extraction.otp.strategy}:${Math.round(extraction.otp.confidence * 100)}`);
  }

  if (extraction.link) {
    reasons.push(
      `link:${String(extraction.link.type)}:${Math.round(normalizeConfidence(extraction.link.confidence) * 100)}`
    );
  }

  const security = scoreSecurityRisk(extraction);
  const domainContext = scoreDomainContext(input);
  reasons.push(...security.reasons, ...domainContext.reasons);
  warnings.push(...security.warnings, ...domainContext.warnings);

  const riskPoints = security.points + domainContext.points;
  const risk = chooseRisk(riskPoints);
  if (riskPoints > 0) {
    reasons.push(`risk-points:${riskPoints}`);
  }

  const otpConfidence = normalizeConfidence(extraction.otp?.confidence);
  const linkConfidence = normalizeConfidence(extraction.link?.confidence);
  const providerConfidence = normalizeConfidence(extraction.debugInfo.providerConfidence);
  const intentConfidence =
    extraction.debugInfo.intentScores && extraction.intent in extraction.debugInfo.intentScores
      ? normalizeConfidence(extraction.debugInfo.intentScores[extraction.intent])
      : 0;

  const signalConfidence = Math.max(
    otpConfidence,
    linkConfidence,
    providerConfidence * 0.85,
    intentConfidence * 0.9,
    extraction.otp || extraction.link ? 0.55 : 0
  );
  const riskPenalty = risk === 'high' ? 0.35 : risk === 'medium' ? 0.12 : 0;
  const confidence = clamp01(signalConfidence - riskPenalty);
  const action = chooseAction(extraction, purpose, risk, confidence);

  const canAutoAct =
    action !== 'show-review' &&
    action !== 'ignore' &&
    (!actionIncludesLink(action) || risk === 'low');

  return {
    purpose,
    action,
    risk,
    confidence,
    canAutoAct,
    reasons,
    warnings,
  };
}
