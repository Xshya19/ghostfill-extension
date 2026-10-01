import { expect, it, vi } from 'vitest';

import { AutoFiller } from '../src/content/autoFiller';
import { SmartFabPresenter, evaluateFab } from '../src/content/fab';
import { FloatingButton } from '../src/content/floatingButton';
import { IntelligenceCore } from '../src/intelligence/IntelligenceCore';
import { extractFieldRecord } from '../src/intelligence/pageAnalyzer';
import { classifyField } from '../src/shared/fieldClassifier';

it('keeps profile, credential, and unrelated fields distinct through hydration and tab changes', async () => {
  vi.useFakeTimers();
  const rect = {
    left: 100,
    top: 100,
    width: 300,
    height: 40,
    right: 400,
    bottom: 140,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  };
  const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
  const core = new IntelligenceCore();
  const filler = new AutoFiller() as unknown as {
    getClassification: (field: HTMLInputElement) => ReturnType<IntelligenceCore['classify']>;
    fillFocusedField: (...args: unknown[]) => Promise<number>;
  };
  const cases = [
    ['<div>Your name</div><input>', 'full-name', 'user'],
    ['<input autocomplete="section-profile shipping name">', 'full-name', 'user'],
    ['<input autocomplete="given-name">', 'first-name', 'user'],
    ['<input autocomplete="family-name">', 'last-name', 'user'],
    ['<input autocomplete="section-company-name name">', 'full-name', 'user'],
    ['<input autocomplete="section-email off">', 'unknown', 'hidden'],
    ['<input autocomplete="section-one-time-code off">', 'unknown', 'hidden'],
    ['<input autocomplete="additional-name" aria-label="Middle name">', 'unknown', 'hidden'],
    ['<label for="f">Preferred name</label><input id="f">', 'full-name', 'user'],
    ['<label for="f">Email address</label><input id="f" type="text">', 'email', 'email'],
    ['<label for="f">Email address</label><input id="f" name="name">', 'email', 'email'],
    ['<div><label>Email address</label><div><div><input name="name"></div></div></div>', 'email', 'email'],
    ['<div><span>Email address</span><div><div><div><input name="name"></div></div></div></div>', 'email', 'email'],
    ['<input aria-label="Email address" data-testid="full-name">', 'email', 'email'],
    ['<input type="email" name="full-name" autocomplete="name">', 'email', 'email'],
    [
      '<input type="email" placeholder="name@company.com" autocomplete="username">',
      'email',
      'email',
    ],
    ['<input type="text" placeholder="name@company.com">', 'email', 'email'],
    ['<label for="f">Street address</label><input id="f" name="email">', 'unknown', 'hidden'],
    ['<input aria-label="Username" autocomplete="username">', 'username', 'user'],
    ['<input type="password" aria-label="Password">', 'password', 'password'],
    ['<input type="password" autocomplete="one-time-code" maxlength="6">', 'otp', 'otp'],
    ['<input aria-label="Security code" inputmode="numeric" maxlength="6">', 'otp', 'otp'],
    ['<input aria-label="Workspace name" name="name">', 'unknown', 'hidden'],
    ['<input aria-label="Workspace name" autocomplete="name">', 'unknown', 'hidden'],
    ['<input aria-label="Name" name="companyName">', 'unknown', 'hidden'],
    ['<input role="searchbox" name="email" aria-label="Email">', 'unknown', 'hidden'],
    ['<input role="combobox" aria-label="Name">', 'unknown', 'hidden'],
    ['<input aria-label="Company name" name="name">', 'unknown', 'hidden'],
    ['<input autocomplete="cc-name">', 'unknown', 'hidden'],
    ['<input aria-label="Search by name" name="name">', 'unknown', 'hidden'],
    ['<input aria-label="Your name" style="display:none;transition:opacity .2s">', 'unknown', 'hidden'],
    ['<input aria-label="Your name" style="visibility:hidden;transition:opacity .2s">', 'unknown', 'hidden'],
    ['<input aria-label="Promotion code" inputmode="numeric" maxlength="6">', 'unknown', 'hidden'],
    ['<input aria-label="Message">', 'unknown', 'hidden'],
    ['<input name="title">', 'unknown', 'hidden'],
    ['<input>', 'unknown', 'hidden'],
  ];
  const rows = [];
  let presenter: SmartFabPresenter | undefined;
  let visibilitySpy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    for (const [html, expectedType, expectedMode] of cases) {
      document.body.innerHTML = `<form>${html}</form>`;
      const field = document.querySelector('input')!;
      const classified = core.classify(extractFieldRecord(field));
      for (const pageType of ['non-auth', 'signup']) {
        const decision = evaluateFab(field, {
          hostname: 'app.notion.com',
          href: `https://app.notion.com/${pageType === 'signup' ? 'signup' : 'onboarding'}`,
          pageSignals: { pageType },
          classify: (el) => classifyField(el as HTMLInputElement),
        });
        rows.push({
          html,
          pageType,
          type: classified.decision === 'FILL' ? classified.fieldType : 'unknown',
          button: decision.presence === 'hidden' ? 'hidden' : decision.mode,
          presence: decision.presence,
          expectedType,
          expectedMode,
        });
      }
    }
    expect(
      rows.filter(
        (row) =>
          row.type !== row.expectedType ||
          row.button !== row.expectedMode ||
          (row.expectedMode !== 'hidden' && row.presence !== 'active')
      )
    ).toEqual([]);

    document.body.innerHTML =
      '<form><label for="f">Your name</label><input id="f">' +
      '<label for="e">Email</label><input id="e" type="email">' +
      '<label for="o">Verification code</label><input id="o" autocomplete="one-time-code"></form>';
    const field = document.querySelector<HTMLInputElement>('#f')!;
    expect(classifyField(field)).toBe('user');
    expect(core.classify(extractFieldRecord(field)).fieldType).toBe('full-name');
    const identity = {
      firstName: 'Evelyn',
      lastName: 'Castillo',
      fullName: 'Evelyn Castillo',
      username: 'evelyncastillo',
      email: 'evelyn@example.com',
    };
    const fill = filler.fillFocusedField(field, identity, '123456', {}, []);
    await vi.runAllTimersAsync();
    expect(await fill).toBe(1);
    expect(field.value).toBe(identity.fullName);
    expect(document.querySelector<HTMLInputElement>('#e')!.value).toBe('');

    document.body.innerHTML =
      '<form><input id="other" autocomplete="name">' +
      '<input id="clicked" autocomplete="name"><input type="email"></form>';
    const clicked = document.querySelector<HTMLInputElement>('#clicked')!;
    const targetedFiller = new AutoFiller();
    const button = new FloatingButton(targetedFiller);
    const action = button as unknown as {
      currentField: HTMLInputElement;
      mode: string;
      identityCache: unknown;
      handlePrimaryAction: () => Promise<void>;
    };
    action.currentField = clicked;
    action.mode = 'user';
    action.identityCache = { response: { success: true, identity }, ts: Date.now() };
    try {
      const click = action.handlePrimaryAction();
      await vi.runAllTimersAsync();
      await click;
      expect(clicked.value).toBe(identity.fullName);
      expect(document.querySelector<HTMLInputElement>('#other')!.value).toBe('');
      expect(document.querySelector<HTMLInputElement>('[type="email"]')!.value).toBe('');
    } finally {
      button.destroy();
      targetedFiller.destroy();
    }

    document.body.innerHTML = '<input aria-label="Your name">';
    const hydrated = document.querySelector('input')!;
    expect(filler.getClassification(hydrated).fieldType).toBe('full-name');
    hydrated.setAttribute('aria-label', 'Work email');
    expect(filler.getClassification(hydrated).fieldType).toBe('email');
    hydrated.placeholder = 'name@company.com';
    hydrated.removeAttribute('aria-label');
    const emailFill = filler.fillFocusedField(hydrated, identity, null, {}, []);
    await vi.runAllTimersAsync();
    expect(await emailFill).toBe(1);
    expect(hydrated.value).toBe(identity.email);

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shown = vi.fn();
    presenter = new SmartFabPresenter({
      host,
      gateOptions: () => ({ enabled: true }),
      onShow: shown,
      onPlace: () => {},
      onHide: () => {},
    });
    hydrated.focus();
    vi.advanceTimersByTime(50);
    expect(presenter.currentField).toBe(hydrated);
    const count = shown.mock.calls.length;
    rectSpy.mockReturnValue({ ...rect, top: -200, bottom: -160 });
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    rectSpy.mockReturnValue(rect);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
    expect(shown.mock.calls.length).toBe(count + 1);

    const shadowHost = document.createElement('div');
    document.body.appendChild(shadowHost);
    const root = shadowHost.attachShadow({ mode: 'open' });
    root.innerHTML = '<label for="n">First name</label><input id="n" autocomplete="given-name">';
    const shadowField = root.querySelector('input')!;
    shadowField.focus();
    vi.advanceTimersByTime(50);
    expect(presenter.currentField).toBe(shadowField);
    presenter.reevaluate();
    expect(presenter.currentField).toBe(shadowField);
    hydrated.focus();
    vi.advanceTimersByTime(50);
    visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(presenter.currentField).toBeNull();
    visibilitySpy.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(50);
    expect(presenter.currentField).toBe(hydrated);
    presenter.dismiss();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(50);
    expect(presenter.currentField).toBeNull();
  } finally {
    presenter?.destroy();
    visibilitySpy?.mockRestore();
    rectSpy.mockRestore();
    vi.useRealTimers();
    document.body.innerHTML = '';
  }
});
