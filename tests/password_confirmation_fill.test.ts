import { expect, it, vi } from 'vitest';

import { AutoFiller } from '../src/content/autoFiller';
import { FieldSetter } from '../src/content/autofill/formFiller';

it('keeps a signup password and its confirmation identical when either field opens the button', async () => {
  const rect = {
    x: 100, y: 100, left: 100, top: 100, right: 400, bottom: 140,
    width: 300, height: 40, toJSON: () => ({}),
  };
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  document.body.innerHTML = `
    <form>
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="new-password">
      <label for="confirmation">Confirm Password</label>
      <input id="confirmation" type="password" autocomplete="new-password">
    </form>`;
  const password = document.querySelector<HTMLInputElement>('#password')!;
  const confirmation = document.querySelector<HTMLInputElement>('#confirmation')!;
  const filler = new AutoFiller();

  try {
    expect(await filler.fillFieldIntoTarget('password', 'first-generated-password', password)).toBe(true);
    expect(password.value).toBe('first-generated-password');
    expect(confirmation.value).toBe('first-generated-password');

    // The site may reveal both values by switching their input type to text.
    password.type = 'text';
    confirmation.type = 'text';
    expect(await filler.fillFieldIntoTarget('password', 'second-generated-password', confirmation)).toBe(true);
    expect(password.value).toBe('second-generated-password');
    expect(confirmation.value).toBe('second-generated-password');

    const write = vi.spyOn(FieldSetter, 'setValue').mockImplementation(async (input, value) => {
      if (input === confirmation) {return false;}
      input.value = value;
      return true;
    });
    try {
      expect(await filler.fillFieldIntoTarget('password', 'third-generated-password', password)).toBe(false);
    } finally {
      write.mockRestore();
    }
  } finally {
    filler.destroy();
    rectSpy.mockRestore();
    document.body.innerHTML = '';
  }
});
