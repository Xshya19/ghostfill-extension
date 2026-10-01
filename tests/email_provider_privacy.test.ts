import { describe, expect, it } from 'vitest';

import type { EmailAccount, EmailService } from '../src/types';
import {
  canAutoOpenVerificationLink,
  isPrivateInbox,
  senderMatchesSite,
} from '../src/services/emailServices/privacy';

function account(service: EmailService, fields: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: 'test-inbox',
    domain: 'example.test',
    fullEmail: 'test@example.test',
    createdAt: 1,
    expiresAt: 2,
    service,
    ...fields,
  };
}

describe('email provider inbox privacy', () => {
  it('fails closed for public and unclassified inbox providers', () => {
    const publicServices: EmailService[] = [
      '1secmail',
      'catchmail',
      'evilmail',
      'getnada',
      'guerrilla',
      'maildrop',
      'mailinator',
      'mailnesia',
      'mailboxtemp',
      'mailcx',
      'openinbox',
      'tempmail',
      'tempmailplus',
      'yopmail',
      'driftz',
    ];

    for (const service of publicServices) {
      expect(isPrivateInbox(account(service)), service).toBe(false);
    }
    expect(isPrivateInbox(null)).toBe(false);
  });

  it('requires the provider credential for token protected inboxes', () => {
    expect(isPrivateInbox(account('mailtm'))).toBe(false);
    expect(isPrivateInbox(account('mailtm', { token: 'session-token' }))).toBe(true);
    expect(isPrivateInbox(account('mailgw', { password: 'inbox-password' }))).toBe(true);
    expect(isPrivateInbox(account('dropmail', { token: 'session-id' }))).toBe(true);
    expect(isPrivateInbox(account('throwawaymail', { token: 'mailbox-id' }))).toBe(true);
    expect(isPrivateInbox(account('tempmaillol', { token: 'inbox-token' }))).toBe(true);
    expect(isPrivateInbox(account('custom', { token: 'api-key' }))).toBe(true);
  });

  it('recognizes authenticated mail accounts as private', () => {
    expect(isPrivateInbox(account('gmail'))).toBe(true);
    expect(isPrivateInbox(account('zoho'))).toBe(true);
    expect(isPrivateInbox(account('microsoft'))).toBe(true);
  });

  it('requires sender and signup-site registrable domains to match', () => {
    expect(senderMatchesSite('Acme Security <verify@acme.com>', 'https://signup.acme.com')).toBe(
      true
    );
    expect(senderMatchesSite('verify@other.example', 'https://signup.acme.com')).toBe(false);
    expect(senderMatchesSite('', 'https://signup.acme.com')).toBe(false);
    expect(senderMatchesSite('verify@acme.com', 'invalid-url')).toBe(false);
  });
  it('matches Qwen first-party domains without trusting lookalikes or shared mail hosts', () => {
    const page = 'https://chat.qwen.ai/auth?mode=register';
    expect(senderMatchesSite('Qwen <noreply@qwenlm.ai>', page)).toBe(true);
    expect(senderMatchesSite('Qwen <notify@mail.qwenlm.ai>', page)).toBe(true);
    expect(senderMatchesSite('Qwen <noreply@qwen.ai>', 'https://chat.qwenlm.ai')).toBe(true);
    for (const sender of [
      'noreply@qwenlm.ai.attacker.com',
      'noreply@qwenlm-ai.com',
      'qwen@aliyun.com',
      'qwen@alibaba.com',
    ]) {
      expect(senderMatchesSite(`Qwen <${sender}>`, page), sender).toBe(false);
    }
    expect(
      canAutoOpenVerificationLink(
        account('driftz', { originUrl: page }),
        'Qwen <noreply@qwenlm.ai>',
        'https://chat.qwen.ai/verify?token=fixture_1234567890'
      )
    ).toBe(true);
  });

  it('allows public inbox verification links from the signup site without allowing OTP autofill', () => {
    const driftz = account('driftz', { originUrl: 'https://signup.example.com' });
    expect(isPrivateInbox(driftz)).toBe(false);
    expect(
      canAutoOpenVerificationLink(
        driftz,
        'Example <verify@example.com>',
        'https://auth.example.com/verify?token=1234567890'
      )
    ).toBe(true);
    expect(
      canAutoOpenVerificationLink(driftz, 'verify@other.com', 'https://auth.example.com/verify')
    ).toBe(false);
    expect(
      canAutoOpenVerificationLink(
        driftz,
        'verify@example.com',
        'https://unrelated.example.net/verify'
      )
    ).toBe(false);
    expect(
      canAutoOpenVerificationLink(null, 'verify@example.com', 'https://example.com/verify')
    ).toBe(false);
  });

  it('uses sender-to-link matching for older accounts without a captured signup site', () => {
    const driftz = account('driftz');
    expect(
      canAutoOpenVerificationLink(driftz, 'verify@example.com', 'https://example.com/verify')
    ).toBe(true);
    expect(
      canAutoOpenVerificationLink(driftz, 'verify@example.com', 'https://other.com/verify')
    ).toBe(false);
  });
});
