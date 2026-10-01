import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AutoFiller } from '../src/content/autoFiller';
import { FloatingButton } from '../src/content/floatingButton';
import { GhostLabel } from '../src/content/ui/GhostLabel';
import * as theme from '../src/shared/theme';

let fab: FloatingButton;
let ui: {
  button: HTMLButtonElement;
  tooltip: HTMLDivElement;
  hasOTPReady: boolean;
  isWaitingForOTP: boolean;
  createContainer: () => void;
  setMode: (mode: string) => void;
};
let field: HTMLInputElement;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML =
    '<label for="email">Email address</label><input id="email" type="email">';
  field = document.querySelector('input')!;
  field.focus();
  fab = new FloatingButton({} as AutoFiller);
  ui = fab as unknown as typeof ui;
  ui.createContainer();
  ui.setMode('email');
  fab.showNearField(field);
});

afterEach(() => {
  fab.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

it('shows a short hint only after hover and clears it on leave, early leave, or hide', () => {
  vi.advanceTimersByTime(500);
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(false);
  ui.button.dispatchEvent(new MouseEvent('mouseenter'));
  vi.advanceTimersByTime(400);
  expect(ui.tooltip.textContent).toBe('Fill email address');
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(true);
  ui.button.dispatchEvent(new MouseEvent('mouseleave'));
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(false);

  ui.button.dispatchEvent(new MouseEvent('mouseenter'));
  ui.button.dispatchEvent(new MouseEvent('mouseleave'));
  vi.advanceTimersByTime(500);
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(false);
  ui.button.dispatchEvent(new MouseEvent('mouseenter'));
  fab.hide();
  vi.advanceTimersByTime(500);
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(false);
});

it('keeps OTP readiness off email fields and uses no exclamation badge on code fields', () => {
  ui.hasOTPReady = true;
  fab.showNearField(field);
  expect(ui.button.querySelector('.gf-badge')).toBeNull();
  expect(ui.button.classList.contains('gf-otp-armed')).toBe(false);
  expect(ui.button.getAttribute('aria-label')).not.toContain('OTP ready');
  ui.setMode('otp');
  fab.showNearField(field);
  expect(ui.button.querySelector('.gf-badge')).toBeNull();
  expect(ui.button.classList.contains('gf-otp-armed')).toBe(true);
  expect(ui.button.getAttribute('aria-label')).toContain('OTP ready');
});

it('offers the contextual hint on keyboard focus and clears it on blur', () => {
  vi.spyOn(ui.button, 'matches').mockImplementation((selector) => selector === ':focus-visible');
  ui.button.dispatchEvent(new FocusEvent('focus'));
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(true);
  expect(ui.button.getAttribute('aria-label')).toContain('Arrow Down');
  ui.button.dispatchEvent(new FocusEvent('blur'));
  expect(ui.tooltip.classList.contains('gf-tooltip-visible')).toBe(false);
});

it('shows one control per field and restores the inline control when the floating control closes', async () => {
  vi.spyOn(theme, 'initTheme').mockReturnValue(() => {});
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 100,
    right: 400,
    bottom: 148,
    width: 300,
    height: 48,
    x: 100,
    y: 100,
    toJSON: () => ({}),
  });
  const inline = new GhostLabel();
  document.body.appendChild(inline);
  inline.attachToAttribute(field, () => {});
  await vi.advanceTimersByTimeAsync(25);
  expect(inline.style.display).toBe('none');
  fab.hide();
  await vi.advanceTimersByTimeAsync(25);
  expect(inline.style.display).toBe('block');
  fab.showNearField(field);
  await vi.advanceTimersByTimeAsync(25);
  expect(inline.style.display).toBe('none');
  fab.destroy();
  await vi.advanceTimersByTimeAsync(25);
  expect(inline.style.display).toBe('block');
});
