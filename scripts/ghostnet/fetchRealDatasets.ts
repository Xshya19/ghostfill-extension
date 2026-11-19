import fs from 'node:fs';
import path from 'node:path';

import type { CorpusEmailSample, GhostNetIntentClass } from './types';

const CACHE_DIR = path.resolve(process.cwd(), '.cache/ghostnet-datasets');
const CACHE_FILE = path.join(CACHE_DIR, 'real_emails_v2.jsonl');

function parseCsvRecords(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && csvText[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') {
        rows.push(row);
      }
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchTextWithRetry(url: string, attempts = 5): Promise<string> {
  let lastErr: unknown = new Error(`Failed to fetch ${url}`);
  for (let a = 0; a < attempts; a++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        lastErr = new Error(`HTTP ${resp.status} for ${url}`);
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, a)));
        continue;
      }
      return await resp.text();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 800 * Math.pow(2, a)));
    }
  }
  throw lastErr;
}

async function fetchJsonSequential<T>(url: string, attempts = 4): Promise<T | null> {
  for (let a = 0; a < attempts; a++) {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, a)));
        continue;
      }
      if (!resp.ok) {
        return null;
      }
      return (await resp.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, a)));
    }
  }
  return null;
}

function assignRealSplit(idx: number): 'train' | 'val' | 'test' {
  const m = idx % 49;
  if (m < 40) {
    return 'train';
  }
  if (m < 44) {
    return 'val';
  }
  return 'test';
}

const ACCIDENTAL_REAL_AUTH_RE =
  /\b(?:verification\s+code|security\s+code|one[- ]?time\s+(?:password|code|pin)|otp\s+is|reset\s+your\s+password|confirm\s+your\s+(?:account|email))\b/i;

const AUTH_PHISH_LURE_RE =
  /\b(?:verify|confirm|validate|activate|suspend|locked|unauthorized|unusual\s+sign|reset\s+(?:your\s+)?password|update\s+(?:your\s+)?(?:account|billing|payment)|click\s+(?:here|below)\s+to\s+(?:log|sign|verify))\b/i;

const MARKETING_HINT_RE =
  /\b(?:unsubscribe|newsletter|special\s+offer|discount|promo|free\s+trial|limited\s+time|mailing\s+list|webinar)\b/i;

const URL_FIND_RE = /https?:\/\/[^\s<>"')\]}]+/i;

const REAL_BRAND_ENVELOPES = [
  { brand: 'Linear', domain: 'linear.app', sender: 'auth@linear.app' },
  { brand: 'Notion', domain: 'notion.so', sender: 'notify@mail.notion.so' },
  { brand: 'Supabase', domain: 'supabase.io', sender: 'noreply@auth.supabase.io' },
  { brand: 'Vercel', domain: 'vercel.com', sender: 'notifications@vercel.com' },
  { brand: 'Stripe', domain: 'stripe.com', sender: 'support@stripe.com' },
  { brand: 'Cloudflare', domain: 'cloudflare.com', sender: 'noreply@notify.cloudflare.com' },
  { brand: 'Raycast', domain: 'raycast.com', sender: 'hello@raycast.com' },
  { brand: 'Figma', domain: 'figma.com', sender: 'no-reply@figma.com' },
  { brand: 'GitHub', domain: 'github.com', sender: 'noreply@github.com' },
  { brand: 'Clerk', domain: 'clerk.dev', sender: 'noreply@clerk.dev' },
] as const;

function buildPhishExpectedSite(idx: number): { expectedDomains: string[]; originUrl: string } {
  const b = REAL_BRAND_ENVELOPES[idx % REAL_BRAND_ENVELOPES.length]!;
  return {
    expectedDomains: [b.domain],
    originUrl: `https://${b.domain}/login`,
  };
}

export async function fetchRealDatasets(forceRefresh = false): Promise<CorpusEmailSample[]> {
  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const cached: CorpusEmailSample[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim()) {
        cached.push(JSON.parse(line) as CorpusEmailSample);
      }
    }
    if (cached.length >= 16000) {
      console.log(`[GhostNet Data] Loaded ${cached.length} cached real emails from ${CACHE_FILE}`);
      return cached;
    }
  }

  console.log('[GhostNet Data] Downloading real email & OTP CSV corpora from HuggingFace CDN...');
  const [zefangCsv, otpCsv, enronSpamCsv] = await Promise.all([
    fetchTextWithRetry(
      'https://huggingface.co/datasets/zefang-liu/phishing-email-dataset/resolve/main/Phishing_Email.csv'
    ),
    fetchTextWithRetry(
      'https://huggingface.co/datasets/alusci/sms-otp-spam-dataset/resolve/main/SMS_OTP_10000_samples.csv'
    ),
    fetchTextWithRetry(
      'https://huggingface.co/datasets/NotShrirang/email-spam-filter/resolve/main/train.csv'
    ),
  ]);

  const samples: CorpusEmailSample[] = [];
  let seq = 0;

  // 1. zefang-liu/phishing-email-dataset (~18.6k rows -> take up to 9,000 strided evenly)
  const zefangRows = parseCsvRecords(zefangCsv).slice(1);
  let zfCount = 0;
  for (let i = 0; i < zefangRows.length && zfCount < 9000; i += 2) {
    const row = zefangRows[i]!;
    const rawText = String(row[1] || '').trim();
    const emailType = String(row[2] || '').trim();
    if (rawText.length < 24 || rawText === 'empty') {
      continue;
    }
    const text = rawText.slice(0, 2200);
    const isPhish = emailType === 'Phishing Email';
    if (!isPhish && ACCIDENTAL_REAL_AUTH_RE.test(text)) {
      continue;
    }

    const firstLine = text.split(/\r?\n/)[0]?.slice(0, 120) || 'Message';
    const hasUrl = URL_FIND_RE.test(text);
    const looksAuthLure = isPhish && hasUrl && AUTH_PHISH_LURE_RE.test(text);
    const isMkt = MARKETING_HINT_RE.test(text) || (isPhish && !looksAuthLure);
    const site = buildPhishExpectedSite(seq);

    samples.push({
      id: `hf-zf-${i}`,
      split: assignRealSplit(seq++),
      source: 'hf-zefang-phish',
      category: looksAuthLure
        ? 'adversarial-phish'
        : isMkt
          ? 'marketing-none'
          : 'transactional-none',
      subject: firstLine,
      body: text,
      htmlBody: '',
      sender: looksAuthLure ? 'security@account-alert-verify.xyz' : 'messages@list-archive.org',
      expectedDomains: site.expectedDomains,
      originUrl: site.originUrl,
      label: {
        intent: looksAuthLure ? 'activation' : isMkt ? 'marketing' : 'transactional',
        otp: null,
        linkSubstring: null,
        action: looksAuthLure ? 'show-review' : 'ignore',
      },
    });
    zfCount++;
  }
  console.log(`  - zefang-liu/phishing-email-dataset: ${zfCount} emails ingested`);

  // 2. NotShrirang/email-spam-filter (5,171 Enron ham & spam emails with Subject lines -> take ~4,200)
  const spamRows = parseCsvRecords(enronSpamCsv).slice(1);
  let esCount = 0;
  for (let i = 0; i < spamRows.length && esCount < 4200; i++) {
    const row = spamRows[i]!;
    const lbl = String(row[1] || '')
      .trim()
      .toLowerCase();
    const raw = String(row[2] || '').trim();
    if (raw.length < 24) {
      continue;
    }
    const text = raw.slice(0, 2200);
    const lines = text.split(/\r?\n/);
    const subject =
      lines[0]
        ?.replace(/^Subject:\s*/i, '')
        .trim()
        .slice(0, 160) || 'Re: Update';
    const body = lines.slice(1).join('\n').trim() || text;
    const isSpam = lbl === 'spam' || row[3] === '1';
    if (!isSpam && ACCIDENTAL_REAL_AUTH_RE.test(text)) {
      continue;
    }
    const hasUrl = URL_FIND_RE.test(text);
    const looksAuthLure = isSpam && hasUrl && AUTH_PHISH_LURE_RE.test(text);
    const isMkt = isSpam || MARKETING_HINT_RE.test(text);
    const site = buildPhishExpectedSite(seq);

    samples.push({
      id: `hf-enron-${i}`,
      split: assignRealSplit(seq++),
      source: 'hf-enron',
      category: looksAuthLure
        ? 'adversarial-phish'
        : isMkt
          ? 'marketing-none'
          : 'transactional-none',
      subject,
      body,
      htmlBody: '',
      sender: isSpam ? 'mailer@promo-relay.biz' : 'colleague@enron.com',
      expectedDomains: site.expectedDomains,
      originUrl: site.originUrl,
      label: {
        intent: looksAuthLure ? 'activation' : isMkt ? 'marketing' : 'transactional',
        otp: null,
        linkSubstring: null,
        action: looksAuthLure ? 'show-review' : 'ignore',
      },
    });
    esCount++;
  }
  console.log(`  - NotShrirang/email-spam-filter (Enron): ${esCount} emails ingested`);

  // 3. alusci/sms-otp-spam-dataset (10,000 real OTP messages -> take 4,500 strided)
  const otpRows = parseCsvRecords(otpCsv).slice(1);
  let otpCount = 0;
  for (let i = 0; i < otpRows.length && otpCount < 4500; i += 2) {
    const row = otpRows[i]!;
    const sms = String(row[1] || '').trim();
    const validLbl = String(row[2] || '')
      .trim()
      .toLowerCase();
    if (validLbl && validLbl !== 'valid') {
      continue;
    }
    const codeMatch = sms.match(/\b(\d{4,8})\b/);
    if (!codeMatch?.[1]) {
      continue;
    }
    const code = codeMatch[1];
    const env = REAL_BRAND_ENVELOPES[otpCount % REAL_BRAND_ENVELOPES.length]!;
    const is2fa = /\b(?:2fa|two[- ]?factor|security)\b/i.test(sms);
    const intent: GhostNetIntentClass = is2fa ? 'two-factor' : 'verification';
    const hasPageExp = otpCount % 2 === 0;
    const includeHtml = otpCount % 3 !== 0;

    samples.push({
      id: `hf-otp-${i}`,
      split: assignRealSplit(seq++),
      source: 'hf-sms-otp',
      category: 'pure-otp',
      subject: otpCount % 4 === 0 ? `${env.brand}: ${code}` : `${env.brand} sign-in alert`,
      body: `${sms}\n\n— ${env.brand} Team`,
      htmlBody: includeHtml
        ? `<html><body><div><p>${sms}</p><p style="color:#777;font-size:12px">© 2026 ${env.brand} Inc.</p></div></body></html>`
        : '',
      sender: env.sender,
      expectedDomains: [env.domain],
      originUrl: `https://${env.domain}/verify`,
      pageExpectation: hasPageExp
        ? {
            hasOtpInputs: true,
            expectedOtpLength: code.length,
            expectedOtpFormat: 'numeric',
            hasMagicLinkPrompt: false,
          }
        : undefined,
      label: {
        intent,
        otp: code,
        linkSubstring: null,
        action: 'fill-otp',
      },
    });
    otpCount++;
  }
  console.log(`  - alusci/sms-otp-spam-dataset: ${otpCount} real OTP messages ingested`);

  // 4. sinabis-group/sinabis-1m-synthetic-emails (18 sequential pages = ~1,800 multilingual EN/DE/FR/IT emails)
  let sinCount = 0;
  for (let p = 0; p < 18; p++) {
    const offset = p * 2500;
    const url = `https://datasets-server.huggingface.co/rows?dataset=sinabis-group%2Fsinabis-1m-synthetic-emails&config=default&split=train&offset=${offset}&length=100`;
    const json = await fetchJsonSequential<{
      rows?: Array<{
        row?: {
          subject?: string;
          from?: { email?: string };
          body?: string;
          text?: string;
        };
      }>;
    }>(url);
    if (!json?.rows) {
      break;
    }
    for (const item of json.rows) {
      const r = item?.row;
      if (!r) {
        continue;
      }
      const body = String(r.body || r.text || '')
        .trim()
        .slice(0, 2200);
      if (body.length < 20) {
        continue;
      }
      const subject = String(r.subject || 'Team Update')
        .trim()
        .slice(0, 160);
      samples.push({
        id: `hf-sinabis-${sinCount}`,
        split: assignRealSplit(seq++),
        source: 'hf-sinabis',
        category: 'transactional-none',
        subject,
        body,
        htmlBody: '',
        sender: String(r.from?.email || 'team@sinabis-group.example').slice(0, 120),
        expectedDomains: [],
        label: {
          intent: 'transactional',
          otp: null,
          linkSubstring: null,
          action: 'ignore',
        },
      });
      sinCount++;
    }
    await new Promise((r) => setTimeout(r, 140));
  }
  console.log(`  - sinabis-group multilingual threads: ${sinCount} emails ingested`);

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const serialized = samples.map((s) => JSON.stringify(s)).join('\n');
  fs.writeFileSync(CACHE_FILE, serialized, 'utf8');
  console.log(`[GhostNet Data] Cached ${samples.length} total real emails to ${CACHE_FILE}`);
  return samples;
}

if (typeof require !== 'undefined' && require.main === module) {
  fetchRealDatasets()
    .then((rows) => {
      const counts = new Map<string, number>();
      for (const r of rows) {
        counts.set(
          `${r.source}:${r.label.action}`,
          (counts.get(`${r.source}:${r.label.action}`) ?? 0) + 1
        );
      }
      console.log('[GhostNet Data] Summary:', Object.fromEntries(counts));
    })
    .catch((err) => {
      console.error('[GhostNet Data] Failed:', err);
      process.exit(1);
    });
}
