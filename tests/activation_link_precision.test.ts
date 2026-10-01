import { describe, expect, it } from 'vitest';

import { assessEmailDecision } from '../src/services/emailDecisionEngine';
import { isAutoOpenableActivationLink } from '../src/services/extraction/activationLinkGuard';
import { extractAll } from '../src/services/intelligentExtractor';

describe('activation link precision', () => {
  it('ignores footer and marketing links in an activation email', () => {
    const result = extractAll(
      'Verify your email',
      'Please verify your email to finish signup.',
      '<a href="https://app.example.com/pricing?token=tracking123456789">Verify email</a>' +
        '<a href="https://app.example.com/unsubscribe">Unsubscribe</a>',
      'accounts@example.com',
      ['app.example.com']
    );

    expect(result.link).toBeNull();
  });

  it('selects the real verification action over a tokenized dashboard link', () => {
    const correct = 'https://app.example.com/verify?token=real_action_123456789';
    const result = extractAll(
      'Confirm your email',
      'Confirm your address to finish signup.',
      '<a href="https://app.example.com/dashboard?token=tracking123456789">Open dashboard</a>' +
        `<a href="${correct}">Confirm email</a>` +
        '<a href="https://app.example.com/unsubscribe">Unsubscribe</a>',
      'accounts@example.com',
      ['app.example.com']
    );

    expect(result.link?.url).toBe(correct);
  });

  it('abstains when two distinct verification actions are equally plausible', () => {
    const result = extractAll(
      'Verify your email',
      'Use the verification link to finish signup.',
      '<a href="https://app.example.com/verify?token=first_action_123456789">Verify email</a>' +
        '<a href="https://app.example.com/verify?token=second_action_123456789">Verify email</a>',
      'accounts@example.com',
      ['app.example.com']
    );

    expect(result.link).toBeNull();
  });

  it('does not auto-open a plausible link on an unrelated domain', () => {
    const result = extractAll(
      'Verify your email',
      'Verify your address.',
      '<a href="https://unrelated.example.net/verify?token=off_site_123456789">Verify email</a>',
      'accounts@example.com',
      ['app.example.com']
    );
    const decision = assessEmailDecision({
      extraction: result,
      sender: 'accounts@example.com',
      expectedDomains: ['app.example.com'],
    });

    expect(decision.action).not.toBe('open-link');
    expect(decision.canAutoAct).toBe(false);
  });

  it('requires review when the sender and activation site disagree', () => {
    const result = extractAll(
      'Verify your email',
      'Verify your address.',
      '<a href="https://app.example.com/verify?token=real_action_123456789">Verify email</a>',
      'accounts@unrelated.example.net'
    );
    const decision = assessEmailDecision({
      extraction: result,
      sender: 'accounts@unrelated.example.net',
    });

    expect(decision.action).toBe('show-review');
    expect(decision.canAutoAct).toBe(false);
  });

  it('does not mistake a redirect parameter for an activation route', () => {
    const bait = 'https://app.example.com/redirect?next=%2Fverify&token=tracking123456789';
    const result = extractAll(
      'Verify your email',
      'Verify your email to continue.',
      `<a href="${bait}">Continue</a>`,
      'accounts@example.com'
    );

    expect(result.link).toBeNull();
    expect(isAutoOpenableActivationLink(bait)).toBe(false);
  });

  it('ignores a generic signup destination with a tracking token', () => {
    const result = extractAll(
      'Verify your email',
      'Verify your email to continue.',
      '<a href="https://app.example.com/signup?token=tracking123456789">Continue</a>',
      'accounts@example.com'
    );

    expect(result.link).toBeNull();
  });

  it('selects the verified destination inside an email tracking wrapper', () => {
    const target = 'https://app.example.com/verify?token=real_action_123456789';
    const wrapped = `https://ct.sendgrid.net/ls/click?url=${encodeURIComponent(target)}`;
    const result = extractAll(
      'Verify your email',
      'Use the link below to verify your email.',
      `<a href="${wrapped}">Verify email</a>`,
      'accounts@example.com'
    );

    expect(result.link?.url).toBe(target);
  });
});
