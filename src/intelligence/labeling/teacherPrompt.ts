// Teacher prompt builder for diagnostics/eval labeling. A large LLM labels
// harvested fields with a rationale, calibrated confidence, and hard-negative
// tag so the heuristic classifier can be measured safely.

import { FIELD_CLASSES } from '../contract';
import type { RawFieldRecord } from '../types';

export const TEACHER_SYSTEM_PROMPT = [
  'You are an expert web form analyst labeling input fields for an autofill engine.',
  'For each field, choose EXACTLY ONE class from this set:',
  '  ' + FIELD_CLASSES.join(', '),
  '',
  'Rules:',
  '- Use Unknown when the field is not one of the identity/credential classes.',
  '- A field that looks like a credential but is actually a payment, search, coupon,',
  '  captcha, ZIP, amount, or date-of-birth field MUST be labeled Unknown, and you MUST',
  '  set hardNegative to the specific subtype (CVV, CardNumber, CardExpiry, ZIP, Search,',
  '  Coupon, Captcha, Amount, DateOfBirth, Honeypot).',
  '- An invisible/offscreen field requesting identity data is a Honeypot -> Unknown + hardNegative=Honeypot.',
  '- OTP = one-time verification codes (login codes, 2FA, passcodes). NOT CVV. NOT ZIP.',
  '- Target_Password_Confirm = the "confirm/repeat password" field, distinct from Password.',
  '- Be conservative: when genuinely ambiguous, prefer Unknown with lower confidence.',
  '',
  'Return STRICT JSON only, no prose. Schema:',
  '{"labels":[{"idx":number,"label":string,"hardNegative":string|null,"confidence":number,"rationale":string}]}',
  'confidence is 0..1. idx must match the input field index.',
].join('\n');

// Only labeling-relevant signals are sent (no user values) -- privacy-safe.
export function fieldToPromptObject(r: RawFieldRecord, idx: number): Record<string, unknown> {
  return {
    idx,
    tag: r.tag,
    type: r.type,
    autocomplete: r.autocomplete,
    name: r.name,
    id: r.id,
    placeholder: r.placeholder,
    ariaLabel: r.ariaLabel,
    labelText: r.labelText,
    surroundingText: r.surroundingText,
    maxLength: r.maxLength,
    inputMode: r.inputMode,
    pattern: r.pattern,
    required: r.required,
    visible: r.visible,
    widthPx: r.widthPx,
  };
}

export function buildUserPrompt(batch: RawFieldRecord[]): string {
  const items = batch.map((r, i) => fieldToPromptObject(r, i));
  return 'Label these ' + batch.length + ' fields:\n' + JSON.stringify(items, null, 2);
}
