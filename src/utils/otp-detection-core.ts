/**
 * Shared OTP Detection logic for all GhostFill components.
 * Consolidates patterns and scoring to ensure consistency between
 * Page Detection and Auto-Filling (L4).
 */

export const OTP_CONSTANTS = {
  MAX_OTP_LENGTH: 8,
  MIN_OTP_LENGTH: 4,
  MIN_SPLIT_FIELDS: 4,
  MAX_SPLIT_FIELDS: 8,
};

export const OTP_PATTERNS = {
  // Field-level signals
  FIELD_SIGNALS: [
    /otp/i,
    /one[-_\s]?time/i,
    /verification[-_\s]?code/i,
    /security[-_\s]?code/i,
    /passcode/i,
    /2fa/i,
    /mfa/i,
    /auth[-_\s]?code/i,
    /pin/i,
  ],
  
  // Page-level signals
  VERIFICATION_PAGE: [
    /verify|verification|confirm[\s._-]*email|activate[\s._-]*account/i,
    /enter[\s._-]*(your\s+)?code|enter[\s._-]*otp|one[-_\s]?time/i,
    /self[-_\s]?service[\s._-]*verification/i,
    /check[\s._-]*inbox|code[\s._-]*sent|we[\s._-]*sent[\s._-]*code/i,
  ],
  
  // Negative patterns (exclude login/password fields from OTP discovery)
  NEGATIVE: [
    /password/i,
    /passwd/i,
    /username/i,
    /login/i,
    /signin/i,
    /search/i,
    /captcha/i,
  ],

  PAGE_TYPES: [
    {
      key: 'isVerificationPage',
      patterns: [
        /verify|verification|confirm[\s._-]*email|activate[\s._-]*account/i,
        /enter[\s._-]*(your\s+)?code|enter[\s._-]*otp|one[-_\s]?time/i,
        /self[-_\s]?service[\s._-]*verification/i,
        /check[\s._-]*inbox|code[\s._-]*sent|we[\s._-]*sent[\s._-]*code/i,
      ],
      signal: 'page:verification',
    },
    {
      key: 'isLoginPage',
      patterns: [/sign\s*in|log\s*in|login|authenticate/i],
      signal: 'page:login',
    },
    {
      key: 'isSignupPage',
      patterns: [/sign\s*up|register|create\s*account|get\s*started|join/i],
      signal: 'page:signup',
    },
    {
      key: 'isPasswordResetPage',
      patterns: [
        /reset[\s._-]*password|forgot[\s._-]*password|recover[\s._-]*account|new[\s._-]*password/i,
      ],
      signal: 'page:password-reset',
    },
    {
      key: 'is2FAPage',
      patterns: [
        /two[- ]?factor|2fa|multi[- ]?factor|mfa|authenticat[\w]*[\s._-]*code/i,
        /security[\s._-]*code|backup[\s._-]*code/i,
      ],
      signal: 'page:2fa',
    },
  ],

  PROVIDERS: [
    [/clerk\.(dev|com)/i, 'Clerk'],
    [/auth0\.com/i, 'Auth0'],
    [/supabase/i, 'Supabase'],
    [/firebase/i, 'Firebase'],
    [/cognito|amazonaws/i, 'AWS Cognito'],
    [/okta\.com/i, 'Okta'],
    [/ory\.|kratos/i, 'Ory Kratos'],
    [/stytch\.com/i, 'Stytch'],
    [/workos\.com/i, 'WorkOS'],
    [/keycloak/i, 'Keycloak'],
    [/linear\.app/i, 'Linear'],
    [/notion\.so/i, 'Notion'],
    [/github\.com/i, 'GitHub'],
    [/gitlab\.com/i, 'GitLab'],
    [/slack\.com/i, 'Slack'],
    [/discord\.com/i, 'Discord'],
    [/vercel\.com/i, 'Vercel'],
    [/stripe\.com/i, 'Stripe'],
    [/mistral\.ai/i, 'Mistral'],
    [/aliyun\.com|alibaba/i, 'Alibaba'],
    [/microsoft\.com|login\.live/i, 'Microsoft'],
    [/google\.com[\w./]*accounts/i, 'Google'],
    [/apple\.com[\w./]*appleid/i, 'Apple'],
    [/twilio\.com\/verify/i, 'Twilio Verify'],
    [/magic\.link/i, 'Magic.link'],
    [/descope\.com/i, 'Descope'],
    [/passage\.id/i, 'Passage'],
    [/hanko\.io/i, 'Hanko'],
    [/frontegg\.com/i, 'Frontegg'],
    [/nhost\.io/i, 'Nhost'],
    [/appwrite\.io/i, 'Appwrite'],
    [/pocketbase\.io/i, 'PocketBase'],
    [/zitadel\.ch|zitadel\.com/i, 'Zitadel'],
    [/authentik/i, 'Authentik'],
    [/casdoor\.org/i, 'Casdoor'],
    [/fusionauth\.io/i, 'FusionAuth'],
    [/userfront\.com/i, 'Userfront'],
    [/supertokens\.com/i, 'SuperTokens'],
    [/bitwarden\.com/i, 'Bitwarden'],
    [/lastpass\.com/i, 'LastPass'],
    [/dashlane\.com/i, 'Dashlane'],
    [/1password\.com/i, '1Password'],
    [/proton\.me|protonmail\.com/i, 'Proton'],
    [/tutanota\.com/i, 'Tutanota'],
    [/binance\.com/i, 'Binance'],
    [/coinbase\.com/i, 'Coinbase'],
    [/kraken\.com/i, 'Kraken'],
    [/kucoin\.com/i, 'KuCoin'],
    [/bybit\.com/i, 'Bybit'],
    [/metamask\.io/i, 'MetaMask'],
    [/phantom\.app/i, 'Phantom'],
    [/amazon\.(com|in|co\.uk)/i, 'Amazon'],
    [/ebay\.com/i, 'eBay'],
    [/paypal\.com/i, 'PayPal'],
    [/venmo\.com/i, 'Venmo'],
    [/cash\.app/i, 'Cash App'],
    [/revolut\.com/i, 'Revolut'],
    [/wise\.com/i, 'Wise'],
    [/adobe\.com/i, 'Adobe'],
    [/dropbox\.com/i, 'Dropbox'],
    [/zoom\.us/i, 'Zoom'],
    [/slack-edge\.com/i, 'Slack Edge'],
    [/microsoftonline\.com/i, 'Microsoft Online'],
  ],
};

export class OTPDetectionCore {
  /**
   * Score an element's likelihood of being an OTP field.
   */
  static scoreElement(el: HTMLElement): number {
    let score = 0;
    const text = (el.id + ' ' + (el.getAttribute('name') ?? '') + ' ' + (el.getAttribute('placeholder') ?? '') + ' ' + (el.getAttribute('autocomplete') ?? '')).toLowerCase();
    const aria = (el.getAttribute('aria-label') ?? '').toLowerCase();
    
    // Positive signals
    for (const pattern of OTP_PATTERNS.FIELD_SIGNALS) {
      if (pattern.test(text) || pattern.test(aria)) {
        score += 30;
      }
    }

    // Explicit autocomplete
    if (el.getAttribute('autocomplete') === 'one-time-code') {
      score += 100;
    }

    // Negative signals
    for (const pattern of OTP_PATTERNS.NEGATIVE) {
      if (pattern.test(text)) {
        score -= 50;
      }
    }

    return score;
  }
}
