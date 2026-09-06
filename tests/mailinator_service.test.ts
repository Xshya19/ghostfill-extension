import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mailinatorService, MailinatorService } from '../src/services/emailServices/mailinatorService';
import { emailService } from '../src/services/emailServices';

describe('MailinatorService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('getDomains', () => {
    it('returns mailinator.com domain', async () => {
      const domains = await mailinatorService.getDomains();
      expect(domains).toEqual(['mailinator.com']);
    });
  });

  describe('createAccount', () => {
    it('creates an account with human-like username and mailinator.com domain', async () => {
      const account = await mailinatorService.createAccount();
      expect(account.service).toBe('mailinator');
      expect(account.domain).toBe('mailinator.com');
      expect(account.fullEmail).toMatch(/^[a-z0-9._%+-]+@mailinator\.com$/i);
      expect(account.id).toContain('mailinator_');
      expect(account.expiresAt - account.createdAt).toBe(24 * 60 * 60 * 1000);
    });

    it('honors requested prefix', async () => {
      const account = await mailinatorService.createAccount('customuser');
      expect(account.login).toBe('customuser');
      expect(account.fullEmail).toBe('customuser@mailinator.com');
    });
  });

  describe('getMessages', () => {
    it('returns empty array when inbox is 404', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('Not found', { status: 404 }))
      );

      const messages = await mailinatorService.getMessages('testinbox@mailinator.com');
      expect(messages).toEqual([]);
    });

    it('parses message list and fetches details with text and HTML bodies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: RequestInfo | URL) => {
          const u = String(url);
          if (u.endsWith('/inboxes/testuser')) {
            return new Response(
              JSON.stringify({
                msgs: [
                  {
                    id: 'msg-100',
                    from: 'Service <service@example.com>',
                    subject: 'Verify your email code: 849201',
                    time: 1700000000000,
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (u.includes('/messages/msg-100')) {
            return new Response(
              JSON.stringify({
                id: 'msg-100',
                subject: 'Verify your email code: 849201',
                parts: [
                  {
                    headers: { 'content-type': 'text/plain; charset=utf-8' },
                    body: 'Your verification code is 849201.',
                  },
                  {
                    headers: { 'content-type': 'text/html; charset=utf-8' },
                    body: '<p>Your verification code is <b>849201</b>.</p>',
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          return new Response('Not found', { status: 404 });
        })
      );

      const messages = await mailinatorService.getMessages('testuser@mailinator.com');
      expect(messages.length).toBe(1);
      expect(messages[0]!.id).toBe('msg-100');
      expect(messages[0]!.subject).toBe('Verify your email code: 849201');
      expect(messages[0]!.textBody).toBe('Your verification code is 849201.');
      expect(messages[0]!.htmlBody).toContain('<b>849201</b>');
    });

    it('gracefully handles missing parts or failed message detail fetch', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: RequestInfo | URL) => {
          const u = String(url);
          if (u.endsWith('/inboxes/testuser')) {
            return new Response(
              JSON.stringify({
                msgs: [
                  {
                    id: 'msg-200',
                    from: 'Alerts <alerts@example.com>',
                    subject: 'System alert',
                    time: 1700000000000,
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (u.includes('/messages/msg-200')) {
            return new Response('Server Error', { status: 500 });
          }
          return new Response('Not found', { status: 404 });
        })
      );

      const messages = await mailinatorService.getMessages('testuser@mailinator.com');
      expect(messages.length).toBe(1);
      expect(messages[0]!.id).toBe('msg-200');
      expect(messages[0]!.subject).toBe('System alert');
      expect(messages[0]!.body).toBe('');
    });
  });

  describe('getMessage', () => {
    it('fetches a single message by ID', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              id: 'single-msg',
              from: 'Sender <sender@example.com>',
              subject: 'Single Message Subject',
              time: 1700000000000,
              parts: [
                {
                  headers: { 'content-type': 'text/plain' },
                  body: 'Single message plain text content',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const email = await mailinatorService.getMessage('myinbox@mailinator.com', 'single-msg');
      expect(email.id).toBe('single-msg');
      expect(email.subject).toBe('Single Message Subject');
      expect(email.textBody).toBe('Single message plain text content');
    });
  });

  describe('Aggregator integration', () => {
    it('emailService aggregator handles mailinator in getDomains', async () => {
      const domains = await emailService.getDomains('mailinator');
      expect(domains).toEqual(['mailinator.com']);
    });
  });
});
