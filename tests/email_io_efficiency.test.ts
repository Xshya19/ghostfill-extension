/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailServiceAggregator } from '../src/services/emailServices';
import { CatchmailService, catchmailService } from '../src/services/emailServices/catchmailService';
import { DriftzService, driftzService } from '../src/services/emailServices/driftzService';
import { maildropService } from '../src/services/emailServices/maildropService';
import { ProviderHealthManager } from '../src/services/emailServices/providerHealthManager';
import { tempMailService } from '../src/services/emailServices/tempMailService';
import { storageService } from '../src/services/storageService';
import { Email, EmailAccount } from '../src/types';

const now = 1_790_999_100_000;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'message-1',
    from: 'Example <auth@example.test>',
    to: 'person@example.test',
    subject: 'Your verification code',
    date: now,
    body: 'Your verification code is 123456.',
    read: false,
    attachments: [],
    ...overrides,
  };
}

function makeAccount(overrides: Partial<EmailAccount> = {}): EmailAccount {
  return {
    id: 'account-1',
    fullEmail: 'person@maildrop.cc',
    domain: 'maildrop.cc',
    service: 'maildrop',
    login: 'person',
    createdAt: now,
    expiresAt: now + 86_400_000,
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each(['driftz', 'catchmail'] as const)('%s message hydration', (provider) => {
  function makeService() {
    return provider === 'driftz' ? new DriftzService() : new CatchmailService();
  }

  function installMailbox(
    count = 5,
    detail: (id: string, address: string) => Promise<Response> = async (id, address) =>
      messageResponse(id, address),
    listOverrides: Record<string, unknown> = {}
  ) {
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.has('limit') || parsed.pathname.endsWith('/mailbox')) {
        const items = Array.from({ length: count }, (_, index) => ({
          id: `message-${index + 1}`,
          fromAddress: 'auth@example.test',
          from: 'Example <auth@example.test>',
          subject: 'Your verification code',
          receivedAt: now / 1000,
          date: new Date(now).toISOString(),
          ...listOverrides,
        }));
        return jsonResponse(
          provider === 'driftz' ? { success: true, result: { items } } : { messages: items }
        );
      }
      const parts = parsed.pathname.split('/').map(decodeURIComponent);
      return detail(
        parts.at(-1)!,
        provider === 'driftz' ? parts.at(-2)! : parsed.searchParams.get('mailbox')!
      );
    });
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  function messageResponse(id: string, address: string, body = 'Code: 123456'): Response {
    const message = {
      id,
      fromName: 'Example Authentication',
      fromAddress: 'auth@example.test',
      from: 'Example Authentication <auth@example.test>',
      toAddress: address,
      mailbox: address,
      subject: 'Your verification code',
      receivedAt: now / 1000,
      date: new Date(now).toISOString(),
      textContent: body,
      text_body: body,
    };
    return jsonResponse(provider === 'driftz' ? { success: true, result: message } : message);
  }

  it('fetches each body once across three unchanged polls while checking the inbox each time', async () => {
    const service = makeService();
    const fetchSpy = installMailbox();

    for (let poll = 0; poll < 3; poll++) {
      const inbox = await service.getMessages('person@example.test');
      expect(inbox).toHaveLength(5);
      expect(inbox.every((email) => email.body === 'Code: 123456')).toBe(true);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(8); // Three fresh inbox lists plus five bodies.
  });

  it.each([undefined, 'not-a-date'])(
    'retains the hydrated timestamp when the list date is %s',
    async (invalidDate) => {
      vi.useFakeTimers();
      vi.setSystemTime(now + 1_000);
      const service = makeService();
      const fetchSpy = installMailbox(1, undefined, { receivedAt: invalidDate, date: invalidDate });
      expect((await service.getMessages('person@example.test'))[0]!.date).toBe(now);
      vi.setSystemTime(now + 11_000);
      expect((await service.getMessages('person@example.test'))[0]!.date).toBe(now);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    }
  );

  it('keeps a missing provider timestamp unknown rather than pretending it arrived now', async () => {
    const service = makeService();
    installMailbox(
      1,
      async () => {
        const message = {
          id: 'message-1',
          from: 'auth@example.test',
          fromAddress: 'auth@example.test',
          text_body: 'Code: 123456',
          textContent: 'Code: 123456',
        };
        return jsonResponse(provider === 'driftz' ? { success: true, result: message } : message);
      },
      { receivedAt: undefined, date: undefined }
    );
    expect((await service.getMessages('person@example.test'))[0]!.date).toBe(0);
  });

  it('reuses a hydrated message when opening it without changing cached unread state', async () => {
    const service = makeService();
    const fetchSpy = installMailbox(1);
    await service.getMessages('person@example.test');

    const opened = await service.getMessage('person@example.test', 'message-1');
    expect(opened.read).toBe(true);
    expect(opened.body).toBe('Code: 123456');
    opened.body = 'Changed by caller';
    const nextPoll = await service.getMessages('person@example.test');

    expect(nextPoll[0]!.body).toBe('Code: 123456');
    expect(nextPoll[0]!.read).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // Two lists and one body.
  });

  it('does not share message IDs between different mailbox addresses', async () => {
    const service = makeService();
    const fetchSpy = installMailbox(1, async (id, address) =>
      messageResponse(id, address, address)
    );
    const first = await service.getMessages('first@example.test');
    const second = await service.getMessages('second@example.test');

    expect(first[0]!.body).toBe('first@example.test');
    expect(second[0]!.body).toBe('second@example.test');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('retries bodies that were initially empty instead of caching an incomplete response', async () => {
    const service = makeService();
    let attempts = 0;
    const fetchSpy = installMailbox(1, async (id, address) =>
      messageResponse(id, address, ++attempts === 1 ? '' : 'Code: 123456')
    );

    expect((await service.getMessages('person@example.test'))[0]!.body).toBe('');
    expect((await service.getMessages('person@example.test'))[0]!.body).toBe('Code: 123456');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('expires hydrated content so later corrections can be fetched', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const service = makeService();
    let attempts = 0;
    const fetchSpy = installMailbox(1, async (id, address) =>
      messageResponse(id, address, ++attempts === 1 ? 'First body' : 'Corrected body')
    );

    expect((await service.getMessages('person@example.test'))[0]!.body).toBe('First body');
    vi.setSystemTime(now + 300_001);
    expect((await service.getMessages('person@example.test'))[0]!.body).toBe('Corrected body');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('propagates cancellation during hydration rather than returning a partial successful inbox', async () => {
    const controller = new AbortController();
    const service = makeService();
    installMailbox(1, async () => {
      controller.abort();
      throw new DOMException('Cancelled by caller', 'AbortError');
    });

    await expect(
      service.getMessages('person@example.test', controller.signal)
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('shares concurrent detail reads without combining caller-owned cancellation', async () => {
    const service = makeService();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchSpy = installMailbox(1, async (id, address) => {
      await ready;
      return messageResponse(id, address);
    });
    const first = service.getMessage('person@example.test', 'message-1');
    const second = service.getMessage('person@example.test', 'message-1');
    release();

    expect(
      (await Promise.all([first, second])).every((email) => email.body === 'Code: 123456')
    ).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      service.getMessage('person@example.test', 'message-1', cancelled.signal)
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps cached data bounded as users open more than fifty messages', async () => {
    const service = makeService();
    const fetchSpy = installMailbox();
    for (let index = 1; index <= 51; index++) {
      await service.getMessage('person@example.test', `message-${index}`);
    }
    await service.getMessage('person@example.test', 'message-51');
    expect(fetchSpy).toHaveBeenCalledTimes(51);
    await service.getMessage('person@example.test', 'message-1');
    expect(fetchSpy).toHaveBeenCalledTimes(52);
  });

  it('evicts bodies by byte budget before reaching the entry limit', async () => {
    const service = makeService();
    const fetchSpy = installMailbox(1, async (id, address) =>
      messageResponse(id, address, 'x'.repeat(100_000))
    );
    for (let index = 1; index <= 3; index++) {
      await service.getMessage('person@example.test', `message-${index}`);
    }
    await service.getMessage('person@example.test', 'message-1');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('returns oversized bodies without retaining them in the cache', async () => {
    const service = makeService();
    const fetchSpy = installMailbox(1, async (id, address) =>
      messageResponse(id, address, 'x'.repeat(600_000))
    );
    for (let index = 0; index < 2; index++) {
      expect((await service.getMessage('person@example.test', 'message-1')).body.length).toBe(
        600_000
      );
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not let an old in-flight read repopulate a cleared session cache', async () => {
    const service = makeService();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    const fetchSpy = installMailbox(1, async (id, address) => {
      if (++requests === 1) {
        await ready;
        return messageResponse(id, address, 'Previous session');
      }
      return messageResponse(id, address, 'Current session');
    });
    const oldRead = service.getMessage('person@example.test', 'message-1');
    service.clearMessageCache();
    expect((await service.getMessage('person@example.test', 'message-1')).body).toBe(
      'Current session'
    );
    release();
    expect((await oldRead).body).toBe('Previous session');

    expect((await service.getMessage('person@example.test', 'message-1')).body).toBe(
      'Current session'
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('aggregator request and persistence efficiency', () => {
  it('preserves existing date-only comparison for providers without timestamp provenance', async () => {
    const aggregator = new EmailServiceAggregator();
    vi.spyOn(storageService, 'get').mockResolvedValue([makeEmail()] as never);
    const persist = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    vi.spyOn(tempMailService, 'checkInbox').mockResolvedValue([makeEmail({ date: now + 10_000 })]);
    await aggregator.checkInbox(
      makeAccount({ service: 'tempmail', fullEmail: 'person@1secmail.com', domain: '1secmail.com' })
    );
    expect(persist).not.toHaveBeenCalled();
  });
  it('coalesces concurrent detail reads across all provider entry points', async () => {
    const aggregator = new EmailServiceAggregator();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = vi.spyOn(maildropService, 'getMessage').mockImplementation(async () => {
      await ready;
      return makeEmail();
    });
    vi.spyOn(storageService, 'get').mockResolvedValue([makeEmail()] as never);
    const persist = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);

    const reads = [
      aggregator.readEmail('message-1', makeAccount()),
      aggregator.readEmail('message-1', makeAccount()),
      aggregator.readEmail('message-1', makeAccount()),
    ];
    release();
    const results = await Promise.all(reads);

    expect(results.every((email) => email.body === makeEmail().body)).toBe(true);
    expect(provider).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledOnce();
  });

  it('persists a successful body hydration even when message headers are unchanged', async () => {
    const aggregator = new EmailServiceAggregator();
    const headersOnly = makeEmail({ body: '' });
    const hydrated = makeEmail();
    vi.spyOn(storageService, 'get').mockResolvedValue([headersOnly] as never);
    const persist = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    vi.spyOn(tempMailService, 'checkInbox').mockResolvedValue([hydrated]);

    await aggregator.checkInbox(
      makeAccount({
        service: 'tempmail',
        fullEmail: 'person@1secmail.com',
        domain: '1secmail.com',
      })
    );

    expect(persist).toHaveBeenCalledWith('inbox', [hydrated]);
  });
});

describe('generation concurrency and cancellation', () => {
  function setupGeneration() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ messages: [] })))
    );
    const health = new ProviderHealthManager();
    const aggregator = new EmailServiceAggregator(health);
    vi.spyOn(aggregator, 'performHealthCheck').mockResolvedValue(undefined);
    vi.spyOn(health, 'recordSuccess').mockImplementation(() => {});
    const failure = vi.spyOn(health, 'recordFailure').mockImplementation(() => {});
    vi.spyOn(health, 'getBestProvider').mockReturnValue('catchmail');
    vi.spyOn(health, 'getRetryDelay').mockReturnValue(1);
    vi.spyOn(storageService, 'getSettings').mockResolvedValue({
      preferredEmailService: 'catchmail',
      saveHistory: false,
    } as never);
    vi.spyOn(storageService, 'get').mockResolvedValue('disposable' as never);
    const persist = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
    const account = makeAccount({
      service: 'catchmail',
      fullEmail: 'person@catchmail.io',
      domain: 'catchmail.io',
    });
    const create = vi.spyOn(catchmailService, 'createAccount').mockResolvedValue(account);
    return { health, aggregator, create, account, persist, failure };
  }

  it('coalesces rapid generation requests throughout the cooldown instead of creating multiple accounts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { aggregator, create } = setupGeneration();
    await aggregator.generateEmail({ service: 'catchmail' });

    const requests = [
      aggregator.generateEmail({ service: 'catchmail' }),
      aggregator.generateEmail({ service: 'catchmail' }),
      aggregator.generateEmail({ service: 'catchmail' }),
    ];
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all(requests);

    expect(create).toHaveBeenCalledTimes(2); // Initial account plus one shared regeneration.
  });

  it.each([true, false])(
    'keeps expired-account policy independent when preventRegeneration=%s calls first',
    async (preventFirst) => {
      const { aggregator, account } = setupGeneration();
      const expired = { ...account, expiresAt: Date.now() - 1 };
      vi.mocked(storageService.get).mockImplementation(
        async (key) => (key === 'preferredEmailType' ? 'disposable' : expired) as never
      );
      const generate = vi.spyOn(aggregator, 'generateEmail').mockResolvedValue(account);

      const first = aggregator.getCurrentEmail(preventFirst);
      const second = aggregator.getCurrentEmail(!preventFirst);
      const results = await Promise.all([first, second]);

      expect(results[preventFirst ? 0 : 1]).toBeNull();
      expect(results[preventFirst ? 1 : 0]).toEqual(account);
      expect(generate).toHaveBeenCalledOnce();
    }
  );

  it('rejects an already cancelled generation before calling a provider', async () => {
    const { aggregator, create, persist, failure } = setupGeneration();
    const controller = new AbortController();
    controller.abort();

    await expect(
      aggregator.generateEmail({ service: 'catchmail', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('does not start fallback providers or record failures after caller cancellation', async () => {
    const { aggregator, create, persist, failure } = setupGeneration();
    const controller = new AbortController();
    vi.spyOn(driftzService, 'createAccount').mockImplementation(async () => {
      controller.abort();
      throw new DOMException('Caller cancelled', 'AbortError');
    });

    await expect(
      aggregator.generateEmail({ service: 'driftz', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(failure).not.toHaveBeenCalled();
  });

  it('stops retry backoff immediately when cancelled and never starts the alternate provider', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { aggregator, health, create } = setupGeneration();
    vi.spyOn(health, 'getRetryDelay').mockReturnValue(30_000);
    vi.spyOn(driftzService, 'createAccount').mockRejectedValue(new Error('Network unavailable'));
    const controller = new AbortController();
    let outcome = 'pending';
    const request = aggregator.generateEmail({ service: 'driftz', signal: controller.signal }).then(
      () => {
        outcome = 'created';
      },
      (error: Error) => {
        outcome = error.name === 'AbortError' ? 'cancelled' : 'failed';
      }
    );
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const immediateOutcome = outcome;
    await vi.advanceTimersByTimeAsync(30_000);
    await request;

    expect(immediateOutcome).toBe('cancelled');
    expect(create).not.toHaveBeenCalled();
  });
});
