import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AutoFiller } from '../src/content/autoFiller';
import { IntelligenceCore } from '../src/intelligence/IntelligenceCore';
import { extractFieldRecord } from '../src/intelligence/pageAnalyzer';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 100,
    width: 300,
    height: 40,
    right: 400,
    bottom: 140,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const identity = {
  firstName: 'Evelyn',
  lastName: 'Castillo',
  fullName: 'Evelyn Castillo',
  email: 'evelyn@example.com',
  username: 'evelyncastillo',
};

it.each([
  ['First name', 'name="name" autocomplete="name"', 'first-name', identity.firstName],
  ['Last name', 'name="name" autocomplete="name"', 'last-name', identity.lastName],
  ['Given name(s)', '', 'first-name', identity.firstName],
  ['Family name / Surname', '', 'last-name', identity.lastName],
  ['First and last name', '', 'full-name', identity.fullName],
  ['First &amp; last name', '', 'full-name', identity.fullName],
  ['Name and surname', '', 'full-name', identity.fullName],
  ['', 'name="contactFirstName"', 'first-name', identity.firstName],
  ['', 'id="accountFamilyName"', 'last-name', identity.lastName],
  ['', 'data-testid="profileFullNameInput"', 'full-name', identity.fullName],
  ['', 'name="workEmailInput"', 'email', identity.email],
  ['', 'id="personalEmailAddress"', 'email', identity.email],
  ['Work email', 'name="fullName"', 'email', identity.email],
  ['Personal email address', '', 'email', identity.email],
  ['Corporate e-mail', '', 'email', identity.email],
  ['School email', '', 'email', identity.email],
  ['Confirm email address', '', 'email', identity.email],
  ['Business email', 'autocomplete="email"', 'email', identity.email],
  ['Your legal name', '', 'full-name', identity.fullName],
  ['Company name', 'name="companyName" autocomplete="name"', 'unknown', ''],
  ['Workspace name', 'name="workspaceFullName"', 'unknown', ''],
  ["Mother's name", 'autocomplete="name"', 'unknown', ''],
  ['Emergency contact first name', 'autocomplete="given-name"', 'unknown', ''],
  ['Maiden name', 'name="name"', 'unknown', ''],
  ['Middle name', 'autocomplete="additional-name"', 'unknown', ''],
  ['First name', 'autocomplete="family-name"', 'unknown', ''],
  ['Last name', 'autocomplete="given-name"', 'unknown', ''],
  ['Search by personal email', 'role="searchbox"', 'unknown', ''],
])(
  'classifies and fills only the requested identity part: %s %s',
  async (label, attrs, expected, value) => {
    document.body.innerHTML = `<form><label>${label}<input ${attrs}></label><input type="email" id="other"></form>`;
    const field = document.querySelector('input')!;
    const result = new IntelligenceCore().classify(extractFieldRecord(field));
    expect(result.decision === 'FILL' ? result.fieldType : 'unknown').toBe(expected);
    const filler = new AutoFiller();
    try {
      const fill = (filler as any).fillFocusedField(field, identity, null, {}, []);
      await vi.runAllTimersAsync();
      expect(await fill).toBe(expected === 'unknown' ? 0 : 1);
      expect(field.value).toBe(value);
      expect(document.querySelector<HTMLInputElement>('#other')!.value).toBe('');
    } finally {
      filler.destroy();
    }
  }
);
