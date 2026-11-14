/**
 * Provider delivery reliability — regression suite for the provider-layer
 * fix batch (H1–H4, M6/M7).
 *
 * The batch fixed six failure modes that all shared one symptom: a real
 * provider outage or API drift looked like a SUCCESSFUL empty-inbox check,
 * so no circuit breaker opened, no fallback provider was chosen, and the
 * user simply never received the verification mail.
 *
 *   H1  Mail.gw now keeps account credentials in memory next to the token
 *       (the JWT only lives 1 h and the MV3 service worker is killed
 *       constantly) and reads BOTH storage keys ('currentEmail' AND
 *       'disposableEmail') as fallback.
 *   H2  tempmail.plus / throwawaymail map the FULL message list, not just
 *       the 5-item "recent" slice that got enriched with bodies.
 *   H3  The shared classifier recognises the legacy
 *       "HTTP error! status: N" shape and no longer treats bare 3-digit
 *       numbers as server faults; Driftz routes its statuses through the
 *       shared helper so a 403 propagates instead of resolving [].
 *   H4  Clearly malformed payload shapes throw (MalformedProviderResponseError)
 *       instead of mapping onto a fake empty inbox, while legitimately
 *       empty inboxes still resolve [].
 *   M6  Mailinator "11/12/2026 10:23:00" timestamps parse via safeParseDate
 *       (Number() produced NaN).
 *   M7  Driftz receivedAt timestamps parse via safeParseDate
 *       (Number("2026-…") produced NaN; epoch seconds still work).
 *
 * NOTE ON "BITE": the working tree is uncommitted, so these tests cannot be
 * run against the old code. Each test carries a comment justifying,
 * mechanically, what the old code path would have done and why this exact
 * assertion would have failed (or, for pure contract pins / guards, why it
 * exists). Bite claims refer to the pre-batch implementation of the
 * corresponding fix.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { mailGwService } from '../src/services/emailServices/mailGwService';
import { MailTmService } from '../src/services/emailServices/mailTmService';
import { mailinatorService } from '../src/services/emailServices/mailinatorService';
import { tempmailPlusService } from '../src/services/emailServices/tempmailPlusService';
import { throwawaymailService } from '../src/services/emailServices/throwawaymailService';
import { catchmailService } from '../src/services/emailServices/catchmailService';
import { maildropService } from '../src/services/emailServices/maildropService';
import { driftzService } from '../src/services/emailServices/driftzService';
import {
  isRetryableError,
  throwIfRetryableStatus,
} from '../src/services/emailServices/isRetryableError';
import { MalformedProviderResponseError } from '../src/services/emailServices/messageListShape';
import { storageService } from '../src/services/storageService';

// ─── helpers (style follows tests/email_providers_inbox_extreme_v2.test.ts) ──

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalFetch) vi.stubGlobal('fetch', originalFetch);
  vi.restoreAllMocks();
});

/** Mail.gw fetch mock: POST /token + GET /messages + GET /messages/m1. */
function stubMailGwFetch(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/token')) {
      return jsonResponse({ token: 'fresh-token' });
    }
    if (u.endsWith('/messages/m1')) {
      return jsonResponse({ id: 'm1', text: 'code 123', html: ['<p>code 123</p>'] });
    }
    if (u.endsWith('/messages')) {
      return jsonResponse({
        'hydra:member': [
          {
            id: 'm1',
            from: { address: 'svc@example.com' },
            to: [{ address: 'poll-user@exdonuts.com' }],
            subject: 'Your code',
            createdAt: '2026-11-12T10:00:00.000Z',
            intro: 'code 123',
          },
        ],
      });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

function firstTokenCall(spy: ReturnType<typeof vi.fn>): { address: unknown; password: unknown } {
  const call = spy.mock.calls.find((c) => String(c[0]).endsWith('/token'));
  expect(call, 'expected a POST to the Mail.gw /token endpoint').toBeDefined();
  const body = JSON.parse(String((call![1] as RequestInit).body)) as {
    address: unknown;
    password: unknown;
  };
  return body;
}

// ─────────────────────────────── H1 — Mail.gw ───────────────────────────────

describe('Mail.gw authentication continuity (H1)', () => {
  beforeEach(() => {
    // Public sign-out API: clears token, expiry AND in-memory credentials, so
    // every test starts from the "post-service-worker-restart" state.
    mailGwService.setToken('');
  });

  it('re-authenticates from in-memory credentials with NO stored currentEmail/disposableEmail', async () => {
    // BITE: pre-H1 the class kept no credentials at all (the `credentials`
    // field did not exist). After the 1 h token TTL — or any service-worker
    // restart — ensureAuthenticated() had nothing to authenticate with,
    // threw "Not authenticated and cannot refresh token", and the inbox
    // silently stopped being polled (0 HTTP requests). This test runs in
    // exactly that state — expired token, empty storage, ONLY in-memory
    // credentials — so the old code rejects while the new code must deliver.
    const getSpy = vi.spyOn(storageService, 'get').mockResolvedValue(null as any);
    (mailGwService as any).credentials = { address: 'poll-user@exdonuts.com', password: 'pw-123' };
    const fetchSpy = stubMailGwFetch();

    const emails = await mailGwService.getMessages();

    expect(emails).toHaveLength(1);
    expect(emails[0]!.subject).toBe('Your code');
    // The re-auth must have used the IN-MEMORY account, not storage.
    expect(firstTokenCall(fetchSpy)).toEqual({
      address: 'poll-user@exdonuts.com',
      password: 'pw-123',
    });
    // The in-memory path wins — storage is never even consulted.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('falls back to the account stored under "disposableEmail" when "currentEmail" is empty', async () => {
    // BITE: the pre-H1 storage reader looked at 'currentEmail' only. The
    // aggregator stores disposable accounts under 'disposableEmail' and only
    // mirrors them into 'currentEmail' when the user is NOT on a Gmail alias,
    // so every user whose active mailbox lived in the disposable slot got
    // "Not authenticated and cannot refresh token" from the storage path too.
    vi.spyOn(storageService, 'get').mockImplementation(async (key: string) => {
      if (key === 'disposableEmail') {
        return {
          service: 'mailgw',
          fullEmail: 'stored-user@exdonuts.com',
          password: 'stored-pw',
        } as any;
      }
      return null as any;
    });
    const fetchSpy = stubMailGwFetch();

    const emails = await mailGwService.getMessages();

    expect(emails).toHaveLength(1);
    expect(firstTokenCall(fetchSpy)).toEqual({
      address: 'stored-user@exdonuts.com',
      password: 'stored-pw',
    });
  });

  it('survives a mid-poll 401 by re-authenticating with the in-memory credentials', async () => {
    // BITE: pre-H1 a server-side token invalidation (401) was unrecoverable —
    // there were no credentials to re-authenticate with, so the inbox died
    // at the next TTL/401. Here the FIRST /messages call answers 401 and the
    // poll must self-heal on the second attempt.
    mailGwService.setToken('stale-token', 'poll-user@exdonuts.com', 'pw-123');
    let messageCalls = 0;
    const fetchSpy = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/token')) {
        return jsonResponse({ token: 'fresh-token' });
      }
      if (u.endsWith('/messages')) {
        messageCalls++;
        if (messageCalls === 1) {
          return new Response('unauthorized', { status: 401 });
        }
        return jsonResponse({ 'hydra:member': [] });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const emails = await mailGwService.getMessages();

    expect(emails).toEqual([]);
    expect(messageCalls).toBe(2);
    const tokenBody = firstTokenCall(fetchSpy);
    expect(tokenBody.address).toBe('poll-user@exdonuts.com');
    expect(tokenBody.password).toBe('pw-123');
  });

  it('throws only when NO credentials exist anywhere (contract pin)', async () => {
    // CONTRACT PIN (honesty: this one also passed on the old code — the old
    // code threw, but only via its storage-only path). It pins the boundary
    // the H1 fix introduced: with no credentials anywhere the service must
    // fail LOUDLY (so the aggregator ejects the provider) rather than firing
    // unauthenticated requests that 401-loop forever. It guards that the new
    // in-memory layer never converts "no credentials" into a silent poll.
    vi.spyOn(storageService, 'get').mockResolvedValue(null as any);

    await expect(mailGwService.getMessages()).rejects.toThrow(
      'Not authenticated and cannot refresh token'
    );
  });
});

// ─────────────────────── H2 — full message list mapping ─────────────────────

describe('Full message list mapping (H2)', () => {
  it('tempmail.plus maps the FULL list, not just the 5 enriched recent mails', async () => {
    // BITE: pre-H2 getMessages() returned only `detailedMails` — the
    // slice(0, 5) that got enriched with detail bodies — so with 7 mails in
    // the box this call resolved to length 5 and mails 6–7 were invisible
    // for the rest of the session (no OTP, no link, no notification).
    const seven = Array.from({ length: 7 }, (_, i) => ({
      mail_id: `tp-${i}`,
      from_mail: `svc${i}@example.com`,
      subject: `Mail ${i}`,
      date: '2026-11-12T10:23:00.000Z',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/api/mails/')) {
          const id = u.split('/api/mails/')[1]!.split('?')[0]!;
          return jsonResponse({
            mail_id: id,
            subject: `Detail ${id}`,
            text: 'body',
            html: '<b>body</b>',
          });
        }
        // list endpoint: /api/mails?email=…&limit=50
        return jsonResponse({ mail_list: seven });
      })
    );

    const emails = await tempmailPlusService.getMessages('inbox@tempmail.plus');

    expect(emails).toHaveLength(7);
    expect(emails.map((m) => m.id)).toEqual([
      'tp-0',
      'tp-1',
      'tp-2',
      'tp-3',
      'tp-4',
      'tp-5',
      'tp-6',
    ]);
    // Mails beyond the enrichment window keep their list metadata...
    expect(emails[5]!.subject).toBe('Mail 5');
    expect(emails[6]!.subject).toBe('Mail 6');
    // ...while the recent ones still get their detail bodies.
    expect(emails[0]!.subject).toBe('Detail tp-0');
  });

  it('throwawaymail maps the FULL list, not just the 5 enriched recent mails', async () => {
    // BITE: pre-H2 the return value was the enriched 5-item array, so a
    // 7-message box was reported as 5 messages and mails 6–7 never surfaced.
    const mailboxId = 'mbx-1';
    const account = {
      id: mailboxId,
      token: mailboxId,
      fullEmail: 'whatever@throwawaymail.app',
      service: 'throwawaymail',
    } as any;
    const list = Array.from({ length: 7 }, (_, i) => ({
      message_id: `tm-${i}`,
      subject: `Mail ${i}`,
      created_at: '2026-11-12T10:23:00.000Z',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes(`/api/mailboxes/${mailboxId}/messages/`)) {
          const id = u.split(`/api/mailboxes/${mailboxId}/messages/`)[1]!;
          return jsonResponse({
            message_id: id,
            subject: `Detail ${id}`,
            text: 'body',
            html: '<b>body</b>',
          });
        }
        if (u.includes(`/api/mailboxes/${mailboxId}/messages`)) {
          return jsonResponse({ messages: list });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const emails = await throwawaymailService.getMessages(account);

    expect(emails).toHaveLength(7);
    expect(emails.map((m) => m.id)).toEqual([
      'tm-0',
      'tm-1',
      'tm-2',
      'tm-3',
      'tm-4',
      'tm-5',
      'tm-6',
    ]);
    expect(emails[6]!.subject).toBe('Mail 6');
    expect(emails[0]!.subject).toBe('Detail tm-0');
  });
});

// ──────────────────── H3/M12 — shared error classification ──────────────────

describe('Shared error classification (H3/M12)', () => {
  it('recognises the legacy "HTTP error! status: N" shape as retryable', () => {
    // BITE: the old classifier matched neither of these shapes — "HTTP
    // error! status: 403" (legacy Driftz / fetch-wrapper wording) fell
    // through to "non-retryable", so driftz.getMessages() swallowed it in
    // its catch block and returned []. A hard provider outage scored as a
    // successful empty check: no recordFailure, no circuit breaker, no
    // fallback provider, no retry backoff.
    expect(isRetryableError(new Error('HTTP error! status: 403'))).toBe(true);
    expect(isRetryableError(new Error('HTTP error! status: 503'))).toBe(true);
    expect(isRetryableError(new Error('Driftz getMessages: HTTP error 403'))).toBe(true);
  });

  it('no longer mistakes bare 3-digit numbers for server faults', () => {
    // BITE: the old rule matched any bare `5\d\d` anywhere in the message,
    // so the benign per-message miss "Message 512 not found in YOPmail
    // inbox" was classified as a provider outage — the circuit breaker
    // tripped and a healthy provider was ejected.
    expect(isRetryableError(new Error('Message 512 not found in YOPmail inbox'))).toBe(false);
    expect(isRetryableError(new Error('Message 500 not found in YOPmail inbox'))).toBe(false);
  });

  it('keeps the 404 = empty-inbox contract and the status-less 5xx phrasing', () => {
    // GUARD: pins both sides of the classifier contract so future edits of
    // the status-context regex cannot re-break them.
    expect(isRetryableError(new Error('Service: HTTP error 404'))).toBe(false);
    expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
  });

  it('throwIfRetryableStatus throws the status-carrying message on 403 and lets 404 pass', () => {
    // GUARD: the helper is the route by which provider statuses now reach
    // the classifier; its message must stay classifier-parseable.
    expect(() => throwIfRetryableStatus(new Response('', { status: 403 }), 'Ctx')).toThrow(
      /HTTP error 403/
    );
    expect(() => throwIfRetryableStatus(new Response('', { status: 404 }), 'Ctx')).not.toThrow();
  });

  it('driftz.getMessages rethrows a 403 instead of reporting an empty inbox', async () => {
    // BITE: pre-H3 the 403 was neither raised by the shared helper nor
    // classified as retryable, so driftz's catch block swallowed it and
    // RESOLVED [] — this rejects.toThrow would have failed against a
    // resolves-[] outcome on the old code.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 }))
    );

    await expect(driftzService.getMessages('user@bbjbinin.mn')).rejects.toThrow(/HTTP error 403/);
  });
});

// ─────────────── H4 — malformed payloads throw, empty stays empty ────────────

describe('Malformed payload shapes throw instead of faking an empty inbox (H4)', () => {
  it('mail.tm: drift payload throws — empty hydra list stays []', async () => {
    // BITE: pre-H4 the mapping was `data['hydra:member'] || []`, so any API
    // drift payload resolved to [] and the aggregator scored the check as a
    // success. The drift part must now THROW; the second half is a GUARD
    // against over-correction (a genuinely empty hydra list must keep
    // resolving [] — it passed on the old code too).
    const svc = new MailTmService();
    await svc.setToken('tok-h4');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ unexpected: 'drift' }))
    );
    await expect(svc.getMessages()).rejects.toThrow(MalformedProviderResponseError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ 'hydra:member': [] }))
    );
    await expect(svc.getMessages()).resolves.toEqual([]);
  });

  it('mail.gw: drift payload throws — empty hydra list stays []', async () => {
    // BITE: pre-H4 mapping was `data['hydra:member'] || []` → drift → [].
    // The empty-hydra-list half is a GUARD against over-correction.
    mailGwService.setToken('tok-h4');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/messages')) {
          return jsonResponse({});
        }
        return new Response('not found', { status: 404 });
      })
    );
    await expect(mailGwService.getMessages()).rejects.toThrow(MalformedProviderResponseError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/messages')) {
          return jsonResponse({ 'hydra:member': [] });
        }
        return new Response('not found', { status: 404 });
      })
    );
    await expect(mailGwService.getMessages()).resolves.toEqual([]);
  });

  it('mailinator: object drift throws — bare [] stays a valid empty inbox', async () => {
    // BITE: pre-H4 mapping was `data.msgs || data.messages || []` → the
    // drift payload resolved []. The bare-[] half is a GUARD: mailinator
    // accepts a bare array payload, and an empty one is a legitimate
    // empty inbox that must keep resolving [] without throwing.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ nope: 'drift' }))
    );
    await expect(mailinatorService.getMessages('testuser@mailinator.com')).rejects.toThrow(
      MalformedProviderResponseError
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse([]))
    );
    await expect(mailinatorService.getMessages('testuser@mailinator.com')).resolves.toEqual([]);
  });

  it('maildrop: non-array inbox payload throws', async () => {
    // BITE: pre-H4 a GraphQL answer whose `inbox` key held a non-array (API
    // drift) mapped onto [] via `data.inbox || []`-style handling and was
    // scored as a successful empty check.
    const acc = {
      token: 'box',
      username: 'box',
      login: 'box',
      domain: 'maildrop.cc',
      fullEmail: 'box@maildrop.cc',
      createdAt: 0,
      expiresAt: 0,
      id: '1',
      service: 'maildrop',
    } as any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = (() => {
          try {
            return JSON.parse(String(init?.body ?? '{}')) as { query?: string };
          } catch {
            return {} as { query?: string };
          }
        })();
        if (body.query?.includes('inbox')) {
          return jsonResponse({ data: { inbox: 'drift-not-an-array' } });
        }
        return jsonResponse({ data: { ping: 'pong' } });
      })
    );

    await expect(maildropService.getMessages(acc)).rejects.toThrow(MalformedProviderResponseError);
  });

  it('tempmail.plus: unknown object shape throws', async () => {
    // BITE: pre-H4 `data.mail_list || data.mails || data.result || []` →
    // drift → [] scored as success.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ unexpected: 'drift' }))
    );
    await expect(tempmailPlusService.getMessages('inbox@tempmail.plus')).rejects.toThrow(
      MalformedProviderResponseError
    );
  });

  it('catchmail: unknown object shape throws', async () => {
    // BITE: pre-H4 `data.messages || []` → drift → [] scored as success.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ unexpected: 'drift' }))
    );
    await expect(catchmailService.getMessages('box@catchmail.io')).rejects.toThrow(
      MalformedProviderResponseError
    );
  });

  it('throwawaymail: unknown object shape throws', async () => {
    // BITE: pre-H4 `data.messages || []` → drift → [] scored as success.
    const account = { id: 'mbx-2', token: 'mbx-2', fullEmail: 'w@throwawaymail.app' } as any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ unexpected: 'drift' }))
    );
    await expect(throwawaymailService.getMessages(account)).rejects.toThrow(
      MalformedProviderResponseError
    );
  });
});

// ─────────────────────── M6/M7 — NaN-free date parsing ──────────────────────

describe('Date parsing without NaN (M6/M7)', () => {
  it('mailinator parses the "11/12/2026 10:23:00" wall-clock format (M6)', async () => {
    // BITE: the old mapping was `Number(msg.time)` — Number("11/12/2026
    // 10:23:00") is NaN, so every human-readable Mailinator list message
    // carried date: NaN and the aggregator's polling age filter then
    // discarded the mail as malformed/ancient.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.endsWith('/inboxes/testuser')) {
          return jsonResponse({
            msgs: [
              {
                id: 'm-time',
                from: 'Svc <svc@example.com>',
                subject: 'Hi',
                time: '11/12/2026 10:23:00',
              },
            ],
          });
        }
        if (u.includes('/messages/m-time')) {
          return jsonResponse({
            id: 'm-time',
            parts: [{ headers: { 'content-type': 'text/plain' }, body: 'code' }],
          });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const emails = await mailinatorService.getMessages('testuser@mailinator.com');

    expect(emails).toHaveLength(1);
    expect(Number.isNaN(emails[0]!.date)).toBe(false);
    // Same parser as safeParseDate uses internally → exact equality.
    expect(emails[0]!.date).toBe(new Date('11/12/2026 10:23:00').getTime());
  });

  it('driftz parses ISO receivedAt strings without NaN (M7)', async () => {
    // BITE: the old mapping was `Number(msg.receivedAt) * 1000` —
    // Number("2026-11-12T10:23:00.000Z") is NaN, so ISO-timestamped Driftz
    // messages carried date: NaN and were dropped by the age filter.
    const iso = '2026-11-12T10:23:00.000Z';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/temp/user%40bbjbinin.mn/')) {
          return jsonResponse({
            success: true,
            result: { textContent: 'code', htmlContent: '<p>code</p>' },
          });
        }
        // list endpoint: /temp/{address}?limit=50
        return jsonResponse({
          success: true,
          result: {
            items: [{ id: 'd1', fromAddress: 'svc@example.com', subject: 'Hi', receivedAt: iso }],
          },
        });
      })
    );

    const emails = await driftzService.getMessages('user@bbjbinin.mn');

    expect(emails).toHaveLength(1);
    expect(Number.isNaN(emails[0]!.date)).toBe(false);
    expect(emails[0]!.date).toBe(new Date(iso).getTime());
  });

  it('driftz keeps epoch-seconds timestamps intact (M7 guard)', async () => {
    // GUARD (honesty: this passes on the old code too). It pins that the
    // safeParseDate swap did NOT change the documented epoch-seconds
    // contract — a seconds value must land on the same millisecond
    // timestamp the old `Number(x) * 1000` mapping produced.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/emails/')) {
          return jsonResponse({
            success: true,
            result: {
              items: [
                { id: 'p1', fromAddress: 'svc@example.com', subject: 'Hi', receivedAt: 1792167780 },
              ],
            },
          });
        }
        return jsonResponse({ success: false });
      })
    );

    const emails = await driftzService.getPermanentMessages('user@bbjbinin.mn');

    expect(emails).toHaveLength(1);
    expect(emails[0]!.date).toBe(1792167780000);
  });
});
