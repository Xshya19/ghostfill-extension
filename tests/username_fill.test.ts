/**
 * Regression: a signup form's "Username" field must get the identity handle,
 * never the email. GitHub names that input id="login" / name="user[login]",
 * which the old email-like regex matched — so it filled
 * "evelyn.castillo.8020@catchmail.io" into a field that rejects "." and "@".
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { AutoFiller } from '../src/content/autoFiller';
import { PageIntelligence } from '../src/content/autofill/otpEngine';
import { FloatingButton } from '../src/content/floatingButton';
import { PageAnalyzer } from '../src/intelligence/pageAnalyzer';
import { classifyField } from '../src/shared/fieldClassifier';

const identity = {
  email: 'evelyn.castillo.8020@catchmail.io',
  username: 'evelyncastillo8020',
  password: 'x',
};

// The method is private; exercising it directly keeps the test off the DOM-heavy fill path.
const valueFor = (el: HTMLInputElement, ctx: Record<string, boolean> = {}) =>
  (
    new AutoFiller() as unknown as {
      getPreferredIdentifierValue: (i: unknown, e: Element, c: unknown) => string | null;
    }
  ).getPreferredIdentifierValue(identity, el, ctx);

const form = (html: string): HTMLFormElement => {
  document.body.innerHTML = `<form>${html}</form>`;
  // jsdom has no layout; these fixture controls represent visible form inputs.
  for (const input of document.querySelectorAll('input')) {
    input.getBoundingClientRect = () => new DOMRect(100, 100, 300, 40);
  }
  return document.body.firstElementChild as HTMLFormElement;
};

describe('username vs email resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = '';
  });

  it('fills the handle into a GitHub-style signup username field', () => {
    const f = form(
      '<input id="login" name="user[login]" autocomplete="username">' +
        '<input id="email" type="email" autocomplete="email">'
    );
    expect(valueFor(f.querySelector('#login')!, { isSignupPage: true })).toBe(identity.username);
  });

  it('still fills the email into an email-named field', () => {
    const f = form('<input name="email" autocomplete="email">');
    expect(valueFor(f.querySelector('input')!, { isSignupPage: true })).toBe(identity.email);
  });

  it('fills the email into a login form identifier with no separate email input', () => {
    const f = form('<input name="account" autocomplete="username"><input type="password">');
    expect(valueFor(f.querySelector('input')!, { isLoginPage: true })).toBe(identity.email);
  });

  it('honours a visible "Username" label even with no sibling email field', () => {
    const f = form(
      '<label for="u">Username</label><input id="u" name="u" autocomplete="username">'
    );
    expect(valueFor(f.querySelector('#u')!, { isSignupPage: true })).toBe(identity.username);
  });

  it('leaves an email field empty rather than filling a handle into it', () => {
    const filler = new AutoFiller() as unknown as {
      getValueForFieldType: (t: string, i: unknown, o: string | null) => string | null;
    };
    const withoutEmail = { username: 'evelyncastillo8020', password: 'x' };
    expect(filler.getValueForFieldType('email', withoutEmail, null)).toBeNull();
    expect(filler.getValueForFieldType('email', identity, null)).toBe(identity.email);
  });

  it('never treats a profile name field as an email target', () => {
    const f = form('<label for="name">Your name</label><input id="name" name="name">');
    const filler = new AutoFiller() as unknown as {
      isCompatibleTarget: (t: string, e: HTMLInputElement) => boolean;
    };
    const nameField = f.querySelector('#name')!;

    expect(filler.isCompatibleTarget('email', nameField)).toBe(false);
    expect(filler.isCompatibleTarget('full-name', nameField)).toBe(true);
  });

  it('treats an email field with a name@example placeholder as an email target', () => {
    const f = form(
      '<label for="work-email">Work email</label>' +
        '<input id="work-email" type="email" placeholder="name@company.com">'
    );
    const filler = new AutoFiller() as unknown as {
      isCompatibleTarget: (t: string, e: HTMLInputElement) => boolean;
    };

    expect(filler.isCompatibleTarget('email', f.querySelector('#work-email')!)).toBe(true);
  });

  it('fills a focused Mistral-style email input with a text type and example placeholder', async () => {
    document.title = 'Login - Mistral AI';
    const f = form(
      '<h1>Let\'s start building</h1><p>Login or signup below</p>' +
        '<label for="mistral-email">Email<span><a href="/recovery">Forgot password?</a></span></label>' +
        '<input id="mistral-email" name="email" type="text" inputmode="email" autocomplete="username" placeholder="you@example.com">'
    );
    const input = f.querySelector('input')!;
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      width: 380,
      height: 48,
      top: 100,
      left: 100,
      right: 480,
      bottom: 148,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    input.focus();

    const filler = new AutoFiller();
    const fab = new FloatingButton(filler);
    const control = fab as unknown as {
      button: HTMLButtonElement;
      createContainer: () => void;
      setMode: (mode: string) => void;
      identityCache: unknown;
      handlePrimaryAction: () => Promise<void>;
    };
    try {
      expect(PageAnalyzer.analyze().pageType).toBe('login');
      expect(PageIntelligence.analyze()).toMatchObject({
        isLoginPage: true,
        isSignupPage: false,
        isPasswordResetPage: false,
      });
      expect(classifyField(input)).toBe('email');
      control.createContainer();
      control.setMode('email');
      fab.showNearField(input);
      control.identityCache = {
        response: { success: true, identity: { email: identity.email }, preferredEmailType: 'disposable' },
        ts: Date.now(),
      };
      await control.handlePrimaryAction();
      expect(input.value).toBe(identity.email);
      expect(control.button.classList.contains('gf-success')).toBe(true);
    } finally {
      fab.destroy();
      filler.destroy();
    }
  });

  it('recognizes a verification step that keeps a login title before its code field appears', () => {
    document.title = 'Login - Mistral AI';
    form('<h1>Check your inbox</h1><p>Enter the verification code sent to your email.</p><input name="email">');

    expect(PageAnalyzer.analyze().pageType).toBe('verification');
    expect(PageIntelligence.analyze()).toMatchObject({
      isVerificationPage: true,
      isLoginPage: false,
    });
  });
});
