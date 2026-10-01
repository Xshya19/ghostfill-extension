import { afterEach, expect, it, vi } from 'vitest';
import { EmailServiceAggregator } from '../src/services/emailServices';
import { catchmailService } from '../src/services/emailServices/catchmailService';
import { driftzService } from '../src/services/emailServices/driftzService';
import { mailGwService } from '../src/services/emailServices/mailGwService';
import { mailTmService } from '../src/services/emailServices/mailTmService';
import { ProviderHealthManager } from '../src/services/emailServices/providerHealthManager';
import { storageService } from '../src/services/storageService';
import { getSenderEmail, getSenderLabel } from '../src/utils/emailIdentity';
import { disconnectMicrosoft, searchMicrosoftInbox } from '../src/services/microsoftMailService';
import { disconnectZoho, searchZohoInbox } from '../src/services/zohoMailService';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['microsoft', 'zoho'])('retains native display names from %s', async (provider) => {
  await (provider === 'microsoft' ? disconnectMicrosoft() : disconnectZoho());
  vi.stubGlobal('chrome', {
    ...chrome,
    identity: {
      getRedirectURL: () => 'https://fixture.chromiumapp.org/',
      launchWebAuthFlow: (_options: unknown, callback: (url: string) => void) =>
        callback('https://fixture.chromiumapp.org/#access_token=fixture&expires_in=3600'),
    },
  });
  vi.spyOn(storageService, 'get').mockImplementation(async (key) => {
    if (key === 'zohoProfile') {
      return { accountId: 'fixture' } as any;
    }
    return 'fixture' as any;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            provider === 'microsoft'
              ? {
                  value: [
                    {
                      id: 'fixture',
                      from: { emailAddress: { name: 'NovaMesh', address: 'bounce@delivery.com' } },
                      subject: 'Welcome',
                      receivedDateTime: new Date().toISOString(),
                    },
                  ],
                }
              : {
                  status: { code: 200 },
                  data: [
                    {
                      messageId: 'fixture',
                      sender: 'NovaMesh',
                      fromAddress: 'bounce@delivery.com',
                      subject: 'Welcome',
                      receivedTime: String(Date.now()),
                    },
                  ],
                }
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )
  );
  const messages = await (provider === 'microsoft'
    ? searchMicrosoftInbox('fixture@outlook.com')
    : searchZohoInbox('fixture@zoho.com'));
  expect(messages[0]!.fromName).toBe('NovaMesh');
  expect(getSenderLabel(messages[0]!.from)).toBe('NovaMesh');
  expect(messages[0]!.fromEmail).toBe('bounce@delivery.com');
});

it.each([
  ['mail.tm', mailTmService],
  ['mail.gw', mailGwService],
])('retains structured sender names from %s list and detail responses', (_provider, service) => {
  const record = {
    id: 'fixture',
    from: { name: 'NovaMesh', address: 'bounces+123@delivery.com' },
    subject: 'Welcome',
    text: 'Message',
    intro: 'Message',
    createdAt: new Date().toISOString(),
  };
  for (const detail of [false, true]) {
    const email = (service as any).convertMessage(record, detail);
    expect(getSenderLabel(email.from)).toBe('NovaMesh');
    expect(getSenderEmail(email.from)).toBe(record.from.address);
  }
});

it('preserves structured senders from providers returning an object instead of a header string', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            String(url).includes('/mailbox?')
              ? {
                  messages: [
                    {
                      id: 'fixture',
                      from: { name: 'NovaMesh', address: 'no-reply@delivery.com' },
                      subject: 'Welcome',
                    },
                  ],
                }
              : {}
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )
  );
  const messages = await catchmailService.getMessages('fixture@catchmail.io');
  expect(getSenderLabel(messages[0]!.from)).toBe('NovaMesh');
  expect(getSenderEmail(messages[0]!.from)).toBe('no-reply@delivery.com');
});

it('uses sender metadata supplied only by the Driftz detail response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify({
            success: true,
            result: String(url).includes('?limit=')
              ? {
                  items: [
                    { id: 'fixture', fromAddress: 'bounces+123@delivery.com', subject: 'Welcome' },
                  ],
                }
              : {
                  fromAddress: 'bounces+123@delivery.com',
                  fromName: 'NovaMesh',
                  textContent: 'Message',
                },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    )
  );
  const messages = await driftzService.getMessages('fixture@inbox.com');
  expect(getSenderLabel(messages[0]!.from)).toBe('NovaMesh');
});

it('retains header names in storage and refreshes sender metadata for an existing message', async () => {
  const message = {
    id: 'fixture',
    from: 'NovaMesh <bounces+123@delivery.com>',
    subject: 'Welcome',
    date: Date.now(),
    body: 'Hello',
    attachments: [],
    read: false,
  };
  const oldMessage = { ...message, from: 'bounces+123@delivery.com' };
  const health = new ProviderHealthManager();
  const aggregator = new EmailServiceAggregator(health);
  vi.spyOn(health, 'isAvailable').mockReturnValue(true);
  vi.spyOn(health, 'recordSuccess').mockImplementation(() => {});
  vi.spyOn(driftzService, 'getMessages').mockResolvedValue([message]);
  vi.spyOn(storageService, 'get').mockResolvedValue([oldMessage] as any);
  const set = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
  const messages = await aggregator.checkInbox({
    id: 'mailbox',
    service: 'driftz',
    fullEmail: 'fixture@inbox.com',
    domain: 'inbox.com',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  });
  expect(messages[0]!.from).toBe(message.from);
  expect(set).toHaveBeenCalledWith('inbox', [message]);
  expect(getSenderEmail(messages[0]!.from)).toBe('bounces+123@delivery.com');
});
