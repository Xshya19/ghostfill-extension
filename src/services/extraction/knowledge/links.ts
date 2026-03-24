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
