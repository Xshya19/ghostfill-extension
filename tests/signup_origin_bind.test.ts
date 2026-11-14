import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the encrypted storage service.
const { store, setSpy } = vi.hoisted(() => {
  const map = new Map<string, unknown>();
  const set = vi.fn(async (key: string, value: unknown) => {
    map.set(key, structuredClone(value));
  });
  return { store: map, setSpy: set };
});

vi.mock('../src/services/storageService', () => ({
  storageService: {
    get: vi.fn(async (key: string) =>
      store.has(key) ? structuredClone(store.get(key)) : undefined
    ),
    set: setSpy,
  },
}));

import {
  maybeBindSignupOrigin,
  originFromTabUrl,
  senderTabUrl,
} from '../src/background/signupOriginBinder';

const tempAccount = (originUrl?: string) => ({
  id: 'tmp-1',
  fullEmail: 'ghost123@x.mail',
  service: 'mailtm',
  createdAt: 1,
  expiresAt: 2,
  ...(originUrl ? { originUrl } : {}),
});

const gmailAccount = (originUrl?: string) => ({
  id: 'gmail_x',
  fullEmail: 'user+alias@gmail.com',
  service: 'gmail',
  createdAt: 1,
  expiresAt: 2,
  ...(originUrl ? { originUrl } : {}),
});

beforeEach(() => {
  store.clear();
  setSpy.mockClear();
});

describe('originFromTabUrl', () => {
  it('returns the origin for http(s) tab URLs', () => {
    expect(originFromTabUrl('https://chat.z.ai/auth/verify_email?token=abc')).toBe(
      'https://chat.z.ai'
    );
    expect(originFromTabUrl('http://signup.internal/register')).toBe('http://signup.internal');
  });

  it('refuses non-web and unparsable tab URLs', () => {
    expect(originFromTabUrl('chrome://newtab')).toBeNull();
    expect(originFromTabUrl('about:blank')).toBeNull();
    expect(originFromTabUrl('chrome-extension://xyz/popup.html')).toBeNull();
    expect(originFromTabUrl('not a url')).toBeNull();
    expect(originFromTabUrl(undefined)).toBeNull();
    expect(originFromTabUrl('')).toBeNull();
  });
});

describe('senderTabUrl', () => {
  it('prefers the browser-provided tab URL over any frame URL', () => {
    expect(
      senderTabUrl({
        tab: { url: 'https://signup.example.com/form' },
        url: 'https://other.example.com/',
      })
    ).toBe('https://signup.example.com/form');
    expect(senderTabUrl({ url: 'https://framed.example.com/' })).toBe(
      'https://framed.example.com/'
    );
    expect(senderTabUrl({})).toBeUndefined();
  });
});

describe('maybeBindSignupOrigin', () => {
  it('binds the origin onto a currentEmail-only temp account', async () => {
    store.set('currentEmail', tempAccount());
    const bound = await maybeBindSignupOrigin('https://chat.z.ai/app', 'identity_fill');
    expect(bound).toBe('https://chat.z.ai');
    expect((store.get('currentEmail') as { originUrl?: string }).originUrl).toBe(
      'https://chat.z.ai'
    );
  });

  it('binds a Gmail-preferred session whose account lives under disposableEmail', async () => {
    store.set('disposableEmail', tempAccount());
    const bound = await maybeBindSignupOrigin('https://claude.ai/magic-link', 'otp_page');
    expect(bound).toBe('https://claude.ai');
    expect((store.get('disposableEmail') as { originUrl?: string }).originUrl).toBe(
      'https://claude.ai'
    );
  });

  it('does not rewrite storage when the origin is unchanged', async () => {
    store.set('currentEmail', tempAccount('https://chat.z.ai'));
    store.set('disposableEmail', tempAccount('https://chat.z.ai'));
    const bound = await maybeBindSignupOrigin('https://chat.z.ai/other', 'otp_page');
    expect(bound).toBe('https://chat.z.ai');
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('latest-wins across a signup on a second site (same ghost account)', async () => {
    store.set('currentEmail', tempAccount('https://chat.z.ai'));
    store.set('disposableEmail', tempAccount('https://chat.z.ai'));
    await maybeBindSignupOrigin('https://claude.ai/magic-link', 'form_submit');
    expect((store.get('currentEmail') as { originUrl?: string }).originUrl).toBe(
      'https://claude.ai'
    );
    expect((store.get('disposableEmail') as { originUrl?: string }).originUrl).toBe(
      'https://claude.ai'
    );
  });

  it('never rebinds a real-mail (Gmail OAuth) account', async () => {
    store.set('currentEmail', gmailAccount());
    const bound = await maybeBindSignupOrigin('https://chat.z.ai/app', 'identity_fill');
    expect(bound).toBe('https://chat.z.ai');
    expect((store.get('currentEmail') as { originUrl?: string }).originUrl).toBeUndefined();
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('returns null for tab-less (popup) or non-web messages and writes nothing', async () => {
    store.set('currentEmail', tempAccount());
    expect(await maybeBindSignupOrigin(undefined, 'identity_fill')).toBeNull();
    expect(await maybeBindSignupOrigin('chrome://newtab', 'identity_fill')).toBeNull();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
