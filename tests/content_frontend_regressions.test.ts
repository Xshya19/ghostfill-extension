import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContextEngine, UltraDetector } from '../src/content/formDetector';
import { AutoFiller } from '../src/content/autoFiller';
import { useOTPExtractor } from '../src/frontend/popup/hooks';
import { EmailAvatar } from '../src/frontend/popup/components/SharedComponents';
import { safeSendMessage } from '../src/utils/messaging';
import type { Email } from '../src/types';

vi.mock('../src/utils/messaging', () => ({
  safeSendMessage: vi.fn(),
  safeSendTabMessage: vi.fn(),
}));

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());

let roots: Root[] = [];
const mount = async (node: React.ReactNode) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { root, container };
};

afterEach(async () => {
  await act(async () => roots.forEach((root) => root.unmount()));
  roots = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Content and popup audit regressions', () => {
  it('redetects fields when an SPA replaces a form with the same shape', async () => {
    document.body.innerHTML = '<form><input type="email" name="email"></form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 150, 40));
    const detector = new UltraDetector();
    const engine = new ContextEngine(detector);
    await engine.init();
    try {
      const oldField = engine.getCandidates()[0]!.element;
      document.querySelector('form')!.outerHTML = '<form><input type="email" name="email"></form>';
      await engine.scan();
      expect(oldField.isConnected).toBe(false);
      expect(engine.getCandidates()[0]!.element).toBe(document.querySelector('input'));
    } finally {
      engine.destroy();
    }
  });

  it('rescans an observed availability change even when form structure is unchanged', async () => {
    document.body.innerHTML = '<form><input type="email" name="email" disabled></form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 150, 40));
    const engine = new ContextEngine();
    await engine.init();
    try {
      expect(engine.getCandidates()).toHaveLength(0);
      document.querySelector('input')!.disabled = false;
      await Promise.resolve(); // Deliver the observer before the explicit scan.
      await engine.scan();
      expect(engine.getCandidates()[0]!.element).toBe(document.querySelector('input'));
    } finally {
      engine.destroy();
    }
  });

  it('fills a newly generated email immediately, inside the identity cache window', async () => {
    document.body.innerHTML = '<form><input type="email" name="email"></form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 150, 40));
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    let generated = false;
    vi.mocked(safeSendMessage).mockImplementation(async (message: any) => {
      if (message.action === 'GENERATE_EMAIL') {
        generated = true;
        return { success: true, email: { fullEmail: 'fresh@mail.tm' } } as any;
      }
      if (message.action === 'GET_IDENTITY') {
        return { success: true, preferredEmailType: 'disposable', identity: { email: generated ? 'fresh@mail.tm' : '' } } as any;
      }
      return { success: true } as any;
    });
    const filler = new AutoFiller();
    try {
      await (filler as any).handleIconClick(document.querySelector('input'), 'email');
      expect(generated).toBe(true);
      expect(document.querySelector('input')!.value).toBe('fresh@mail.tm');
    } finally {
      filler.destroy();
    }
  });

  it.each(['body', 'textBody', 'htmlBody'] as const)('re-extracts hydrated %s but reuses results for unchanged messages', async (bodyField) => {
    vi.mocked(safeSendMessage).mockImplementation(async (message: any) => ({
      success: true,
      ...((message.payload.textBody + message.payload.htmlBody).includes('491827') ? { otp: '491827', link: 'https://service.com/verify' } : {}),
    }) as any);
    let extracted: ReturnType<typeof useOTPExtractor> | undefined;
    const Probe = ({ emails }: { emails: Email[] }) => {
      extracted = useOTPExtractor(emails);
      return null;
    };
    const base = { id: 'message-1', date: 1_000, from: 'auth@service.com', subject: 'Verify your account', body: '' } as Email;
    const { root } = await mount(React.createElement(Probe, { emails: [base] }));
    expect(extracted?.otps['message-1']).toBeNull();
    const hydrated = { ...base, [bodyField]: 'Your verification code is 491827' };
    await act(async () => root.render(React.createElement(Probe, { emails: [hydrated] })));
    expect(extracted?.otps['message-1']).toBe('491827');
    expect(extracted?.links['message-1']).toBe('https://service.com/verify');
    await act(async () => root.render(React.createElement(Probe, { emails: [{ ...hydrated }] })));
    expect(safeSendMessage).toHaveBeenCalledTimes(2);
    await act(async () => root.render(React.createElement(Probe, { emails: [base] })));
    expect(extracted?.otps['message-1']).toBeNull();
    expect(extracted?.links['message-1']).toBeNull();
  });

  it('renders only a local fallback for a sender-controlled host', async () => {
    const { container } = await mount(React.createElement(EmailAvatar, {
      from: 'Security <notice@per-recipient.attacker.com>',
      website: 'https://tracking.attacker.net',
      content: '<a href="https://body.attacker.org">Verify account</a>',
    }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.email-avatar-fallback')).not.toBeNull();
  });

  it('keeps bundled sender logos available', async () => {
    const { container } = await mount(React.createElement(EmailAvatar, { from: 'Qwen <noreply@qwen.ai>' }));
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/qwen/);
    expect(container.querySelector('img')?.getAttribute('src')).not.toMatch(/^https?:/);
  });

  it.each([false, true])('distributes an OTP once across split boxes (focused=%s)', async (focused) => {
    document.body.innerHTML = '<form>' + '<input name="otp" autocomplete="one-time-code" maxlength="1">'.repeat(6) + '</form>';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 40));
    vi.mocked(safeSendMessage).mockImplementation(async (message: any) => {
      if (message.action === 'GET_IDENTITY') {return { success: true, identity: {} } as any;}
      if (message.action === 'GET_LAST_OTP') {return { success: true, lastOTP: { code: '491827' } } as any;}
      return { success: true } as any;
    });
    const inputs = [...document.querySelectorAll('input')];
    const values: string[] = [];
    inputs.forEach((input) => input.addEventListener('input', () => values.push(input.value)));
    if (focused) {inputs[2]!.focus();}
    const filler = new AutoFiller();
    try {
      const result = await filler.smartFill();
      expect(result.success).toBe(true);
      expect(result.filledCount).toBe(6);
      expect(inputs.map((input) => input.value)).toEqual([...'491827']);
      expect(values).toEqual([...'491827']);
    } finally {
      filler.destroy();
    }
  });
});
