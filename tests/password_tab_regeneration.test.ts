import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  PasswordGenerator,
  arePasswordOptionsEqual,
  createPasswordPreviewState,
  reducePasswordPreview,
} from '../src/frontend/popup/components/SharedComponents';
import { safeSendMessage } from '../src/utils/messaging';
import { DEFAULT_PASSWORD_OPTIONS, type PasswordOptions } from '../src/types';

vi.mock('../src/utils/messaging', () => ({
  safeSendMessage: vi.fn(),
  safeSendTabMessage: vi.fn(),
}));

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());

let roots: Root[] = [];
const container = document.createElement('div');

const mount = async (node: React.ReactNode) => {
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(node));
  return { root, container };
};

afterEach(async () => {
  await act(async () => roots.forEach((root) => root.unmount()));
  roots = [];
  container.innerHTML = '';
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const STORED_PASSWORD = 'saved-account-password';

const renderGenerator = (currentPassword: string): React.ReactElement =>
  React.createElement(PasswordGenerator, { onToast: vi.fn(), currentPassword });

let generationCount = 0;
const mockGenerator = () => {
  generationCount = 0;
  vi.mocked(safeSendMessage).mockImplementation(async () => {
    generationCount += 1;
    return {
      success: true,
      result: {
        password: `generated-${generationCount}`,
        strength: {
          score: 3,
          level: 'good',
          crackTime: 'Secure',
          entropy: 80,
          suggestions: [],
        },
        options: DEFAULT_PASSWORD_OPTIONS,
        generatedAt: Date.now(),
      },
    };
  });
};

const clickButton = async (label: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`Button not found: ${label}`);
  }
  await act(async () => {
    button.click();
  });
};

const revealedPassword = (): string =>
  container.querySelector('.password-display-text')?.textContent?.trim() ?? '';

const revealPassword = async () => {
  await clickButton('Show password');
};

describe('password preview decision model', () => {
  const base = DEFAULT_PASSWORD_OPTIONS;
  const withoutSymbols: PasswordOptions = { ...base, symbols: false };

  it('describes the stored account password when it arrives', () => {
    const state = createPasswordPreviewState(base);
    const outcome = reducePasswordPreview(state, {
      type: 'stored-password',
      currentPassword: STORED_PASSWORD,
    });

    expect(outcome.effect).toEqual({ kind: 'describe-stored', password: STORED_PASSWORD });
    expect(outcome.state.showingExisting).toBe(true);
    expect(outcome.state.hasPreview).toBe(true);
  });

  it('regenerates when the recipe changes even while an account password is displayed', () => {
    let state = createPasswordPreviewState(base);
    state = reducePasswordPreview(state, {
      type: 'stored-password',
      currentPassword: STORED_PASSWORD,
    }).state;

    const outcome = reducePasswordPreview(state, {
      type: 'options-changed',
      options: withoutSymbols,
    });

    expect(outcome.effect.kind).toBe('generate');
    expect(outcome.effect.kind === 'generate' && outcome.effect.options).toEqual(withoutSymbols);
    expect(outcome.state.showingExisting).toBe(false);
  });

  it('never falls back to the stored account password after a manual generation', () => {
    let state = createPasswordPreviewState(base);
    state = reducePasswordPreview(state, { type: 'user-generate', options: base }).state;

    const outcome = reducePasswordPreview(state, {
      type: 'options-changed',
      options: withoutSymbols,
    });

    expect(outcome.effect.kind).toBe('generate');
    expect(outcome.effect.kind === 'generate' && outcome.effect.options).toEqual(withoutSymbols);
  });

  it('keeps a manually generated password when the account password changes later', () => {
    let state = createPasswordPreviewState(base);
    state = reducePasswordPreview(state, { type: 'user-generate', options: base }).state;

    const outcome = reducePasswordPreview(state, {
      type: 'stored-password',
      currentPassword: 'rotated-account-password',
    });

    expect(outcome.effect.kind).toBe('none');
    expect(outcome.state.showingExisting).toBe(false);
  });

  it('generates a first password when no account password exists', () => {
    const state = createPasswordPreviewState(base);
    const outcome = reducePasswordPreview(state, { type: 'options-changed', options: base });

    expect(outcome.effect.kind).toBe('generate');
  });

  it('does not regenerate for an unchanged recipe', () => {
    let state = createPasswordPreviewState(base);
    state = reducePasswordPreview(state, {
      type: 'stored-password',
      currentPassword: STORED_PASSWORD,
    }).state;

    const outcome = reducePasswordPreview(state, { type: 'options-changed', options: { ...base } });

    expect(outcome.effect.kind).toBe('none');
  });

  it('keeps the stored account password when the saved recipe is restored', () => {
    let state = createPasswordPreviewState(base);
    state = reducePasswordPreview(state, {
      type: 'stored-password',
      currentPassword: STORED_PASSWORD,
    }).state;

    const restored: PasswordOptions = { ...base, length: 32 };
    const outcome = reducePasswordPreview(state, { type: 'recipe-restored', options: restored });

    expect(outcome.effect.kind).toBe('none');
    expect(outcome.state.baselineOptions).toEqual(restored);
  });

  it('compares recipes by value', () => {
    expect(arePasswordOptionsEqual(base, { ...base })).toBe(true);
    expect(arePasswordOptionsEqual(base, withoutSymbols)).toBe(false);
    expect(arePasswordOptionsEqual(base, { ...base, length: base.length + 1 })).toBe(false);
  });
});

describe('password tab regeneration', () => {
  it('regenerates the preview when an option changes while an account password exists', async () => {
    mockGenerator();
    await mount(renderGenerator(STORED_PASSWORD));

    await revealPassword();
    expect(revealedPassword()).toBe(STORED_PASSWORD);
    // Mounting describes the stored password; it must not kick off a
    // background generation that would replace it.
    expect(safeSendMessage).not.toHaveBeenCalled();

    // Toggling a character set must produce a new preview, not the saved one.
    await clickButton('Symbols');
    expect(revealedPassword()).toBe('generated-1');
    expect(revealedPassword()).not.toBe(STORED_PASSWORD);
  });

  it('regenerates the preview when the length slider moves', async () => {
    mockGenerator();
    await mount(renderGenerator(STORED_PASSWORD));

    await revealPassword();
    expect(revealedPassword()).toBe(STORED_PASSWORD);

    const slider = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) {
      throw new Error('Length slider not found');
    }
    // React tracks the input value, so the native setter has to be used for
    // the change event to be seen as a user edit.
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    await act(async () => {
      nativeValueSetter?.call(slider, '32');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The slider syncs into the recipe after a short debounce.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(revealedPassword()).toBe('generated-1');
    expect(revealedPassword()).not.toBe(STORED_PASSWORD);
  });

  it('does not revert a manually generated password when an option changes', async () => {
    mockGenerator();
    await mount(renderGenerator(STORED_PASSWORD));

    await revealPassword();
    await clickButton('Generate again');
    expect(revealedPassword()).toBe('generated-1');

    await clickButton('Numbers');
    expect(revealedPassword()).toBe('generated-2');
    expect(revealedPassword()).not.toBe(STORED_PASSWORD);
  });

  it('keeps a manually generated password when the account password changes', async () => {
    mockGenerator();
    const { root } = await mount(renderGenerator(STORED_PASSWORD));

    await revealPassword();
    await clickButton('Generate again');
    expect(revealedPassword()).toBe('generated-1');

    await act(async () => {
      root.render(renderGenerator('rotated-account-password'));
    });

    expect(revealedPassword()).toBe('generated-1');
    expect(revealedPassword()).not.toBe('rotated-account-password');
  });
});
