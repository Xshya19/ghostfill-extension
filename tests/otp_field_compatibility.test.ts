import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OTPFieldDiscovery, OTPFiller, PageIntelligence } from '../src/content/autofill/otpEngine';
import { OTPPageDetector } from '../src/content/otpPageDetector';
import { PageAnalyzer } from '../src/intelligence/pageAnalyzer';
import { AutoFiller } from '../src/content/autoFiller';
import type { FormDetector } from '../src/content/formDetector';

describe('OTP widget compatibility', () => {
  beforeEach(() => {
    document.title = '';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 40, 40));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    '<input type="tel" autocomplete="one-time-code" maxlength="6">',
    '<input type="tel" name="otp" maxlength="6">',
    '<input type="tel" aria-label="Verification code" maxlength="6">',
    '<input autocomplete="section-signup ONE-TIME-CODE" maxlength="6">',
  ])('discovers an explicitly identified code field: %s', (html) => {
    document.body.innerHTML = html;
    const input = document.querySelector('input')!;
    expect(OTPFieldDiscovery.discover(PageIntelligence.analyze())?.fields).toEqual([input]);
  });

  it.each([
    '<input type="tel" name="phone" autocomplete="tel" maxlength="10">',
    '<input name="captcha-code" autocomplete="one-time-code" maxlength="6">',
    '<input name="otp" autocomplete="cc-csc" maxlength="6">',
    '<input name="code" aria-label="Coupon code" maxlength="6">',
    '<input autocomplete="section-one-time-code off" maxlength="6">',
    '<div contenteditable="true" role="textbox" aria-label="Write a message"></div>',
  ])('leaves unrelated and unsafe fields alone: %s', (html) => {
    document.body.innerHTML = html;
    expect(OTPFieldDiscovery.discover(PageIntelligence.analyze())).toBeNull();
  });

  it('registers and discovers a code field inside nested open web components', () => {
    const host = document.createElement('auth-shell');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const widget = document.createElement('code-widget');
    root.append(widget);
    const innerRoot = widget.attachShadow({ mode: 'open' });
    innerRoot.innerHTML = '<input autocomplete="section-auth one-time-code" maxlength="6">';
    const input = innerRoot.querySelector('input')!;
    expect(PageAnalyzer.analyze().hasOTPField).toBe(true);
    expect(OTPFieldDiscovery.discover(PageIntelligence.analyze())?.fields).toEqual([input]);

    const detector = new OTPPageDetector({} as AutoFiller, {
      detectForms: () => ({ forms: [], standaloneFields: [] }),
    } as unknown as FormDetector);
    try {
      (detector as unknown as { runDetection: (trigger: string) => void }).runDetection('test');
      expect(detector.getStatus().isOTPPage).toBe(true);
      expect(detector.getStatus().fieldCount).toBe(1);
    } finally {
      detector.destroy();
    }
  });

  it('keeps separate split widgets apart and prefers the focused widget', () => {
    document.body.innerHTML = `<form id="first">${'<input name="otp" maxlength="1">'.repeat(6)}</form>
      <form id="second">${'<input name="otp" maxlength="1">'.repeat(6)}</form>`;
    const second = [...document.querySelectorAll<HTMLInputElement>('#second input')];
    second[0]!.focus();
    const group = OTPFieldDiscovery.discover(PageIntelligence.analyze());
    expect(group?.fields).toEqual(second);
    expect(group?.expectedLength).toBe(6);
  });

  it.each([
    '<input id="active" name="otp" maxlength="6">',
    '<div id="active">' + '<input maxlength="1">'.repeat(6) + '</div>',
  ])('prefers the focused widget across different discovery strategies: %s', (html) => {
    document.body.innerHTML = '<input autocomplete="one-time-code" maxlength="6">' + html;
    const expected = [...document.querySelectorAll<HTMLInputElement>('input')].slice(1);
    expected[0]!.focus();
    expect(OTPFieldDiscovery.discover(PageIntelligence.analyze())?.fields).toEqual(expected);
  });

  it('registers a dynamically mounted shadow field when it receives focus', async () => {
    vi.useFakeTimers();
    const detector = new OTPPageDetector({} as AutoFiller, {
      detectForms: () => ({ forms: [], standaloneFields: [] }),
    } as unknown as FormDetector);
    const internal = detector as unknown as {
      installFocusListener: () => void;
      runDetection: (trigger: string) => void;
    };
    try {
      internal.installFocusListener();
      internal.runDetection('test');
      expect(detector.getStatus().isOTPPage).toBe(false);
      const host = document.createElement('code-widget');
      document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<input autocomplete="one-time-code" maxlength="6">';
      root.querySelector<HTMLInputElement>('input')!.focus();
      await vi.advanceTimersByTimeAsync(100);
      expect(detector.getStatus().isOTPPage).toBe(true);
    } finally {
      detector.destroy();
    }
  });

  it('continues discovery when the first widget is incomplete', () => {
    document.body.innerHTML = `<form>${'<input name="otp" maxlength="1">'.repeat(3)}</form>
      <form id="complete">${'<input name="otp" maxlength="1">'.repeat(6)}</form>`;
    const group = OTPFieldDiscovery.discover(PageIntelligence.analyze());
    expect(group?.fields).toEqual([...document.querySelectorAll('#complete input')]);
    expect(group?.isSplit).toBe(true);
  });

  it('resolves repeated selectors in the focused component during delivery', async () => {
    const inputs: HTMLInputElement[] = [];
    for (let i = 0; i < 2; i++) {
      const host = document.createElement('code-widget');
      document.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = '<input id="code" type="tel" autocomplete="section-auth one-time-code" maxlength="6">';
      inputs.push(root.querySelector<HTMLInputElement>('input')!);
    }
    inputs[1]!.focus();
    const delegatedInput = vi.fn();
    document.addEventListener('input', delegatedInput);
    const filler = new AutoFiller();
    try {
      expect(await filler.fillOTP('451612', ['#code'], true)).toBe(true);
      expect(inputs.map((field) => field.value)).toEqual(['', '451612']);
      expect(delegatedInput).toHaveBeenCalledTimes(1);
      expect((delegatedInput.mock.calls[0]![0] as Event).composed).toBe(true);
    } finally {
      document.removeEventListener('input', delegatedInput);
      filler.destroy();
    }
  });

  it('refuses a partial split code without modifying the fields', async () => {
    document.body.innerHTML = '<form>' + '<input name="otp" maxlength="1">'.repeat(4) + '</form>';
    const group = OTPFieldDiscovery.discover(PageIntelligence.analyze())!;
    const result = await OTPFiller.fill('451612', group, 'unknown', true);
    expect(result.success).toBe(false);
    expect(result.filledCount).toBe(0);
    expect(group.fields.map((field) => field.value).join('')).toBe('');
  });

  it.each([
    '<input id="code" autocomplete="one-time-code" maxlength="4">',
    '<div>' + '<input class="code" name="captcha-code" maxlength="1">'.repeat(6) + '</div>',
    '<div>' + '<input class="code" autocomplete="cc-csc" maxlength="1">'.repeat(6) + '</div>',
  ])('validates saved selectors before acknowledging a fill: %s', async (html) => {
    document.body.innerHTML = html;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input')];
    inputs[0]!.focus();
    const filler = new AutoFiller();
    try {
      const selectors = inputs.map((_, index) => `input:nth-of-type(${index + 1})`);
      expect(await filler.fillOTP('451612', selectors, true)).toBe(false);
      expect(inputs.map((field) => field.value).join('')).toBe('');
    } finally {
      filler.destroy();
    }
  });

  it('fills the actual digits once, without injecting a probe digit', async () => {
    document.body.innerHTML = '<form>' + '<input name="otp" maxlength="1">'.repeat(6) + '</form>';
    const group = OTPFieldDiscovery.discover(PageIntelligence.analyze())!;
    const events: string[] = [];
    group.fields.forEach((field) => field.addEventListener('input', () => events.push(field.value)));
    const result = await OTPFiller.fill('451612', group, 'unknown');
    expect(result.success).toBe(true);
    expect(group.fields.map((field) => field.value).join('')).toBe('451612');
    expect(events).toEqual(['4', '5', '1', '6', '1', '2']);
  });

  it('writes the complete code to one explicitly marked editable widget', async () => {
    document.body.innerHTML = '<div contenteditable="true" role="textbox" autocomplete="one-time-code"></div>';
    const field = document.querySelector<HTMLElement>('div')!;
    const group = OTPFieldDiscovery.discover(PageIntelligence.analyze())!;
    const result = await OTPFiller.fill('451612', group, 'unknown');
    expect(result.success).toBe(true);
    expect(field.textContent).toBe('451612');
    field.addEventListener('beforeinput', (event) => event.preventDefault());
    expect((await OTPFiller.fill('582914', group, 'unknown')).success).toBe(false);
    expect(field.textContent).toBe('451612');
  });
});
