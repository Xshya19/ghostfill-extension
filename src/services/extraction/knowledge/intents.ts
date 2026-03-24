import type { ContextKeyword } from '../../types/extraction.types';

export const CONTEXT_KEYWORD_DATABASE: Record<string, ContextKeyword[]> = {
  otp: [
    { keyword: 'verification code', weight: 35, strength: 'strong', category: 'otp' },
    { keyword: 'security code', weight: 30, strength: 'strong', category: 'otp' },
    { keyword: 'one-time password', weight: 35, strength: 'strong', category: 'otp' },
    { keyword: 'otp', weight: 35, strength: 'strong', category: 'otp' },
    { keyword: '2fa code', weight: 30, strength: 'strong', category: 'otp' },
    { keyword: 'authentication code', weight: 30, strength: 'strong', category: 'otp' },
    { keyword: 'passcode', weight: 25, strength: 'strong', category: 'otp' },
    { keyword: 'pin code', weight: 22, strength: 'medium', category: 'otp' },
    { keyword: 'code is', weight: 30, strength: 'strong', category: 'otp' },
    { keyword: 'your code', weight: 25, strength: 'medium', category: 'otp' },
    { keyword: 'enter code', weight: 22, strength: 'medium', category: 'otp' },
    { keyword: 'verify your identity', weight: 30, strength: 'strong', category: 'otp' },
    { keyword: 'never share', weight: 18, strength: 'medium', category: 'otp' },
    { keyword: 'expires in', weight: 15, strength: 'weak', category: 'otp' },
    { keyword: 'access code', weight: 25, strength: 'medium', category: 'otp' },
    { keyword: 'authorization code', weight: 25, strength: 'medium', category: 'otp' },
    { keyword: 'validation code', weight: 25, strength: 'medium', category: 'otp' },
    { keyword: 'confirmation code', weight: 25, strength: 'medium', category: 'otp' },
  ],

  activation: [
    { keyword: 'activate your account', weight: 40, strength: 'strong', category: 'activation' },
    { keyword: 'activation link', weight: 35, strength: 'strong', category: 'activation' },
    { keyword: 'verify your email', weight: 35, strength: 'strong', category: 'activation' },
    { keyword: 'email verification', weight: 32, strength: 'strong', category: 'activation' },
    { keyword: 'confirm your email', weight: 32, strength: 'strong', category: 'activation' },
    { keyword: 'welcome to', weight: 25, strength: 'medium', category: 'activation' },
    { keyword: 'click here', weight: 22, strength: 'medium', category: 'activation' },
    { keyword: 'click the link', weight: 25, strength: 'medium', category: 'activation' },
    { keyword: 'get started', weight: 20, strength: 'medium', category: 'activation' },
    { keyword: 'complete registration', weight: 28, strength: 'strong', category: 'activation' },
    { keyword: 'account created', weight: 22, strength: 'medium', category: 'activation' },
    { keyword: 'verify now', weight: 28, strength: 'strong', category: 'activation' },
    { keyword: 'activate now', weight: 30, strength: 'strong', category: 'activation' },
  ],

  'password-reset': [
    { keyword: 'reset password', weight: 40, strength: 'strong', category: 'password-reset' },
    { keyword: 'password reset', weight: 40, strength: 'strong', category: 'password-reset' },
    { keyword: 'forgot password', weight: 35, strength: 'strong', category: 'password-reset' },
    { keyword: 'new password', weight: 28, strength: 'strong', category: 'password-reset' },
    { keyword: 'recover account', weight: 28, strength: 'strong', category: 'password-reset' },
    { keyword: 'reset link', weight: 30, strength: 'strong', category: 'password-reset' },
  ],

  urgency: [
    { keyword: 'now', weight: 12, strength: 'weak', category: 'urgency' },
    { keyword: 'immediately', weight: 15, strength: 'medium', category: 'urgency' },
    { keyword: 'urgent', weight: 18, strength: 'medium', category: 'urgency' },
    { keyword: 'expires', weight: 15, strength: 'medium', category: 'urgency' },
    { keyword: 'limited time', weight: 15, strength: 'medium', category: 'urgency' },
  ],
};

export const INTENT_PATTERNS = {
  subject: {
    activation: [
      /activate.*account/i,
      /verify.*email/i,
      /welcome.*to/i,
      /confirm.*email/i,
      /get.*started/i,
      /complete.*registration/i,
    ],
    verification: [
      /verification.*code/i,
      /security.*code/i,
      /2fa/i,
      /otp/i,
      /sign[- ]?in.*attempt/i,
    ],
    'password-reset': [
      /reset.*password/i,
      /forgot.*password/i,
      /change.*password/i,
      /recover.*account/i,
    ],
  },
  url: {
    activation: [/activate/i, /verify/i, /confirm/i, /welcome/i],
    verification: [/2fa/i, /otp/i, /security/i, /auth/i],
    'password-reset': [/reset/i, /recover/i, /forgot/i],
  },
};
