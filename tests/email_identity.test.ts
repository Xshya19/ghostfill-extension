import { describe, expect, it } from 'vitest';

import {
  getSenderDomain,
  getSenderEmail,
  getSenderLabel,
  parseEmailIdentity,
} from '../src/utils/emailIdentity';

describe('email identity normalization', () => {
  it('turns automated Notion senders into a provider label', () => {
    const raw = 'bounce+2241f3@mailer.notion.so';

    expect(getSenderLabel(raw, 'Your Notion signup code')).toBe('Notion');
    expect(getSenderEmail(raw)).toBe('bounce+2241f3@mailer.notion.so');
    expect(getSenderDomain(raw)).toBe('notion.so');
  });

  it('recognizes a known provider behind a service subdomain', () => {
    expect(getSenderLabel('bounce+token@service.qwenlm.ai', 'Activate your account')).toBe('Qwen');
  });

  it('preserves a useful display name and parses angle-bracket headers', () => {
    const parsed = parseEmailIdentity('Qwen AI <no-reply@service.qwenlm.ai>');

    expect(parsed.displayName).toBe('Qwen AI');
    expect(parsed.email).toBe('no-reply@service.qwenlm.ai');
    expect(getSenderLabel('Qwen AI <no-reply@service.qwenlm.ai>')).toBe('Qwen AI');
  });

  it('does not surface an opaque address when no domain is available', () => {
    expect(getSenderLabel('bounce+opaque-token')).toBe('Unknown sender');
  });
});
