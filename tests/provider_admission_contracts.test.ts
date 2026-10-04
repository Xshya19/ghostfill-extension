/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailServiceAggregator } from '../src/services/emailServices';
import { ProviderHealthManager } from '../src/services/emailServices/providerHealthManager';
import { TempmailPlusService } from '../src/services/emailServices/tempmailPlusService';
import { MailTmService } from '../src/services/emailServices/mailTmService';
import { MailGwService } from '../src/services/emailServices/mailGwService';
import * as humanNames from '../src/utils/humanNameGenerator';
import { EMAIL_SERVICE_OPTIONS } from '../src/frontend/options/components/OptionsTabs';
import { storageService } from '../src/services/storageService';
import type { EmailAccount, EmailService } from '../src/types';
import { checkProviderAvailability } from '../src/services/emailServices/providerAvailability';
import {
  TEMP_EMAIL_PROVIDER_OPTIONS,
  GENERATION_PROVIDER_PRIORITY,
} from '../src/services/emailServices/providerRegistry';

type AdmissionState = {
  availableServices: EmailService[];
  healthCheckInitialized: boolean;
  healthCheckTimestamp: number;
  createAccountWithService: (
    service: EmailService,
    options?: { signal?: AbortSignal }
  ) => Promise<EmailAccount>;
};
const state = (service: EmailServiceAggregator) => service as unknown as AdmissionState;
const selectable: EmailService[] = [
  'catchmail',
  'throwawaymail',
  'tempmailplus',
  'mailtm',
  'mailgw',
  'guerrilla',
  'maildrop',
  'driftz',
  'yopmail',
  'custom',
];
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('provider admission', () => {
  it('uses one registry for the picker and automatic health priority', () => {
    expect([...GENERATION_PROVIDER_PRIORITY].sort()).toEqual(
      TEMP_EMAIL_PROVIDER_OPTIONS.map(({ value }) => value).sort()
    );
    expect(new Set(GENERATION_PROVIDER_PRIORITY).size).toBe(GENERATION_PROVIDER_PRIORITY.length);
  });
  it.each(['mailinator', 'yopmail'])(
    'does not offer an unsupported %s adapter for new inboxes',
    (service) => {
      expect(EMAIL_SERVICE_OPTIONS.some(({ value }) => value === service)).toBe(false);
    }
  );

  it('does not resurrect legacy providers when all supported choices are excluded', () => {
    expect(new ProviderHealthManager().getBestProvider(selectable)).toBeNull();
  });

  it('filters cached admission to supported providers and removes duplicates', async () => {
    const service = new EmailServiceAggregator(new ProviderHealthManager());
    vi.spyOn(storageService, 'get').mockResolvedValue({
      checkVersion: 1,
      timestamp: Date.now(),
      availableServices: ['mailinator', 'mailtm', 'mailtm', 'unknown'],
    } as never);
    await service.performHealthCheck();
    expect(state(service).availableServices).toEqual(['mailtm']);
  });

  it('does not trust a future timestamp that would suppress availability checks', async () => {
    const service = new EmailServiceAggregator(new ProviderHealthManager());
    vi.spyOn(storageService, 'get').mockResolvedValue({
      timestamp: Date.now() + 86_400_000,
      availableServices: ['mailinator'],
    } as never);
    vi.spyOn(storageService, 'getSettings').mockResolvedValue({} as never);
    vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    const network = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', network);
    await service.performHealthCheck();
    expect(network).toHaveBeenCalled();
    expect(state(service).availableServices).not.toContain('mailinator');
  });

  it('rechecks domain-only admission cached by an older extension version', async () => {
    const service = new EmailServiceAggregator(new ProviderHealthManager());
    vi.spyOn(storageService, 'get').mockResolvedValue({
      timestamp: Date.now(),
      availableServices: ['catchmail'],
    } as never);
    vi.spyOn(storageService, 'getSettings').mockResolvedValue({} as never);
    vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    const network = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', network);
    await service.performHealthCheck();
    expect(network).toHaveBeenCalled();
    expect(state(service).availableServices).not.toContain('catchmail');
  });

  it.each(['mailtm', null, { mailtm: true }])(
    'rejects malformed cached provider arrays: %s',
    async (availableServices) => {
      const service = new EmailServiceAggregator(new ProviderHealthManager());
      vi.spyOn(storageService, 'get').mockResolvedValue({
        timestamp: Date.now(),
        availableServices,
      } as never);
      vi.spyOn(service, 'getDomains').mockResolvedValue([]);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status: 503 }))
      );
      await service.performHealthCheck();
      expect(Array.isArray(state(service).availableServices)).toBe(true);
    }
  );

  it('cannot turn static domain metadata into a successful network check', async () => {
    const service = new EmailServiceAggregator(new ProviderHealthManager());
    state(service).healthCheckInitialized = true;
    vi.spyOn(service, 'getDomains').mockResolvedValue(['static.example']);
    vi.spyOn(storageService, 'getSettings').mockResolvedValue({} as never);
    vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    const network = vi.fn(async () => new Response('', { status: 503 }));
    vi.stubGlobal('fetch', network);
    await service.performHealthCheck();
    expect(state(service).availableServices).not.toContain('catchmail');
    expect(state(service).availableServices).not.toContain('mailtm');
    expect(state(service).availableServices).not.toContain('custom');
    expect(network).toHaveBeenCalled();
  });

  it('uses current admission during fallback even if the scorer suggests an excluded provider', async () => {
    const health = new ProviderHealthManager();
    const service = new EmailServiceAggregator(health);
    state(service).healthCheckInitialized = true;
    state(service).healthCheckTimestamp = Date.now();
    state(service).availableServices = ['maildrop'];
    vi.spyOn(health, 'getBestProvider').mockReturnValue('catchmail');
    vi.spyOn(health, 'getRetryDelay').mockReturnValue(0);
    vi.spyOn(storageService, 'getSettings').mockResolvedValue({
      preferredEmailService: 'driftz',
      saveHistory: false,
    } as never);
    vi.spyOn(storageService, 'get').mockResolvedValue('disposable' as never);
    vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    const create = vi
      .spyOn(state(service), 'createAccountWithService')
      .mockImplementation(async (provider) => {
        if (provider === 'driftz') throw new Error('Provider unreachable');
        return {
          id: 'test',
          fullEmail: `test@${provider}.example`,
          domain: `${provider}.example`,
          service: provider,
          createdAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        };
      });
    const account = await service.generateEmail({ service: 'driftz' });
    expect(account.service).toBe('maildrop');
    expect(create.mock.calls.map(([provider]) => provider)).toEqual(['driftz', 'maildrop']);
  });

  it('preserves legacy domain/read routing without offering it for new default accounts', async () => {
    const service = new EmailServiceAggregator();
    expect(await service.getDomains('mailinator')).toEqual(['mailinator.com']);
  });

  it.each(['catchmail', 'tempmailplus', 'maildrop'] as const)(
    'does not fabricate a new %s address while its inbox API is unreachable',
    async (provider) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status: 503 }))
      );
      const service = new EmailServiceAggregator();
      await expect(state(service).createAccountWithService(provider, {})).rejects.toThrow(
        'HTTP error 503'
      );
    }
  );
});

describe('Mail.tm and Mail.gw collection contracts', () => {
  it('uses an API-compatible default Mail.tm username even when human identity names contain punctuation', async () => {
    vi.spyOn(humanNames, 'generateHumanLikeUsername').mockReturnValue('alice.work.email');
    const service = new MailTmService();
    vi.spyOn(service, 'getDomains').mockResolvedValue(['current.example']);
    vi.spyOn(
      service as unknown as { waitUntilAuthenticatable: () => Promise<void> },
      'waitUntilAuthenticatable'
    ).mockResolvedValue();
    vi.spyOn(
      service as unknown as { authenticate: () => Promise<void> },
      'authenticate'
    ).mockImplementation(async () => {
      Object.assign(service, { token: 'test-token' });
    });
    const network = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      return /^[a-z0-9]+@current\.example$/.test(request.address)
        ? new Response(JSON.stringify({ id: 'created-account', address: request.address }), {
            status: 201,
          })
        : new Response(JSON.stringify({ message: 'Username is not valid' }), { status: 422 });
    });
    vi.stubGlobal('fetch', network);
    const account = await service.createAccount();
    expect(account.service).toBe('mailtm');
    expect(account.fullEmail).toMatch(/^[a-z0-9]+@current\.example$/);
    expect(account.token).toBe('test-token');
  });
  const services = [
    { label: 'Mail.tm', Service: MailTmService },
    { label: 'Mail.gw', Service: MailGwService },
  ];
  it.each(services)(
    '$label reads active domains from a JSON array instead of obsolete fallback domains',
    async ({ Service }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify([{ domain: 'current.example', isActive: true, isPrivate: false }])
            )
        )
      );
      expect(await new Service().getDomains()).toEqual(['current.example']);
    }
  );

  it.each(services)(
    '$label never invents a receiving domain when the API has none',
    async ({ Service }) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ 'hydra:member': [] })))
      );
      expect(await new Service().getDomains()).toEqual([]);
    }
  );

  it.each(services)(
    '$label does not discard messages in a JSON collection',
    async ({ Service }) => {
      const message = {
        id: 'real-message',
        from: { address: 'sender@example.com' },
        to: [{ address: 'recipient@current.example' }],
        subject: 'Your sign-in code',
        createdAt: '2026-10-04T03:00:00Z',
        text: 'Your code is 001234',
        intro: 'Your code is 001234',
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (url: RequestInfo | URL) =>
            new Response(
              JSON.stringify(String(url).includes('/messages/real-message') ? message : [message])
            )
        )
      );
      const service = new Service();
      vi.spyOn(
        service as unknown as { ensureAuthenticated: () => Promise<void> },
        'ensureAuthenticated'
      ).mockResolvedValue();
      const inbox = await service.getMessages();
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.id).toBe('real-message');
      expect(inbox[0]?.body).toBe('Your code is 001234');
    }
  );
});

describe('bounded provider availability contracts', () => {
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it.each(['mailtm', 'mailgw'] as const)(
    '%s accepts only active receiving domains from its real API',
    async (provider) => {
      const network = vi.fn(async () =>
        json({ 'hydra:member': [{ domain: 'inbox.example', isActive: true, isPrivate: false }] })
      );
      vi.stubGlobal('fetch', network);
      expect(await checkProviderAvailability(provider)).toBe('available');
      expect(network).toHaveBeenCalledOnce();
      expect(network.mock.calls[0]).toHaveLength(2);
    }
  );

  it('also handles the published Mail.tm JSON collection representation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ domain: 'inbox.example', isActive: true, isPrivate: false }]))
    );
    expect(await checkProviderAvailability('mailtm')).toBe('available');
  });

  it.each(['mailtm', 'mailgw'] as const)(
    '%s does not admit private/inactive domains or error payloads',
    async (provider) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({
            'hydra:member': [{ domain: 'private.example', isActive: false, isPrivate: true }],
          })
        )
      );
      await expect(checkProviderAvailability(provider)).rejects.toThrow('unexpected API response');
    }
  );

  it('requires a successful Driftz domain payload instead of its fallback list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ success: false, result: { temp: ['bbjbinin.mn'] } }))
    );
    await expect(checkProviderAvailability('driftz')).rejects.toThrow('unexpected API response');
  });

  it('checks the actual GraphQL ping and rejects embedded errors on HTTP 200', async () => {
    const network = vi
      .fn()
      .mockResolvedValueOnce(json({ data: { ping: 'pong' } }))
      .mockResolvedValueOnce(
        json({ data: { ping: 'pong' }, errors: [{ message: 'Unavailable' }] })
      );
    vi.stubGlobal('fetch', network);
    expect(await checkProviderAvailability('maildrop')).toBe('available');
    await expect(checkProviderAvailability('maildrop')).rejects.toThrow('unexpected API response');
  });

  it('checks Catchmail inbox schema without creating an account', async () => {
    const network = vi.fn(async () => json({ messages: [] }));
    vi.stubGlobal('fetch', network);
    expect(await checkProviderAvailability('catchmail')).toBe('available');
    const [url, init] = network.mock.calls[0]! as unknown as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/v1/mailbox');
    expect(new URL(url).searchParams.get('address')).toMatch(/^ghostfill-health-.+@catchmail\.io$/);
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('recognizes the documented unallocated Throwawaymail inbox response', async () => {
    const network = vi.fn(async () => json({ error: 'Mailbox not found' }, 404));
    vi.stubGlobal('fetch', network);
    expect(await checkProviderAvailability('throwawaymail')).toBe('available');
    expect(String((network.mock.calls[0] as unknown as [string])[0])).toMatch(
      /\/api\/mailboxes\/[\da-f-]+\/messages$/
    );
  });

  it('does not accept an HTML 404 as a working provider API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Not found</html>', { status: 404 }))
    );
    await expect(checkProviderAvailability('throwawaymail')).rejects.toThrow();
  });

  it('validates Tempmail.plus empty-list schema rather than trusting local generation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ mail_list: [] }))
    );
    expect(await checkProviderAvailability('tempmailplus')).toBe('available');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'Wrong address format' }))
    );
    await expect(checkProviderAvailability('tempmailplus')).rejects.toThrow(
      'unexpected API response'
    );
  });

  it.each(['guerrilla', 'yopmail', 'custom'] as const)(
    'leaves %s unchecked without inventing session activity',
    async (provider) => {
      const network = vi.fn();
      vi.stubGlobal('fetch', network);
      expect(await checkProviderAvailability(provider)).toBe('unchecked');
      expect(network).not.toHaveBeenCalled();
    }
  );

  it('propagates cancellation and performs no retry or additional request', async () => {
    const controller = new AbortController();
    const network = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    vi.stubGlobal('fetch', network);
    const request = checkProviderAvailability('catchmail', controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(network).toHaveBeenCalledOnce();
  });

  it('bounds body consumption when headers arrive but JSON stalls', async () => {
    vi.useFakeTimers();
    let bodyStarted = false;
    let bodySignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodySignal = init?.signal ?? undefined;
        return {
          ok: true,
          status: 200,
          json: () => {
            bodyStarted = true;
            return new Promise<never>(() => {});
          },
        } as Response;
      })
    );
    const request = checkProviderAvailability('catchmail');
    const rejected = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(7000);
    await rejected;
    expect(bodyStarted).toBe(true);
    expect(bodySignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Tempmail.plus supported mailbox domains', () => {
  it('generates the mailbox domain published by the service, not its website hostname', async () => {
    const service = new TempmailPlusService();
    const account = await service.createAccount('example.person');
    expect(account.fullEmail).toBe('example.person@mailto.plus');
    expect(account.domain).toBe('mailto.plus');
  });

  it('lists current provider mailbox domains without the unrelated website MX', async () => {
    const domains = await new TempmailPlusService().getDomains();
    expect(domains[0]).toBe('mailto.plus');
    expect(domains).not.toContain('tempmail.plus');
    expect(domains).toContain('fextemp.com');
  });

  it('sends the complete receiving address on both list and detail requests', async () => {
    const network = vi.fn(
      async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).includes('/mails/7?')
              ? {
                  result: true,
                  mail_id: 7,
                  text: 'Your code is 001234',
                  date: '2026-10-04T03:00:00Z',
                }
              : {
                  result: true,
                  mail_list: [
                    {
                      mail_id: 7,
                      from_name: 'Acme',
                      from_mail: 'verify@acme.example',
                      time: '2026-10-04T03:00:00Z',
                      is_new: true,
                    },
                  ],
                }
          )
        )
    );
    vi.stubGlobal('fetch', network);
    const service = new TempmailPlusService();
    const messages = await service.getMessages('person@mailto.plus');
    expect(
      network.mock.calls.map(([url]) => new URL(String(url)).searchParams.get('email'))
    ).toEqual(['person@mailto.plus', 'person@mailto.plus']);
    expect(messages[0]?.from).toBe('Acme <verify@acme.example>');
    expect(messages[0]?.body).toBe('Your code is 001234');
    expect(messages[0]?.read).toBe(false);
  });

  it('preserves the provider summary time if hydration fails instead of assigning now', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('/mails/7?')
          ? new Response('', { status: 503 })
          : new Response(
              JSON.stringify({
                result: true,
                mail_list: [{ mail_id: 7, time: '2026-10-03T03:00:00Z' }],
              })
            )
      )
    );
    const messages = await new TempmailPlusService().getMessages('person@mailto.plus');
    expect(messages[0]?.date).toBe(Date.parse('2026-10-03T03:00:00Z'));
  });

  it('does not label an undated Tempmail.plus message as freshly received', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: true, mail_list: [{ subject: 'Notice' }] }))
      )
    );
    const messages = await new TempmailPlusService().getMessages('person@mailto.plus');
    expect(messages[0]?.date).toBe(0);
  });

  it('does not report a provider error payload as an empty working inbox', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ result: false, err: { code: 1021, msg: 'Protected inbox' } })
          )
      )
    );
    await expect(new TempmailPlusService().getMessages('person@mailto.plus')).rejects.toThrow(
      'Tempmail.plus'
    );
  });

  it('uses the complete address in a direct message read', async () => {
    const network = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: true,
            mail_id: 7,
            text: 'Code 001234',
            date: '2026-10-04T03:00:00Z',
          })
        )
    );
    vi.stubGlobal('fetch', network);
    await new TempmailPlusService().getMessage('person@mailto.plus', '7');
    expect(new URL(String(network.mock.calls[0]?.[0])).searchParams.get('email')).toBe(
      'person@mailto.plus'
    );
  });
});
