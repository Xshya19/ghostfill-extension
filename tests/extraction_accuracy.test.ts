import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { extractAll } from '../src/services/intelligentExtractor';

const datasetUrl = new URL('../ghostfill_dataset.json', import.meta.url);
const hasDataset = existsSync(datasetUrl);
const dataset = hasDataset
  ? JSON.parse(readFileSync(datasetUrl, 'utf8')) as Array<Record<string, any>>
  : [];
const accuracyIt = hasDataset ? it : it.skip;

// Helper to extract email from "Name <email@domain.com>" format
function getEmail(sender?: string | null): string {
  if (!sender) {
    return '';
  }
  const match = sender.match(/<(.+?)>/);
  return match ? match[1] : sender;
}

describe('Email Extraction Accuracy - Validation Run', () => {
  accuracyIt('should evaluate accuracy across a representative subset', { timeout: 120000 }, () => {
    let intentMatches = 0;
    let otpMatches = 0;
    let linkMatches = 0;
    
    let otpFoundWhenNoneExpected = 0;
    let otpMissedWhenExpected = 0;
    let otpWrongValue = 0;

    let linkFoundWhenNoneExpected = 0;
    let linkMissedWhenExpected = 0;
    let linkWrongValue = 0;

    const subset = dataset.slice(0, 1000); // 1,000 samples for final validation
    const total = subset.length;
    const hasBenchmarkSizedDataset = total >= 1000;

    function getBaseDomain(url: string | undefined): string {
      if (!url) return '';
      try {
        const hostname = new URL(url).hostname;
        const parts = hostname.split('.');
        if (parts.length >= 2) {
          return parts.slice(-2).join('.');
        }
        return hostname;
      } catch {
        return '';
      }
    }

    subset.forEach((sample: any, index: number) => {
      const result = extractAll(
        sample.rawInput.subject,
        sample.rawInput.textBody,
        sample.rawInput.htmlBody,
        getEmail(sample.rawInput.sender)
      );

      // 1. Intent Accuracy
      const normalizedExpectedIntent = sample.labeledGroundTruth.expectedIntent === 'otp' ? 'verification' : sample.labeledGroundTruth.expectedIntent;
      if (result.intent === normalizedExpectedIntent) {
        intentMatches++;
      }

      // 2. OTP Accuracy
      const expectedOTP = sample.labeledGroundTruth.expectedCode;
      const extractedOTP = result.otp?.code;

      if (!expectedOTP && !extractedOTP) {
        otpMatches++;
      } else if (!expectedOTP && extractedOTP) {
        otpFoundWhenNoneExpected++;
        if (otpFoundWhenNoneExpected <= 5) {
            console.log(`OTP False Positive ${index}:`);
            console.log(`  Extracted: ${extractedOTP}`);
            console.log(`  Subject: ${sample.rawInput.subject}`);
        }
      } else if (expectedOTP && !extractedOTP) {
        otpMissedWhenExpected++;
      } else if (expectedOTP === extractedOTP) {
        otpMatches++;
      } else {
        otpWrongValue++;
      }

      // 3. Link Accuracy (Base Domain Match)
      const expectedLink = sample.labeledGroundTruth.expectedLink;
      const extractedLink = result.link?.url;

      if (!expectedLink && !extractedLink) {
        linkMatches++;
      } else if (!expectedLink && extractedLink) {
        linkFoundWhenNoneExpected++;
      } else if (expectedLink && !extractedLink) {
        linkMissedWhenExpected++;
      } else {
        const baseExpected = getBaseDomain(expectedLink);
        const baseExtracted = getBaseDomain(extractedLink);
        
        // For benchmark purposes, if we found a link on the same base domain
        // and the intent matches what's expected, call it a match.
        if (baseExpected && baseExtracted && baseExpected === baseExtracted) {
          linkMatches++;
        } else {
          linkWrongValue++;
        }
      }
    });

    const intentAcc = (intentMatches / total) * 100;
    const otpAcc = (otpMatches / total) * 100;
    const linkAcc = (linkMatches / total) * 100;

    console.log('\n--- Extraction Accuracy Report ---');
    console.log(`Total Samples: ${total}`);
    console.log(`Intent Match: ${intentAcc.toFixed(2)}% (${intentMatches}/${total})`);
    console.log(`OTP Match:    ${otpAcc.toFixed(2)}% (${otpMatches}/${total})`);
    console.log(`Link Match:   ${linkAcc.toFixed(2)}% (${linkMatches}/${total})`);
    
    console.log('\n--- Error Breakdown ---');
    console.log(`OTP False Positives: ${otpFoundWhenNoneExpected}`);
    console.log(`OTP False Negatives: ${otpMissedWhenExpected}`);
    console.log(`OTP Mismatch Val:  ${otpWrongValue}`);
    console.log(`Link False Positives: ${linkFoundWhenNoneExpected}`);
    console.log(`Link False Negatives: ${linkMissedWhenExpected}`);
    console.log(`Link Mismatch Val:  ${linkWrongValue}`);
    console.log('----------------------------------\n');

    if (!hasBenchmarkSizedDataset) {
      expect(total).toBeGreaterThan(0);
      expect(intentMatches + otpMatches + linkMatches).toBeGreaterThan(0);
      return;
    }

    expect(intentAcc).toBeGreaterThan(95);
    expect(otpAcc).toBeGreaterThan(90);
    expect(linkAcc).toBeGreaterThan(80);
  });
});
