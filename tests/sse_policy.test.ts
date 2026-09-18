import { describe, expect, it } from 'vitest';

import { isAllowedMailTmSseRequest } from '../src/utils/ssePolicy';

describe('Mail.tm SSE relay policy', () => {
  const accountId = '507f1f77bcf86cd799439011';

  it('allows the exact Mercure account topic', () => {
    expect(
      isAllowedMailTmSseRequest(
        `https://mercure.mail.tm/.well-known/mercure?topic=${encodeURIComponent(`/accounts/${accountId}`)}`,
        accountId
      )
    ).toBe(true);
  });

  it.each([
    'https://evil.example/.well-known/mercure?topic=%2Faccounts%2F507f1f77bcf86cd799439011',
    'https://mercure.mail.tm/other?topic=%2Faccounts%2F507f1f77bcf86cd799439011',
    'https://mercure.mail.tm/.well-known/mercure?topic=%2Faccounts%2Fsomeone-else',
    'https://mercure.mail.tm/.well-known/mercure?topic=%2Faccounts%2F507f1f77bcf86cd799439011&next=https%3A%2F%2Fevil.example',
  ])('rejects a relay URL outside the exact allowlist: %s', (url) => {
    expect(isAllowedMailTmSseRequest(url, accountId)).toBe(false);
  });

  it('rejects malformed account identifiers', () => {
    expect(
      isAllowedMailTmSseRequest(
        'https://mercure.mail.tm/.well-known/mercure?topic=%2Faccounts%2F..%2Fsecret',
        '../secret'
      )
    ).toBe(false);
  });
});
