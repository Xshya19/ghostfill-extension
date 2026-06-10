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
    pattern: /\/(?:email[-_]?verification|verify[-_]?email|confirm[-_]?email|email\/confirm)/i,
    name: 'email-confirmation-path',
    baseConfidence: 94,
    type: 'activation',
    description: 'Email confirmation path',
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
];
