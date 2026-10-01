import { afterEach, describe, expect, it, vi } from 'vitest';

import { FieldSetter, PhantomTyper } from '../src/content/autofill/formFiller';
import { FloatingButton } from '../src/content/floatingButton';
import { SmartFabPresenter } from '../src/content/fab';
import { HostPolicyStore } from '../src/content/fab/fabHostPolicy';
import type { AutoFiller } from '../src/content/autoFiller';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('responsive field actions', () => {
  it('writes a compatible field immediately without simulating every character', async () => {
    document.body.innerHTML = '<input type="email">';
    const field = document.querySelector('input')!;
    const input = vi.fn();
    field.addEventListener('input', input);
    const typing = vi.spyOn(PhantomTyper, 'typeSimulatedString');
    const fill = FieldSetter.setValue(field, 'person@example.com', 'react');
    expect(field.value).toBe('person@example.com');
    expect(await fill).toBe(true);
    expect(input).toHaveBeenCalledTimes(1);
    expect(typing).not.toHaveBeenCalled();
  });

  it('keeps keyboard simulation available for widgets that reject a direct fill', async () => {
    document.body.innerHTML = '<input type="text">';
    const field = document.querySelector('input')!;
    field.addEventListener('input', (event) => {
      if (!(event instanceof InputEvent) || event.data?.length !== 1) field.value = '';
    });
    const typing = vi.spyOn(PhantomTyper, 'typeSimulatedString');
    expect(await FieldSetter.setValue(field, '582914')).toBe(true);
    expect(field.value).toBe('582914');
    expect(typing).toHaveBeenCalled();
  });

  it('shows the field button on focus without a debounce delay by default', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input type="password"><div id="host"></div>';
    const field = document.querySelector('input')!;
    vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 40));
    const show = vi.fn();
    const presenter = new SmartFabPresenter({
      host: document.querySelector('#host')!,
      policy: new HostPolicyStore(),
      autoWire: false,
      gateOptions: () => ({ enabled: true }),
      onShow: show,
      onPlace: () => {},
      onHide: () => {},
    });
    presenter.handleFocusIn(field);
    expect(show).toHaveBeenCalled();
    presenter.destroy();
  });

  it('coalesces repeated presses while one primary action is pending', async () => {
    let finish!: () => void;
    const fill = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const fab = new FloatingButton({} as AutoFiller);
    document.body.innerHTML = '<input type="email">';
    const ui = fab as unknown as {
      mode: string;
      currentField: HTMLElement;
      actionFillActiveEmail: typeof fill;
      handlePrimaryAction: () => Promise<void>;
    };
    ui.mode = 'email';
    ui.currentField = document.querySelector('input')!;
    ui.actionFillActiveEmail = fill;
    const first = ui.handlePrimaryAction();
    const second = ui.handlePrimaryAction();
    expect(fill).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    fab.destroy();
  });
});
