import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmailAccount } from '../src/types';

const state = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  searchZohoInbox: vi.fn(async () => []),
}));

vi.mock('../src/services/storageService', () => ({
  storageService: {
    get: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    getFresh: vi.fn(async (key: string) => state.storage.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      state.storage.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      state.storage.delete(key);
    }),
  },
}));

vi.mock('../src/services/zohoMailService', () => ({
  searchZohoInbox: state.searchZohoInbox,
}));

const account = (service: EmailAccount['service'], fullEmail: string): EmailAccount => ({
  id: `${service}-saved`,
  domain: fullEmail.split('@')[1]!,
  fullEmail,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  service,
});

describe('public runtime boundary with saved full-build state', () => {
  beforeEach(() => {
    state.storage.clear();
    state.searchZohoInbox.mockClear();
    vi.resetModules();
    vi.stubGlobal('__GHOSTFILL_BUILD_PROFILE__', 'public');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('uses the temporary account despite a saved Gmail preference and connection', async () => {
    const temporary = account('mailtm', 'temporary@mail.tm');
    state.storage.set('preferredEmailType', 'gmail');
    state.storage.set('gmailConnected', true);
    state.storage.set('gmailProfile', { email: 'person@gmail.com' });
    state.storage.set('currentEmail', account('gmail', 'person@gmail.com'));
    state.storage.set('disposableEmail', temporary);

    const { emailService } = await import('../src/services/emailServices');
    expect(await emailService.getCurrentEmail()).toEqual(temporary);
  });

  it('does not expose a saved real-mail account as the temporary account', async () => {
    state.storage.set('currentEmail', account('zoho', 'person@zohomail.com'));

    const { emailService } = await import('../src/services/emailServices');
    expect(await emailService.getCurrentEmail(true)).toBeNull();
  });

  it('fills temporary mail despite a saved Gmail tab preference', async () => {
    state.storage.set('preferredEmailType', 'gmail');
    state.storage.set('currentEmail', account('gmail', 'person@gmail.com'));
    state.storage.set('disposableEmail', account('mailtm', 'temporary@mail.tm'));

    const { identityService } = await import('../src/services/identityService');
    expect(await identityService.resolveEmailForActiveTab()).toMatchObject({
      email: 'temporary@mail.tm',
      preferredEmailType: 'disposable',
      source: 'disposable',
    });
  });

  it('rejects explicit real-mail inbox requests without contacting the provider', async () => {
    const { emailService } = await import('../src/services/emailServices');

    await expect(emailService.checkInbox(account('zoho', 'person@zohomail.com'))).rejects.toThrow(
      'Real-mail integrations are unavailable in the public build.'
    );
    expect(state.searchZohoInbox).not.toHaveBeenCalled();
  });
});
