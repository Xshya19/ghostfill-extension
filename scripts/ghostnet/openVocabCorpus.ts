import type { PageVerificationExpectation } from '../../src/services/types/extraction.types';

import type { CorpusEmailSample, GhostNetActionClass, GhostNetIntentClass } from './types';

class SeededRng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 0x100000000;
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

interface Persona {
  name: string;
  domain: string;
  senders: string[];
}

const PERSONAS: Persona[] = [
  {
    name: 'Acme Cloud',
    domain: 'acme-cloud.io',
    senders: ['auth@acme-cloud.io', 'noreply@mail.acme-cloud.io'],
  },
  {
    name: 'Linear',
    domain: 'linear.app',
    senders: ['auth@linear.app', 'notifications@linear.app'],
  },
  { name: 'Notion', domain: 'notion.so', senders: ['notify@mail.notion.so', 'team@notion.so'] },
  { name: 'Clerk', domain: 'clerk.dev', senders: ['noreply@clerk.dev', 'security@clerk.dev'] },
  { name: 'Supabase', domain: 'supabase.io', senders: ['noreply@auth.supabase.io'] },
  {
    name: 'Vercel',
    domain: 'vercel.com',
    senders: ['notifications@vercel.com', 'security@vercel.com'],
  },
  { name: 'GitHub', domain: 'github.com', senders: ['noreply@github.com'] },
  {
    name: 'Claude',
    domain: 'claude.ai',
    senders: ['no-reply@mail.anthropic.com', 'auth@claude.ai'],
  },
  { name: 'Qwen', domain: 'qwen.ai', senders: ['noreply@mail.qwen.ai'] },
  { name: 'LLM7', domain: 'llm7.io', senders: ['noreply@llm7.io'] },
  { name: 'Figma', domain: 'figma.com', senders: ['no-reply@figma.com'] },
  { name: 'Stripe', domain: 'stripe.com', senders: ['support@stripe.com', 'security@stripe.com'] },
  { name: 'Raycast', domain: 'raycast.com', senders: ['hello@raycast.com'] },
  { name: 'Mistral', domain: 'mistral.ai', senders: ['auth@mistral.ai'] },
  { name: 'Cloudflare', domain: 'cloudflare.com', senders: ['noreply@notify.cloudflare.com'] },
  { name: 'Loom', domain: 'loom.com', senders: ['no-reply@loom.com'] },
  { name: 'HuggingFace', domain: 'huggingface.co', senders: ['website@huggingface.co'] },
  { name: 'Postman', domain: 'postman.com', senders: ['accounts@postman.com'] },
  { name: 'Fly.io', domain: 'fly.io', senders: ['support@fly.io'] },
  { name: 'Render', domain: 'render.com', senders: ['no-reply@render.com'] },
  { name: 'Northstar', domain: 'northstar.dev', senders: ['identity@northstar.dev'] },
  { name: 'Veridian', domain: 'veridian.app', senders: ['hello@veridian.app'] },
  { name: 'KiteMail', domain: 'kitemail.co', senders: ['accounts@kitemail.co'] },
  { name: 'PulseHQ', domain: 'pulsehq.io', senders: ['team@pulsehq.io'] },
];

const GREETINGS = [
  'Hi there,',
  'Hello,',
  'Hey!',
  'Good morning,',
  'Welcome aboard —',
  '',
  'Quick update:',
] as const;

const EXPIRIES = [
  'Valid for 10 minutes.',
  'This stays active for 15 minutes.',
  'It stops working after 5 minutes.',
  'Works once and times out shortly.',
  'Never forward this message to outsiders.',
  '',
] as const;

function randomNumericCode(rng: SeededRng, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String(rng.int(0, 9));
  }
  if (/^(\d)\1+$/.test(out) || out === '123456' || out === '654321' || out === '012345') {
    return '48291736'.slice(0, len);
  }
  return out;
}

function randomAlnumCode(rng: SeededRng, len: number): string {
  const safeLen = Math.max(4, Math.min(8, len));
  const lettersUp = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const allUp = lettersUp + digits;
  const mode = rng.int(0, 4);
  let out = '';

  if (mode === 0 && safeLen >= 5) {
    // Digit-bookended morphology (e.g. 48DFG77, 12ABC34)
    const leadDigits = safeLen >= 7 ? 2 : 1;
    const trailDigits = safeLen >= 6 ? 2 : 1;
    const midLetters = Math.max(1, safeLen - leadDigits - trailDigits);
    for (let i = 0; i < leadDigits; i++) {
      out += digits[rng.int(0, digits.length - 1)]!;
    }
    for (let i = 0; i < midLetters; i++) {
      out += lettersUp[rng.int(0, lettersUp.length - 1)]!;
    }
    for (let i = 0; i < trailDigits; i++) {
      out += digits[rng.int(0, digits.length - 1)]!;
    }
  } else if (mode === 1) {
    // Letter-prefix + digits (e.g. G9284, AB4829)
    const nLetters = Math.max(1, Math.floor(safeLen / 3));
    for (let i = 0; i < nLetters; i++) {
      out += lettersUp[rng.int(0, lettersUp.length - 1)]!;
    }
    while (out.length < safeLen) {
      out += digits[rng.int(0, digits.length - 1)]!;
    }
  } else if (mode === 2) {
    // Digit-prefix + letters (e.g. 482KXM)
    const nDigits = Math.max(2, Math.ceil(safeLen / 2));
    for (let i = 0; i < nDigits; i++) {
      out += digits[rng.int(0, digits.length - 1)]!;
    }
    while (out.length < safeLen) {
      out += lettersUp[rng.int(0, lettersUp.length - 1)]!;
    }
  } else {
    // Alternating / Steam Crockford-Base32 style mixed alphanumeric
    for (let i = 0; i < safeLen; i++) {
      if (mode === 3) {
        const pool = i % 2 === 0 ? lettersUp : digits;
        out += pool[rng.int(0, pool.length - 1)]!;
      } else {
        out += allUp[rng.int(0, allUp.length - 1)]!;
      }
    }
  }

  if (!/\d/.test(out) || !/[A-Z]/.test(out)) {
    out = `48DFG77K`.slice(0, safeLen);
  }
  if (!/(?:\d.*){2,}/.test(out)) {
    out = `${out.slice(0, safeLen - 2)}${rng.int(2, 9)}${rng.int(2, 9)}`;
  }
  if (rng.chance(0.1)) {
    return out.toLowerCase();
  }
  return out;
}

function randomToken(rng: SeededRng, len = 26): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[rng.int(0, chars.length - 1)]!;
  }
  return s;
}

function formatCodeSurface(
  rng: SeededRng,
  code: string,
  isAlnum: boolean
): { text: string; splitBox: boolean } {
  if (!isAlnum && code.length >= 4 && code.length <= 8 && rng.chance(0.14)) {
    return { text: code, splitBox: true };
  }
  if (code.length >= 6 && code.length <= 8 && rng.chance(0.16)) {
    const half = Math.floor(code.length / 2);
    return { text: `${code.slice(0, half)}-${code.slice(half)}`, splitBox: false };
  }
  if (!isAlnum && code.length === 6 && rng.chance(0.08)) {
    return { text: code.split('').join(' '), splitBox: false };
  }
  if (rng.chance(0.07)) {
    return { text: `[ ${code} ]`, splitBox: false };
  }
  if (rng.chance(0.05)) {
    return { text: code.split('').join('\u200B'), splitBox: false };
  }
  return { text: code, splitBox: false };
}

function wrapHtmlShell(
  rng: SeededRng,
  domain: string,
  inner: string,
  extraFooterDistractors: boolean
): string {
  const footer = extraFooterDistractors
    ? `<div class="footer" style="margin-top:24px;font-size:12px;color:#777">
         <a href="https://${domain}/unsubscribe?ref=mail">Unsubscribe</a> |
         <a href="https://${domain}/privacy">Privacy</a> |
         <a href="https://status.${domain}">Status</a>
         <p>© 2026 ${domain} Inc. · 548 Market St, San Francisco, CA 94104</p>
       </div>`
    : `<p style="font-size:11px;color:#888">© 2026 ${domain}</p>`;
  if (rng.chance(0.3)) {
    return `<html><body><table role="presentation" width="100%"><tr><td style="padding:20px">${inner}${footer}</td></tr></table></body></html>`;
  }
  return `<html><body><div class="mail-card" style="max-width:560px;margin:0 auto">${inner}${footer}</div></body></html>`;
}

function assignSplit(idx: number): 'train' | 'val' | 'test' {
  // 40 train / 4 val / 5 test out of every 49
  const m = idx % 49;
  if (m < 40) {
    return 'train';
  }
  if (m < 44) {
    return 'val';
  }
  return 'test';
}

// Compositional unkeyworded natural-English builders (no hardcoded trigger words needed!)
const UNKEYWORDED_OTP_VERBS = [
  'Drop',
  'Punch',
  'Type',
  'Paste',
  'Put',
  'Enter',
  'Copy',
  'Plug',
] as const;
const UNKEYWORDED_OTP_TARGETS = [
  'into the browser tab you just opened',
  'onto the screen you came from',
  'into the open prompt waiting on your page',
  'so we know this mailbox is yours',
  'to prove someone is actually here',
  'before the open window times out',
] as const;

const MULTILINGUAL_OTP_BUILDERS: Array<
  (brand: string, c: string) => { subj: string; body: string }
> = [
  (b, c) => ({ subj: `${b}: ${c}`, body: `Use ${c} to finish checking your inbox.` }),
  (b, c) => ({ subj: `Finish with ${b}`, body: `Your verification code is ${c}.` }),
  (b, c) => ({
    subj: 'Security passcode',
    body: `Your one-time verification passcode for ${b} is ${c}.`,
  }),
  (_b, c) => ({
    subj: 'Access from new computer',
    body: `Enter security passcode ${c} to authorize this device.`,
  }),
  (b, c) => ({
    subj: `Tu código de ${b}`,
    body: `Tu código de verificación es ${c}. Expira en 10 minutos.`,
  }),
  (b, c) => ({
    subj: `Votre accès ${b}`,
    body: `Votre code de vérification est : ${c}. Ne le partagez pas.`,
  }),
  (b, c) => ({ subj: `Ihr ${b} Zugang`, body: `Ihr Bestätigungscode lautet: ${c}.` }),
  (b, c) => ({
    subj: `Código de ${b}`,
    body: `Seu código de verificação é ${c}. Válido por 10 minutos.`,
  }),
  (b, c) => ({ subj: `Codice di verifica ${b}`, body: `Il tuo codice di verifica è: ${c}.` }),
  (b, c) => ({ subj: `${b} doğrulama`, body: `Doğrulama kodunuz: ${c}. Paylaşmayın.` }),
  (b, c) => ({ subj: `${b} सत्यापन`, body: `आपका सत्यापन कोड ${c} है। इसे किसी से साझा न करें।` }),
  (b, c) => ({ subj: `${b} 验证码`, body: `您的验证码是 ${c}，10分钟内有效。` }),
  (b, c) => ({ subj: `${b} 認証コード`, body: `認証コードは ${c} です。10分間有効です。` }),
  (_b, c) => ({ subj: '認証コードのお知らせ', body: `認証コードは ${c} です。` }),
  (b, c) => ({
    subj: `${b} 인증번호 안내`,
    body: `인증번호 ${c} 를 입력하여 로그인을 완료하세요.`,
  }),
  (b, c) => ({ subj: `رمز من ${b}`, body: `رمز التحقق الخاص بك هو ${c} لإكمال تسجيل الدخول.` }),
];

const UNKEYWORDED_LINK_PHRASES = [
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Activate your ${b} account`,
    body: () => 'Activate now',
    anchor: 'Verify Email',
    path: '/verify',
    param: 'token',
  },
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Activate your ${b} account`,
    body: () => 'Activate now to verify your email.',
    anchor: 'Verify Email',
    path: '/verify',
    param: 'token',
  },
  {
    intent: 'password-reset' as GhostNetIntentClass,
    subj: () => 'Reset your password',
    body: (b: string) => `Click below to reset your ${b} password.`,
    anchor: 'Reset Password',
    path: '/reset-password',
    param: 'reset_token',
  },
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Confirm this address for ${b}`,
    body: (b: string) => `Press the button below so ${b} knows this mailbox belongs to you.`,
    anchor: 'Yes, it is mine',
    path: '/accounts/confirm',
    param: 'confirmation_token',
  },
  {
    intent: 'magic-link-login' as GhostNetIntentClass,
    subj: (b: string) => `Ready to enter ${b}`,
    body: (b: string) =>
      `One quick tap below jumps you straight into your ${b} workspace without a password.`,
    anchor: 'Jump into workspace',
    path: '/auth/callback',
    param: 'session',
  },
  {
    intent: 'magic-link-login' as GhostNetIntentClass,
    subj: (b: string) => `Your ${b} doorway is ready`,
    body: (b: string) => `Tap the button below to hop right back into ${b}.`,
    anchor: 'Continue to Workspace',
    path: '/loginwithemail',
    param: 'state',
  },
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Finish setting up ${b}`,
    body: (b: string) => `Tap once below to finish hooking up your new ${b} workspace.`,
    anchor: 'Complete Setup',
    path: '/verify-email',
    param: 'token',
  },
  {
    intent: 'password-reset' as GhostNetIntentClass,
    subj: (b: string) => `Pick a new passphrase on ${b}`,
    body: (b: string) =>
      `We got a request to swap the credentials on your ${b} profile. Follow the button below.`,
    anchor: 'Choose New Credentials',
    path: '/reset-password',
    param: 'reset_token',
  },
  {
    intent: 'invitation' as GhostNetIntentClass,
    subj: (b: string) => `Sarah asked you to collaborate on ${b}`,
    body: (b: string) => `Sarah added your address to the product engineering group on ${b}.`,
    anchor: 'Join Team',
    path: '/invite/accept',
    param: 'invite_token',
  },
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Confirma tu cuenta en ${b}`,
    body: (b: string) => `Haz clic en el botón de abajo para confirmar tu correo en ${b}.`,
    anchor: 'Confirmar Correo',
    path: '/verificar',
    param: 'token',
  },
  {
    intent: 'activation' as GhostNetIntentClass,
    subj: (b: string) => `Validez votre inscription ${b}`,
    body: (b: string) => `Cliquez ci-dessous pour activer votre accès à ${b}.`,
    anchor: 'Activer mon compte',
    path: '/activer',
    param: 'token',
  },
];

export function generateOpenVocabCorpus(seed = 20261119): CorpusEmailSample[] {
  const rng = new SeededRng(seed);
  const samples: CorpusEmailSample[] = [];
  let seq = 0;

  // ── 1. 2,107 Unkeyworded + Multilingual + 2FA + Split-Box Pure OTPs ───────
  for (let i = 0; i < 2107; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const isAlnum = rng.chance(0.24);
    const len = isAlnum ? rng.pick([4, 5, 6, 7, 8]) : rng.pick([4, 5, 6, 6, 7, 8]);
    let code = isAlnum ? randomAlnumCode(rng, len) : randomNumericCode(rng, len);
    if (rng.chance(0.02)) {
      code = '2026';
    }

    const fmt = formatCodeSurface(rng, code, isAlnum);
    const stylePick = rng.next();
    let subj = '';
    let lead = '';
    let body = '';
    let htmlBody = '';
    let intent: GhostNetIntentClass = 'verification';

    if (stylePick < 0.08) {
      // Standalone minimal W3C/WICG WebOTP format
      subj = 'Sign in check';
      body = `Complete your sign in on ${p.name}.\n\n@${p.domain} #${code}`;
      htmlBody = rng.chance(0.25)
        ? ''
        : `<p>Complete your sign in on ${p.name}.</p><pre>@${p.domain} #${code}</pre>`;
    } else {
      if (stylePick < 0.36) {
        // Unkeyworded compositional natural English (ZERO OTP/code keywords!)
        const verb = rng.pick(UNKEYWORDED_OTP_VERBS);
        const tgt = rng.pick(UNKEYWORDED_OTP_TARGETS);
        const greet = rng.pick(GREETINGS);
        const exp = rng.pick(EXPIRIES);
        subj = rng.pick([
          `Quick check from ${p.name}`,
          `Almost there — ${p.name}`,
          `Confirming it is really you on ${p.name}`,
          `${p.name} browser check`,
        ]);
        lead = `${greet ? greet + ' ' : ''}${verb} ${fmt.text} ${tgt}.${exp ? ' ' + exp : ''}`;
      } else if (stylePick < 0.54) {
        // 2FA / New device login
        intent = 'two-factor';
        const browser = rng.pick([
          'Chrome on Windows',
          'Safari on macOS',
          'Firefox on Linux',
          'Mobile Safari',
        ]);
        const city = rng.pick(['Bengaluru', 'Berlin', 'Toronto', 'Austin', 'Tokyo', 'London']);
        subj = `New login attempt on ${p.name} (${city})`;
        lead = `Someone just tried signing in using ${browser} near ${city}. Approve this session by typing ${fmt.text} in your browser. Valid for 5 minutes.`;
      } else {
        // Multilingual & classic OTP
        const m = rng.pick(MULTILINGUAL_OTP_BUILDERS)(p.name, fmt.text);
        if (rng.chance(0.18)) {
          subj = `Welcome to ${p.name} — verify your account`;
          lead = `Your verification code is: ${fmt.text}. Enter it to continue.`;
        } else {
          subj = rng.chance(0.32) ? `${p.name} — ${code}` : m.subj;
          lead = `${m.body} ${rng.pick(EXPIRIES)}`.trim();
        }
      }

      const distractor = rng.chance(0.35)
        ? `\nInvoice ref #${rng.int(100000, 999999)} | Helpline +1 (800) 555-0192 | ZIP 94107`
        : '';
      const handleCollision = rng.chance(0.04) && !isAlnum;
      const recipientLine = handleCollision ? `Hi jesse.duncan.${code}@catchmail.io, ` : '';
      const wicgSuffix = rng.chance(0.1) ? `\n\n@${p.domain} #${code}` : '';
      body = `${recipientLine}${lead}${distractor}${wicgSuffix}\n© 2026 ${p.name}`;

      let codeBlock = rng.chance(0.25)
        ? `<p>Code: <code>${fmt.text}</code></p>`
        : `<p style="font-size:26px;font-weight:bold;letter-spacing:3px">${fmt.text}</p>`;
      if (fmt.splitBox) {
        const tds = code
          .split('')
          .map((c) => `<td style="padding:8px;border:1px solid #d4d4d8;font-size:22px">${c}</td>`)
          .join('');
        codeBlock = `<table><tr>${tds}</tr></table>`;
      }
      htmlBody = rng.chance(0.15)
        ? ''
        : wrapHtmlShell(
            rng,
            p.domain,
            `<h2>${p.name}</h2><p>${recipientLine}${lead}</p>${codeBlock}`,
            rng.chance(0.5)
          );
    }

    const pageExpectation: PageVerificationExpectation | undefined = rng.chance(0.55)
      ? {
          hasOtpInputs: true,
          expectedOtpLength: code.length,
          expectedOtpFormat: isAlnum ? 'alphanumeric' : 'numeric',
          hasMagicLinkPrompt: false,
        }
      : undefined;

    const dropSiteCtx = rng.chance(0.3);
    samples.push({
      id: `ov-otp-${i}`,
      split: assignSplit(seq++),
      source: 'open-vocab-discourse',
      category: 'pure-otp',
      subject: subj,
      body,
      htmlBody,
      sender,
      expectedDomains: dropSiteCtx ? [] : [p.domain],
      originUrl: dropSiteCtx ? undefined : `https://${p.domain}/verify`,
      pageExpectation,
      label: { intent, otp: code, linkSubstring: null, action: 'fill-otp' },
    });
  }

  // ── 2. 833 Temporal / Superseded Multi-Code Discourse ──────────────────
  for (let i = 0; i < 833; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const isAlnum = rng.chance(0.22);
    const len = isAlnum ? rng.pick([5, 6, 7, 8]) : rng.pick([4, 5, 6, 6, 7, 8]);
    const stale = isAlnum ? randomAlnumCode(rng, len) : randomNumericCode(rng, len);
    let fresh = isAlnum ? randomAlnumCode(rng, len) : randomNumericCode(rng, len);
    if (fresh === stale) {
      fresh = isAlnum ? '48DFG77M'.slice(0, len) : '54646548'.slice(0, len);
    }

    const orderMode = rng.int(0, 4);
    let subj = `Updated sign-in check for ${p.name}`;
    let body = '';
    let htmlBody = '';

    if (orderMode === 0) {
      body = `Heads up: ${stale} expired 5 minutes ago. Use ${fresh} instead to finish logging into ${p.name}.`;
    } else if (orderMode === 1) {
      body = `Ignore ${stale} from the earlier message — punch ${fresh} into your open ${p.name} tab now.`;
    } else if (orderMode === 2) {
      body = `We invalidated ${stale} after you asked again. Enter ${fresh} right now (${stale} will not work).`;
    } else if (orderMode === 3) {
      subj = `Re: ${p.name} access check`;
      body = `Use ${fresh} on the current page.\n\nOn Nov 18, 2026, Support <${sender}> wrote:\n> Previous check: ${stale}`;
      htmlBody = wrapHtmlShell(
        rng,
        p.domain,
        `<p>Use <strong>${fresh}</strong> on the current page.</p><blockquote><p>Previous check: ${stale}</p></blockquote>`,
        false
      );
    } else {
      body = `Note: ${fresh} replaces your old digits ${stale}. Drop ${fresh} into the form.`;
    }

    if (!htmlBody) {
      htmlBody = wrapHtmlShell(rng, p.domain, `<p>${body}</p>`, rng.chance(0.4));
    }

    const dropSiteCtx = rng.chance(0.3);
    samples.push({
      id: `ov-temporal-${i}`,
      split: assignSplit(seq++),
      source: 'open-vocab-discourse',
      category: 'pure-otp',
      subject: subj,
      body,
      htmlBody,
      sender,
      expectedDomains: dropSiteCtx ? [] : [p.domain],
      originUrl: dropSiteCtx ? undefined : `https://${p.domain}/verify`,
      pageExpectation: {
        hasOtpInputs: true,
        expectedOtpLength: len,
        expectedOtpFormat: isAlnum ? 'alphanumeric' : 'numeric',
      },
      label: { intent: 'verification', otp: fresh, linkSubstring: null, action: 'fill-otp' },
    });
  }

  // ── 3. 833 Negation & Anti-Scam Counterfactuals ────────────────────────
  for (let i = 0; i < 833; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const trapCode = randomNumericCode(rng, 6);
    const mode = rng.int(0, 2);

    if (mode === 0) {
      // Pure anti-scam warning -> no code, ignore!
      const body = `Security warning from ${p.name}: Our team will never phone you to ask for digits. If anyone told you to enter ${trapCode}, hang up and do not enter ${trapCode} anywhere.`;
      samples.push({
        id: `ov-neg-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'transactional-none',
        subject: `How to spot ${p.name} impersonators`,
        body,
        htmlBody: wrapHtmlShell(rng, p.domain, `<p>${body}</p>`, true),
        sender,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}`,
        label: { intent: 'transactional', otp: null, linkSubstring: null, action: 'ignore' },
      });
    } else if (mode === 1) {
      // Counterfactual replacement: replaced 6-digit codes with magic link!
      const tok = randomToken(rng, 26);
      const url = `https://app.${p.domain}/auth/magic-link?session=${tok}`;
      const body = `We retired 6-digit prompts like ${trapCode}. Tap the link below instead to step into ${p.name}: ${url}`;
      samples.push({
        id: `ov-neg-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'pure-link',
        subject: `Step right into ${p.name}`,
        body,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<p>We retired 6-digit prompts like ${trapCode}.</p><a href="${url}" class="btn" style="background:#0a84ff;padding:12px 22px;color:#fff">Continue to ${p.name}</a>`,
          true
        ),
        sender,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/login`,
        pageExpectation: { hasOtpInputs: false, hasMagicLinkPrompt: true },
        label: {
          intent: 'magic-link-login',
          otp: null,
          linkSubstring: `${p.domain}/auth/magic-link`,
          action: 'open-link',
        },
      });
    } else {
      // Documentation / sample snippet warning
      const body = `Formatting guide for ${p.name}: numbers like ${trapCode} are shown here only as an example — never type example numbers into live forms.`;
      samples.push({
        id: `ov-neg-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'transactional-none',
        subject: `${p.name} developer documentation note`,
        body,
        htmlBody: wrapHtmlShell(rng, p.domain, `<p>${body}</p>`, true),
        sender,
        expectedDomains: [p.domain],
        label: { intent: 'transactional', otp: null, linkSubstring: null, action: 'ignore' },
      });
    }
  }

  // ── 4. 1,568 Unkeyworded & Standard Links (Activation/Magic/Reset/Invite) ─
  for (let i = 0; i < 1568; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const cfg = rng.pick(UNKEYWORDED_LINK_PHRASES);
    const tok = randomToken(rng, 28);
    const rawDest = `https://app.${p.domain}${cfg.path}?${cfg.param}=${tok}`;
    const wrapped = rng.chance(0.24)
      ? `https://ct.sendgrid.net/ls/click?url=${encodeURIComponent(rawDest)}`
      : rawDest;
    const hasOrigin = rng.chance(0.88);
    const subj = cfg.subj(p.name);
    const copy = cfg.body(p.name);
    const omitPlainUrl = copy === 'Activate now' && rng.chance(0.5);
    const body = omitPlainUrl ? copy : `${copy}\n${cfg.anchor}: ${wrapped}`;
    const htmlBody =
      !omitPlainUrl && rng.chance(0.16)
        ? ''
        : omitPlainUrl
          ? `<a href="${wrapped}" class="btn">${cfg.anchor}</a>`
          : wrapHtmlShell(
              rng,
              p.domain,
              `<h2>${p.name}</h2><p>${copy}</p><p><a href="${wrapped}" class="btn-primary" style="background:#0a84ff;padding:12px 24px;color:#fff">${cfg.anchor}</a></p>`,
              true
            );

    samples.push({
      id: `ov-link-${i}`,
      split: assignSplit(seq++),
      source: 'open-vocab-discourse',
      category: 'pure-link',
      subject: subj,
      body,
      htmlBody,
      sender,
      expectedDomains: hasOrigin ? [p.domain] : [],
      originUrl: hasOrigin ? `https://${p.domain}/signup` : undefined,
      pageExpectation: rng.chance(0.45)
        ? { hasOtpInputs: false, hasMagicLinkPrompt: true }
        : undefined,
      label: {
        intent: cfg.intent,
        otp: null,
        linkSubstring: `${p.domain}${cfg.path}`,
        action: hasOrigin ? 'open-link' : 'show-review',
      },
    });
  }

  // ── 5. 1,029 Paired OTP + Magic Link with Page-Context Conditioning ─────
  for (let i = 0; i < 1029; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const isAlnum = rng.chance(0.2);
    const len = isAlnum ? rng.pick([5, 6, 7, 8]) : rng.pick([4, 5, 6, 6, 7, 8]);
    const code = isAlnum ? randomAlnumCode(rng, len) : randomNumericCode(rng, len);
    const tok = randomToken(rng, 24);
    const urlOnlyTrap = rng.chance(0.2);

    if (urlOnlyTrap) {
      const linkUrl = `https://app.${p.domain}/loginwithemail?state=abc-${code}-xyz`;
      samples.push({
        id: `ov-paired-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'paired-both',
        subject: `Log in to ${p.name}`,
        body: `Open the sign-in doorway below:\n${linkUrl}`,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<p>Use the link below to open your ${p.name} account:</p><a href="${linkUrl}" class="btn" style="background:#111;padding:12px 20px;color:#fff">Sign in to ${p.name}</a>`,
          true
        ),
        sender,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/login`,
        pageExpectation: { hasOtpInputs: false, hasMagicLinkPrompt: true },
        label: {
          intent: 'magic-link-login',
          otp: null,
          linkSubstring: `${p.domain}/loginwithemail`,
          action: 'open-link',
        },
      });
      continue;
    }

    const isNotionStyle = i % 2 === 0;
    const linkPath = isNotionStyle ? '/loginwithemail' : '/auth/magic-link';
    const linkUrl = isNotionStyle
      ? `https://app.${p.domain}/loginwithemail?state=v02_state_${tok}&code=${code}&isSignup=true`
      : `https://app.${p.domain}/auth/magic-link?token=${tok}&code=${code}`;
    const mode = i % 3;
    // Keep subject/intent cleanly correlated without making pageExpectation leak into intent
    const subj = isNotionStyle
      ? mode === 0
        ? `Your ${p.name} signup code`
        : `Sign in to ${p.name}`
      : mode === 0
        ? rng.pick([
            `Your ${p.name} temporary digits: ${code}`,
            `Your ${p.name} login code is ${code}`,
          ])
        : `Sign in to ${p.name}`;
    const body = isNotionStyle
      ? `Sign up for ${p.name}\nYou can sign up by entering the code on the sign up page in ${p.name}, or simply by clicking the magic link.\n\n${code}\n\nSign in with Magic Link: ${linkUrl}`
      : `Type ${code} into the page you came from, or click below to continue right away:\n${linkUrl}`;
    const htmlBody = isNotionStyle
      ? `<h1>Sign up for ${p.name}</h1><p>You can sign up by entering the code on the sign up page in ${p.name}, or simply by clicking the magic link.</p><p>${code}</p><a href="${linkUrl.replaceAll('&', '&amp;')}">Sign in with Magic Link</a>`
      : wrapHtmlShell(
          rng,
          p.domain,
          `<p>Your temporary login digits:</p><p style="font-size:24px;font-weight:bold">${code}</p><p>Or click below:</p><a href="${linkUrl}" class="btn" style="background:#0a84ff;padding:12px 20px;color:#fff">Sign in to ${p.name}</a>`,
          true
        );

    const pageExpectation: PageVerificationExpectation | undefined =
      mode === 0
        ? {
            hasOtpInputs: true,
            expectedOtpLength: len,
            expectedOtpFormat: isAlnum ? 'alphanumeric' : 'numeric',
          }
        : mode === 1
          ? { hasOtpInputs: false, hasMagicLinkPrompt: true }
          : undefined;
    const expectedAction: GhostNetActionClass =
      mode === 0 ? 'fill-otp' : mode === 1 ? 'open-link' : 'fill-otp-and-open-link';
    const dropSiteCtx = expectedAction === 'fill-otp' && rng.chance(0.3);

    samples.push({
      id: `ov-paired-${i}`,
      split: assignSplit(seq++),
      source: 'open-vocab-discourse',
      category: 'paired-both',
      subject: subj,
      body,
      htmlBody,
      sender,
      expectedDomains: dropSiteCtx ? [] : [p.domain],
      originUrl: dropSiteCtx ? undefined : `https://app.${p.domain}/login`,
      pageExpectation,
      label: {
        intent: mode === 0 ? 'verification' : 'magic-link-login',
        otp: code,
        linkSubstring: `${p.domain}${linkPath}`,
        action: expectedAction,
      },
    });
  }

  // ── 6. 686 Adversarial Honeypots, Dual Ambiguous Links & Unbound Phish ───
  for (let i = 0; i < 686; i++) {
    const p = rng.pick(PERSONAS);
    const kind = i % 3;
    if (kind === 0) {
      // display:none / opacity:0 honeypot before real code
      const trap = randomNumericCode(rng, 6);
      let real = randomNumericCode(rng, 6);
      if (real === trap) {
        real = '482910';
      }
      const hiddenAttr = rng.pick([
        'display:none;font-size:0px',
        'visibility:hidden',
        'opacity:0;max-height:0;overflow:hidden',
      ]);
      samples.push({
        id: `ov-adv-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'adversarial-phish',
        subject: `Finish checking ${p.name}`,
        body: `Use ${real} in your browser tab.`,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<div style="${hiddenAttr}">Use ${trap} right now</div><p>Enter these digits:</p><p style="font-size:26px;font-weight:bold">${real}</p>`,
          true
        ),
        sender: p.senders[0]!,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/verify`,
        pageExpectation: { hasOtpInputs: true, expectedOtpLength: 6, expectedOtpFormat: 'numeric' },
        label: { intent: 'verification', otp: real, linkSubstring: null, action: 'fill-otp' },
      });
    } else if (kind === 1) {
      // Competing dual activation URLs -> show-review
      const u1 = `https://app.${p.domain}/verify?token=${randomToken(rng, 20)}`;
      const u2 = `https://app.${p.domain}/activate?token=${randomToken(rng, 20)}`;
      samples.push({
        id: `ov-adv-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'adversarial-phish',
        subject: `Complete your ${p.name} setup`,
        body: `Verify: ${u1}\nActivate: ${u2}`,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<p>Pick the link below:</p><a href="${u1}" class="btn">Verify Email</a> <a href="${u2}" class="btn">Activate Account</a>`,
          false
        ),
        sender: p.senders[0]!,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/signup`,
        label: { intent: 'activation', otp: null, linkSubstring: null, action: 'show-review' },
      });
    } else {
      // Self-consistent phishing email unbound to expected site -> show-review
      const evilHost = rng.pick([
        'verify-alert.xyz',
        'xn--accm-4oa.com',
        '192.168.1.55',
        'login-notice.tk',
      ]);
      const tok = randomToken(rng, 22);
      const url = evilHost.startsWith('192.')
        ? `http://${evilHost}/verify?token=${tok}`
        : `https://${evilHost}/verify?token=${tok}`;
      const body = `Unusual login detected on your ${p.name} profile. Re-enter your credentials right away to stop termination: ${url}`;
      samples.push({
        id: `ov-adv-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'adversarial-phish',
        subject: `Urgent action needed on ${p.name}`,
        body,
        htmlBody: wrapHtmlShell(
          rng,
          evilHost,
          `<p>${body}</p><a href="${url}" style="background:#c00;padding:12px 24px;color:#fff">Confirm Account</a>`,
          false
        ),
        sender: `alert@${evilHost}`,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/login`,
        label: { intent: 'activation', otp: null, linkSubstring: null, action: 'show-review' },
      });
    }
  }

  // ── 7. 784 Hard-Negative Courier PINs, Receipts, Meetings & Promos ─────
  for (let i = 0; i < 784; i++) {
    const p = rng.pick(PERSONAS);
    const sender = rng.pick(p.senders);
    const n1 = rng.int(100000, 999999);
    const n2 = rng.int(1000, 9999);
    const kind = i % 5;

    if (kind === 0) {
      // Courier delivery PIN (hard semantic negative!)
      const body = `Your dinner order #${n1} is arriving in 4 minutes! Hand PIN ${n2} to your delivery courier at the front door.`;
      samples.push({
        id: `ov-negdom-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'transactional-none',
        subject: `Your courier is outside (#${n1})`,
        body,
        htmlBody: wrapHtmlShell(rng, p.domain, `<p>${body}</p>`, true),
        sender,
        expectedDomains: [p.domain],
        label: { intent: 'transactional', otp: null, linkSubstring: null, action: 'ignore' },
      });
    } else if (kind === 1) {
      // Order receipt & invoice
      const body = `Order #${n1} paid ($${rng.int(15, 290)}.${rng.int(10, 99)}). Tracking ref ${rng.int(100000, 999999)}. Shipped to CA 94107.`;
      const url = `https://${p.domain}/orders/${n1}`;
      samples.push({
        id: `ov-negdom-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'transactional-none',
        subject: `${p.name} receipt #${n1}`,
        body,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<p>${body}</p><a href="${url}" class="btn">Track Shipment</a>`,
          true
        ),
        sender,
        expectedDomains: [p.domain],
        label: { intent: 'transactional', otp: null, linkSubstring: null, action: 'ignore' },
      });
    } else if (kind === 2) {
      // SaaS Welcome Newsletter single-number trap
      const count = rng.pick([50000, 100000, 25000, 42000]);
      const url = `https://${p.domain}/docs/quickstart`;
      const body = `Join ${count} engineers shipping faster with ${p.name}. Read the quickstart guide today.`;
      samples.push({
        id: `ov-negdom-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'marketing-none',
        subject: `Welcome to ${p.name}!`,
        body,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<h2>Welcome!</h2><p>${body}</p><a href="${url}">Get started</a>`,
          true
        ),
        sender,
        expectedDomains: [p.domain],
        originUrl: `https://${p.domain}/signup`,
        label: { intent: 'marketing', otp: null, linkSubstring: null, action: 'ignore' },
      });
    } else if (kind === 3) {
      // Promo coupon flash sale
      const promo = rng.pick(['WINTER26', 'SAVE2026', 'SPRING25', 'HELLO20']);
      const url = `https://${p.domain}/pricing?utm_campaign=sale`;
      const body = `Save 40% this weekend using promo code ${promo} during checkout.`;
      samples.push({
        id: `ov-negdom-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'marketing-none',
        subject: `${p.name} Weekend Sale — 40% off`,
        body,
        htmlBody: wrapHtmlShell(
          rng,
          p.domain,
          `<p>Use code <strong>${promo}</strong> at checkout.</p><a href="${url}">Shop Now</a>`,
          true
        ),
        sender,
        expectedDomains: [p.domain],
        label: { intent: 'marketing', otp: null, linkSubstring: null, action: 'ignore' },
      });
    } else {
      // Meeting ID + port number
      const body = `Join Zoom Meeting ID: ${n1}99 tomorrow at 10am. Meeting room word: syncroom. Test server port 8080.`;
      samples.push({
        id: `ov-negdom-${i}`,
        split: assignSplit(seq++),
        source: 'open-vocab-discourse',
        category: 'transactional-none',
        subject: `Architecture Sync tomorrow`,
        body,
        htmlBody: wrapHtmlShell(rng, p.domain, `<p>${body}</p>`, false),
        sender,
        expectedDomains: [p.domain],
        label: { intent: 'transactional', otp: null, linkSubstring: null, action: 'ignore' },
      });
    }
  }

  return samples;
}

export function debiasRealCorpusMetadata(samples: CorpusEmailSample[]): CorpusEmailSample[] {
  return samples.map((s, idx) => {
    if (s.source === 'hf-sms-otp' && idx % 3 === 0) {
      return {
        ...s,
        expectedDomains: [],
        originUrl: undefined,
      };
    }
    if (s.label.action === 'ignore' && idx % 3 === 0) {
      const m = s.sender.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
      if (m?.[1]) {
        return {
          ...s,
          expectedDomains: [m[1].toLowerCase()],
        };
      }
    }
    return s;
  });
}
