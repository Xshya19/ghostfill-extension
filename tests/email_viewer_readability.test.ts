import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailViewerModal } from '../src/frontend/popup/components/SharedComponents';

const link = 'https://app.notion.com/loginwithemail?state=fixture&password=009165';
const message = {
  id: 'notion-reader',
  from: 'Notion <notify@mail.notion.so>',
  subject: 'Your Notion signup code',
  textBody: '009165',
  otp: '009165',
  link,
  htmlBody: `<h2>Sign up for Notion</h2><p>Enter the code or use the magic link.</p><p>009165</p><a href="${link}">Sign in with Magic Link</a>`,
};

describe('email reader readability', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    flushSync(() =>
      root.render(React.createElement(EmailViewerModal, { message, onClose: vi.fn() }))
    );
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the full message when the provider text contains only its code and preserves copy/link actions', async () => {
    expect(container.querySelector('pre')?.textContent).toContain('Sign up for Notion');
    expect(container.querySelector('pre')?.textContent).toContain('Sign in with Magic Link');
    expect(container.querySelector('pre')?.textContent).toContain('\n009165\n');
    vi.stubGlobal('isSecureContext', true);
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const button = container.querySelector<HTMLButtonElement>(
      '.alias-message-action-btn--copy-code'
    )!;
    expect(button.textContent).toContain('009165');
    flushSync(() => button.click());
    await Promise.resolve();
    expect(copy).toHaveBeenCalledWith('009165');
    vi.mocked(chrome.tabs.create).mockClear();
    container.querySelector<HTMLButtonElement>('.email-hero-link-banner')!.click();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: link, active: true });
  });

  it('keeps the provider code when the HTML body contains a different code', () => {
    flushSync(() =>
      root.render(
        React.createElement(EmailViewerModal, {
          message: { ...message, htmlBody: '<p>Your verification code: 123456</p>' },
          onClose: vi.fn(),
        })
      )
    );
    expect(container.querySelector('pre')?.textContent).toBe('009165');
    expect(container.querySelector('.email-hero-otp-code')?.textContent).toBe('009165');
  });

  it('does not repeatedly grow the frame when the document height includes its viewport', () => {
    flushSync(() =>
      container.querySelector<HTMLButtonElement>('[title="View formatted email"]')!.click()
    );
    const frame = container.querySelector('iframe')!;
    const doc = frame.contentDocument!;
    Object.defineProperties(doc.body, {
      scrollHeight: { configurable: true, get: () => 280 },
      offsetHeight: { configurable: true, get: () => 280 },
    });
    const viewportHeight = () => Math.max(280, parseFloat(frame.style.height) || 160);
    Object.defineProperties(doc.documentElement, {
      scrollHeight: { configurable: true, get: viewportHeight },
      offsetHeight: { configurable: true, get: viewportHeight },
    });
    frame.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(2200);
    expect(frame.style.height).toBe('280px');
  });

  it('shows an unavailable date for explicitly unknown timestamps', () => {
    flushSync(() =>
      root.render(
        React.createElement(EmailViewerModal, {
          message: { ...message, date: 0 },
          onClose: vi.fn(),
        })
      )
    );
    expect(container.querySelector('.email-viewer-date')?.textContent).toBe('Date unavailable');
    expect(container.textContent).not.toContain('1970');
  });

  it('does not promote a newsletter number, unsubscribe link, or stale backend finding into a verification action', () => {
    flushSync(() =>
      root.render(
        React.createElement(EmailViewerModal, {
          message: {
            id: 'newsletter',
            subject: 'Welcome. Let’s get you set up.',
            from: 'team@example.com',
            textBody: 'Customize your work. San Francisco, CA 94104. &#8203;',
            htmlBody:
              '<h1>Your setup checklist</h1><p>San Francisco, CA 94104</p><a href="https://links.example.com/s/u/fixture">Unsubscribe</a>',
            otp: '8203',
            link: 'https://links.example.com/s/u/fixture',
          },
          onClose: vi.fn(),
        })
      )
    );
    expect(container.querySelector('.email-hero-otp-code')).toBeNull();
    expect(container.querySelector('.email-hero-link-banner')).toBeNull();
    expect(container.querySelector('.alias-message-action-btn--copy-code')).toBeNull();
  });
});
