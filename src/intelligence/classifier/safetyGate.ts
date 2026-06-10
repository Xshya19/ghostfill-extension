// Deterministic safety gate. This is NOT a classifier and NOT a fallback brain.
// It is a seatbelt: a small set of inviolable rules that prevent the worst
// outcomes when typing into password/OTP fields. It runs AFTER classification
// and can only BLOCK or annotate -- it never changes the predicted class.

import type { ClassificationResult, FieldClass, RawFieldRecord } from '../types';

export interface SafetyVerdict {
  allow: boolean;
  reason: string;
}

// OTP/password capability check: would it be safe to type this kind of secret
// into this element at all?
function otpCapable(r: RawFieldRecord): boolean {
  if (r.type === 'email') {
    return false;
  } // never type an OTP into an email field
  if (r.maxLength > 0 && r.maxLength < 4 && r.maxLength !== 1) {
    return false;
  } // too short for a code, not a split box
  return true;
}

export function checkSafety(
  r: RawFieldRecord,
  result: ClassificationResult,
  chosen: FieldClass
): SafetyVerdict {
  // 1) never fill anything into a detected honeypot / invisible trap
  if (result.hardNegative === 'Honeypot') {
    return { allow: false, reason: 'honeypot trap field' };
  }
  if (!r.visible && r.type !== 'hidden') {
    const isCustomStyledInput = r.opacityZero && !r.offscreen && !r.tiny;
    if (!r.focused && !isCustomStyledInput) {
      return { allow: false, reason: 'field not visible' };
    }
  }
  // 2) never fill identity/OTP into a payment/search/captcha/coupon field
  const dangerousNegatives = new Set([
    'CVV',
    'CardNumber',
    'CardExpiry',
    'Captcha',
    'Coupon',
    'Search',
    'Amount',
    'ZIP',
    'DateOfBirth',
  ]);
  if (result.hardNegative && dangerousNegatives.has(result.hardNegative) && chosen !== 'Unknown') {
    return {
      allow: false,
      reason: 'target looks like ' + result.hardNegative + ', refusing identity/OTP fill',
    };
  }
  // 3) OTP must only go into an OTP-capable element
  if (chosen === 'OTP' && !otpCapable(r)) {
    return { allow: false, reason: 'element not OTP-capable (type/maxLength)' };
  }
  // 4) secrets only into appropriate input types
  if ((chosen === 'Password' || chosen === 'Target_Password_Confirm') && r.type === 'email') {
    return { allow: false, reason: 'refusing to type password into an email field' };
  }
  return { allow: true, reason: 'no safety rule triggered' };
}

// Post-fill verification helper. After writing a value, confirm it landed.
// (Note for OTP on type=number with leading zero -- see audit P0-3.)
export function verifyFill(
  expected: string,
  actual: string,
  fieldType: string
): { ok: boolean; reason: string } {
  if (actual === expected) {
    return { ok: true, reason: 'exact match' };
  }
  if (fieldType === 'number') {
    const strippedExpected = expected.replace(/^0+/, '');
    if (actual === strippedExpected && strippedExpected !== expected) {
      return {
        ok: false,
        reason: 'number field dropped leading zero(s); refill via keystroke path',
      };
    }
  }
  const digitsExpected = expected.replace(/[^0-9]/g, '');
  const digitsActual = actual.replace(/[^0-9]/g, '');
  if (digitsExpected && digitsExpected === digitsActual) {
    return { ok: true, reason: 'matched after stripping formatting' };
  }
  return { ok: false, reason: 'value mismatch after fill' };
}
