import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  yopmailService,
  decodeHtmlEntities,
  parseAlternateDomainsHtml,
  YopmailService,
} from '../src/services/emailServices/yopmailService';
import { emailService } from '../src/services/emailServices';

describe('YopmailService', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('HTML entity decoding', () => {
    it('decodes standard and hex HTML entities', () => {
      expect(decodeHtmlEntities('Hello &amp; World')).toBe('Hello & World');
      expect(decodeHtmlEntities('&quot;Quotes&quot;')).toBe('"Quotes"');
      expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
      expect(decodeHtmlEntities('Marcaci&#243;n')).toBe('Marcación');
      expect(decodeHtmlEntities('Test&#x20;Space')).toBe('Test Space');
      expect(decodeHtmlEntities('')).toBe('');
    });
  });

  describe('createAccount', () => {
    it('generates an account on a least-blocked alternate domain (never yopmail.com)', async () => {
      const account = await yopmailService.createAccount();
      expect(account.service).toBe('yopmail');
      // Anti-block: yopmail.com/.fr/.net are the most blocklisted — generation
      // must default to an obscure alternate domain.
      expect(account.domain).not.toBe('yopmail.com');
      expect(account.domain).not.toBe('yopmail.fr');
      expect(account.domain).not.toBe('yopmail.net');
      expect(account.fullEmail).toContain(`@${account.domain}`);
      expect(account.username).toBe(account.login);
      expect(account.id).toContain('yopmail_');
      expect(account.expiresAt - account.createdAt).toBe(8 * 24 * 60 * 60 * 1000);
    });

    it('sanitizes and honors custom prefix', async () => {
      const account = await yopmailService.createAccount('My.Test_User-99');
      expect(account.login).toBe('my.test_user-99');
      expect(account.fullEmail).toBe(`my.test_user-99@${account.domain}`);
    });

    it('falls back to a generated login when prefix sanitizes to empty', async () => {
      const account = await yopmailService.createAccount('!!!');
      expect(account.login).toBeDefined();
      expect(account.login!.length).toBeGreaterThan(0);
      expect(account.fullEmail).toContain('@');
    });

    it('truncates logins to YOPmail max 64 chars', async () => {
      const account = await yopmailService.createAccount(`${'a'.repeat(100)}@yopmail.com`);
      expect(account.login).toBeDefined();
      expect(account.login!.length).toBeLessThanOrEqual(64);
    });
  });

  describe('getDomains', () => {
    it('returns least-blocked alternates first plus primary domains', async () => {
      const domains = await yopmailService.getDomains();
      expect(domains[0]).not.toBe('yopmail.com');
      expect(domains).toContain('mynes.com');
      expect(domains).toContain('yopmail.com');
      expect(domains).toContain('yopmail.fr');
      expect(domains).toContain('yopmail.net');
      expect(domains).toContain('cool.fr.nf');
      expect(domains).toContain('jetable.fr.nf');
      expect(domains.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('parseAlternateDomainsHtml', () => {
    it('extracts, lowercases, and dedupes published alternate domains', () => {
      const html = `
        <div class="lstdom"><div>@Mynes.COM</div><div>@brand-new-obscure-77.com</div>
        <div>@brand-new-obscure-77.com</div><div>@yopmail.com</div>
        <div>not-a-domain</div><div>@bad..dots.com</div></div>
      `;
      expect(parseAlternateDomainsHtml(html)).toEqual([
        'mynes.com',
        'brand-new-obscure-77.com',
        'yopmail.com',
      ]);
    });

    it('returns empty array when no domain entries exist', () => {
      expect(parseAlternateDomainsHtml('<html><body>no domains</body></html>')).toEqual([]);
    });
  });

  describe('refreshAlternatePool', () => {
    const altPage = (entries: string): string =>
      `<html><body><div class="lstdom">${entries}</div></body></html>`;

    it('merges fresh obscure domains ahead of primaries and never generates giveaways', async () => {
      const service = new YopmailService();
      const filler = Array.from({ length: 12 }, (_, i) => `<div>@fresh-pool-${i}.com</div>`).join('');
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () =>
          altPage(`${filler}<div>@spammy-trash-99.com</div><div>@yopmail.com</div>`),
      });

      await service.refreshAlternatePool();
      const domains = await service.getDomains();
      expect(domains).toContain('fresh-pool-0.com');
      expect(domains).toContain('spammy-trash-99.com');
      expect(domains.indexOf('fresh-pool-0.com')).toBeLessThan(domains.indexOf('yopmail.com'));

      // Giveaway domains stay listed but are never auto-generated.
      for (let i = 0; i < 40; i++) {
        const account = await service.createAccount();
        expect(account.domain).not.toBe('yopmail.com');
        expect(account.domain).not.toBe('spammy-trash-99.com');
      }
    });

    it('keeps the static pool when refresh fails', async () => {
      const service = new YopmailService();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
      await service.refreshAlternatePool();
      const domains = await service.getDomains();
      expect(domains).toContain('mynes.com');
      expect(domains).toContain('yopmail.com');
      expect(domains.length).toBeGreaterThanOrEqual(30);
    });

    it('single-flights concurrent refreshes into one fetch', async () => {
      const service = new YopmailService();
      let hits = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        hits++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            altPage(
              Array.from({ length: 12 }, (_, i) => `<div>@sf-pool-${i}.xyz</div>`).join('')
            ),
        });
      });
      await Promise.all([
        service.refreshAlternatePool(),
        service.refreshAlternatePool(),
        service.refreshAlternatePool(),
      ]);
      expect(hits).toBe(1);
    });
  });

  describe('parseInboxHtml', () => {
    it('returns empty array when inbox has no messages', () => {
      const emptyHtml = '<!DOCTYPE html><html><body><div id="inbox"></div></body></html>';
      const messages = yopmailService.parseInboxHtml(emptyHtml, 'user@yopmail.com');
      expect(messages).toEqual([]);
    });

    it('correctly parses messages from YOPmail inbox DOM', () => {
      const mockInboxHtml = `
        <div class="m" id="e_ZwLjBGN1ZQHlBQN4ZQNjZwRkAmxmZN==">
          <div class="mctn">
            <div class="msh">
              <span class="lmh">11:28</span>
              <span class="lmf">Support Team</span>
            </div>
            <div class="lms">Your Verification Code is 839201</div>
          </div>
        </div>
        <div class="m" id="e_ZwLjBGN1ZQHlBQN2ZQNjZwRkAmL4Zt==">
          <div class="mctn">
            <div class="msh">
              <span class="lmh">10:15</span>
              <span class="lmf">Acme &amp; Co</span>
            </div>
            <div class="lms">Welcome to the platform</div>
          </div>
        </div>
      `;

      const messages = yopmailService.parseInboxHtml(mockInboxHtml, 'alice@yopmail.com');
      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('e_ZwLjBGN1ZQHlBQN4ZQNjZwRkAmxmZN==');
      expect(messages[0].from).toBe('Support Team');
      expect(messages[0].subject).toBe('Your Verification Code is 839201');
      expect(messages[0].to).toBe('alice@yopmail.com');
      expect(messages[0].read).toBe(true);

      expect(messages[1].id).toBe('e_ZwLjBGN1ZQHlBQN2ZQNjZwRkAmL4Zt==');
      expect(messages[1].from).toBe('Acme & Co');
      expect(messages[1].subject).toBe('Welcome to the platform');
    });

    it('parses reordered-attribute markup via the adaptive fallback', () => {
      const shuffledHtml = `
        <div id="e_FALLBACK1" class="m" data-x="1">
          <span class="lmf">Fallback Sender</span>
          <span class="lmh">09:00</span>
          <div class="lms">Fallback subject 123456</div>
        </div>
      `;
      const messages = yopmailService.parseInboxHtml(shuffledHtml, 'bob@mynes.com');
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('e_FALLBACK1');
      expect(messages[0].from).toBe('Fallback Sender');
      expect(messages[0].subject).toBe('Fallback subject 123456');
      expect(messages[0].to).toBe('bob@mynes.com');
    });
  });

  describe('parseMessageHtml', () => {
    it('extracts subject, sender, date, and body', () => {
      const mockMailHtml = `
        <main>
          <div class="ellipsis nw b f18">Welcome to Service</div>
          <span class="ellipsis b">noreply@service.com</span>
          <div class="md text zoom nw f24"><i class="material-icons-outlined">&#xe192;</i><span class="ellipsis">Saturday, September 5, 2026 11:30:14 AM</span></div>
          <div id="mail">
            <p>Hello Alice,</p>
            <p>Your one-time pass is <strong>482910</strong>.</p>
          </div>
          </div>
        </main>
      `;

      const email = yopmailService.parseMessageHtml(mockMailHtml, 'msg_123', 'alice@yopmail.com');
      expect(email.id).toBe('msg_123');
      expect(email.subject).toBe('Welcome to Service');
      expect(email.from).toBe('noreply@service.com');
      expect(email.htmlBody).toContain('<strong>482910</strong>');
      expect(email.body).toContain('482910');
      expect(email.textBody).toContain('Your one-time pass is 482910');
    });
  });

  describe('Session token flow and inbox fetching', () => {
    it('fetches session tokens and loads inbox messages', async () => {
      const service = new YopmailService();

      const homeHtml = `
        <html>
          <head><script src="/ver/9.3/webmail.js"></script></head>
          <body>
            <input type="hidden" name="yp" id="yp" value="TEST_YP_TOKEN_123" />
          </body>
        </html>
      `;
      const scriptJs = 'var url = "inbox?login=" + l + "&yj=TEST_YJ_TOKEN_XYZ&v=" + v;';
      const inboxHtml = `
        <div class="m" id="e_TEST_MSG_ID">
          <span class="lmh">12:00</span>
          <span class="lmf">Notifier</span>
          <div class="lms">Activation Link Inside</div>
        </div>
      `;

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'set-cookie': 'yc=1; path=/' }),
            text: async () => homeHtml,
          });
        }
        if (urlStr.includes('/ver/9.3/webmail.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => scriptJs,
          });
        }
        if (urlStr.includes('/inbox')) {
          expect(urlStr).toContain('yp=TEST_YP_TOKEN_123');
          expect(urlStr).toContain('yj=TEST_YJ_TOKEN_XYZ');
          expect(urlStr).toContain('login=testuser');
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => inboxHtml,
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
      });

      globalThis.fetch = mockFetch;

      const emails = await service.getMessages('testuser@yopmail.com');
      expect(emails).toHaveLength(1);
      expect(emails[0].id).toBe('e_TEST_MSG_ID');
      expect(emails[0].subject).toBe('Activation Link Inside');
    });

    it('refreshes session and retries when receiving 400 status', async () => {
      const service = new YopmailService();

      let inboxAttempts = 0;
      const homeHtml = '<input type="hidden" name="yp" id="yp" value="FRESH_YP" /><script src="/ver/9.3/webmail.js"></script>';
      const scriptJs = '&yj=FRESH_YJ&v=';
      const inboxHtml = '<div class="m" id="e_RECOVERED"><span class="lmh">12:01</span><span class="lmf">Sender</span><div class="lms">Success</div></div>';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => homeHtml,
          });
        }
        if (urlStr.includes('webmail.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => scriptJs,
          });
        }
        if (urlStr.includes('/inbox')) {
          inboxAttempts++;
          if (inboxAttempts === 1) {
            return Promise.resolve({
              ok: false,
              status: 400,
              headers: new Headers(),
              text: async () => 'Bad Request: expired tokens',
            });
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => inboxHtml,
          });
        }
        return Promise.reject(new Error(`Unexpected URL: ${urlStr}`));
      });

      const emails = await service.getMessages('user@yopmail.com');
      expect(inboxAttempts).toBe(2);
      expect(emails).toHaveLength(1);
      expect(emails[0].id).toBe('e_RECOVERED');
    });

    it('single-flights concurrent polls into one session refresh', async () => {
      const service = new YopmailService();
      let homeHits = 0;
      let jsHits = 0;
      let inboxHits = 0;

      const homeHtml =
        '<input type="hidden" name="yp" id="yp" value="SHARED_YP" /><script src="/ver/9.3/webmail.js"></script>';
      const scriptJs = '&yj=SHARED_YJ&v=';
      const inboxHtml =
        '<div class="m" id="e_SHARED"><span class="lmh">12:02</span><span class="lmf">S</span><div class="lms">Hi</div></div>';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          homeHits++;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => homeHtml,
          });
        }
        if (urlStr.includes('webmail.js')) {
          jsHits++;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => scriptJs,
          });
        }
        inboxHits++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => inboxHtml,
        });
      });

      const results = await Promise.all([
        service.getMessages('a@mynes.com'),
        service.getMessages('b@mynes.com'),
        service.getMessages('c@mynes.com'),
      ]);
      expect(homeHits).toBe(1);
      expect(jsHits).toBe(1);
      expect(inboxHits).toBe(3);
      for (const r of results) {
        expect(r).toHaveLength(1);
      }
    });

    it('sends session tokens on the mail-content request', async () => {
      const service = new YopmailService();
      const homeHtml =
        '<input type="hidden" name="yp" id="yp" value="MAIL_YP" /><script src="/ver/9.3/webmail.js"></script>';
      const scriptJs = '&yj=MAIL_YJ&v=';
      const mailHtml =
        '<main><div class="ellipsis nw b f18">Code inside</div><div id="mail"><p>Code <strong>771122</strong></p></div></main>';
      let mailUrl = '';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => homeHtml,
          });
        }
        if (urlStr.includes('webmail.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => scriptJs,
          });
        }
        mailUrl = urlStr;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => mailHtml,
        });
      });

      const email = await service.getMessage('a@mynes.com', 'e_MSG9');
      expect(mailUrl).toContain('yp=MAIL_YP');
      expect(mailUrl).toContain('yj=MAIL_YJ');
      expect(email.body).toContain('771122');
    });

    it('reuses the cached yj on refresh and skips webmail.js (halved refresh traffic)', async () => {
      const service = new YopmailService();
      let homeHits = 0;
      let jsHits = 0;
      const homeHtml =
        '<input type="hidden" name="yp" id="yp" value="YP_ONE" /><script src="/ver/9.3/webmail.js"></script>';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          homeHits++;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => homeHtml,
          });
        }
        jsHits++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '&yj=CACHED_YJ&v=',
        });
      });

      await service.ensureSession(true);
      await service.ensureSession(true);
      expect(homeHits).toBe(2);
      expect(jsHits).toBe(1);
    });

    it('refetches webmail.js when the homepage reports a new version', async () => {
      const service = new YopmailService();
      let version = '9.3';
      let jsHits = 0;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              `<input type="hidden" name="yp" id="yp" value="YP_X" /><script src="/ver/${version}/webmail.js"></script>`,
          });
        }
        jsHits++;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '&yj=NEW_YJ&v=',
        });
      });

      await service.ensureSession(true);
      version = '9.4';
      await service.ensureSession(true);
      expect(jsHits).toBe(2);
    });

    it('falls back to the previous yj when a new version parses empty', async () => {
      const service = new YopmailService();
      let version = '9.3';
      let serveGarbageJs = false;
      let inboxUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              `<input type="hidden" name="yp" id="yp" value="YP_FB" /><script src="/ver/${version}/webmail.js"></script>`,
          });
        }
        if (urlStr.includes('webmail.js')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => (serveGarbageJs ? 'var nothing_here = 1;' : '&yj=STALE_YJ&v='),
          });
        }
        inboxUrl = urlStr;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '',
        });
      });

      await service.ensureSession(true);
      // New webmail version whose script parses empty: keep the old yj
      // (stale-but-plausibly-valid) instead of a guaranteed-400 empty one.
      version = '9.4';
      serveGarbageJs = true;
      await service.ensureSession(true);
      await service.getMessages('fallback@mynes.com');
      expect(inboxUrl).toContain('yj=STALE_YJ');
    });
  });

  describe('Polling throttle & cookie sync', () => {
    it('throttles rapid subsequent calls for the same account and returns cached messages', async () => {
      const service = new YopmailService();
      let fetchCount = 0;

      const homeHtml = '<input type="hidden" name="yp" id="yp" value="YP1" /><script src="/ver/9.3/webmail.js"></script>';
      const scriptJs = '&yj=YJ1&v=';
      const inboxHtml = '<div class="m" id="e_CACHED_1"><span class="lmh">12:00</span><span class="lmf">From</span><div class="lms">Sub</div></div>';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => homeHtml });
        }
        if (urlStr.includes('webmail.js')) {
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => scriptJs });
        }
        fetchCount++;
        return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => inboxHtml });
      });

      // Call 1: makes network requests
      const res1 = await service.getMessages('throttle_user@mynes.com');
      expect(res1).toHaveLength(1);
      expect(fetchCount).toBe(1);

      // Call 2 immediately (sub-6s): should return cached results with 0 extra inbox network fetches
      const res2 = await service.getMessages('throttle_user@mynes.com');
      expect(res2).toHaveLength(1);
      expect(res2[0].id).toBe('e_CACHED_1');
      expect(fetchCount).toBe(1);
    });

    it('refuses runaway token refresh when receiving multiple 400s within 60 seconds', async () => {
      const service = new YopmailService();
      let homeFetches = 0;

      const homeHtml = '<input type="hidden" name="yp" id="yp" value="YP2" /><script src="/ver/9.3/webmail.js"></script>';
      const scriptJs = '&yj=YJ2&v=';

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.endsWith('/en/')) {
          homeFetches++;
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => homeHtml });
        }
        if (urlStr.includes('webmail.js')) {
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => scriptJs });
        }
        // Inbox consistently returns 400
        return Promise.resolve({
          ok: false,
          status: 400,
          headers: new Headers(),
          text: async () => 'Bad Request',
        });
      });

      // First call: initial fetch + 1 retry = 2 home fetches (initial session + 1 retry refresh)
      await expect(service.getMessages('user_err1@mynes.com')).rejects.toThrow();
      expect(homeFetches).toBe(2);

      // Second call immediately with a different user (bypassing the login-specific cache):
      // Token refresh was done < 60s ago, so it refuses to loop-refresh the session again!
      await expect(service.getMessages('user_err2@mynes.com')).rejects.toThrow();
      // homeFetches must NOT have increased because refresh was blocked by the 60s guard
      expect(homeFetches).toBe(2);
    });

    it('sets chrome.cookies when chrome.cookies API is available', async () => {
      const service = new YopmailService();
      const mockSet = vi.fn().mockResolvedValue({ name: 'ytime', value: '12:00' });

      // Mock chrome.cookies
      const originalChrome = (globalThis as any).chrome;
      (globalThis as any).chrome = {
        cookies: {
          set: mockSet,
        },
      };

      try {
        const homeHtml = '<input type="hidden" name="yp" id="yp" value="YP_CK" /><script src="/ver/9.3/webmail.js"></script>';
        const scriptJs = '&yj=YJ_CK&v=';
        const inboxHtml = '<div class="m" id="e_CK"><span class="lmh">12:00</span><span class="lmf">F</span><div class="lms">S</div></div>';

        globalThis.fetch = vi.fn().mockImplementation((url: string) => {
          const urlStr = String(url);
          if (urlStr.endsWith('/en/')) {
            return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => homeHtml });
          }
          if (urlStr.includes('webmail.js')) {
            return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => scriptJs });
          }
          return Promise.resolve({ ok: true, status: 200, headers: new Headers(), text: async () => inboxHtml });
        });

        await service.getMessages('cookie_test@mynes.com');

        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://yopmail.com/',
            name: 'ytime',
          })
        );
        expect(mockSet).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://yopmail.com/',
            name: 'compte',
            value: 'cookie_test',
          })
        );
      } finally {
        (globalThis as any).chrome = originalChrome;
      }
    });
  });

  describe('Aggregator integration', () => {
    it('resolves domains for yopmail service through aggregator', async () => {
      const domains = await emailService.getDomains('yopmail');
      expect(domains).toContain('yopmail.com');
    });

    it('generates email account when yopmail is specified', async () => {
      const account = await emailService.generateEmail({ service: 'yopmail', prefix: 'testagg' });
      expect(account.service).toBe('yopmail');
      expect(account.login).toBe('testagg');
      expect(account.domain).not.toBe('yopmail.com');
      expect(account.fullEmail).toBe(`testagg@${account.domain}`);
    });
  });
});
