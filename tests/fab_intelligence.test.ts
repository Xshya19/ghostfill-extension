import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateFab,
  collectFieldEvidence,
  isAppSurfaceHost,
  AUTH_PATH_RE,
} from '../src/content/fab/fabVisibilityGate';
import { HostPolicyStore, type StorageAdapter } from '../src/content/fab/fabHostPolicy';
import { FabAnchor } from '../src/content/fab/fabAnchor';
import { SmartFabPresenter } from '../src/content/fab/index';
import { shouldDecorateField } from '../src/shared/fieldClassifier';

describe('FAB Intelligence Layer', () => {
  describe('fabVisibilityGate — Hard Blocks', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('blocks search fields by role, type, name, or content', () => {
      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      document.body.appendChild(searchInput);
      expect(evaluateFab(searchInput).presence).toBe('hidden');
      expect(evaluateFab(searchInput).blockedBy).toBe('excluded-input-type');

      const textSearch = document.createElement('input');
      textSearch.type = 'text';
      textSearch.name = 'q';
      document.body.appendChild(textSearch);
      // Give mock dimensions
      vi.spyOn(textSearch, 'getBoundingClientRect').mockReturnValue({
        width: 150,
        height: 32,
        top: 0,
        left: 0,
        right: 150,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      expect(evaluateFab(textSearch).presence).toBe('hidden');
      expect(evaluateFab(textSearch).blockedBy).toBe('search-field');
    });

    it('blocks textareas without credential autocomplete', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
        width: 300,
        height: 100,
        top: 0,
        left: 0,
        right: 300,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(textarea);
      expect(decision.presence).toBe('hidden');
      expect(decision.blockedBy).toBe('content-field');
    });

    it('blocks rich-text contenteditable and role="textbox" editors without credential autocomplete', () => {
      const editor = document.createElement('div');
      editor.contentEditable = 'true';
      document.body.appendChild(editor);
      vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({
        width: 500,
        height: 400,
        top: 0,
        left: 0,
        right: 500,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(editor);
      expect(decision.presence).toBe('hidden');
      expect(decision.blockedBy).toBe('rich-text-editor');
    });

    it('blocks excluded input types (checkbox, radio, hidden, etc.)', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);
      expect(evaluateFab(checkbox).blockedBy).toBe('excluded-input-type');

      const button = document.createElement('input');
      button.type = 'button';
      document.body.appendChild(button);
      expect(evaluateFab(button).blockedBy).toBe('excluded-input-type');
    });

    it('blocks disabled and read-only inputs', () => {
      const disabledInput = document.createElement('input');
      disabledInput.type = 'text';
      disabledInput.disabled = true;
      document.body.appendChild(disabledInput);
      expect(evaluateFab(disabledInput).blockedBy).toBe('field-not-editable');

      const readonlyInput = document.createElement('input');
      readonlyInput.type = 'text';
      readonlyInput.readOnly = true;
      document.body.appendChild(readonlyInput);
      expect(evaluateFab(readonlyInput).blockedBy).toBe('field-not-editable');
    });

    it('blocks payment, address, and promo fields', () => {
      const cardField = document.createElement('input');
      cardField.type = 'text';
      cardField.name = 'credit_card_number';
      document.body.appendChild(cardField);
      vi.spyOn(cardField, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 32,
        top: 0,
        left: 0,
        right: 200,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      expect(evaluateFab(cardField).blockedBy).toBe('payment-field');

      const addressField = document.createElement('input');
      addressField.type = 'text';
      addressField.name = 'postal_code';
      document.body.appendChild(addressField);
      vi.spyOn(addressField, 'getBoundingClientRect').mockReturnValue({
        width: 100,
        height: 32,
        top: 0,
        left: 0,
        right: 100,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      expect(evaluateFab(addressField).blockedBy).toBe('address-field');

      const promoField = document.createElement('input');
      promoField.type = 'text';
      promoField.name = 'coupon_code';
      document.body.appendChild(promoField);
      vi.spyOn(promoField, 'getBoundingClientRect').mockReturnValue({
        width: 120,
        height: 32,
        top: 0,
        left: 0,
        right: 120,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      expect(evaluateFab(promoField).blockedBy).toBe('promo-field');
    });

    it('blocks app surfaces (Docs, Slack, WhatsApp) unless on auth page or with credential contract', () => {
      expect(isAppSurfaceHost('docs.google.com')).toBe(true);
      expect(isAppSurfaceHost('slack.com')).toBe(true);
      expect(isAppSurfaceHost('web.whatsapp.com')).toBe(true);
      expect(isAppSurfaceHost('github.com')).toBe(false);

      const field = document.createElement('input');
      field.type = 'text';
      field.name = 'title';
      document.body.appendChild(field);
      vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 32,
        top: 0,
        left: 0,
        right: 200,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(field, {
        hostname: 'docs.google.com',
        href: 'https://docs.google.com/document/d/123/edit',
      });
      expect(decision.presence).toBe('hidden');
      expect(decision.blockedBy).toBe('host-app-surface');
    });

    it('allows app surface if URL has auth intent or input is explicit credential', () => {
      const pwd = document.createElement('input');
      pwd.type = 'password';
      document.body.appendChild(pwd);
      vi.spyOn(pwd, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 32,
        top: 0,
        left: 0,
        right: 200,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(pwd, {
        hostname: 'slack.com',
        href: 'https://slack.com/signin',
      });
      expect(decision.presence).toBe('active');
      expect(decision.mode).toBe('password');
    });
  });

  describe('fabVisibilityGate — High-Confidence Auth Fields & Presence', () => {
    beforeEach(() => {
      document.body.innerHTML = '';
    });

    it('evaluates password fields as active presence and password mode', () => {
      const pwd = document.createElement('input');
      pwd.type = 'password';
      document.body.appendChild(pwd);
      vi.spyOn(pwd, 'getBoundingClientRect').mockReturnValue({
        width: 180,
        height: 36,
        top: 0,
        left: 0,
        right: 180,
        bottom: 36,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(pwd);
      expect(decision.presence).toBe('active');
      expect(decision.mode).toBe('password');
      expect(decision.score).toBeGreaterThanOrEqual(60);
    });

    it('evaluates one-time-code autocomplete as active OTP mode', () => {
      const otpInput = document.createElement('input');
      otpInput.type = 'text';
      otpInput.setAttribute('autocomplete', 'one-time-code');
      document.body.appendChild(otpInput);
      vi.spyOn(otpInput, 'getBoundingClientRect').mockReturnValue({
        width: 140,
        height: 36,
        top: 0,
        left: 0,
        right: 140,
        bottom: 36,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      const decision = evaluateFab(otpInput);
      expect(decision.presence).toBe('active');
      expect(decision.mode).toBe('otp');
      expect(decision.score).toBeGreaterThanOrEqual(60);
    });

    it('anchors split OTP digit boxes to their shared container', () => {
      const container = document.createElement('div');
      container.className = 'otp-group';
      for (let i = 0; i < 6; i++) {
        const digitBox = document.createElement('input');
        digitBox.type = 'text';
        digitBox.maxLength = 1;
        digitBox.inputMode = 'numeric';
        vi.spyOn(digitBox, 'getBoundingClientRect').mockReturnValue({
          width: 30,
          height: 36,
          top: 0,
          left: i * 40,
          right: i * 40 + 30,
          bottom: 36,
          x: i * 40,
          y: 0,
          toJSON: () => ({}),
        });
        container.appendChild(digitBox);
      }
      document.body.appendChild(container);

      const firstBox = container.children[0] as HTMLInputElement;
      const decision = evaluateFab(firstBox);
      expect(decision.presence).toBe('active');
      expect(decision.mode).toBe('otp');
      expect(decision.anchorElement).toBe(container);
    });

    it('delegates shouldDecorateField to evaluateFab', () => {
      const pwd = document.createElement('input');
      pwd.type = 'password';
      document.body.appendChild(pwd);
      vi.spyOn(pwd, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 32,
        top: 0,
        left: 0,
        right: 200,
        bottom: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      expect(shouldDecorateField(pwd)).toBe(true);

      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      document.body.appendChild(searchInput);
      expect(shouldDecorateField(searchInput)).toBe(false);
    });
  });

  describe('HostPolicyStore — Per-Host Learning', () => {
    it('tracks dismissals and automatically downgrades and mutes host', () => {
      const store = new HostPolicyStore();
      const host = 'annoyingsite.com';

      expect(store.snapshot(host).muted).toBe(false);
      expect(store.shouldStayQuiet(host)).toBe(false);

      // 1st dismissal
      store.recordDismiss(host);
      expect(store.shouldStayQuiet(host)).toBe(false);
      expect(store.snapshot(host).muted).toBe(false);

      // 2nd dismissal -> stays quiet
      store.recordDismiss(host);
      expect(store.shouldStayQuiet(host)).toBe(true);
      expect(store.snapshot(host).muted).toBe(false);

      // 4th dismissal -> auto-mutes for 30 days
      store.recordDismiss(host);
      store.recordDismiss(host);
      expect(store.snapshot(host).muted).toBe(true);
      expect(store.snapshot(host).dismissals).toBe(4);

      // recordAccept wipes slate
      store.recordAccept(host);
      expect(store.snapshot(host).muted).toBe(false);
      expect(store.snapshot(host).dismissals).toBe(0);
      expect(store.snapshot(host).accepts).toBe(1);
      expect(store.shouldStayQuiet(host)).toBe(false);
    });

    it('supports explicit mute and unmute', () => {
      const store = new HostPolicyStore();
      const host = 'example.org';

      store.mute(host);
      expect(store.snapshot(host).muted).toBe(true);

      store.unmute(host);
      expect(store.snapshot(host).muted).toBe(false);
    });

    it('persists policy state using storage adapter', async () => {
      let savedData: Record<string, unknown> = {};
      const mockStorage: StorageAdapter = {
        async get(key: string) {
          return savedData[key];
        },
        async set(key: string, value: unknown) {
          savedData[key] = value;
        },
      };

      const store = new HostPolicyStore(mockStorage);
      await store.load();
      store.recordDismiss('site1.com');
      store.mute('site2.com');

      expect(store.snapshot('site1.com').dismissals).toBe(1);
      expect(store.snapshot('site2.com').muted).toBe(true);
    });
  });

  describe('AUTH_PATH_RE', () => {
    it('detects common authentication URL routes', () => {
      expect(AUTH_PATH_RE.test('https://example.com/login')).toBe(true);
      expect(AUTH_PATH_RE.test('https://example.com/sign-in')).toBe(true);
      expect(AUTH_PATH_RE.test('https://example.com/auth/oauth/callback')).toBe(true);
      expect(AUTH_PATH_RE.test('https://example.com/checkout/guest')).toBe(true);
      expect(AUTH_PATH_RE.test('https://example.com/2fa/verify')).toBe(true);
      expect(AUTH_PATH_RE.test('https://example.com/blog/article-about-cats')).toBe(false);
      expect(AUTH_PATH_RE.test('https://example.com/products/shoes')).toBe(false);
    });
  });

  describe('FabAnchor', () => {
    it('positions inside-right when input is wide enough', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const input = document.createElement('input');
      document.body.appendChild(input);
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 200,
        width: 300,
        height: 40,
        right: 400,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      });

      let placed: any = null;
      const anchor = new FabAnchor({
        host,
        size: 32,
        onPlace: (p) => {
          placed = p;
        },
        onHide: () => {},
      });

      anchor.attach(input);
      expect(placed).not.toBeNull();
      expect(placed?.placement).toBe('inside-right');
      anchor.destroy();
    });

    it('reports field-hidden if field has 0 dimensions', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);

      const input = document.createElement('input');
      document.body.appendChild(input);
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

      let hideReason: string | null = null;
      const anchor = new FabAnchor({
        host,
        size: 32,
        onPlace: () => {},
        onHide: (reason) => {
          hideReason = reason;
        },
      });

      anchor.attach(input);
      expect(hideReason).toBe('field-hidden');
      anchor.destroy();
    });
  });

  describe('SmartFabPresenter', () => {
    it('shows on focusin for auth fields and cleans up on dismiss', () => {
      vi.useFakeTimers();
      const host = document.createElement('div');
      document.body.appendChild(host);

      const pwd = document.createElement('input');
      pwd.type = 'password';
      document.body.appendChild(pwd);
      vi.spyOn(pwd, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 100,
        width: 200,
        height: 40,
        right: 300,
        bottom: 140,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      let shown = false;
      let hiddenCause: string | null = null;

      const store = new HostPolicyStore();
      const presenter = new SmartFabPresenter({
        host,
        policy: store,
        focusDebounceMs: 10,
        blurGraceMs: 50,
        gateOptions: () => ({ enabled: true }),
        onShow: () => {
          shown = true;
        },
        onPlace: () => {},
        onHide: (cause) => {
          hiddenCause = cause;
        },
      });

      presenter.handleFocusIn(pwd);
      vi.advanceTimersByTime(20);
      expect(shown).toBe(true);

      // Dismiss records host dismissal
      presenter.dismiss();
      expect(hiddenCause).toBe('dismissed');
      expect(store.snapshot(location.hostname).dismissals).toBe(1);

      presenter.destroy();
      vi.useRealTimers();
    });

    it('respects blur grace period before hiding', () => {
      vi.useFakeTimers();
      const host = document.createElement('div');
      document.body.appendChild(host);

      const pwd = document.createElement('input');
      pwd.type = 'password';
      document.body.appendChild(pwd);
      vi.spyOn(pwd, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 100,
        width: 200,
        height: 40,
        right: 300,
        bottom: 140,
        x: 100,
        y: 100,
        toJSON: () => ({}),
      });

      let hiddenCause: string | null = null;
      const presenter = new SmartFabPresenter({
        host,
        focusDebounceMs: 10,
        blurGraceMs: 100,
        gateOptions: () => ({ enabled: true }),
        onShow: () => {},
        onPlace: () => {},
        onHide: (cause) => {
          hiddenCause = cause;
        },
      });

      presenter.handleFocusIn(pwd);
      vi.advanceTimersByTime(20);

      // Blur the field
      const blurEvent = new FocusEvent('focusout');
      Object.defineProperty(blurEvent, 'relatedTarget', { value: null });
      presenter.handleFocusOut(blurEvent);

      // Within grace period, not yet hidden
      vi.advanceTimersByTime(50);
      expect(hiddenCause).toBeNull();

      // Grace period expires
      vi.advanceTimersByTime(60);
      expect(hiddenCause).toBe('blur');

      presenter.destroy();
      vi.useRealTimers();
    });
  });
});
