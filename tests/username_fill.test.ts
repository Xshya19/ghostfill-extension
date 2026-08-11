/**
 * Regression: a signup form's "Username" field must get the identity handle,
 * never the email. GitHub names that input id="login" / name="user[login]",
 * which the old email-like regex matched — so it filled
 * "evelyn.castillo.8020@catchmail.io" into a field that rejects "." and "@".
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { AutoFiller } from '../src/content/autoFiller';

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
  return document.body.firstElementChild as HTMLFormElement;
};

describe('username vs email resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
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
});
