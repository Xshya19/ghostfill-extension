import { afterEach, describe, expect, it, vi } from 'vitest';

import { scoreActivationLink } from '../src/services/extraction/activationLinkGuard';
import { extractAll } from '../src/services/intelligentExtractor';
import { smartDetectionService } from '../src/services/otpService';

const notionLink = (code: string) =>
  `https://app.notion.com/loginwithemail?state=v02%3Atemp_password%3Afixture_state_123456789&password=${code}&isSignup=true`;

function notionMessage(code: string) {
  const instructions =
    'You can sign up by entering the code on the sign up page in Notion, or simply by clicking the magic link.';
  const url = notionLink(code);
  return {
    subject: 'Your Notion signup code',
    body: `Sign up for Notion\n${instructions}\n\n${code}\n\nSign in with Magic Link: ${url}`,
    html: `<h1>Sign up for Notion</h1><p>${instructions}</p><p>${code}</p><a href="${url.replaceAll('&', '&amp;')}">Sign in with Magic Link</a>`,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('paired verification messages', () => {
  it('does not treat a postal address in a magic-link email as a verification code', async () => {
    const url = 'https://claude.ai/magic-link#fixture_login_token_abcdef123456789';
    const tracking = `https://url8792.mail.anthropic.com/ls/click?upn=u001.${'rFcAmKXLOm9u6wLRWHIUYb57odYuMXptiIvSnUIhs1OeXNnA7r2WnG'.repeat(12)}-2B0SMX`;
    const body = `Sign in to Claude\nClick Sign in with Claude.ai to log in.\n${url}\nAnthropic, 548 Market Street, PMB 90375, San Francisco, CA 94104-5401\nPrivacy [${tracking}]`;
    const html = `<h1>Sign in to Claude</h1><a href="${url}">Sign in with Claude.ai</a><a href="${tracking}">Privacy</a><footer>Anthropic, 548 Market Street, PMB 90375, San Francisco, CA 94104-5401</footer>`;
    const result = await smartDetectionService.detect('Sign in to Claude', body, html, 'Claude <support@mail.anthropic.com>', ['claude.ai']);
    expect(result).toMatchObject({ type: 'link', link: url, decision: { action: 'open-link', canAutoAct: true } });
    expect(result.code).toBeUndefined();
  });
  it.each(['451612', '038291'])(
    'keeps the independent Notion code %s and its alternative link',
    (code) => {
      const message = notionMessage(code);
      const result = extractAll(
        message.subject,
        message.body,
        message.html,
        'accounts@notion.com',
        ['app.notion.com']
      );
      expect(result.otp?.code).toBe(code);
      expect(result.link?.url).toBe(notionLink(code));
      expect(result.link?.type).not.toBe('password-reset');
      expect(result.debugInfo.crossValidation).not.toBe('otp-is-url-token');
    }
  );

  it('preserves a code from HTML when the plain-text part contains only a preview', () => {
    const message = notionMessage('451612');
    const result = extractAll(
      message.subject,
      'Sign up for Notion',
      message.html,
      'accounts@notion.com'
    );
    expect(result.otp?.code).toBe('451612');
    expect(result.link?.url).toBe(notionLink('451612'));
  });

  it.each(['582914', 'A8F29K', '582-914'])(
    'preserves the separate code %s when it is also in the link',
    (code) => {
      const clean = code.replace('-', '');
      const url = `https://app.example.com/verify?token=fixture_${clean}_123456789`;
      const result = extractAll(
        'Your verification code',
        `Enter the code to verify your email:\n${code}\nOr verify using ${url}`,
        `<p>Enter the code to verify your email:</p><strong>${code}</strong><a href="${url}">Verify email</a>`,
        'accounts@example.com'
      );
      expect(result.otp?.code).toBe(clean);
      expect(result.link?.url).toBe(url);
    }
  );

  it('does not turn a number contained only in a magic-link token into a manual code', () => {
    const url = 'https://app.example.com/magic?token=fixture_582914_123456789';
    const result = extractAll(
      'Sign in with your magic link',
      `Sign in by clicking ${url}`,
      `<a href="${url}">Sign in with Magic Link</a>`,
      'accounts@example.com'
    );
    expect(result.otp).toBeNull();
    expect(result.link?.url).toBe(url);
  });

  it('classifies an opaque-state email login route as a magic link', () => {
    expect(scoreActivationLink(notionLink('451612'), 'Sign in with Magic Link').cls).toBe(
      'magic-login'
    );
    expect(scoreActivationLink(notionLink('451612'), 'Sign in with Magic Link').canAutoOpen).toBe(
      true
    );
    expect(
      scoreActivationLink(
        'https://app.example.com/redirect?state=fixture_state_123456789',
        'Continue'
      ).canAutoOpen
    ).toBe(false);
  });

  it('does not reuse the text-only detection when the full HTML message arrives', async () => {
    const session = new Map<string, unknown>();
    vi.spyOn(chrome.storage.session, 'get').mockImplementation(async (key) =>
      typeof key === 'string' ? { [key]: session.get(key) } : Object.fromEntries(session)
    );
    vi.spyOn(chrome.storage.session, 'set').mockImplementation(async (data) => {
      Object.entries(data).forEach(([key, value]) => session.set(key, value));
    });
    await (
      smartDetectionService as unknown as { initializeCacheEncryption: () => Promise<void> }
    ).initializeCacheEncryption();
    const message = notionMessage('451612');
    await smartDetectionService.detect(
      message.subject,
      'Sign up for Notion',
      '',
      'accounts@notion.com'
    );
    const result = await smartDetectionService.detect(
      message.subject,
      'Sign up for Notion',
      message.html,
      'accounts@notion.com'
    );
    expect(result.code).toBe('451612');
    expect(result.link).toBe(notionLink('451612'));
  });

  it('does not collide when a long template changes its code in the middle', async () => {
    const session = new Map<string, unknown>();
    vi.spyOn(chrome.storage.session, 'get').mockImplementation(async (key) =>
      typeof key === 'string' ? { [key]: session.get(key) } : Object.fromEntries(session)
    );
    vi.spyOn(chrome.storage.session, 'set').mockImplementation(async (data) => {
      Object.entries(data).forEach(([key, value]) => session.set(key, value));
    });
    await (
      smartDetectionService as unknown as { initializeCacheEncryption: () => Promise<void> }
    ).initializeCacheEncryption();
    const body = (code: string) =>
      `${'Welcome to our service. '.repeat(70)}\nYour verification code is ${code}.\n${'This code expires shortly. '.repeat(40)}`;
    await smartDetectionService.detect(
      'Your verification code',
      body('582914'),
      '',
      'accounts@example.com'
    );
    const result = await smartDetectionService.detect(
      'Your verification code',
      body('391827'),
      '',
      'accounts@example.com'
    );
    expect(result.code).toBe('391827');
  });
});
