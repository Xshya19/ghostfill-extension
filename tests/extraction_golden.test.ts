import { describe, it, expect } from 'vitest';
import { prepareForParsing } from '../src/services/extraction/parseText';
import { extractOtp } from '../src/services/extraction/otpEngine';
import { extractAnchors, pickActivationLink } from '../src/services/extraction/linkEngine';
import fs from 'fs';
import path from 'path';

interface TestCase {
  id: string;
  provider?: string;
  desc?: string;
  subject?: string;
  text?: string;
  html?: string;
  intent?: 'verification' | 'activation' | 'password-reset';
  expect: {
    otp?: string | null;
    link?: string | null;
    action?: string;
  };
}

const corpusPath = path.resolve(__dirname, 'fixtures/otp-corpus.jsonl');
const rawCases = fs.readFileSync(corpusPath, 'utf-8');
const cases: TestCase[] = rawCases.trim().split('\n').map((l) => JSON.parse(l));

describe('Golden Corpus Extraction & Accuracy Suite', () => {
  let wrongFillCount = 0;

  for (const c of cases) {
    it(`${c.id} — ${c.desc ?? c.provider ?? 'fixture'}`, () => {
      const p = prepareForParsing(c.subject ?? '', c.text ?? '', c.html ?? '');

      if (c.expect.otp !== undefined) {
        const v = extractOtp(p, { intent: c.intent ?? 'verification' });

        if (c.expect.otp === null) {
          if (v.action === 'autofill') wrongFillCount++;
          expect(v.action, `Must not autofill; got code=${v.code} p=${v.probability.toFixed(3)}`).not.toBe('autofill');
        } else {
          if (v.action === 'autofill' && v.code !== c.expect.otp) wrongFillCount++;
          expect(v.code, `Code mismatch: expected ${c.expect.otp}, got ${v.code} (p=${v.probability.toFixed(3)})`).toBe(c.expect.otp);
          if (c.expect.action) {
            expect(v.action).toBe(c.expect.action);
          }
        }
      }

      if (c.expect.link !== undefined) {
        const anchors = extractAnchors(c.html ?? '');
        const verdict = pickActivationLink(anchors, [], c.intent ?? 'activation');

        if (c.expect.link === null) {
          expect(verdict.action, `Must not auto-open link; got ${verdict.url}`).not.toBe('auto-open');
        } else {
          expect(verdict.url).toBe(c.expect.link);
          if (c.expect.action) {
            expect(verdict.action).toBe(c.expect.action);
          }
        }
      }
    });
  }

  it('verifies ZERO wrong-fill rate across golden corpus', () => {
    expect(wrongFillCount).toBe(0);
  });
});
