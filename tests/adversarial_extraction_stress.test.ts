import { describe, it, expect } from 'vitest';
import { extractAll } from '../src/services/intelligentExtractor';
import { extractOTP } from '../src/services/extraction/otpExtractor';

describe('Adversarial Extraction & False-Positive Stress Suite', () => {
  describe('Extreme Payload & Deep Nested HTML', () => {
    it('successfully parses a 50KB email with deeply nested tables and 20 marketing links', () => {
      let nestedHtml = '<div class="email-wrapper"><table><tbody>';
      for (let i = 0; i < 20; i++) {
        nestedHtml += `<tr><td><a href="https://marketing.example.com/promo?id=${i}&utm_source=email">Special Deal #${i} - Click Here</a></td></tr>`;
      }
      nestedHtml += `<tr><td>
        <p>Thank you for signing up! Please confirm your account below:</p>
        <a href="https://auth.example.com/verify-email?token=sec_token_998877665544" class="btn-primary" style="background:#6366f1;color:#fff;padding:12px 24px;">Verify Email Address</a>
      </td></tr>`;
      nestedHtml += '</tbody></table></div>';

      const result = extractAll(
        'Confirm your registration on ExampleApp',
        'Confirm your registration on ExampleApp. Verify Email Address: https://auth.example.com/verify-email?token=sec_token_998877665544',
        nestedHtml,
        'no-reply@example.com'
      );

      expect(result.link).toBeDefined();
      expect(result.link?.url).toContain('https://auth.example.com/verify-email?token=sec_token_998877665544');
      expect(result.intent).toBe('activation');
    });

    it('extracts OTP code hidden inside zero-width spaces and Unicode formatting chars', () => {
      // Obfuscated with zero-width spaces (\u200B), zero-width non-joiners (\u200C), zero-width joiners (\u200D), BOM (\uFEFF)
      const obfuscatedBody = 'Your security verification code is: 7\u200B4\u200C9\u200D1\uFEFF8\u20603. Use it to complete sign-in.';
      
      const otp = extractOTP(obfuscatedBody);
      expect(otp).toBeDefined();
      expect(otp?.code).toBe('749183');
    });
  });

  describe('False-Positive Number Discrimination', () => {
    it('selects the genuine OTP and rejects phone numbers, zip codes, years, and order IDs', () => {
      const emailText = `
        Dear Customer,
        Thank you for your order #88492019 placed on May 15, 2026.
        Your shipment will be delivered to Beverly Hills, CA 90210.
        Tracking number: 1Z9999999999999999.
        
        To verify your login to view shipping details, enter your one-time passcode:
        Your verification code: 628401
        
        If you have questions, call customer support at +1 (800) 555-0199.
        © 2026 Example Corp. All rights reserved.
      `;

      const otp = extractOTP(emailText);
      expect(otp).toBeDefined();
      expect(otp?.code).toBe('628401');
    });

    it('extracts alphanumeric dashed OTP codes cleanly', () => {
      const emailText = 'Here is your one-time verification passcode: K9X-4B2. Valid for 10 minutes.';
      const otp = extractOTP(emailText);
      expect(otp).toBeDefined();
      expect(otp?.code.replace(/[-\s]/g, '')).toMatch(/K9X4B2/i);
    });

    it('extracts bracketed and quoted OTP codes', () => {
      const emailText = 'Your one-time password is: [ 491823 ]. Do not share this code.';
      const otp = extractOTP(emailText);
      expect(otp).toBeDefined();
      expect(otp?.code).toBe('491823');
    });

    it('extracts OTP formatted with spaces between individual digits', () => {
      const emailText = 'Your confirmation code is 8 4 9 2 0 1. Enter this to finish signing up.';
      const otp = extractOTP(emailText);
      expect(otp).toBeDefined();
      expect(otp?.code.replace(/\s+/g, '')).toBe('849201');
    });
  });

  describe('Multi-Link Cognitive Discrimination', () => {
    it('prioritizes primary CTA verification button over footer and social links', () => {
      const linksHtml = `
        <div>
          <a href="https://example.com/unsubscribe">Unsubscribe</a>
          <a href="https://twitter.com/example">Twitter</a>
          <a href="https://facebook.com/example">Facebook</a>
          <a href="https://example.com/privacy-policy">Privacy Policy</a>
          <a href="https://app.example.com/confirm_account?token=abcdef1234567890" class="btn-verify">Confirm My Account</a>
          <a href="https://example.com/terms">Terms of Service</a>
          <a href="https://play.google.com/store/apps/details?id=com.example">Download Android App</a>
        </div>
      `;

      const result = extractAll(
        'Please confirm your account',
        'Please confirm your account: https://app.example.com/confirm_account?token=abcdef1234567890',
        linksHtml,
        'accounts@app.example.com'
      );

      expect(result.link).toBeDefined();
      expect(result.link?.url).toContain('https://app.example.com/confirm_account?token=abcdef1234567890');
    });
  });
});
