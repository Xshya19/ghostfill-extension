import { describe, expect, it, beforeEach, vi } from 'vitest';

import { validateMessage } from '../../../utils/validation';
import { AutoFiller } from '../../autoFiller';
import { OTPFieldDiscovery } from '../engines/otp-discovery';
import { FieldClassifier } from '../utils/field-classifier';
import { PageContext } from '../../../types/form.types';

function visibleRect(width = 240, height = 40): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeInput(attrs: Record<string, string>, label?: string): HTMLInputElement {
  const input = document.createElement('input');
  for (const [key, value] of Object.entries(attrs)) {
    input.setAttribute(key, value);
  }
  if (attrs.id && label) {
    const labelEl = document.createElement('label');
    labelEl.setAttribute('for', attrs.id);
    labelEl.textContent = label;
    document.body.appendChild(labelEl);
  }
  Object.defineProperty(input, 'getBoundingClientRect', {
    configurable: true,
    value: () => visibleRect(),
  });
  document.body.appendChild(input);
  return input;
}

const verificationContext: PageContext = Object.freeze({
  isVerificationPage: true,
  isLoginPage: false,
  isSignupPage: false,
  isPasswordResetPage: false,
  is2FAPage: false,
  framework: 'unknown',
  hasOTPLanguage: true,
  expectedOTPLength: 6,
  provider: null,
  pageSignals: [],
});

describe('OTP targeting safeguards', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.mocked(chrome.runtime.sendMessage).mockReset();
    vi.mocked(chrome.runtime.sendMessage).mockResolvedValue({});
  });

  it('does not classify a verification email field as an OTP field', () => {
    const input = makeInput(
      {
        type: 'text',
        id: 'verificationEmail',
        name: 'verification_email',
        placeholder: 'Email Address',
      },
      'Email Address'
    );

    expect(FieldClassifier.classify(input)).toBe('email');
  });

  it('does not classify captcha code fields as OTP fields', () => {
    const input = makeInput(
      {
        type: 'text',
        id: 'captcha_code',
        name: 'captcha_code',
        placeholder: 'Enter code',
      },
      'Help us beat the bots'
    );

    expect(FieldClassifier.classify(input)).not.toBe('otp');
    expect(OTPFieldDiscovery.discover(verificationContext)).toBeNull();
  });

  it('still classifies real verification code fields as OTP fields', () => {
    const input = makeInput(
      {
        type: 'text',
        id: 'verification_code',
        name: 'verification_code',
        placeholder: 'Verification Code',
        maxlength: '6',
        inputmode: 'numeric',
      },
      'Verification Code'
    );

    expect(FieldClassifier.classify(input)).toBe('otp');
    expect(OTPFieldDiscovery.discover(verificationContext)?.fields[0]).toBe(input);
  });

  it('accepts the runtime shape used by CLASSIFY_FIELD messages', () => {
    const result = validateMessage({
      action: 'CLASSIFY_FIELD',
      payload: {
        features: {
          structural: Array.from({ length: 128 }, () => 0),
        },
        context: verificationContext,
      },
    });

    expect(result.valid).toBe(true);
  });

  it('preserves already-filled identity fields when only the OTP is missing', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation((message: unknown) => {
      const action =
        typeof message === 'object' && message !== null && 'action' in message
          ? (message as { action?: string }).action
          : undefined;

      if (action === 'GET_IDENTITY') {
        return Promise.resolve({
          success: true,
          identity: {
            email: 'new@example.com',
            username: 'new-user',
            password: 'NewPass123!',
            firstName: 'New',
            lastName: 'User',
            fullName: 'New User',
          },
        });
      }

      if (action === 'GET_LAST_OTP') {
        return Promise.resolve({ lastOTP: { code: '654321' } });
      }

      return Promise.resolve({ success: true });
    });

    document.body.innerHTML = `
      <main>
        <h1>Verification Code</h1>
        <form>
          <label for="email">Email Address</label>
          <input id="email" name="email" type="email" value="jdpwwtxd1s@wshu.net" />
          <label for="username">Username</label>
          <input id="username" name="username" type="text" value="existing-user" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" value="ExistingPass123!" />
          <label for="verification_code">Verification Code</label>
          <input
            id="verification_code"
            name="verification_code"
            type="text"
            inputmode="numeric"
            maxlength="6"
          />
        </form>
      </main>
    `;

    document.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      Object.defineProperty(input, 'getBoundingClientRect', {
        configurable: true,
        value: () => visibleRect(),
      });
    });

    const email = document.querySelector<HTMLInputElement>('#email')!;
    const username = document.querySelector<HTMLInputElement>('#username')!;
    const password = document.querySelector<HTMLInputElement>('#password')!;
    const otp = document.querySelector<HTMLInputElement>('#verification_code')!;

    const result = await new AutoFiller().smartFill();

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(1);
    expect(email.value).toBe('jdpwwtxd1s@wshu.net');
    expect(username.value).toBe('existing-user');
    expect(password.value).toBe('ExistingPass123!');
    expect(otp.value).toBe('654321');
  });
});
