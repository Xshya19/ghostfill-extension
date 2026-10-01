import { describe, expect, it } from 'vitest';
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  AliasInbox,
  EmailAvatar,
  InboxList,
  getSenderSource,
} from '../src/frontend/popup/components/SharedComponents';

import {
  getSenderDomain,
  getSenderEmail,
  getSenderLabel,
  getSenderLogoDomains,
  parseEmailIdentity,
} from '../src/utils/emailIdentity';

describe('email identity normalization', () => {
  it('keeps the fallback icon visible until a logo loads and retries a failed source', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      flushSync(() => root.render(React.createElement(EmailAvatar, { from: 'Qwen' })));
      const image = container.querySelector('img')!;
      const firstSource = image.src;
      expect(firstSource).toContain('qwen');
      expect(image.style.visibility).toBe('hidden');
      expect(container.querySelector('.email-avatar-fallback svg')).not.toBeNull();
      Object.defineProperties(image, {
        naturalWidth: { value: 32 },
        naturalHeight: { value: 32 },
      });
      flushSync(() => image.dispatchEvent(new Event('load')));
      expect(image.style.visibility).toBe('visible');
      flushSync(() => image.dispatchEvent(new Event('error')));
      expect(image.src).not.toBe(firstSource);
      expect(image.style.visibility).toBe('hidden');
    } finally {
      flushSync(() => root.unmount());
    }
  });
  it('uses the product website for known sender logos, including name-only headers', () => {
    expect(getSenderLogoDomains('no-reply@service.qwenlm.ai')[0]).toBe('chat.qwen.ai');
    expect(getSenderLogoDomains('Qwen')[0]).toBe('chat.qwen.ai');
    expect(getSenderLogoDomains('bounce+2241f3@mailer.notion.so')[0]).toBe('www.notion.com');
    expect(getSenderLogoDomains('Notion')[0]).toBe('www.notion.com');
  });

  it('discovers an unfamiliar sender website from message links without guessing a domain', () => {
    const content =
      '<img src="https://cdn.delivery.net/logo.png"><a href="https://app.apmix.ai/dashboard?token=private">Open dashboard</a><a href="https://x.com/apmix">Follow us</a>';
    expect(getSenderLogoDomains('Apmix', null, content)).toEqual(['apmix.ai', 'app.apmix.ai']);
    expect(getSenderLogoDomains('Apmix <bounce@mailer.delivery.net>', null, content)).toEqual([
      'apmix.ai',
      'app.apmix.ai',
    ]);
    expect(getSenderLogoDomains('Apmix')).toEqual([]);
    expect(getSenderLogoDomains('Qwen', 'https://img.alicdn.com/logo.png')[0]).toBe('chat.qwen.ai');
  });

  it('prefers an unknown sender domain and uses the message website only when it is missing', () => {
    expect(getSenderLogoDomains('Hello <hello@mailer.company.co.uk>')).toEqual([
      'company.co.uk',
      'mailer.company.co.uk',
    ]);
    expect(
      getSenderLogoDomains('Company', 'https://app.company.com/activate?token=private')
    ).toEqual(['company.com', 'app.company.com']);
    expect(getSenderLogoDomains('Qwen <hello@unrelated.com>')[0]).toBe('unrelated.com');
    expect(getSenderLogoDomains('Unknown sender', 'javascript:alert(1)')).toEqual([]);
    expect(getSenderLogoDomains('hello@localhost')).toEqual([]);
  });
  it('turns automated Notion senders into a provider label', () => {
    const raw = 'bounce+2241f3@mailer.notion.so';

    expect(getSenderLabel(raw, 'Your Notion signup code')).toBe('Notion');
    expect(getSenderEmail(raw)).toBe('bounce+2241f3@mailer.notion.so');
    expect(getSenderDomain(raw)).toBe('notion.so');
  });

  it('uses the domain when no display name or corroborated product is available', () => {
    expect(getSenderLabel('bounce+token@service.qwenlm.ai', 'Activate your account')).toBe(
      'Qwenlm'
    );
  });

  it('preserves a useful display name and parses angle-bracket headers', () => {
    const parsed = parseEmailIdentity('Qwen AI <no-reply@service.qwenlm.ai>');

    expect(parsed.displayName).toBe('Qwen AI');
    expect(parsed.email).toBe('no-reply@service.qwenlm.ai');
    expect(getSenderLabel('Qwen AI <no-reply@service.qwenlm.ai>')).toBe('Qwen AI');
  });

  it('does not surface an opaque address when no domain is available', () => {
    expect(getSenderLabel('bounce+opaque-token')).toBe('Unknown sender');
  });

  it.each([
    ['bounces+31859940-87e8-v07h9', 'Unknown sender'],
    ['mailer-daemon+opaque', 'Unknown sender'],
    [{ name: 'NovaMesh', address: 'bounces+123@delivery.example.com' }, 'NovaMesh'],
    [{ name: 'Élodie Martin', email: 'elodie@example.com' }, 'Élodie Martin'],
    [{ unexpected: 'not a sender' }, 'Unknown sender'],
    [42, 'Unknown sender'],
    ['Support <help@newcompany.com>', 'Support'],
    ['=?UTF-8?Q?=C3=89lodie_Martin?= <elodie@example.com>', 'Élodie Martin'],
    ['=?UTF-8?B?Tm92YU1lc2g=?= <hello@novamesh.io>', 'NovaMesh'],
    ['=?UTF-8?Q?Nova?=\r\n =?UTF-8?Q?Mesh?= <hello@novamesh.io>', 'NovaMesh'],
    ['=?bad-charset?Q?Nova?= <hello@novamesh.io>', 'Novamesh'],
  ])('normalizes provider sender metadata %j', (raw, expected) => {
    expect(getSenderLabel(raw)).toBe(expected);
  });

  it('preserves the actual name and address when combining provider metadata', () => {
    const raw = getSenderSource('', { name: 'NovaMesh', address: 'bounce+123@delivery.com' });
    expect(getSenderLabel(raw)).toBe('NovaMesh');
    expect(getSenderEmail(raw)).toBe('bounce+123@delivery.com');
    expect(getSenderSource('Qwen AI', 'no-reply@service.qwenlm.ai')).toBe(
      'Qwen AI <no-reply@service.qwenlm.ai>'
    );
    expect(
      getSenderLabel(getSenderSource('NovaMesh', '=?UTF-8?Q?NovaMesh?= <hi@novamesh.io>'))
    ).toBe('NovaMesh');
  });

  it('uses corroborated message domains for opaque senders without a brand list', () => {
    const claude = 'https://claude.ai/magic-link#fixture';
    expect(getSenderLabel('bounces+opaque', 'Your secure link to Claude.ai is here', claude)).toBe(
      'Claude'
    );
    const content =
      '<img src="https://cdn.delivery.com/logo.png"><a href="https://app.novamesh.io/verify">Sign in</a><a href="https://social.example.com">Follow</a>';
    expect(
      getSenderLabel(
        'bounces+token@mailer.delivery.com',
        'Your NovaMesh sign-in code',
        null,
        content
      )
    ).toBe('NovaMesh');
    expect(getSenderDomain('bounces+token@mailer.delivery.com')).toBe('delivery.com');
    expect(getSenderLabel('bounces+opaque', 'A note about OtherBrand.io', claude)).toBe(
      'Unknown sender'
    );
    expect(
      getSenderLabel(
        'bounces+opaque',
        'Compare NovaMesh and OtherBrand',
        null,
        'https://novamesh.io https://otherbrand.io'
      )
    ).toBe('Unknown sender');
    expect(
      getSenderLabel('Actual Author <author@sender.com>', 'Your NovaMesh code', null, content)
    ).toBe('Actual Author');
    expect(getSenderLabel('no-reply@novamesh.io', 'Your NovaMesh code')).toBe('NovaMesh');
    expect(getSenderLabel('bounces+opaque', 'Your code is here', 'https://code.io/help')).toBe(
      'Unknown sender'
    );
  });

  it('renders the same resolved sender in inbox text, avatar, and accessible action', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      flushSync(() =>
        root.render(
          React.createElement(InboxList, {
            preferredEmailType: 'disposable',
            gmailConnected: false,
            gmailIsManual: false,
            gmailInboxLoading: false,
            gmailInboxError: null,
            inboxCount: 1,
            displayedEmails: [
              {
                id: 'claude-fixture',
                from: 'bounces+31859940-87e8-v07h9',
                subject: 'Your secure link to Claude.ai is here',
                date: Date.now(),
                body: 'Sign in https://claude.ai/magic-link#fixture',
                read: false,
                attachments: [],
                activationLink: 'https://claude.ai/magic-link#fixture',
              },
            ],
            onNavigate: () => {},
            onCopyOTP: () => {},
            onOpenLink: () => {},
            onFetchGmailInbox: () => {},
            onOpenEmail: () => {},
          })
        )
      );
      expect(container.querySelector('.inbox-sender-name')?.textContent).toBe('Claude');
      expect(container.querySelector('[aria-label*="from Claude:"]')).not.toBeNull();
      expect(container.querySelector('.inbox-item-avatar')?.getAttribute('title')).toBe('Claude');
    } finally {
      flushSync(() => root.unmount());
    }
  });

  it('resolves opaque sender names in the real-mail inbox view too', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    try {
      flushSync(() => root.render(React.createElement(AliasInbox, {
        isManual: false, loading: false, error: null, signingIn: false, openingMessageId: null,
        onRefresh: () => {}, onSignIn: () => {}, onOpenMessage: () => {},
        inbox: [{ id: 'fixture', threadId: 'fixture', from: 'bounces+opaque',
          fromName: '', fromEmail: 'bounces+opaque', subject: 'Your secure link to Claude.ai is here',
          date: Date.now(), dateFormatted: 'Today', snippet: '',
          body: 'Sign in https://claude.ai/magic-link#fixture', isUnread: true, labelIds: [] }],
      })));
      expect(container.querySelector('.inbox-item-from')?.textContent).toBe('Claude');
      expect(container.querySelector('[aria-label*="from Claude:"]')).not.toBeNull();
      expect(container.querySelector('.inbox-item-avatar')?.getAttribute('title')).toBe('Claude');
    } finally {
      flushSync(() => root.unmount());
    }
  });
});
