// ═══════════════════════════════════════════════════════════════════════════════
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  🌌  G H O S T F I L L   3 . 0  —  F L O A T I N G   B U T T O N    ║
// ║  Spatial FAB · Context-Aware · Accessible · Framework-Smart           ║
// ║  World-class immersive micro-interaction system                       ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// Architecture Notes:
// ┌────────────────────────────────────────────────────────────────────────┐
// │  PageAnalyzer    — Deep page intelligence (type, provider, framework) │
// │  FieldContext    — Per-field mode detection & filtering               │
// │  SmartPositioner — Collision-aware spatial placement engine           │
// │  ContextualMenu  — Dynamic action builder based on page context       │
// │  IconSystem      — SVG icon library with gradient support             │
// │  FloatingButton  — State machine, DOM, events, lifecycle (exported)   │
// └────────────────────────────────────────────────────────────────────────┘
// ═══════════════════════════════════════════════════════════════════════════════

import {
  GenerateEmailResponse,
  GeneratePasswordResponse,
  GetLastOTPResponse,
} from '../types';
import { TIMING } from '../utils/constants';
import { debounce } from '../utils/debounce';
import { createLogger } from '../utils/logger';
import { safeSendMessage } from '../utils/messaging';
import { AutoFiller } from './autoFiller';
import { pageStatus } from './pageStatus';

const log = createLogger('FloatingButton');


// ═══════════════════════════════════════════════════════════════
//  §1  T Y P E   D E F I N I T I O N S
// ═══════════════════════════════════════════════════════════════

type ButtonState =
  | 'hidden'
  | 'idle'
  | 'hovering'
  | 'loading'
  | 'success'
  | 'error'
  | 'dragging'
  | 'menu-open';

type ButtonMode =
  | 'magic'
  | 'email'
  | 'password'
  | 'otp'
  | 'user'
  | 'form';

type ButtonSize = 'mini' | 'normal' | 'expanded';

type PageType =
  | 'login'
  | 'signup'
  | 'verification'
  | '2fa'
  | 'password-reset'
  | 'checkout'
  | 'profile'
  | 'generic-form'
  | 'non-auth';

interface MenuAction {
  id: string;
  icon: string;
  label: string;
  shortcut?: string;
  visible: boolean;
  handler: () => Promise<void>;
}

interface PositionConfig {
  left: number;
  top: number;
  placement: 'inside-right' | 'outside-right' | 'outside-left' | 'below';
}

interface PageAnalysis {
  pageType: PageType;
  hasEmailField: boolean;
  hasPasswordField: boolean;
  hasOTPField: boolean;
  hasNameFields: boolean;
  formCount: number;
  inputCount: number;
  isAuthRelated: boolean;
  provider: string | null;
  framework: string;
  signals: string[];
}


// ═══════════════════════════════════════════════════════════════
//  §2  P A G E   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

class PageAnalyzer {

  private static readonly PROVIDER_MAP: ReadonlyArray<[RegExp, string]> = [
    // Modern SaaS Auth
    [/clerk\.(dev|com)/i, 'Clerk'],
    [/auth0\.com/i, 'Auth0'],
    [/supabase/i, 'Supabase'],
    [/firebase/i, 'Firebase'],
    [/cognito|amazonaws/i, 'AWS Cognito'],
    [/okta/i, 'Okta'],
    [/ory\.|kratos/i, 'Ory Kratos'],
    [/stytch/i, 'Stytch'],
    [/keycloak/i, 'Keycloak'],
    [/supertokens/i, 'SuperTokens'],
    [/magic\.link/i, 'Magic Link'],
    [/workos/i, 'WorkOS'],
    [/kinde/i, 'Kinde Auth'],
    [/logto/i, 'Logto'],
    [/b2c\.login\.microsoft/i, 'Azure B2C'],
    [/auth\.pingidentity/i, 'Ping Identity'],

    // Developer / Productivity
    [/github\.com/i, 'GitHub'],
    [/gitlab/i, 'GitLab'],
    [/bitbucket/i, 'Bitbucket'],
    [/slack\.com/i, 'Slack'],
    [/discord\.com|discordapp\.com/i, 'Discord'],
    [/linear\.app/i, 'Linear'],
    [/notion\.so/i, 'Notion'],
    [/vercel\.com/i, 'Vercel'],
    [/netlify\.com/i, 'Netlify'],

    // E-commerce & Finance
    [/stripe/i, 'Stripe'],
    [/paypal/i, 'PayPal'],
    [/shopify/i, 'Shopify'],
    [/amazon/i, 'Amazon'],
    [/paddle/i, 'Paddle'],

    // Big Tech & SSO
    [/mistral/i, 'Mistral'],
    [/microsoft|login\.live/i, 'Microsoft'],
    [/google.*accounts/i, 'Google'],
    [/apple\.com.*appleid/i, 'Apple ID'],
    [/linkedin\.com/i, 'LinkedIn'],
    [/x\.com|twitter\.com/i, 'X (Twitter)'],
  ];

  static analyze(): PageAnalysis {
    const url = window.location.href.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.innerText || '').slice(0, 3000).toLowerCase();
    const metaContent = Array.from(document.querySelectorAll('meta'))
      .map(m => (m.getAttribute('content') || '').toLowerCase())
      .join(' ');
    const combined = `${url} ${path} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];

    // ── Field detection ───────────────────────────────────
    const hasEmailField = !!document.querySelector(
      'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete*="email"]',
    );
    const hasPasswordField = !!document.querySelector('input[type="password"]');
    const hasOTPField = !!document.querySelector(
      'input[autocomplete="one-time-code"], input[name*="otp" i], input[name="code"], ' +
      'input[id*="otp" i], input[maxlength="1"][type="text"], input[maxlength="1"][type="tel"], ' +
      'input[maxlength="4"], input[maxlength="6"], input[maxlength="8"]',
    );
    const hasNameFields = !!document.querySelector(
      'input[name*="name" i]:not([name*="user" i]), input[autocomplete="given-name"], input[autocomplete="family-name"]',
    );

    const formCount = document.querySelectorAll('form').length;
    const inputCount = document.querySelectorAll('input:not([type="hidden"])').length;

    // ── Page-type classification ──────────────────────────
    const pageType = this.classifyPage(combined, hasOTPField, hasPasswordField, hasEmailField, signals);

    // ── Provider detection ────────────────────────────────
    const provider = this.detectProvider(url, signals);

    // ── Framework detection ───────────────────────────────
    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);

    return {
      pageType,
      hasEmailField,
      hasPasswordField,
      hasOTPField,
      hasNameFields,
      formCount,
      inputCount,
      isAuthRelated: pageType !== 'non-auth',
      provider,
      framework,
      signals,
    };
  }

  private static classifyPage(
    combined: string,
    hasOTPField: boolean,
    hasPasswordField: boolean,
    hasEmailField: boolean,
    signals: string[],
  ): PageType {
    // Verification / 2FA (highest priority)
    if (
      /verify|verification|confirm.*email|activate.*account|enter.*code|one[- ]?time|otp|self[- ]?service.*verification/.test(combined)
      || hasOTPField
    ) {
      const type = /two[- ]?factor|2fa|mfa|authenticat.*code|security.*code/.test(combined)
        ? '2fa' as const
        : 'verification' as const;
      signals.push(`page:${type}`);
      return type;
    }

    // Password reset
    if (/reset.*password|forgot.*password|recover|new.*password|change.*password/.test(combined)) {
      signals.push('page:password-reset');
      return 'password-reset';
    }

    // Signup
    if (/sign\s*up|register|create\s*account|get\s*started|join\s*(us|now|free)|enroll/.test(combined)) {
      signals.push('page:signup');
      return 'signup';
    }

    // Login
    if (/sign\s*in|log\s*in|login|authenticate/.test(combined)) {
      signals.push('page:login');
      return 'login';
    }

    // Checkout
    if (/checkout|billing|payment|subscribe|purchase/.test(combined)) {
      signals.push('page:checkout');
      return 'checkout';
    }

    // Profile
    if (/profile|settings|account\s*settings|edit\s*profile|preferences/.test(combined)) {
      signals.push('page:profile');
      return 'profile';
    }

    // Generic form
    if (hasPasswordField || hasEmailField) {
      signals.push('page:generic-form');
      return 'generic-form';
    }

    return 'non-auth';
  }

  private static detectProvider(url: string, signals: string[]): string | null {
    for (const [pattern, name] of this.PROVIDER_MAP) {
      if (pattern.test(url)) {
        signals.push(`provider:${name}`);
        return name;
      }
    }
    return null;
  }

  private static detectFramework(): string {
    // React (Next.js config / fiber check)
    const testEl = document.querySelector('input') || document.querySelector('div');
    if (
      testEl &&
      Object.keys(testEl).some(k => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$'))
    ) {
      return 'react';
    }
    // Next.js specific SSR markers
    if (document.querySelector('script[id="__NEXT_DATA__"]')) return 'nextjs';

    // Vue (Nuxt)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (document.querySelector('[data-v-]') || (document as any).__vue_app__) {
      return 'vue';
    }

    // Angular
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (document.querySelector('[ng-version]') || (window as any).ng) {
      return 'angular';
    }

    // Svelte (SvelteKit)
    if (document.querySelector('[class*="svelte-"]') || document.querySelector('script[type="svelte-data"]')) {
      return 'svelte';
    }

    // SolidJS
    if (document.querySelector('[data-hk]') || (window as any)._$HY) {
      return 'solid';
    }

    // HTMX
    if (document.querySelector('[hx-get], [hx-post], [hx-trigger]')) {
      return 'htmx';
    }

    // Qwik
    if (document.querySelector('[q\\:container], [q\\:id]')) {
      return 'qwik';
    }

    return 'unknown';
  }
}


// ═══════════════════════════════════════════════════════════════
//  §3  F I E L D   C O N T E X T   A N A L Y Z E R
// ═══════════════════════════════════════════════════════════════

class FieldContext {

  private static readonly EXCLUDED_TYPES = new Set([
    'hidden', 'submit', 'button', 'reset', 'checkbox',
    'radio', 'file', 'image', 'range', 'color',
  ]);

  private static readonly TOOLTIPS: Readonly<Record<ButtonMode, string>> = {
    magic: 'GhostFill — Auto-fill this form',
    email: 'Fill email address',
    password: 'Fill password',
    otp: 'Paste verification code',
    user: 'Fill name',
    form: 'Auto-fill entire form',
  };

  static getMode(field: HTMLElement): ButtonMode {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      return 'magic';
    }

    const input = field as HTMLInputElement;
    const type = (input.type || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const autocomplete = (input.autocomplete || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const label = this.findLabelText(input).toLowerCase();
    const combined = `${type} ${name} ${id} ${placeholder} ${autocomplete} ${ariaLabel} ${label}`;
    const nameId = name + id;

    // OTP / Code
    if (autocomplete === 'one-time-code') { return 'otp'; }
    if (/otp|one[-_]?time|verification[-_]?code|passcode|security[-_]?code/.test(combined)) { return 'otp'; }
    if (/^(code|pin|token)$/.test(name) || /^(code|pin|token)$/.test(id)) { return 'otp'; }
    if (input.maxLength >= 1 && input.maxLength <= 8 && /digit|code|pin/.test(combined)) { return 'otp'; }
    if (input.inputMode === 'numeric' && input.maxLength >= 4 && input.maxLength <= 8) { return 'otp'; }

    // Email
    if (type === 'email') { return 'email'; }
    if (/e[-_]?mail/.test(nameId) || /email/.test(label)) { return 'email'; }
    if (/@/.test(placeholder)) { return 'email'; }

    // Password
    if (type === 'password') { return 'password'; }
    if (/password|passwd|pwd/.test(nameId)) { return 'password'; }

    // Username → email icon
    if (/user[-_]?name|login[-_]?name|login[-_]?id/.test(nameId)) { return 'email'; }
    if (autocomplete === 'username') { return 'email'; }

    // Credit Card Fields
    if (/card[-_]?number|cvc|cvv|ccv|expiration|expiry/.test(combined)) { return 'magic'; }
    if (autocomplete === 'cc-number' || autocomplete === 'cc-csc') { return 'magic'; }

    // Search Fields
    if (type === 'search' || /search|query|keyword/.test(combined)) { return 'magic'; }

    // Name fields
    if (/first[-_]?name|last[-_]?name|full[-_]?name|given[-_]?name|family[-_]?name|surname|display[-_]?name/.test(nameId)) { return 'user'; }
    if (/name/.test(nameId) && !/user/.test(nameId) && !/company/.test(nameId)) { return 'user'; }

    // Address fields
    if (/street|address|city|country|state|zip|postal/.test(combined)) { return 'magic'; }

    return 'magic';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getTooltip(mode: ButtonMode, _pageType: PageType): string {
    return this.TOOLTIPS[mode] ?? this.TOOLTIPS.magic;
  }

  static shouldShowButton(field: HTMLElement): boolean {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) { return false; }

    const input = field as HTMLInputElement;

    if (this.EXCLUDED_TYPES.has(input.type)) { return false; }
    if (input.type === 'search') { return false; }

    const name = (input.name || input.id || input.placeholder || '').toLowerCase();
    if (/search|query|q$|filter|find/.test(name)) { return false; }

    if (input.maxLength === 1) { return false; }
    if (input.disabled || input.readOnly) { return false; }

    const rect = field.getBoundingClientRect();
    if (rect.width < 30 || rect.height < 15) { return false; }

    const style = window.getComputedStyle(field);
    if (style.display === 'none' || style.visibility === 'hidden') { return false; }

    return true;
  }

  private static findLabelText(input: HTMLElement): string {
    if (input.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
      if (label) { return label.textContent?.trim() || ''; }
    }
    const parentLabel = input.closest('label');
    if (parentLabel) { return parentLabel.textContent?.trim() || ''; }
    return input.getAttribute('aria-label') || '';
  }
}


// ═══════════════════════════════════════════════════════════════
//  §4  S M A R T   P O S I T I O N E R
// ═══════════════════════════════════════════════════════════════

class SmartPositioner {
  private static readonly MARGIN = 8;

  static calculate(field: HTMLElement, buttonSize: number): PositionConfig {
    const rect = field.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Get computed style for smarter placement
    const style = window.getComputedStyle(field);
    const paddingRight = parseFloat(style.paddingRight) || 0;

    // We want the button inside the field on the right side.
    // If a field has unusually large right padding (>24px), it usually means 
    // there's already an icon there (like a "Show Password" eye or a clear button).
    // In that case, we place GhostFill just to the left of their padding.
    const dynamicPadding = paddingRight > 24 ? paddingRight + 4 : 8;

    // Off-screen check: hide instantly if scrolled out of view
    if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) {
      return { left: -9999, top: -9999, placement: 'inside-right' };
    }

    // Base placement: vertically centered, inner right
    let left = rect.right - buttonSize - dynamicPadding;
    let top = rect.top + (rect.height - buttonSize) / 2;
    let placement: PositionConfig['placement'] = 'inside-right';

    // Collision: field too narrow to comfortably fit button inside
    if (rect.width < buttonSize + 32) {
      left = rect.right + 8; // place outside on the right
      placement = 'outside-right';

      // If placing outside right pushes it off screen, try outside left
      if (left + buttonSize > vw - 8) {
        left = rect.left - buttonSize - 8;
        placement = 'outside-left';
      }

      // If outside left ALSO pushes it off screen, put it below the field
      if (left < 8) {
        left = rect.left;
        top = rect.bottom + 8;
        placement = 'below';
      }
    }

    // Global Viewport clamping to ensure it ALWAYS stays fully on screen
    left = Math.max(8, Math.min(left, vw - buttonSize - 8));
    top = Math.max(8, Math.min(top, vh - buttonSize - 8));

    return { left, top, placement };
  }

  static calculateMenuPosition(
    buttonRect: DOMRect,
    menuWidth: number,
    menuHeight: number,
  ): { top: string; right: string; bottom: string; left: string; transformOrigin: string } {
    const vh = window.innerHeight;
    const m = this.MARGIN;

    const config = {
      top: `${buttonRect.height + 8}px`,
      right: '0',
      bottom: 'auto',
      left: 'auto',
      transformOrigin: 'top right',
    };

    if (buttonRect.bottom + menuHeight + m > vh) {
      config.top = 'auto';
      config.bottom = `${buttonRect.height + 8}px`;
      config.transformOrigin = 'bottom right';
    }

    if (buttonRect.right - menuWidth < m) {
      config.right = 'auto';
      config.left = '0';
      config.transformOrigin = config.top !== 'auto' ? 'top left' : 'bottom left';
    }

    return config;
  }
}


// ═══════════════════════════════════════════════════════════════
//  §5  C O N T E X T U A L   M E N U   B U I L D E R
// ═══════════════════════════════════════════════════════════════

class ContextualMenu {

  static buildActions(
    analysis: PageAnalysis,
    currentMode: ButtonMode,
    hasOTPReady: boolean,
  ): MenuAction[] {
    const noop = async () => { };

    const isIdentityCtx =
      currentMode === 'user' ||
      analysis.hasNameFields ||
      analysis.pageType === 'signup';

    const showOTP =
      analysis.pageType === 'verification' ||
      analysis.pageType === '2fa' ||
      analysis.hasOTPField ||
      hasOTPReady;

    const showEmail =
      analysis.hasEmailField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'login';

    const showPassword =
      analysis.hasPasswordField ||
      analysis.pageType === 'signup' ||
      analysis.pageType === 'password-reset';

    // Build the dynamic name labels based on context.
    const siteTitleMatch = document.title.match(/^([^-\|]+)/);
    const contextName = siteTitleMatch ? siteTitleMatch[1].trim() : 'Account';

    const actions: MenuAction[] = [
      { id: 'smart-fill', icon: '✨', label: `✨ Auto-fill ${contextName}`, shortcut: '⌘⇧G', visible: true, handler: noop },
      { id: 'paste-otp', icon: '🔑', label: hasOTPReady ? 'Paste Found Code' : 'Paste Code', visible: showOTP, handler: noop },
      { id: 'generate-email', icon: '📧', label: 'Use Hidden Email', visible: showEmail, handler: noop },
      { id: 'generate-password', icon: '🔐', label: 'Generate Secure Password', visible: showPassword, handler: noop },
      { id: 'fill-firstname', icon: '👤', label: 'Inject First Name', visible: isIdentityCtx, handler: noop },
      { id: 'fill-lastname', icon: '👥', label: 'Inject Last Name', visible: isIdentityCtx, handler: noop },
      { id: 'fill-fullname', icon: '📝', label: 'Inject Full Name', visible: isIdentityCtx, handler: noop },
      { id: 'fill-username', icon: '🎭', label: 'Inject Username', visible: isIdentityCtx, handler: noop },
      { id: 'clear-fields', icon: '🧹', label: 'Clear All Fields', visible: true, handler: noop },
      { id: 'divider', icon: '', label: '', visible: true, handler: noop },
      { id: 'settings', icon: '⚙️', label: 'GhostFill Settings', visible: true, handler: noop },
    ];

    return actions.filter(a => a.visible);
  }
}


// ═══════════════════════════════════════════════════════════════
//  §6  I C O N   S Y S T E M
// ═══════════════════════════════════════════════════════════════

class IconSystem {

  static get(mode: ButtonMode): string {
    return this.ICONS[mode] ?? this.ICONS.magic;
  }

  static getSpinner(): string {
    return '<div class="gf-spinner" role="status" aria-label="Loading"></div>';
  }

  static getSuccess(): string {
    return `<svg class="gf-success-check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#22c55e"/>
      <path d="M8 12.5l2.5 2.5 5-5" stroke="white" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  static getError(): string {
    return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#ef4444"/>
      <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2"
            stroke-linecap="round"/>
    </svg>`;
  }

  static getBadge(count: number): string {
    if (count <= 0) { return ''; }
    return `<span class="gf-badge" aria-label="${count} notification${count > 1 ? 's' : ''}">${count > 9 ? '9+' : count}</span>`;
  }

  private static readonly ICONS: Readonly<Record<ButtonMode, string>> = {
    magic: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfGG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7c5cfc"/><stop offset="100%" stop-color="#a78bfa"/>
      </linearGradient></defs>
      <path d="M12 2C8.13 2 5 5.13 5 9v11l2-2 2 2 2-2 2 2 2-2 2 2V9c0-3.87-3.13-7-7-7z" fill="url(#gfGG)"/>
      <circle cx="9" cy="10" r="1.5" fill="white"/><circle cx="15" cy="10" r="1.5" fill="white"/>
    </svg>`,

    email: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfEG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient></defs>
      <rect x="2" y="4" width="20" height="16" rx="3" fill="url(#gfEG)"/>
      <path d="M2 7l10 6 10-6" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,

    password: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfKG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#38bdf8"/><stop offset="50%" stop-color="#3b82f6"/>
        <stop offset="100%" stop-color="#7c5cfc"/>
      </linearGradient></defs>
      <circle cx="8" cy="15" r="5" fill="url(#gfKG)"/>
      <path d="M12 12l8-8M18 6l2 2M20 4l2 2" stroke="url(#gfKG)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="8" cy="15" r="2" fill="white" fill-opacity="0.4"/>
    </svg>`,

    otp: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfOG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#d97706"/>
      </linearGradient></defs>
      <rect x="3" y="11" width="18" height="11" rx="3" fill="url(#gfOG)"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="url(#gfOG)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="12" cy="16" r="1.5" fill="white"/>
    </svg>`,

    user: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfUG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a855f7"/><stop offset="100%" stop-color="#7c3aed"/>
      </linearGradient></defs>
      <circle cx="12" cy="8" r="5" fill="url(#gfUG)"/>
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="url(#gfUG)"/>
    </svg>`,

    form: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="gfFG" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#0891b2"/>
      </linearGradient></defs>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="url(#gfFG)"/>
      <rect x="6" y="7"  width="8"  height="2" rx="1" fill="white" opacity="0.9"/>
      <rect x="6" y="11" width="12" height="2" rx="1" fill="white" opacity="0.7"/>
      <rect x="6" y="15" width="6"  height="2" rx="1" fill="white" opacity="0.5"/>
    </svg>`,
  };
}


// ═══════════════════════════════════════════════════════════════
//  §7  M A I N   F L O A T I N G   B U T T O N   C L A S S
// ═══════════════════════════════════════════════════════════════

export class FloatingButton {

  // ── DOM ──────────────────────────────────────────────────
  private container: HTMLDivElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private button: HTMLButtonElement | null = null;
  private menu: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;

  // ── State ────────────────────────────────────────────────
  private state: ButtonState = 'hidden';
  private mode: ButtonMode = 'magic';
  private size: ButtonSize = 'normal';
  private currentField: HTMLElement | null = null;
  private currentFieldRef: WeakRef<HTMLElement> | null = null;
  private isEnabled = true;
  private hasOTPReady = false;
  private pageAnalysis: PageAnalysis | null = null;

  // ── Timers ───────────────────────────────────────────────
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private tooltipTimeout: ReturnType<typeof setTimeout> | null = null;
  private stateResetTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Scroll & Resize ──────────────────────────────────────
  private rafId: number | null = null;
  private isScrolling = false;
  private fieldResizeObserver: ResizeObserver | null = null;

  // ── Event cleanup ────────────────────────────────────────
  private cleanupFns: Array<() => void> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageListener: ((msg: any) => void) | null = null;
  private listenerRegistered = false;

  // ── Dependencies ─────────────────────────────────────────
  private autoFiller: AutoFiller;

  // ── Keyboard ─────────────────────────────────────────────
  private readonly SHORTCUT_KEY = 'g';

  constructor(autoFiller: AutoFiller) {
    this.autoFiller = autoFiller;
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.1  L I F E C Y C L E
  // ═══════════════════════════════════════════════════════════

  async init(): Promise<void> {
    this.createContainer();
    this.setupEventListeners();
    this.setupKeyboardShortcut();
    this.setupMutationObserver();
    log.debug('FloatingButton initialised');
    this.loadSettingsAsync();
    this.checkOTPAvailability();
  }

  destroy(): void {
    this.cancelAllTimers();
    if (this.rafId) { cancelAnimationFrame(this.rafId); }
    if (this.fieldResizeObserver) { this.fieldResizeObserver.disconnect(); this.fieldResizeObserver = null; }

    for (const fn of this.cleanupFns) {
      try { fn(); } catch { /* ignore */ }
    }
    this.cleanupFns = [];

    if (this.messageListener && chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.listenerRegistered = false;
    }

    this.container?.remove();
    this.container = null;
    this.shadowRoot = null;
    this.button = null;
    this.menu = null;
    this.tooltip = null;
    this.currentField = null;
    this.currentFieldRef = null;
    this.pageAnalysis = null;
    this.state = 'hidden';
  }

  // ═══════════════════════════════════════════════════════════
  //  §7.2  S E T T I N G S   &   O T P
  // ═══════════════════════════════════════════════════════════

  private async loadSettingsAsync(): Promise<void> {
    try {
      const resp = await safeSendMessage({ action: 'GET_SETTINGS' }) as
        { settings?: { showFloatingButton: boolean } };
      if (resp?.settings) {
        this.isEnabled = resp.settings.showFloatingButton;
        if (!this.isEnabled) { this.setState('hidden'); }
      }
    } catch {
      log.debug('Settings fetch failed — defaulting to enabled');
    }

    if (chrome?.runtime?.onMessage && !this.listenerRegistered) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.messageListener = (msg: any) => {
        if (msg.action === 'SETTINGS_CHANGED' && msg.settings) {
          this.isEnabled = msg.settings.showFloatingButton;
          if (!this.isEnabled) { this.setState('hidden'); }
        }
        if (msg.action === 'OTP_RECEIVED') {
          this.hasOTPReady = true;
          this.updateBadge();
        }
      };
      chrome.runtime.onMessage.addListener(this.messageListener);
      this.listenerRegistered = true;
    }
  }

  private async checkOTPAvailability(): Promise<void> {
    try {
      const resp = await safeSendMessage({ action: 'GET_LAST_OTP' }) as GetLastOTPResponse;
      if (resp?.lastOTP?.code) {
        this.hasOTPReady = true;
        this.updateBadge();
      }
    } catch { /* ignore */ }
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.3  S T A T E   M A C H I N E
  // ═══════════════════════════════════════════════════════════

  private setState(newState: ButtonState, message?: string): void {
    if (this.state === newState) { return; }
    const old = this.state;
    this.state = newState;
    log.debug(`State: ${old} → ${newState}`);

    const handlers: Record<ButtonState, () => void> = {
      hidden: () => this.applyHidden(),
      idle: () => this.applyIdle(),
      hovering: () => this.applyHovering(),
      loading: () => this.applyLoading(),
      success: () => this.applySuccess(message),
      error: () => this.applyError(message),
      'menu-open': () => this.applyMenuOpen(),
      dragging: () => { }, // Reserved
    };

    handlers[newState]?.();
  }

  private applyHidden(): void {
    if (this.container) { this.container.style.display = 'none'; }
    this.closeMenuSilent();
    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
      this.fieldResizeObserver = null;
    }
    this.currentField = null;
    this.currentFieldRef = null;
  }

  private applyIdle(): void {
    if (!this.container || !this.button) { return; }
    this.container.style.display = 'block';
    this.button.innerHTML = IconSystem.get(this.mode);
    this.button.classList.remove('gf-loading', 'gf-success', 'gf-error');
    this.button.setAttribute('aria-label', FieldContext.getTooltip(this.mode, this.getPageType()));
    this.updateBadge();
    this.scheduleAutoHide();
  }

  private applyHovering(): void {
    this.cancelAllTimers();
    this.showTooltip();
  }

  private applyLoading(): void {
    if (!this.button) { return; }
    this.cancelAllTimers();
    this.button.classList.add('gf-loading');
    this.button.innerHTML = IconSystem.getSpinner();
    this.hideTooltip();
  }

  private applySuccess(message?: string): void {
    if (!this.button) { return; }
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-success');
    this.button.innerHTML = IconSystem.getSuccess();

    if (message && this.tooltip) {
      this.showStatusTooltip(message, 'var(--success)');
    } else {
      this.hideTooltip();
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      this.setState('hidden');
    }, 1500);
  }

  private applyError(message?: string): void {
    if (!this.button) { return; }
    this.button.classList.remove('gf-loading');
    this.button.classList.add('gf-error');
    this.button.innerHTML = IconSystem.getError();

    if (this.tooltip) {
      this.showStatusTooltip(message || 'Action failed', 'var(--error)');
    }

    this.stateResetTimeout = setTimeout(() => {
      this.clearStatusTooltip();
      this.setState('idle');
    }, 2000);
  }

  private applyMenuOpen(): void {
    this.cancelAllTimers();
    this.openMenuInternal();
    this.hideTooltip();
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.4  D O M   C R E A T I O N
  // ═══════════════════════════════════════════════════════════

  private createContainer(): void {
    document.getElementById('ghostfill-fab')?.remove();

    this.container = document.createElement('div');
    this.container.id = 'ghostfill-fab';
    this.container.style.cssText =
      'position:fixed;z-index:2147483647;display:none;pointer-events:auto;';

    this.shadowRoot = this.container.attachShadow({ mode: 'closed' });

    const styles = document.createElement('style');
    styles.textContent = this.getStyles();
    this.shadowRoot.appendChild(styles);

    this.button = document.createElement('button');
    this.button.className = 'gf-fab';
    this.button.innerHTML = IconSystem.get('magic');
    this.button.setAttribute('aria-label', 'GhostFill — Auto-fill this form');
    this.button.setAttribute('role', 'button');
    this.button.setAttribute('tabindex', '0');
    this.shadowRoot.appendChild(this.button);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'gf-tooltip';
    this.tooltip.setAttribute('role', 'tooltip');
    this.shadowRoot.appendChild(this.tooltip);

    this.menu = document.createElement('div');
    this.menu.className = 'gf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', 'GhostFill actions');
    this.shadowRoot.appendChild(this.menu);

    document.body.appendChild(this.container);

    this.wireButtonEvents();
  }

  private wireButtonEvents(): void {
    if (!this.button) { return; }

    this.button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.state === 'loading') { return; }
      if (this.state === 'menu-open') { this.setState('idle'); return; }
      this.handlePrimaryAction();
    });

    this.button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setState('menu-open');
    });

    // Touch long-press
    let longPress: ReturnType<typeof setTimeout> | null = null;
    this.button.addEventListener('touchstart', (e) => {
      longPress = setTimeout(() => {
        e.preventDefault();
        this.setState('menu-open');
        longPress = null;
      }, 500);
    }, { passive: false });

    const cancelLongPress = () => {
      if (longPress) { clearTimeout(longPress); longPress = null; }
    };
    this.button.addEventListener('touchend', cancelLongPress);
    this.button.addEventListener('touchmove', cancelLongPress);

    // Hover
    this.button.addEventListener('mouseenter', () => {
      if (this.state === 'idle') { this.setState('hovering'); }
    });
    this.button.addEventListener('mouseleave', () => {
      if (this.state === 'hovering') { this.setState('idle'); }
    });

    // Keyboard
    this.button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.handlePrimaryAction(); }
      else if (e.key === 'Escape') { this.setState('hidden'); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.setState('menu-open'); }
    });
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.5  P R I M A R Y   A C T I O N
  // ═══════════════════════════════════════════════════════════

  private async handlePrimaryAction(): Promise<void> {
    this.setState('loading');
    pageStatus.show('Analysing form…', 'loading');

    try {
      const result = await this.autoFiller.smartFill();

      if (result.success && result.filledCount > 0) {
        const msg = `Filled ${result.filledCount} field(s)!`;
        pageStatus.success(msg, 1500);
        this.setState('success', msg);
      } else {
        pageStatus.hide();
        this.setState('idle');
        log.debug('No fields filled — silent dismiss');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      log.error('Smart fill error:', error);
      const msg = error?.message || 'Failed to fill';
      pageStatus.error(msg, 2000);
      this.setState('error', msg);
    }
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.6  M E N U
  // ═══════════════════════════════════════════════════════════

  private openMenuInternal(): void {
    if (!this.menu || !this.shadowRoot) { return; }

    const analysis = this.getPageAnalysis();
    const actions = ContextualMenu.buildActions(analysis, this.mode, this.hasOTPReady);

    this.menu.innerHTML = actions.map(a => {
      if (a.id === 'divider') { return '<div class="gf-menu-divider" role="separator"></div>'; }
      return `<button class="gf-menu-item" data-action="${a.id}" role="menuitem" tabindex="-1">
        <span class="gf-menu-icon">${a.icon}</span>
        <span class="gf-menu-label">${a.label}</span>
        ${a.shortcut ? `<span class="gf-menu-shortcut">${a.shortcut}</span>` : ''}
      </button>`;
    }).join('');

    this.menu.querySelectorAll<HTMLButtonElement>('.gf-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleMenuAction((e.currentTarget as HTMLElement).dataset.action || '');
      });
    });

    if (this.button) {
      const rect = this.button.getBoundingClientRect();
      Object.assign(this.menu.style, SmartPositioner.calculateMenuPosition(rect, 240, 320));
    }

    this.menu.classList.add('gf-menu-open');

    const firstItem = this.menu.querySelector<HTMLButtonElement>('.gf-menu-item');
    if (firstItem) { requestAnimationFrame(() => firstItem.focus()); }

    this.menu.addEventListener('keydown', (e) => {
      const items = Array.from(this.menu!.querySelectorAll<HTMLButtonElement>('.gf-menu-item'));
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[idx < items.length - 1 ? idx + 1 : 0]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[idx > 0 ? idx - 1 : items.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        this.setState('idle');
      }
    });
  }

  private closeMenuSilent(): void {
    if (this.menu) {
      this.menu.classList.remove('gf-menu-open');
      this.menu.innerHTML = '';
    }
  }

  private async handleMenuAction(actionId: string): Promise<void> {
    this.setState('loading');

    try {
      switch (actionId) {

        case 'smart-fill':
          await this.handlePrimaryAction();
          return;

        case 'paste-otp':
          await this.actionPasteOTP();
          break;

        case 'generate-email':
          await this.actionGenerateEmail();
          break;

        case 'generate-password':
          await this.actionGeneratePassword();
          break;

        case 'fill-firstname':
        case 'fill-lastname':
        case 'fill-fullname':
        case 'fill-username':
          await this.actionFillIdentity(actionId);
          break;

        case 'clear-fields':
          // Attempt to clear fields
          await this.autoFiller.clearForm();
          pageStatus.success('Fields cleared', 1000);
          this.setState('idle');
          break;

        case 'settings':
          safeSendMessage({ action: 'OPEN_OPTIONS' });
          this.setState('hidden');
          break;

        default:
          this.setState('idle');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      log.error('Menu action failed:', error);
      const msg = error?.message || 'Action failed';
      pageStatus.error(msg, 2000);
      this.setState('error', msg);
    }
  }

  // ── Individual action handlers ──────────────────────────

  private async actionPasteOTP(): Promise<void> {
    const resp = await safeSendMessage({ action: 'GET_LAST_OTP' }) as GetLastOTPResponse;
    if (resp?.lastOTP?.code) {
      const filled = await this.autoFiller.fillOTP(resp.lastOTP.code);
      if (filled) {
        pageStatus.success(`Code ${resp.lastOTP.code} filled!`, 1500);
        this.setState('success', 'Code filled!');
      } else {
        pageStatus.error('No OTP field found', 2000);
        this.setState('error', 'No OTP field found');
      }
    } else {
      pageStatus.error('No OTP available', 2000);
      this.setState('error', 'No OTP available');
    }
  }

  private async actionGenerateEmail(): Promise<void> {
    const resp = await safeSendMessage({ action: 'GENERATE_EMAIL' }) as GenerateEmailResponse;
    if (resp?.success && resp.email?.fullEmail && this.currentField) {
      await this.autoFiller.fillField(
        this.buildFieldSelector(this.currentField),
        resp.email.fullEmail,
      );
      pageStatus.success('Email filled!', 1500);
      this.setState('success', 'Email filled!');
    } else {
      const msg = resp?.error || 'Failed to generate email';
      pageStatus.error(msg, 2000);
      this.setState('error', msg);
    }
  }

  private async actionGeneratePassword(): Promise<void> {
    const resp = await safeSendMessage({ action: 'GENERATE_PASSWORD' }) as GeneratePasswordResponse;
    if (resp?.result?.password && this.currentField) {
      await this.autoFiller.fillField(
        this.buildFieldSelector(this.currentField),
        resp.result.password,
      );
      pageStatus.success('Password filled!', 1500);
      this.setState('success', 'Password filled!');
    } else {
      pageStatus.error('Failed to generate password', 2000);
      this.setState('error', 'Failed to generate password');
    }
  }

  private async actionFillIdentity(actionId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await safeSendMessage({ action: 'GET_IDENTITY' }) as any;

    if (!resp?.success || !resp.identity || !this.currentField) {
      pageStatus.error('Failed to get identity', 2000);
      this.setState('error', 'Failed to get identity');
      return;
    }

    const fieldMap: Record<string, [string, string]> = {
      'fill-firstname': [resp.identity.firstName, 'First Name'],
      'fill-lastname': [resp.identity.lastName, 'Last Name'],
      'fill-fullname': [resp.identity.fullName, 'Full Name'],
      'fill-username': [resp.identity.username, 'Username'],
    };

    const [value, label] = fieldMap[actionId] ?? ['', actionId];

    if (value) {
      await this.autoFiller.fillField(
        this.buildFieldSelector(this.currentField),
        value,
      );
      pageStatus.success(`${label} filled!`, 1500);
      this.setState('success', `${label} filled!`);
    } else {
      pageStatus.error(`No ${label} available`, 2000);
      this.setState('error', `No ${label} available`);
    }
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.7  T O O L T I P
  // ═══════════════════════════════════════════════════════════

  private showTooltip(): void {
    if (!this.tooltip) { return; }
    this.tooltip.textContent = FieldContext.getTooltip(this.mode, this.getPageType());
    this.tooltipTimeout = setTimeout(() => {
      this.tooltip?.classList.add('gf-tooltip-visible');
    }, 600);
  }

  private hideTooltip(): void {
    if (this.tooltipTimeout) { clearTimeout(this.tooltipTimeout); this.tooltipTimeout = null; }
    this.tooltip?.classList.remove('gf-tooltip-visible');
  }

  private showStatusTooltip(text: string, bgColor: string): void {
    if (!this.tooltip) { return; }
    this.tooltip.textContent = text;
    this.tooltip.style.backgroundColor = bgColor;
    this.tooltip.style.color = 'white';
    this.tooltip.classList.add('gf-tooltip-visible');
  }

  private clearStatusTooltip(): void {
    if (!this.tooltip) { return; }
    this.tooltip.classList.remove('gf-tooltip-visible');
    this.tooltip.style.backgroundColor = '';
    this.tooltip.style.color = '';
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.8  B A D G E
  // ═══════════════════════════════════════════════════════════

  private updateBadge(): void {
    if (!this.shadowRoot) { return; }
    this.shadowRoot.querySelector('.gf-badge')?.remove();
    if (this.hasOTPReady) {
      const badge = document.createElement('span');
      badge.className = 'gf-badge';
      badge.textContent = '!';
      badge.setAttribute('aria-label', 'OTP code ready');
      this.button?.appendChild(badge);
    }
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.9  E V E N T   L I S T E N E R S
  // ═══════════════════════════════════════════════════════════

  private setupEventListeners(): void {
    // Focus tracking
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleFocus = debounce((target: any) => {
      const field = target as HTMLElement;
      if (!this.isEnabled) { return; }
      if (
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) &&
        FieldContext.shouldShowButton(field)
      ) {
        this.showNearField(field);
      }
    }, 100);

    const onFocusIn = (e: FocusEvent) => {
      const path = e.composedPath?.() || [];
      const target = (path[0] || e.target) as HTMLElement;
      handleFocus(target);
    };

    document.addEventListener('focusin', onFocusIn, true);
    this.cleanupFns.push(() => document.removeEventListener('focusin', onFocusIn, true));

    // Focus out
    const onFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement;
      if (this.container?.contains(related)) { return; }
      if (this.state === 'menu-open') { return; }
      this.scheduleAutoHide();
    };
    document.addEventListener('focusout', onFocusOut, true);
    this.cleanupFns.push(() => document.removeEventListener('focusout', onFocusOut, true));

    // Click-outside closes menu
    const onDocClick = (e: MouseEvent) => {
      if (this.state !== 'menu-open') { return; }
      const path = e.composedPath?.() || [];
      if (path.some(el => el === this.container)) { return; }
      this.setState('idle');
    };
    document.addEventListener('click', onDocClick, true);
    this.cleanupFns.push(() => document.removeEventListener('click', onDocClick, true));

    // Scroll following (RAF)
    const onScroll = () => {
      if (this.state === 'hidden' || !this.currentField) { return; }
      if (!this.isScrolling) { this.isScrolling = true; this.followFieldOnScroll(); }
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    this.cleanupFns.push(() => window.removeEventListener('scroll', onScroll, true));

    // Resize
    const onResize = debounce(() => {
      if (this.state !== 'hidden' && this.currentField) { this.positionNearField(this.currentField); }
    }, 100);
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.10  K E Y B O A R D   S H O R T C U T
  // ═══════════════════════════════════════════════════════════

  private setupKeyboardShortcut(): void {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === this.SHORTCUT_KEY) {
        e.preventDefault();
        e.stopPropagation();
        log.info('⌨️ Keyboard shortcut triggered');
        this.handlePrimaryAction();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
    this.cleanupFns.push(() => document.removeEventListener('keydown', onKeydown, true));
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.11  M U T A T I O N   O B S E R V E R
  // ═══════════════════════════════════════════════════════════

  private setupMutationObserver(): void {
    const observer = new MutationObserver(
      debounce(() => {
        this.pageAnalysis = null; // Important! Invalidates cache
        if (this.currentField && !this.currentField.isConnected) {
          this.setState('hidden');
        }
      }, 500),
    );
    observer.observe(document.body, { childList: true, subtree: true });
    this.cleanupFns.push(() => observer.disconnect());
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.12  P O S I T I O N I N G
  // ═══════════════════════════════════════════════════════════

  private currentFieldRect: DOMRect | null = null;
  private trackingRafId: number | null = null;

  showNearField(field: HTMLElement): void {
    if (!this.isEnabled) { return; }

    // Reattach container if SPA removed it
    if (this.container && !this.container.isConnected) {
      document.body.appendChild(this.container);
    }

    const analysis = this.getPageAnalysis();
    if (
      !analysis.isAuthRelated &&
      !analysis.hasOTPField &&
      !analysis.hasEmailField &&
      !analysis.hasPasswordField &&
      analysis.inputCount < 1
    ) { return; }

    this.currentField = field;
    this.currentFieldRef = new WeakRef(field);
    this.mode = FieldContext.getMode(field);

    if (this.fieldResizeObserver) {
      this.fieldResizeObserver.disconnect();
    }
    this.fieldResizeObserver = new ResizeObserver(
      debounce(() => {
        if (this.state !== 'hidden' && this.currentField) {
          this.positionNearField(this.currentField);
        }
      }, 50)
    );
    this.fieldResizeObserver.observe(field);

    this.positionNearField(field);
    this.setState('idle');
    this.startContinuousTracking();
  }

  private startContinuousTracking(): void {
    if (this.trackingRafId) cancelAnimationFrame(this.trackingRafId);

    const track = () => {
      if (this.state === 'hidden') {
        this.trackingRafId = null;
        return;
      }

      const field = this.currentFieldRef?.deref();
      if (!field || !field.isConnected) {
        this.setState('hidden');
        this.trackingRafId = null;
        return;
      }

      const rect = field.getBoundingClientRect();
      const last = this.currentFieldRect;

      if (!last ||
        Math.abs(last.x - rect.x) > 0.5 ||
        Math.abs(last.y - rect.y) > 0.5 ||
        Math.abs(last.width - rect.width) > 0.5 ||
        Math.abs(last.height - rect.height) > 0.5) {
        this.currentFieldRect = rect;
        this.positionNearField(field);
      }

      this.trackingRafId = requestAnimationFrame(track);
    };

    this.trackingRafId = requestAnimationFrame(track);
  }

  private positionNearField(field: HTMLElement): void {
    if (!this.container) { return; }
    const btnSize = this.size === 'mini' ? 28 : this.size === 'expanded' ? 48 : 36;
    const pos = SmartPositioner.calculate(field, btnSize);
    if (pos.left === -9999) { this.setState('hidden'); return; }
    this.container.style.left = `${pos.left}px`;
    this.container.style.top = `${pos.top}px`;
    this.container.style.transform = 'none';
  }

  private followFieldOnScroll(): void {
    if (this.rafId) { cancelAnimationFrame(this.rafId); }
    this.rafId = requestAnimationFrame(() => {
      this.isScrolling = false;
      // Handled primarily by continuous tracking now, but good fallback
      const field = this.currentFieldRef?.deref();
      if (field && this.state !== 'hidden') {
        this.positionNearField(field);
      }
    });
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.13  T I M E R S
  // ═══════════════════════════════════════════════════════════

  private scheduleAutoHide(): void {
    if (this.state === 'menu-open' || this.state === 'loading') { return; }
    this.cancelHideTimer();
    this.hideTimeout = setTimeout(() => {
      if (this.state !== 'menu-open' && this.state !== 'loading') { this.setState('hidden'); }
    }, TIMING.FLOATING_BUTTON_HIDE_MS || 4000);
  }

  private cancelHideTimer(): void {
    if (this.hideTimeout) { clearTimeout(this.hideTimeout); this.hideTimeout = null; }
  }

  private cancelAllTimers(): void {
    this.cancelHideTimer();
    if (this.tooltipTimeout) { clearTimeout(this.tooltipTimeout); this.tooltipTimeout = null; }
    if (this.stateResetTimeout) { clearTimeout(this.stateResetTimeout); this.stateResetTimeout = null; }
  }


  // ═══════════════════════════════════════════════════════════
  //  §7.14  H E L P E R S
  // ═══════════════════════════════════════════════════════════

  private getPageAnalysis(): PageAnalysis {
    if (!this.pageAnalysis) {
      this.pageAnalysis = PageAnalyzer.analyze();
      log.debug('Page analysed:', {
        type: this.pageAnalysis.pageType,
        provider: this.pageAnalysis.provider,
        framework: this.pageAnalysis.framework,
        inputs: this.pageAnalysis.inputCount,
      });
    }
    return this.pageAnalysis;
  }

  private getPageType(): PageType {
    return this.getPageAnalysis().pageType;
  }

  private buildFieldSelector(field: HTMLElement): string {
    const input = field as HTMLInputElement;
    if (input.id) { return `#${CSS.escape(input.id)}`; }
    if (input.name) { return `input[name="${CSS.escape(input.name)}"]`; }
    if (input.type && input.type !== 'text') { return `input[type="${input.type}"]`; }
    return 'input';
  }

  // Public API
  show(): void { if (this.state === 'hidden') { this.setState('idle'); } }
  hide(): void { this.setState('hidden'); }
  isVisible(): boolean { return this.state !== 'hidden'; }


  // ═══════════════════════════════════════════════════════════
  //  §7.15  S H A D O W - D O M   S T Y L E S
  // ═══════════════════════════════════════════════════════════

  private getStyles(): string {
    return `
/* ══════════════════════════════════════════════════════════════
   GhostFill 3.0 — Spatial FAB Shadow DOM Styles
   3D depth · Glass materials · Staggered menu · Dark mode
   ══════════════════════════════════════════════════════════════ */

:host {
  all: initial;
  font-family: "Inter", -apple-system, BlinkMacSystemFont,
    "SF Pro Display", "Segoe UI", Roboto, sans-serif;

  --brand: #7c5cfc;
  --brand-light: #a78bfa;
  --brand-rgb: 124, 92, 252;
  --brand-glow: rgba(124, 92, 252, 0.25);

  --success: #22c55e;
  --success-rgb: 34, 197, 94;
  --success-glow: rgba(34, 197, 94, 0.25);
  --error: #ef4444;
  --error-rgb: 239, 68, 68;
  --error-glow: rgba(239, 68, 68, 0.25);

  --glass-bg: linear-gradient(135deg,
    rgba(255,255,255,0.88) 0%, rgba(248,250,252,0.82) 100%);
  --glass-bg-hover: linear-gradient(135deg,
    rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.90) 100%);
  --glass-border: rgba(255,255,255,0.55);
  --glass-border-hover: rgba(var(--brand-rgb), 0.2);

  --text: #0f172a;
  --text-secondary: #64748b;
  --text-tertiary: #94a3b8;

  --shadow-rest:
    0 1px 2px rgba(0,0,0,0.03), 0 2px 4px rgba(0,0,0,0.03),
    0 4px 8px rgba(0,0,0,0.04), 0 8px 16px rgba(0,0,0,0.04);
  --shadow-hover:
    0 2px 4px rgba(0,0,0,0.02), 0 4px 8px rgba(0,0,0,0.04),
    0 8px 16px rgba(0,0,0,0.05), 0 16px 32px rgba(0,0,0,0.06),
    0 0 0 1px rgba(var(--brand-rgb),0.06), 0 0 30px var(--brand-glow);
  --shadow-active:
    0 1px 2px rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.04);
  --shadow-immersive:
    0 8px 16px rgba(0,0,0,0.03), 0 16px 32px rgba(0,0,0,0.06),
    0 32px 64px rgba(0,0,0,0.09), 0 48px 96px rgba(0,0,0,0.10);

  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.175, 0.885, 0.32, 1.275);
  --ease-smooth: cubic-bezier(0.25, 0.1, 0.25, 1);
  --perspective: 600px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

/* ── FAB ── */
.gf-fab {
  width: 40px; height: 40px; border-radius: 13px;
  background: var(--glass-bg);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-rest), inset 0 1px 0 rgba(255,255,255,0.8);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  outline: none; position: relative; overflow: visible;
  transform: perspective(var(--perspective)) translateZ(0);
  transform-style: preserve-3d;
  transition:
    transform 0.35s var(--ease-out-expo),
    box-shadow 0.35s var(--ease-out-expo),
    border-color 0.3s var(--ease-smooth),
    background 0.3s var(--ease-smooth);
  will-change: transform, box-shadow;
}

.gf-fab::before {
  content: ""; position: absolute;
  top: 0; left: 0; right: 0; height: 50%;
  border-radius: 13px 13px 50% 50%;
  background: linear-gradient(180deg,
    rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.1) 60%, transparent 100%);
  pointer-events: none; z-index: 1; transition: opacity 0.3s ease;
}

.gf-fab::after {
  content: ""; position: absolute; inset: 0;
  border-radius: inherit; padding: 1px;
  background: linear-gradient(135deg,
    rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.15) 25%,
    rgba(var(--brand-rgb),0.08) 50%, rgba(255,255,255,0.1) 75%,
    rgba(255,255,255,0.4) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none; z-index: 2; opacity: 0.7; transition: opacity 0.3s ease;
}

.gf-fab:hover {
  transform: perspective(var(--perspective)) translateY(-3px) translateZ(6px) scale(1.06);
  background: var(--glass-bg-hover);
  box-shadow: var(--shadow-hover), inset 0 1px 0 rgba(255,255,255,0.9);
  border-color: var(--glass-border-hover);
}
.gf-fab:hover::before, .gf-fab:hover::after { opacity: 1; }

.gf-fab:active {
  transform: perspective(var(--perspective)) translateY(1px) translateZ(-2px) scale(0.95);
  box-shadow: var(--shadow-active), inset 0 2px 4px rgba(0,0,0,0.06);
  transition-duration: 0.08s;
}

.gf-fab:focus-visible { outline: 2.5px solid var(--brand); outline-offset: 3px; }

@keyframes gfSpatialPulse {
  0%,100% { box-shadow: var(--shadow-rest), inset 0 1px 0 rgba(255,255,255,0.8); }
  50% { box-shadow: var(--shadow-rest), 0 0 24px var(--brand-glow),
    0 0 48px rgba(var(--brand-rgb),0.08), inset 0 1px 0 rgba(255,255,255,0.8); }
}
.gf-fab:not(:hover):not(:active):not(.gf-loading):not(.gf-success):not(.gf-error) {
  animation: gfSpatialPulse 3.5s infinite ease-in-out;
}

/* Icon */
.gf-fab svg {
  width: 22px; height: 22px; position: relative; z-index: 3;
  filter: drop-shadow(0 1px 3px rgba(var(--brand-rgb),0.18));
  transition: transform 0.35s var(--ease-spring), filter 0.3s ease;
}
.gf-fab:hover svg {
  transform: scale(1.1) rotate(-2deg);
  filter: drop-shadow(0 2px 6px rgba(var(--brand-rgb),0.25));
}
.gf-fab:active svg { transform: scale(0.92); transition-duration: 0.08s; }

/* Loading */
.gf-fab.gf-loading { cursor: wait; animation: none; border-color: rgba(var(--brand-rgb),0.15); }
.gf-spinner {
  width: 18px; height: 18px;
  border: 2.5px solid rgba(var(--brand-rgb),0.12);
  border-radius: 50%; border-top-color: var(--brand);
  animation: gfSpin 0.65s cubic-bezier(0.4,0,0.2,1) infinite;
  position: relative; z-index: 3;
}
@keyframes gfSpin { to { transform: rotate(360deg); } }

/* Success */
.gf-fab.gf-success {
  animation: none; border-color: rgba(var(--success-rgb),0.35);
  box-shadow: 0 0 20px var(--success-glow), 0 0 40px rgba(var(--success-rgb),0.1), var(--shadow-rest);
}
.gf-success-check { animation: gfCheckPop 0.45s var(--ease-spring); position: relative; z-index: 3; }
@keyframes gfCheckPop {
  0%   { transform: scale(0) rotate(-60deg); opacity: 0; }
  50%  { transform: scale(1.25) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); }
}

/* Error */
.gf-fab.gf-error {
  animation: gfShake 0.45s ease;
  border-color: rgba(var(--error-rgb),0.35);
  box-shadow: 0 0 16px var(--error-glow), var(--shadow-rest);
}
@keyframes gfShake {
  0%,100% { transform: perspective(var(--perspective)) translateX(0); }
  15%  { transform: perspective(var(--perspective)) translateX(-5px) translateZ(2px); }
  30%  { transform: perspective(var(--perspective)) translateX(4px) translateZ(2px); }
  45%  { transform: perspective(var(--perspective)) translateX(-3px) translateZ(1px); }
  60%  { transform: perspective(var(--perspective)) translateX(2px) translateZ(1px); }
  75%  { transform: perspective(var(--perspective)) translateX(-1px); }
}

/* Badge */
.gf-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 17px; height: 17px; border-radius: 50%;
  background: linear-gradient(135deg, var(--error) 0%, #f87171 100%);
  color: white; font-size: 9px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid white; z-index: 10; padding: 0 3px;
  animation: gfBadgePop 0.35s var(--ease-spring);
  box-shadow: 0 2px 6px rgba(var(--error-rgb),0.3), 0 4px 12px rgba(var(--error-rgb),0.15);
}
@keyframes gfBadgePop {
  0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
  60%  { transform: scale(1.2) rotate(5deg); }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

/* Tooltip */
.gf-tooltip {
  position: absolute; bottom: calc(100% + 10px); left: 50%;
  transform: translateX(-50%) translateY(6px);
  padding: 7px 12px;
  background: rgba(15,23,42,0.92);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  color: white; font-size: 11px; font-weight: 550; letter-spacing: -0.01em;
  border-radius: 8px; white-space: nowrap; pointer-events: none;
  opacity: 0; transition: all 0.25s var(--ease-out-expo);
  z-index: 1001; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
}
.gf-tooltip::after {
  content: ''; position: absolute; top: 100%; left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent; border-top-color: rgba(15,23,42,0.92);
}
.gf-tooltip-visible { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Menu */
.gf-menu {
  position: absolute; top: calc(100% + 10px); right: 0;
  min-width: 232px;
  background: linear-gradient(160deg,
    rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.90) 100%);
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);
  border-radius: 16px; border: 1px solid rgba(255,255,255,0.65);
  box-shadow: var(--shadow-immersive);
  padding: 6px; z-index: 999; overflow: hidden;
  opacity: 0; visibility: hidden;
  transform: perspective(var(--perspective)) translateY(-8px) rotateX(4deg) scale(0.95);
  transform-origin: top right;
  transition:
    opacity 0.3s var(--ease-out-expo), visibility 0.3s var(--ease-out-expo),
    transform 0.35s var(--ease-spring);
}
.gf-menu::before {
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 40%;
  background: linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 100%);
  border-radius: 16px 16px 0 0; pointer-events: none; z-index: 0;
}
.gf-menu::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(145deg,
    rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.1) 30%,
    rgba(var(--brand-rgb),0.06) 60%, rgba(255,255,255,0.3) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
  pointer-events: none; z-index: 1;
}
.gf-menu-open {
  opacity: 1; visibility: visible;
  transform: perspective(var(--perspective)) translateY(0) rotateX(0) scale(1);
}

.gf-menu-item {
  display: flex; align-items: center; gap: 11px;
  padding: 10px 13px; width: 100%;
  cursor: pointer; border-radius: 10px; border: none; background: transparent;
  font: inherit; font-size: 13px; font-weight: 550; letter-spacing: -0.01em;
  color: var(--text); text-align: left; outline: none;
  position: relative; z-index: 2;
  transition: background 0.2s var(--ease-smooth), transform 0.2s var(--ease-out-expo);
}
.gf-menu-item:hover, .gf-menu-item:focus-visible {
  background: rgba(var(--brand-rgb),0.06); transform: translateX(3px);
}
.gf-menu-item:active {
  transform: translateX(3px) scale(0.98);
  background: rgba(var(--brand-rgb),0.1); transition-duration: 0.06s;
}
.gf-menu-item:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }

.gf-menu-icon {
  font-size: 16px; flex-shrink: 0; width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px; background: rgba(var(--brand-rgb),0.06);
  transition: background 0.2s ease;
}
.gf-menu-item:hover .gf-menu-icon { background: rgba(var(--brand-rgb),0.1); }
.gf-menu-label { flex: 1; }
.gf-menu-shortcut {
  font-size: 10px; color: var(--text-tertiary); font-weight: 500;
  letter-spacing: 0.02em; opacity: 0.7;
  display: inline-flex; align-items: center;
  padding: 2px 5px; background: rgba(0,0,0,0.04);
  border-radius: 4px; border: 1px solid rgba(0,0,0,0.06);
  transition: opacity 0.2s ease;
}
.gf-menu-item:hover .gf-menu-shortcut { opacity: 1; }

.gf-menu-divider {
  height: 1px; margin: 5px 10px;
  background: linear-gradient(90deg,
    transparent 0%, rgba(0,0,0,0.06) 20%, rgba(0,0,0,0.06) 80%, transparent 100%);
  position: relative; z-index: 2;
}

/* Staggered entry */
.gf-menu-open .gf-menu-item { animation: gfMIE 0.35s var(--ease-out-expo) both; }
.gf-menu-open .gf-menu-item:nth-child(1) { animation-delay: 0.03s; }
.gf-menu-open .gf-menu-item:nth-child(2) { animation-delay: 0.06s; }
.gf-menu-open .gf-menu-item:nth-child(3) { animation-delay: 0.09s; }
.gf-menu-open .gf-menu-item:nth-child(4) { animation-delay: 0.12s; }
.gf-menu-open .gf-menu-item:nth-child(5) { animation-delay: 0.15s; }
.gf-menu-open .gf-menu-item:nth-child(6) { animation-delay: 0.18s; }
.gf-menu-open .gf-menu-item:nth-child(7) { animation-delay: 0.21s; }
.gf-menu-open .gf-menu-item:nth-child(8) { animation-delay: 0.24s; }
@keyframes gfMIE {
  from { opacity: 0; transform: translateX(-6px) translateY(4px); }
  to   { opacity: 1; transform: translateX(0) translateY(0); }
}
.gf-menu-open .gf-menu-divider { animation: gfDF 0.4s var(--ease-out-expo) 0.1s both; }
@keyframes gfDF {
  from { opacity: 0; transform: scaleX(0.3); }
  to   { opacity: 1; transform: scaleX(1); }
}

/* ── Dark Mode ── */
@media (prefers-color-scheme: dark) {
  :host {
    --glass-bg: linear-gradient(135deg, rgba(22,30,52,0.92) 0%, rgba(12,18,36,0.88) 100%);
    --glass-bg-hover: linear-gradient(135deg, rgba(28,36,60,0.95) 0%, rgba(18,24,44,0.92) 100%);
    --glass-border: rgba(255,255,255,0.08);
    --glass-border-hover: rgba(var(--brand-rgb),0.3);
    --text: #f1f5f9; --text-secondary: #94a3b8; --text-tertiary: #64748b;
    --brand-glow: rgba(167,139,250,0.25);
    --shadow-rest: 0 2px 4px rgba(0,0,0,0.20), 0 4px 8px rgba(0,0,0,0.15), 0 8px 16px rgba(0,0,0,0.10);
    --shadow-hover: 0 4px 8px rgba(0,0,0,0.20), 0 8px 16px rgba(0,0,0,0.18),
      0 16px 32px rgba(0,0,0,0.15), 0 0 36px var(--brand-glow);
    --shadow-active: 0 1px 2px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2);
    --shadow-immersive: 0 8px 16px rgba(0,0,0,0.25), 0 24px 48px rgba(0,0,0,0.25), 0 48px 96px rgba(0,0,0,0.20);
  }
  .gf-fab {
    background: var(--glass-bg); border-color: var(--glass-border);
    box-shadow: var(--shadow-rest), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .gf-fab::before { background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 60%); }
  .gf-fab::after {
    background: linear-gradient(135deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 30%,
      rgba(var(--brand-rgb),0.06) 60%, rgba(255,255,255,0.06) 100%);
    opacity: 0.5;
  }
  .gf-fab:hover {
    background: var(--glass-bg-hover); border-color: var(--glass-border-hover);
    box-shadow: var(--shadow-hover), inset 0 1px 0 rgba(255,255,255,0.08);
  }
  .gf-fab:active { box-shadow: var(--shadow-active), inset 0 2px 6px rgba(0,0,0,0.2); }
  .gf-fab.gf-success {
    border-color: rgba(var(--success-rgb),0.4);
    box-shadow: 0 0 24px var(--success-glow), 0 0 48px rgba(var(--success-rgb),0.08), var(--shadow-rest);
  }
  .gf-fab.gf-error {
    border-color: rgba(var(--error-rgb),0.4);
    box-shadow: 0 0 20px var(--error-glow), var(--shadow-rest);
  }
  .gf-spinner { border-color: rgba(var(--brand-rgb),0.15); border-top-color: var(--brand-light); }
  .gf-badge { border-color: rgba(12,18,36,1); }
  .gf-tooltip {
    background: rgba(30,41,59,0.95); border: 1px solid rgba(255,255,255,0.08);
    box-shadow: 0 4px 20px rgba(0,0,0,0.35);
  }
  .gf-tooltip::after { border-top-color: rgba(30,41,59,0.95); }
  .gf-menu {
    background: linear-gradient(160deg, rgba(22,30,52,0.96) 0%, rgba(12,18,36,0.94) 100%);
    border-color: rgba(255,255,255,0.06);
  }
  .gf-menu::before { background: linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%); }
  .gf-menu::after {
    background: linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.01) 30%,
      rgba(var(--brand-rgb),0.04) 60%, rgba(255,255,255,0.05) 100%);
  }
  .gf-menu-item { color: var(--text); }
  .gf-menu-item:hover, .gf-menu-item:focus-visible { background: rgba(var(--brand-rgb),0.10); }
  .gf-menu-item:active { background: rgba(var(--brand-rgb),0.15); }
  .gf-menu-icon { background: rgba(255,255,255,0.05); }
  .gf-menu-item:hover .gf-menu-icon { background: rgba(var(--brand-rgb),0.12); }
  .gf-menu-shortcut {
    background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); color: var(--text-tertiary);
  }
  .gf-menu-divider {
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 20%,
      rgba(255,255,255,0.06) 80%, transparent 100%);
  }
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  .gf-fab, .gf-fab::before, .gf-fab::after, .gf-fab svg,
  .gf-menu, .gf-menu-item, .gf-tooltip, .gf-badge, .gf-spinner, .gf-success-check {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .gf-fab:hover, .gf-fab:active { transform: none !important; }
  .gf-menu-open { transform: none !important; }
  .gf-menu-open .gf-menu-item {
    animation: none !important; opacity: 1 !important; transform: none !important;
  }
}
    `;
  }
}
