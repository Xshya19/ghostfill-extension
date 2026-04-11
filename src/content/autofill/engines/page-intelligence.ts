import { FrameworkType, PageContext } from '../../../types/form.types';
import { OTP_PATTERNS, OTP_CONSTANTS } from '../../../utils/otp-detection-core';
import { safeQuerySelector, safeQuerySelectorAll } from '../utils/dom-utils';

/**
 * PAGE INTELLIGENCE ENGINE
 * Analyzes the current page to determine context (login, signup, verification, etc.)
 */
export class PageIntelligence {
  private static readonly SCAN_LIMIT = 3000;
  private static readonly OTP_LANGUAGE_PATTERNS: readonly RegExp[] = [
    /otp|one[-_\s]?time|verification[-_\s]?code|security[-_\s]?code|pin[-_\s]?code/i,
    /\d[- ]?digit\s*code|enter\s*code|paste\s*code/i,
  ];

  static analyze(): PageContext {
    const url = window.location.href.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.textContent ?? '').slice(0, this.SCAN_LIMIT).toLowerCase();
    const metaContent = safeQuerySelectorAll<HTMLMetaElement>(document, 'meta')
      .map((m) => (m.getAttribute('content') ?? '').toLowerCase())
      .join(' ');

    const combinedText = `${url} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];

    // ── Page Type Detection (Centralized) ──────────────────
    const pageTypes: Record<string, boolean> = {};
    for (const type of OTP_PATTERNS.PAGE_TYPES as any[]) {
      let matched = false;
      for (const pattern of type.patterns) {
        if (pattern.test(combinedText)) {
          matched = true;
          signals.push(type.signal);
          break;
        }
      }
      pageTypes[type.key] = matched;
    }

    // ── OTP Language Detection ─────────────────────────────
    let hasOTPLanguage = false;
    for (const pattern of this.OTP_LANGUAGE_PATTERNS) {
      if (pattern.test(combinedText)) {
        hasOTPLanguage = true;
        signals.push('page:otp-language');
        break;
      }
    }

    // ── Expected OTP Length Detection ──────────────────────
    let expectedOTPLength: number | null = null;
    const lengthMatch = bodyText.match(/(\d)[- ]?digit\s*(code|otp|pin|number)/i);
    if (lengthMatch?.[1]) {
      const parsed = parseInt(lengthMatch[1], 10);
      if (parsed >= OTP_CONSTANTS.MIN_OTP_LENGTH && parsed <= OTP_CONSTANTS.MAX_OTP_LENGTH) {
        expectedOTPLength = parsed;
        signals.push(`page:expected-length-${expectedOTPLength}`);
      }
    }

    // ── Framework & Provider ─────────────────────────────
    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);
    const provider = this.detectProvider(url, bodyText);
    if (provider) {
      signals.push(`provider:${provider}`);
    }

    return Object.freeze({
      isVerificationPage: !!pageTypes['isVerificationPage'],
      isLoginPage: !!pageTypes['isLoginPage'],
      isSignupPage: !!pageTypes['isSignupPage'],
      isPasswordResetPage: !!pageTypes['isPasswordResetPage'],
      is2FAPage: !!pageTypes['is2FAPage'],
      framework,
      hasOTPLanguage,
      expectedOTPLength,
      provider,
      pageSignals: Object.freeze(signals),
    });
  }

  static detectFramework(): FrameworkType {
    try {
      // ── React / Next.js ───────────────────────────────────────────────────
      if (safeQuerySelector(document, '[data-reactroot]')) {
        return 'react';
      }
      const rootEl = document.getElementById('root');
      if (
        rootEl &&
        Object.keys(rootEl).some(
          (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternals')
        )
      ) {
        return 'react';
      }
      // Next.js Pages Router
      if (document.getElementById('__NEXT_DATA__')) {
        return 'react';
      }
      // Next.js App Router
      if (safeQuerySelector(document, '[data-nextjs-scroll-focus-boundary]')) {
        return 'react';
      }
      // Fallback: common React root ids
      if (
        document.getElementById('root') ||
        document.getElementById('__next') ||
        document.getElementById('app')
      ) {
        // Confirm it actually has a React internal key before committing
        const root =
          document.getElementById('root') ??
          document.getElementById('__next') ??
          document.getElementById('app');
        if (
          root &&
          Object.keys(root).some(
            (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
          )
        ) {
          return 'react';
        }
      }

      // ── Vue ───────────────────────────────────────────────────────────────
      // Vue 3: __vue_app__ is set on the mount element
      if (
        safeQuerySelector(document, '[__vue_app__]') ||
        safeQuerySelector(document, '[data-v-app]')
      ) {
        return 'vue';
      }
      // Vue 2: __vue__ is set on elements managed by Vue
      const vueEl = safeQuerySelector(document, '#app, #vue-app, [id^="vue"]');
      if (vueEl && ('__vue__' in vueEl || '__vue_app__' in vueEl)) {
        return 'vue';
      }

      // ── Angular ──────────────────────────────────────────────────────────
      if (
        safeQuerySelector(document, '[ng-version]') ||
        safeQuerySelector(document, '[_nghost-ng-c]') ||
        safeQuerySelector(document, '[ng-app]') ||
        safeQuerySelector(document, 'app-root, [_nghost]')
      ) {
        return 'angular';
      }

      // ── Svelte ────────────────────────────────────────────────────────────
      if (safeQuerySelector(document, '[data-svelte-h]') || '__svelte' in window) {
        return 'vue'; // treat Svelte like Vue for event purposes
      }
    } catch {
      /* ignore */
    }
    return 'unknown';
  }

  private static detectProvider(url: string, text: string): string | null {
    for (const [pattern, name] of OTP_PATTERNS.PROVIDERS as any[]) {
      if (pattern.test(url) || pattern.test(text)) {
        return name;
      }
    }
    return null;
  }
}
