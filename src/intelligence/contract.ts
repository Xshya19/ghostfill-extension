// THE feature/label contract. Single source of truth shared by harvesting,
// labeling, classification, eval, and (later) training.
//
// FIXES audit bug P1-1 / P1-2:
//   - structural vector is 64-dim (was 128; dims 56..63 reserved/zero)
//   - labels are the canonical 10-class CAPS space (was 9 lowercase classes)

import type { FieldClass } from './types';

export const NUM_STRUCTURAL_FEATURES = 64;

export const FIELD_CLASSES: FieldClass[] = [
  'Email',
  'Username',
  'Password',
  'Target_Password_Confirm',
  'First_Name',
  'Last_Name',
  'Full_Name',
  'Phone',
  'OTP',
  'Unknown',
];

// Named indices into the structural vector. 0..55 are populated by the
// extractor; 56..63 are reserved for forward-compatible additions so the model
// input width never has to change again.
export const STRUCT = {
  // input type one-hots (0..7)
  TYPE_TEXT: 0,
  TYPE_EMAIL: 1,
  TYPE_PASSWORD: 2,
  TYPE_TEL: 3,
  TYPE_NUMBER: 4,
  TYPE_SEARCH: 5,
  TYPE_HIDDEN: 6,
  TYPE_OTHER: 7,
  // autocomplete coarse buckets (8..15)
  AC_EMAIL: 8,
  AC_USERNAME: 9,
  AC_CURRENT_PASSWORD: 10,
  AC_NEW_PASSWORD: 11,
  AC_ONE_TIME_CODE: 12,
  AC_TEL: 13,
  AC_NAME: 14,
  AC_OFF_OR_NONE: 15,
  // structural / layout (16..31)
  MAXLEN_IS_1: 16,
  MAXLEN_LE_8: 17,
  WIDTH_LE_90: 18,
  INPUTMODE_NUMERIC: 19,
  PATTERN_DIGITS: 20,
  REQUIRED: 21,
  VISIBLE: 22,
  HAS_LABEL: 23,
  HAS_PLACEHOLDER: 24,
  HAS_ARIA: 25,
  IN_FORM: 26,
  SIBLING_SAME_SHAPE_COUNT_4_8: 27, // split-OTP signal
  OFFSCREEN: 28,
  ZERO_OPACITY: 29,
  TINY_SIZE: 30,
  IS_TEXTAREA: 31,
  // keyword presence on combined text (32..55)
  KW_EMAIL: 32,
  KW_USER: 33,
  KW_PASS: 34,
  KW_CONFIRM: 35,
  KW_NEW: 36,
  KW_CURRENT: 37,
  KW_OTP: 38,
  KW_CODE: 39,
  KW_VERIFY: 40,
  KW_PHONE: 41,
  KW_FIRST: 42,
  KW_LAST: 43,
  KW_FULLNAME: 44,
  KW_CVV: 45,
  KW_CARD: 46,
  KW_EXPIRY: 47,
  KW_ZIP: 48,
  KW_SEARCH: 49,
  KW_COUPON: 50,
  KW_CAPTCHA: 51,
  KW_AMOUNT: 52,
  KW_DOB: 53,
  KW_DIGITS_IN_NAME: 54,
  KW_OTP_LENGTH_HINT: 55,
  // 56..63 reserved
} as const;

export function emptyStructural(): number[] {
  return new Array(NUM_STRUCTURAL_FEATURES).fill(0);
}
