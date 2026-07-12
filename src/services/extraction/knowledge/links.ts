import type { LinkPattern } from '../../types/extraction.types';

export const LINK_PATTERN_DATABASE: LinkPattern[] = [
  // Activation Links
  {
    pattern: /\/activate(?:ion)?/i,
    name: 'activate-path',
    baseConfidence: 98,
    type: 'activation',
    description: 'Activation path',
  },
  {
    pattern: /\/verify(?:email)?/i,
    name: 'verify-path',
    baseConfidence: 95,
    type: 'activation',
    description: 'Verification path',
  },
  {
    pattern: /\/confirm(?:email)?/i,
    name: 'confirm-path',
    baseConfidence: 90,
    type: 'activation',
    description: 'Confirmation path',
  },
  {
    pattern: /\/auth.*\/verify/i,
    name: 'auth-verify-path',
    baseConfidence: 95,
    type: 'activation',
    description: 'Auth verification',
  },
  {
    pattern: /\/signup.*verify/i,
    name: 'signup-verify-path',
    baseConfidence: 90,
    type: 'activation',
    description: 'Signup verification',
  },
  {
    pattern: /\/(?:email[-_]?verification|verify[-_]?email|confirm[-_]?email|email\/confirm|email\/action|auth\/action)/i,
    name: 'email-confirmation-path',
    baseConfidence: 94,
    type: 'activation',
    description: 'Email confirmation path',
  },
  {
    pattern: /\/(?:validate|validation|email[-_]?validat(?:e|ion)|validat(?:e|ion)[-_]?email)/i,
    name: 'validate-path',
    baseConfidence: 93,
    type: 'activation',
    description: 'Email/account validation path (synonym of verify)',
  },
  {
    pattern: /\/(?:claim|enable|unlock)(?:[-_]?(?:account|email|access))?/i,
    name: 'claim-enable-unlock-path',
    baseConfidence: 88,
    type: 'activation',
    description: 'Claim/enable/unlock account path (activation synonyms)',
  },
  {
    pattern: /[?&](?:mode=verifyEmail|oobCode=|oob_code=)/i,
    name: 'firebase-oob-verify',
    baseConfidence: 96,
    type: 'activation',
    description: 'Firebase Auth email action (verifyEmail + oobCode)',
  },
  {
    pattern: /\/(?:invite|invitation|invitations)\/?(?:accept|join)?/i,
    name: 'invite-path',
    baseConfidence: 92,
    type: 'activation',
    description: 'Invite or invitation path',
  },
  {
    pattern: /\/(?:accept[-_]?invite|join[-_]?workspace|join[-_]?team|join[-_]?organization)/i,
    name: 'invite-action-path',
    baseConfidence: 94,
    type: 'activation',
    description: 'Invite acceptance action',
  },
  {
    pattern: /\/(?:magic[-_]?link|passwordless|email[-_]?login|signin[-_]?link|login[-_]?link)/i,
    name: 'magic-login-path',
    baseConfidence: 92,
    type: 'activation',
    description: 'Magic or passwordless login path',
  },
  {
    pattern: /\/(?:authorize|approve|authenticate|device[-_]?confirm|trust[-_]?device)/i,
    name: 'authorization-path',
    baseConfidence: 90,
    type: 'activation',
    description: 'Authorization or device confirmation path',
  },

  // Password Reset Links
  {
    pattern: /\/reset[-_]?password/i,
    name: 'reset-password-path',
    baseConfidence: 98,
    type: 'password-reset',
    description: 'Password reset',
  },
  {
    pattern: /\/forgot[-_]?password/i,
    name: 'forgot-password-path',
    baseConfidence: 95,
    type: 'password-reset',
    description: 'Forgot password',
  },
  {
    pattern: /\/recover[-_]?account/i,
    name: 'recover-account-path',
    baseConfidence: 90,
    type: 'password-reset',
    description: 'Account recovery',
  },

  // Token/Code Parameters
  {
    pattern: /[?&](?:invite(?:_token)?|invitation(?:_token)?|accept_invite)=[a-zA-Z0-9._-]{8,}/i,
    name: 'invite-token-param',
    baseConfidence: 92,
    type: 'activation',
    description: 'Invite token parameter',
  },
  {
    pattern:
      /[?&](?:confirmation_token|confirm_token|verification_token|activation_token|magic_token|login_token)=[a-zA-Z0-9._-]{8,}/i,
    name: 'activation-token-param',
    baseConfidence: 92,
    type: 'activation',
    description: 'Activation token parameter',
  },
  {
    pattern: /[?&]token=[a-zA-Z0-9_-]{20,}/i,
    name: 'token-param',
    baseConfidence: 90,
    type: 'verification',
    description: 'Token parameter',
  },
  {
    pattern: /[?&]code=[a-zA-Z0-9_-]{10,}/i,
    name: 'code-param',
    baseConfidence: 85,
    type: 'verification',
    description: 'Code parameter',
  },
  {
    pattern: /[?&]id=[a-f0-9-]{30,}/i,
    name: 'id-param-uuid',
    baseConfidence: 80,
    type: 'activation',
    description: 'UUID parameter',
  },
  {
    pattern: /[?&]action=verify/i,
    name: 'action-verify-param',
    baseConfidence: 75,
    type: 'verification',
    description: 'Action=verify',
  },
  {
    pattern: /[?&]type=activation/i,
    name: 'type-activation-param',
    baseConfidence: 85,
    type: 'activation',
    description: 'Type=activation',
  },

  // ── NEW: Additional Common Activation Paths ─────────────────────────────
  {
    // /callback and /oauth/callback — common in OIDC/OAuth flows (Auth0, Okta, etc.)
    pattern: /\/(?:oauth\/)?callback(?:\/|$|\?)/i,
    name: 'callback-path',
    baseConfidence: 88,
    type: 'activation',
    description: 'OAuth/OIDC callback path',
  },
  {
    // /complete, /complete-signup, /complete-registration
    pattern: /\/complete(?:[-_]?(?:signup|registration|verification|account|email))?(?:\/|$|\?)/i,
    name: 'complete-path',
    baseConfidence: 85,
    type: 'activation',
    description: 'Completion path',
  },
  {
    // /auth/verify, /auth/confirm — sub-path auth verification
    pattern: /\/auth(?:enticate)?\/(?:verify|confirm|validate|activate|complete)(?:\/|$|\?)/i,
    name: 'auth-sub-verify-path',
    baseConfidence: 94,
    type: 'activation',
    description: 'Auth sub-path verification',
  },
  {
    // /user/activate, /users/verify, /account/activate
    pattern: /\/(?:user|users|account|accounts|member|members)\/(?:activate|verify|confirm|validate)(?:\/|$|\?)/i,
    name: 'user-activate-path',
    baseConfidence: 94,
    type: 'activation',
    description: 'User/account activation path',
  },
  {
    // /register/confirm, /registration/verify
    pattern: /\/register(?:ation)?\/(?:confirm|verify|activate|complete)(?:\/|$|\?)/i,
    name: 'registration-confirm-path',
    baseConfidence: 92,
    type: 'activation',
    description: 'Registration confirmation path',
  },
  {
    // /onboard, /onboarding/complete
    pattern: /\/onboard(?:ing)?(?:\/|$|\?)/i,
    name: 'onboarding-path',
    baseConfidence: 80,
    type: 'activation',
    description: 'Onboarding path',
  },
  {
    // Hash-fragment tokens: /verify#token=abc123, /activate#code=xyz
    // Standard URL parsers strip fragments — we detect them here before normalisation
    pattern: /#(?:token|code|access_token|id_token|invite_token|confirmation_token|magic_token|auth_token)=[A-Za-z0-9._%-]{8,}/i,
    name: 'hash-fragment-token',
    baseConfidence: 90,
    type: 'activation',
    description: 'Token in URL hash fragment',
  },
  {
    // /set-password, /create-password (post-invite flows)
    pattern: /\/(?:set|create|choose)[-_]?password(?:\/|$|\?)/i,
    name: 'set-password-path',
    baseConfidence: 88,
    type: 'password-reset',
    description: 'Set/create password path',
  },
  {
    // /link/login, /login/link, /email/verify (Supabase, Firebase Auth patterns)
    pattern: /\/(?:link\/login|login\/link|email\/verify|verify\/email|auth\/link)(?:\/|$|\?)/i,
    name: 'email-link-login-path',
    baseConfidence: 93,
    type: 'activation',
    description: 'Email link login path (Supabase/Firebase)',
  },
];

