import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingButton } from '../src/content/floatingButton';
import { evaluateFab } from '../src/content/fab/fabVisibilityGate';
import { OTPPageDetector } from '../src/content/otpPageDetector';
import { PageAnalyzer, extractFieldRecord } from '../src/intelligence/pageAnalyzer';
import type { AutoFiller } from '../src/content/autoFiller';
import type { FormDetector } from '../src/content/formDetector';
import { pageStatus } from '../src/content/ui/pageStatus';

function showInputs(): void {
  for (const input of document.querySelectorAll('input')) {
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 40));
  }
}

function renderPreflightForm(): HTMLInputElement {
  document.title = 'User details';
  document.body.innerHTML = `
    <main>
      <h1>User Details</h1>
      <form>
        <label for="email">Email Address</label>
        <input id="email" type="email" placeholder="Email Address" />
        <div>
          <div>CAPTCHA</div>
          <input id="challenge" type="text" maxlength="6" placeholder="Enter the characters you see" />
        </div>
        <button type="button">Send verification code</button>
        <input type="password" placeholder="New Password" />
      </form>
    </main>`;
  showInputs();
  return document.querySelector<HTMLInputElement>('#email')!;
}

describe('verification preflight form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.title = '';
    vi.restoreAllMocks();
  });

  it('does not treat a short CAPTCHA input as an OTP field', () => {
    renderPreflightForm();
    expect(PageAnalyzer.analyze().hasOTPField).toBe(false);
  });

  it('reads registration attributes when named controls shadow form properties', () => {
    document.body.innerHTML = '<form name="signup" action="/register"><input name="name"><input type="email"><input type="password"></form>';
    showInputs();
    const form = document.querySelector('form')!;
    // Browsers expose named controls before form IDL properties; jsdom does not.
    for (const property of ['name', 'action', 'id', 'className', 'method']) {
      Object.defineProperty(form, property, { value: form.querySelector('input') });
    }
    const detector = new OTPPageDetector({} as AutoFiller, {} as FormDetector);
    try {
      expect((detector as unknown as { isRegistrationForm: (form: HTMLFormElement) => boolean }).isRegistrationForm(form)).toBe(true);
      expect(extractFieldRecord(form.querySelector('input')!).formAction).toBe('/register');
    } finally {
      detector.destroy();
    }
  });

  it('still recognizes a group of one-character OTP inputs', () => {
    document.body.innerHTML = `<form><div id="code-group">${'<input type="text" maxlength="1" />'.repeat(6)}</div></form>`;
    expect(PageAnalyzer.analyze().hasOTPField).toBe(true);
  });

  it('does not register an OTP waiting page until a code field appears', () => {
    renderPreflightForm();
    const formDetector = { detectForms: () => ({ forms: [], standaloneFields: [] }) };
    const detector = new OTPPageDetector({} as AutoFiller, formDetector as FormDetector);

    (detector as unknown as { runDetection: (trigger: string) => void }).runDetection('test');
    expect(detector.getStatus().isOTPPage).toBe(false);

    document.body.innerHTML = `
      <h1>Enter verification code</h1>
      <input id="verification-code" autocomplete="one-time-code" maxlength="6" />`;
    showInputs();
    expect(PageAnalyzer.analyze().hasOTPField).toBe(true);
    (detector as unknown as { runDetection: (trigger: string) => void }).runDetection('test');
    expect(detector.getStatus().isOTPPage).toBe(true);
    expect(detector.getStatus().fieldCount).toBe(1);
    detector.destroy();
  });

  it('does not register a preflight page when password fields have not mounted yet', () => {
    renderPreflightForm();
    for (const password of document.querySelectorAll('input[type="password"]')) {
      password.remove();
    }
    const formDetector = { detectForms: () => ({ forms: [], standaloneFields: [] }) };
    const detector = new OTPPageDetector({} as AutoFiller, formDetector as FormDetector);

    (detector as unknown as { runDetection: (trigger: string) => void }).runDetection('test');
    expect(detector.getStatus().isOTPPage).toBe(false);
    expect(detector.getStatus().fieldCount).toBe(0);
    detector.destroy();
  });

  it('fills the focused email field even when a prior OTP is saved', async () => {
    const email = renderPreflightForm();
    const analysis = PageAnalyzer.analyze();
    const decision = evaluateFab(email, { pageSignals: analysis });
    expect(decision.mode).toBe('email');

    const autoFiller = { fillOTP: vi.fn(), fillFieldIntoTarget: vi.fn() } as unknown as AutoFiller;
    const fab = new FloatingButton(autoFiller);
    const internal = fab as unknown as {
      mode: string;
      currentField: HTMLInputElement;
      hasOTPReady: boolean;
      pageAnalysis: ReturnType<typeof PageAnalyzer.analyze>;
      actionFillActiveEmail: ReturnType<typeof vi.fn>;
      actionPasteOTP: ReturnType<typeof vi.fn>;
      handlePrimaryAction: () => Promise<void>;
    };
    internal.mode = decision.mode;
    internal.currentField = email;
    internal.hasOTPReady = true;
    internal.pageAnalysis = analysis;
    internal.actionFillActiveEmail = vi.fn().mockResolvedValue(undefined);
    internal.actionPasteOTP = vi.fn().mockResolvedValue(undefined);

    await internal.handlePrimaryAction();
    expect(internal.actionFillActiveEmail).toHaveBeenCalledWith({ allowGenerateDisposable: true });
    expect(internal.actionPasteOTP).not.toHaveBeenCalled();
    fab.destroy();
  });

  it('does not fetch or fill a saved OTP on the email/CAPTCHA step', async () => {
    renderPreflightForm();
    const autoFiller = { fillOTP: vi.fn() } as unknown as AutoFiller;
    const fab = new FloatingButton(autoFiller);
    const internal = fab as unknown as { actionPasteOTP: () => Promise<void> };
    vi.mocked(chrome.runtime.sendMessage).mockClear();

    await internal.actionPasteOTP();

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect(autoFiller.fillOTP).not.toHaveBeenCalled();
    fab.destroy();
  });
  it('explains a saved-code site mismatch instead of saying no code has arrived', async () => {
    document.body.innerHTML = '<input autocomplete="one-time-code" maxlength="6">';
    showInputs();
    const autoFiller = { fillOTP: vi.fn() } as unknown as AutoFiller;
    const fab = new FloatingButton(autoFiller);
    const feedback = vi.spyOn(pageStatus, 'info');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      error: 'Saved code belongs to a different site',
    });
    try {
      await (fab as unknown as { actionPasteOTP: () => Promise<void> }).actionPasteOTP();
      expect(feedback).toHaveBeenCalledWith(
        'Code found — review the email in GhostFill before using it here',
        expect.any(Number)
      );
      expect(autoFiller.fillOTP).not.toHaveBeenCalled();
    } finally {
      fab.destroy();
    }
  });
  it('reports a background lookup failure without claiming the inbox is empty', async () => {
    document.body.innerHTML = '<input autocomplete="one-time-code" maxlength="6">';
    showInputs();
    const autoFiller = { fillOTP: vi.fn() } as unknown as AutoFiller;
    const fab = new FloatingButton(autoFiller);
    const feedback = vi.spyOn(pageStatus, 'info');
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce({
      success: false,
      error: 'Service not initialized',
    });
    try {
      await (fab as unknown as { actionPasteOTP: () => Promise<void> }).actionPasteOTP();
      expect(feedback).toHaveBeenCalledWith(
        'Could not check your code — try again',
        expect.any(Number)
      );
      expect(autoFiller.fillOTP).not.toHaveBeenCalled();
    } finally {
      fab.destroy();
    }
  });
});
