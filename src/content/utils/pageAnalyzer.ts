import { deepQuerySelectorAll } from '../../utils/helpers';

export type PageType =
  | 'login'
  | 'signup'
  | 'verification'
  | '2fa'
  | 'password-reset'
  | 'checkout'
  | 'profile'
  | 'generic-form'
  | 'non-auth';

export interface PageAnalysis {
  readonly pageType: PageType;
  readonly hasEmailField: boolean;
  readonly hasPasswordField: boolean;
  readonly hasOTPField: boolean;
  readonly hasNameFields: boolean;
  readonly formCount: number;
  readonly inputCount: number;
  readonly isAuthRelated: boolean;
  readonly provider: string | null;
  readonly framework: string;
  readonly signals: readonly string[];
}

export function safeQuerySelector<T extends Element>(
  root: ParentNode,
  selector: string
): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

const PAGE_TEXT_SCAN_LIMIT = 3000;

export class PageAnalyzer {
  // ── Provider Detection Patterns ─────────────────────────
  private static readonly PROVIDER_MAP: ReadonlyArray<readonly [RegExp, string]> = [
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
    [/google[\w./]*accounts/i, 'Google'],
    [/apple\.com[\w./]*appleid/i, 'Apple ID'],
    [/linkedin\.com/i, 'LinkedIn'],
    [/x\.com|twitter\.com/i, 'X (Twitter)'],
  ] as const;

  // ── Page Classification Patterns ────────────────────────
  private static readonly PAGE_PATTERNS: ReadonlyArray<{
    readonly type: PageType;
    readonly pattern: RegExp;
    readonly signal: string;
  }> = [
    {
      type: 'verification',
      pattern: /verify|verification|confirm[\s._-]*email|activate[\s._-]*account|enter[\s._-]*(your\s+)?code|one[-_\s]?time|otp|self[-_\s]?service[\s._-]*verification/i,
      signal: 'page:verification',
    },
    {
      type: '2fa',
      pattern: /two[-_\s]?factor|2fa|mfa|authenticat[\w]*[\s._-]*code|security[\s._-]*code/i,
      signal: 'page:2fa',
    },
    {
      type: 'password-reset',
      pattern: /reset[\s._-]*password|forgot[\s._-]*password|recover|new[\s._-]*password|change[\s._-]*password/i,
      signal: 'page:password-reset',
    },
    {
      type: 'signup',
      pattern: /sign\s*up|register|create\s*account|get\s*started|join\s*(us|now|free)|enroll/i,
      signal: 'page:signup',
    },
    {
      type: 'login',
      pattern: /sign\s*in|log\s*in|login|authenticate/i,
      signal: 'page:login',
    },
    {
      type: 'checkout',
      pattern: /checkout|billing|payment|subscribe|purchase/i,
      signal: 'page:checkout',
    },
    {
      type: 'profile',
      pattern: /profile|settings|account\s*settings|edit\s*profile|preferences/i,
      signal: 'page:profile',
    },
  ] as const;

  // ── Field Detection Selectors ───────────────────────────
  private static readonly FIELD_SELECTORS = {
    email: 'input[type="email"], input[name*="email" i], input[id*="email" i], input[autocomplete*="email"]',
    password: 'input[type="password"]',
    otp: [
      'input[autocomplete="one-time-code"]',
      'input[name*="otp" i]',
      'input[name="code"]',
      'input[id*="otp" i]',
      'input[maxlength="1"][type="text"]',
      'input[maxlength="1"][type="tel"]',
      'input[maxlength="4"]',
      'input[maxlength="6"]',
      'input[maxlength="8"]',
    ].join(', '),
    name: 'input[name*="name" i]:not([name*="user" i]), input[autocomplete="given-name"], input[autocomplete="family-name"]',
  } as const;

  // ── Framework Detection ─────────────────────────────────
  private static readonly FRAMEWORK_DETECTORS: ReadonlyArray<{
    readonly name: string;
    readonly detect: () => boolean;
  }> = [
    {
      name: 'nextjs',
      detect: () => !!safeQuerySelector(document, 'script[id="__NEXT_DATA__"]'),
    },
    {
      name: 'react',
      detect: () => {
        const el = safeQuerySelector<HTMLElement>(document, 'input') ?? safeQuerySelector<HTMLElement>(document, 'div');
        if (!el) {return false;}
        return Object.keys(el).some(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$') || k.startsWith('__reactInternalInstance$')
        );
      },
    },
    {
      name: 'vue',
      detect: () => {
        if ((document as Document & { __vue_app__?: unknown }).__vue_app__) {return true;}
        const allEls = document.body?.querySelectorAll('*');
        if (!allEls) {return false;}
        for (let i = 0, len = Math.min(allEls.length, 100); i < len; i++) {
          if (allEls[i].getAttributeNames().some((a) => /^data-v-[a-f0-9]+$/.test(a))) {
            return true;
          }
        }
        return false;
      },
    },
    {
      name: 'angular',
      detect: () => !!(
        (window as Window & { ng?: unknown }).ng ??
        safeQuerySelector(document, '[ng-version]') ??
        safeQuerySelector(document, '[_nghost]') ??
        safeQuerySelector(document, '[ng-app]')
      ),
    },
    {
      name: 'svelte',
      detect: () => !!(
        safeQuerySelector(document, '[class*="svelte-"]') ??
        safeQuerySelector(document, 'script[type="svelte-data"]')
      ),
    },
    {
      name: 'solid',
      detect: () => !!(
        (window as Window & { _$HY?: unknown })._$HY ??
        safeQuerySelector(document, '[data-hk]')
      ),
    },
    {
      name: 'htmx',
      detect: () => !!safeQuerySelector(document, '[hx-get], [hx-post], [hx-trigger]'),
    },
    {
      name: 'qwik',
      detect: () => !!safeQuerySelector(document, '[q\\:container], [q\\:id]'),
    },
  ];

  static analyze(): PageAnalysis {
    const url = window.location.href.toLowerCase();
    const path = window.location.pathname.toLowerCase();
    const title = document.title.toLowerCase();
    const bodyText = (document.body?.textContent ?? '').slice(0, PAGE_TEXT_SCAN_LIMIT).toLowerCase();
    const metaContent = Array.from(document.querySelectorAll('meta'))
      .map((m) => (m.getAttribute('content') ?? '').toLowerCase())
      .join(' ');
    const combined = `${url} ${path} ${title} ${bodyText} ${metaContent}`;
    const signals: string[] = [];

    // ── Field detection ───────────────────────────────────
    const hasEmailField = deepQuerySelectorAll(this.FIELD_SELECTORS.email).length > 0;
    const hasPasswordField = deepQuerySelectorAll(this.FIELD_SELECTORS.password).length > 0;
    const hasOTPField = deepQuerySelectorAll(this.FIELD_SELECTORS.otp).length > 0;
    const hasNameFields = deepQuerySelectorAll(this.FIELD_SELECTORS.name).length > 0;
    const formCount = deepQuerySelectorAll('form').length;
    const inputCount = deepQuerySelectorAll('input:not([type="hidden"])').length;

    // ── Page-type classification ──────────────────────────
    const pageType = this.classifyPage(combined, hasOTPField, hasPasswordField, hasEmailField, signals);

    // ── Provider detection ────────────────────────────────
    const provider = this.detectProvider(url, signals);

    // ── Framework detection ───────────────────────────────
    const framework = this.detectFramework();
    signals.push(`framework:${framework}`);

    return Object.freeze({
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
      signals: Object.freeze(signals),
    });
  }

  private static classifyPage(
    combined: string,
    hasOTPField: boolean,
    hasPasswordField: boolean,
    hasEmailField: boolean,
    signals: string[]
  ): PageType {
    // Special: OTP field present OR verification language → check 2FA vs verification
    if (hasOTPField || this.PAGE_PATTERNS[0].pattern.test(combined)) {
      const is2FA = this.PAGE_PATTERNS[1].pattern.test(combined);
      const type = is2FA ? '2fa' : 'verification';
      signals.push(`page:${type}`);
      return type;
    }

    // Iterate remaining patterns in priority order
    for (const { type, pattern, signal } of this.PAGE_PATTERNS) {
      if (type === 'verification' || type === '2fa') {continue;} // Already handled above
      if (pattern.test(combined)) {
        signals.push(signal);
        return type;
      }
    }

    // Generic form fallback
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
    for (const detector of this.FRAMEWORK_DETECTORS) {
      try {
        if (detector.detect()) {return detector.name;}
      } catch {
        /* detection failed, continue */
      }
    }
    return 'unknown';
  }
}
