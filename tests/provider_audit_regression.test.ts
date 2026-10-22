import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { EmailServiceAggregator } from '../src/services/emailServices';
import { catchmailService } from '../src/services/emailServices/catchmailService';
import { CustomDomainService } from '../src/services/emailServices/customDomainService';
import { mailinatorService } from '../src/services/emailServices/mailinatorService';
import { mailnesiaService } from '../src/services/emailServices/mailnesiaService';
import { MailTmService, mailTmService } from '../src/services/emailServices/mailTmService';
import { ProviderHealthManager } from '../src/services/emailServices/providerHealthManager';
import { tempMailService } from '../src/services/emailServices/tempMailService';
import { storageService } from '../src/services/storageService';
import type { Email, EmailAccount, EmailService } from '../src/types';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const account = (service: EmailService = 'catchmail'): EmailAccount => ({
  id: 'account-1', fullEmail: 'alice@example.com', domain: 'example.com', login: 'alice',
  service, password: 'test-password', token: 'expired-token',
  createdAt: Date.now(), expiresAt: Date.now() + 3_600_000,
});
const message: Email = {
  id: 'message-1', from: 'verify@example.com', subject: 'Code', body: 'Code 839201',
  date: 100_000, attachments: [], read: true,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request in provider regression test')));
  vi.stubGlobal('chrome', { ...chrome, permissions: { contains: vi.fn().mockResolvedValue(true) } });
  mailTmService.clearAuthentication();
  vi.spyOn(storageService, 'get').mockResolvedValue([] as never);
  vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('successful fresh inbox checks reset the provider failure streak', async () => {
  const health = new ProviderHealthManager();
  const api = new EmailServiceAggregator(health);
  const fetch = vi.spyOn(catchmailService, 'getMessages');
  for (let i = 0; i < 3; i++) {
    fetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(api.checkInbox(account())).rejects.toThrow();
    fetch.mockResolvedValueOnce([]);
    await expect(api.checkInbox(account())).resolves.toEqual([]);
  }
  expect(health.getHealthReport().find(({ name }) => name === 'catchmail')?.consecutiveFailures).toBe(0);
  expect(health.isAvailable('catchmail')).toBe(true);
});

it('a circuit-open cached response does not count as fresh provider success', async () => {
  const health = new ProviderHealthManager();
  const api = new EmailServiceAggregator(health);
  for (let i = 0; i < 3; i++) { health.recordFailure('catchmail', new Error('Failed to fetch')); }
  const fetch = vi.spyOn(catchmailService, 'getMessages');
  await expect(api.checkInbox(account())).resolves.toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
  expect(health.isAvailable('catchmail')).toBe(false);
});

it('Mail.tm refreshes a rejected token and keeps it for subsequent full-message reads', async () => {
  const acc = account('mailtm');
  vi.spyOn(storageService, 'get').mockImplementation(async (key) => (key === 'currentEmail' ? acc : []) as never);
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/token')) { return json({ token: 'fresh-token' }); }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-token') { return json({}, 401); }
    const mail = { id: message.id, from: { address: message.from }, subject: message.subject, text: message.body, createdAt: new Date().toISOString() };
    return String(url).endsWith('/messages') ? json({ 'hydra:member': [mail] }) : json(mail);
  });
  vi.stubGlobal('fetch', fetch);
  const api = new EmailServiceAggregator(new ProviderHealthManager());
  expect(await api.checkInbox(acc)).toHaveLength(1);
  expect(mailTmService.getToken()).toBe('fresh-token');
  await expect(api.readEmail(message.id, acc)).resolves.toMatchObject({ body: message.body });
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
});

it('Mail.tm message 401 reauthenticates the requested stored mailbox, not the current mailbox', async () => {
  const acc = account('mailtm');
  const other = { ...acc, fullEmail: 'other@example.com', password: 'other-password' };
  vi.spyOn(storageService, 'get').mockImplementation(async (key) => (key === 'currentEmail' ? other : []) as never);
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/token')) {
      expect(JSON.parse(String(init?.body))).toEqual({ address: acc.fullEmail, password: acc.password });
      return json({ token: 'stored-mailbox-token' });
    }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-token') { return json({}, 401); }
    return json({ id: message.id, from: { address: message.from }, text: message.body });
  });
  vi.stubGlobal('fetch', fetch);
  await expect(new EmailServiceAggregator(new ProviderHealthManager()).readEmail(message.id, acc))
    .resolves.toMatchObject({ body: message.body });
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
});

it('concurrent Mail.tm body reads share one refresh and cannot reinstall the rejected token', async () => {
  const acc = account('mailtm');
  let releaseToken!: (value: Response) => void;
  const tokenResponse = new Promise<Response>((resolve) => { releaseToken = resolve; });
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith('/token')) { return tokenResponse; }
    if (new Headers(init?.headers).get('Authorization') === 'Bearer expired-token') { return json({}, 401); }
    return json({ id: message.id, from: { address: message.from }, text: message.body });
  });
  vi.stubGlobal('fetch', fetch);
  const api = new EmailServiceAggregator(new ProviderHealthManager());
  const first = api.readEmail(message.id, acc);
  await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1));
  const second = api.readEmail(message.id, acc);
  releaseToken(json({ token: 'shared-fresh-token' }));
  await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  expect(mailTmService.getToken()).toBe('shared-fresh-token');
});

it('clearing Mail.tm authentication prevents an in-flight login from restoring its token', async () => {
  const service = new MailTmService();
  let releaseToken!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { releaseToken = resolve; })));
  const login = service.authenticate('alice@example.com', 'test-password');
  const assertion = expect(login).rejects.toMatchObject({ name: 'AbortError' });
  service.clearAuthentication();
  releaseToken(json({ token: 'late-token' }));
  await assertion;
  expect(service.getToken()).toBeNull();
});

it('Mail.tm account creation rejects failed new credentials instead of returning an old token', async () => {
  vi.useFakeTimers();
  const service = new MailTmService();
  await service.setToken('previous-account-token');
  vi.spyOn(service, 'getDomains').mockResolvedValue(['example.com']);
  const authenticate = vi.spyOn(service, 'authenticate');
  vi.stubGlobal('fetch', vi.fn(async (url) => String(url).endsWith('/accounts')
    ? json({ id: 'new-account', address: 'new-user@example.com' }) : json({}, 401)));
  const assertion = expect(service.createAccount('new-user')).rejects.toThrow('Authentication failed');
  await vi.advanceTimersByTimeAsync(20_000);
  await assertion;
  expect(authenticate).toHaveBeenCalled();
  expect(service.getToken()).toBeNull();
});

it('custom fallback IDs stay stable across polls, reorderings, and identical duplicates', async () => {
  vi.spyOn(storageService, 'getSettings').mockResolvedValue({ customDomain: 'example.com', customDomainUrl: 'https://worker.example.com/api' } as never);
  vi.spyOn(storageService, 'getCustomDomainKey').mockResolvedValue(null);
  const firstMail = { from: message.from, subject: message.subject, body: message.body, date: 100_000 };
  const secondMail = { ...firstMail, subject: 'Another email' };
  let messages = [firstMail, secondMail, firstMail];
  vi.stubGlobal('fetch', vi.fn(async () => json({ messages })));
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const service = new CustomDomainService();
  const first = await service.getMessages(account('custom'));
  clock.mockReturnValue(100_001);
  messages = [secondMail, firstMail, firstMail];
  const second = await service.getMessages(account('custom'));
  expect(new Set(first.map(({ id }) => id)).size).toBe(3);
  expect(second.map(({ id }) => id).sort()).toEqual(first.map(({ id }) => id).sort());
  await expect(new EmailServiceAggregator(new ProviderHealthManager()).readEmail(first[0]!.id, account('custom')))
    .resolves.toMatchObject({ body: message.body });
});

it('custom requests require a host grant and omit cookies and redirects after approval', async () => {
  vi.spyOn(storageService, 'getSettings').mockResolvedValue({ customDomain: 'example.com', customDomainUrl: 'https://worker.example.com/api' } as never);
  vi.spyOn(storageService, 'getCustomDomainKey').mockResolvedValue(null);
  vi.mocked(chrome.permissions.contains).mockResolvedValue(false);
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json({ messages: [] }));
  vi.stubGlobal('fetch', fetch);
  const service = new CustomDomainService();
  await expect(service.createAccount()).rejects.toThrow('Allow endpoint access');
  await expect(service.getMessages(account('custom'))).rejects.toThrow('Allow endpoint access');
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(chrome.permissions.contains).mockResolvedValue(true);
  await service.createAccount();
  await service.getMessages(account('custom'));
  expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://worker.example.com/*'] });
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({ redirect: 'error', credentials: 'omit' });
  }
});

it('stored Mailnesia message reads dispatch to Mailnesia', async () => {
  const read = vi.spyOn(mailnesiaService, 'getMessage').mockResolvedValue(message);
  const unrelated = vi.spyOn(tempMailService, 'readEmail').mockResolvedValue(message);
  await new EmailServiceAggregator(new ProviderHealthManager()).readEmail(message.id, account('mailnesia'));
  expect(read).toHaveBeenCalledWith('alice@example.com', message.id, undefined);
  expect(unrelated).not.toHaveBeenCalled();
});

it('generation honors the saved Mailinator preference', async () => {
  const api = new EmailServiceAggregator(new ProviderHealthManager());
  vi.spyOn(api, 'performHealthCheck').mockResolvedValue(undefined);
  vi.spyOn(storageService, 'getSettings').mockResolvedValue({ preferredEmailService: 'mailinator', saveHistory: false } as never);
  const mailinator = vi.spyOn(mailinatorService, 'createAccount').mockResolvedValue(account('mailinator'));
  const catchmail = vi.spyOn(catchmailService, 'createAccount').mockResolvedValue(account());
  expect((await api.generateEmail()).service).toBe('mailinator');
  expect(mailinator).toHaveBeenCalledOnce();
  expect(catchmail).not.toHaveBeenCalled();
});

it('clearing data prevents an in-flight generation from restoring an account', async () => {
  const api = new EmailServiceAggregator(new ProviderHealthManager());
  vi.spyOn(api, 'performHealthCheck').mockResolvedValue(undefined);
  vi.spyOn(storageService, 'getSettings').mockResolvedValue({ preferredEmailService: 'catchmail', saveHistory: false } as never);
  let finishGeneration!: (value: EmailAccount) => void;
  const create = vi.spyOn(catchmailService, 'createAccount').mockImplementation(() => new Promise((resolve) => { finishGeneration = resolve; }));
  const generation = api.generateEmail();
  const assertion = expect(generation).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(create).toHaveBeenCalled());
  const clearing = api.clearData();
  finishGeneration(account());
  await assertion;
  await clearing;
  expect(storageService.set).not.toHaveBeenCalledWith('currentEmail', expect.anything());
  expect(storageService.set).not.toHaveBeenCalledWith('disposableEmail', expect.anything());
});

it('clearData waits for already-started account persistence before removing stored accounts', async () => {
  const api = new EmailServiceAggregator(new ProviderHealthManager());
  vi.spyOn(api, 'performHealthCheck').mockResolvedValue(undefined);
  vi.spyOn(storageService, 'getSettings').mockResolvedValue({ preferredEmailService: 'catchmail', saveHistory: false } as never);
  vi.spyOn(catchmailService, 'createAccount').mockResolvedValue(account());
  let finishWrite!: () => void;
  vi.mocked(storageService.set).mockImplementation(async (key) => {
    if (key === 'disposableEmail') { await new Promise<void>((resolve) => { finishWrite = resolve; }); }
  });
  const remove = vi.spyOn(storageService, 'remove').mockResolvedValue(undefined);
  const generation = api.generateEmail();
  const assertion = expect(generation).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(storageService.set).toHaveBeenCalledWith('disposableEmail', expect.anything()));
  const clearing = api.clearData();
  await Promise.resolve();
  expect(remove).not.toHaveBeenCalled();
  finishWrite();
  await assertion;
  await clearing;
  expect(remove).toHaveBeenCalledWith('disposableEmail');
  expect(storageService.set).not.toHaveBeenCalledWith('currentEmail', expect.anything());
});
