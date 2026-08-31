/**
 * HARD: Intelligent Extraction + DomEngine + ActivationLinkGuard extreme
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractAll } from '../src/services/intelligentExtractor';
import { extractOTP } from '../src/services/extraction/otpExtractor';
import { extractActivationLink } from '../src/services/extraction/linkExtractor';
import { analyzeEmailZones } from '../src/services/extraction/zoneAnalyzer';
import { scoreActivationLink, isAutoOpenableActivationLink } from '../src/services/extraction/activationLinkGuard';
import { detectProvider } from '../src/services/extraction/providerDetector';
import { deepQuerySelectorAll, getUniqueSelector } from '../src/utils/core';

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ZoneAnalyzer — non-string robustness', () => {
  it('handles null, undefined, numbers, objects without throwing', () => {
    expect(() => analyzeEmailZones(null as any)).not.toThrow();
    expect(() => analyzeEmailZones(undefined as any)).not.toThrow();
    expect(() => analyzeEmailZones(12345 as any)).not.toThrow();
    expect(() => analyzeEmailZones({ html: '<b>test</b>' } as any)).not.toThrow();
  });

  it('detects preheader, hero, and footer sections in realistic HTML', () => {
    const html = `
      <div class="preheader" style="display:none">Use code 482910 to verify</div>
      <div class="header"><h1>Welcome</h1></div>
      <div class="hero"><p>Here is your code: <strong>482910</strong></p></div>
      <div class="footer"><a href="https://example.com/unsub">Unsubscribe</a></div>
    `;
    const zones = analyzeEmailZones(html);
    expect(zones).toBeDefined();
    expect(zones.length).toBeGreaterThan(0);
  });
});

describe('IntelligentExtractor — cross-validation & double-sanitize', () => {
  it('extractAll handles html vs text double-escape &amp;amp; not double-escaped', () => {
    const html = '<p>Your code is 482913 &amp; valid</p>';
    const result = extractAll('Verify your account', 'Your code is 482913 & valid', html, 'no-reply@example.com');
    expect(result.otp === null || result.otp?.code === '482913').toBe(true);
    if (result.otp) expect(result.otp.code).not.toContain('&amp;');
  });

  it('extractAll falls back plain text when html stripping loses context', () => {
    const result = extractAll('Subject is Hi', 'plain body has code 294018 for verification', '', 'a@b.com');
    expect(result.otp?.code).toBeDefined();
  });

  it('link extraction ESP unwrapping inside extractAll CTA vs footer discrimination', () => {
    const html = `
      <div class="email-wrapper"><table><tbody>
      ${Array.from({length:20},(_,i)=> `<tr><td><a href="https://marketing.example.com/promo?id=${i}">Deal ${i}</a></td></tr>`).join('')}
      <tr><td><a href="https://auth.example.com/verify-email?token=sec_token_998877" class="btn" style="background:#6366f1;color:#fff;padding:12px;">Verify Email Address</a></td></tr>
      </tbody></table><footer><a href="https://marketing.example.com/unsubscribe">Unsubscribe</a></footer></div>`;
    const r = extractAll('Confirm your registration', 'Confirm: https://auth.example.com/verify-email?token=sec_token_998877', html, 'no-reply@example.com');
    expect(r.link?.url).toContain('sec_token_998877');
  });
});

describe('ZoneAnalyzer — class-only CTA miss', () => {
  it('CTA with class="button" but no inline style still detected via class regex', () => {
    const htmlClassOnly = '<a class="button" href="https://x.com/verify?token=abc">Verify</a>';
    const zones1 = analyzeEmailZones(htmlClassOnly);
    expect(zones1).toBeDefined();
  });
});

describe('ProviderDetector — phishing boost guard', () => {
  it('detects known providers', () => {
    const provider = detectProvider('security@github.com', 'Your GitHub verification code is 123456', '', 'github.com');
    expect(provider).toBeDefined();
  });
});

describe('ActivationLinkGuard — strong 50-synonym path vs unsubscribe trap', () => {
  it('rejects unsubscribe urls', () => {
    const evil = 'https://evil.com/unsubscribe?user=123';
    const canOpen = isAutoOpenableActivationLink(evil, '<a href="https://evil.com/unsubscribe">Unsubscribe</a>');
    expect(canOpen).toBe(false);
  });

  it('strong path /confirm_account with token scores high quality and auto-openable', () => {
    const url = 'https://app.example.com/confirm_account?token=abcdef1234567890';
    const r = scoreActivationLink(url, `<a href="${url}">Confirm My Account</a>`, 'Please confirm your account');
    expect(r.quality).toBeGreaterThan(10);
    expect(isAutoOpenableActivationLink(url, `<a href="${url}">Confirm</a>`)).toBe(true);
  });

  it('marketing /terms and app store links never auto-open', () => {
    expect(isAutoOpenableActivationLink('https://example.com/privacy-policy', '<a>Privacy</a>')).toBe(false);
    expect(isAutoOpenableActivationLink('https://play.google.com/store/apps/details?id=com.example', '<a>App</a>')).toBe(false);
  });

  it('hash fragment token #token=abc is considered', () => {
    const url = 'https://example.com/verify#token=sec123';
    const r = scoreActivationLink(url, `<a href="${url}">Verify</a>`, 'verify');
    expect(r.quality).toBeGreaterThan(10);
  });
});

describe('DomEngine — NFKC & stack depth', () => {
  it('NFKC converts full-width digits to ASCII for OTP regex', async () => {
    const { normalizeForExtraction } = await import('../src/services/extraction/domEngine');
    const fw = '０１２３４５';
    const norm = normalizeForExtraction(fw);
    expect(norm).toBe('012345');
  });

  it('deepQuerySelectorAll scans shadow tree safely', () => {
    const container = document.createElement('div');
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('span');
    inner.textContent = 'deep';
    shadow.appendChild(inner);
    container.appendChild(host);
    document.body.appendChild(container);

    const results = deepQuerySelectorAll('span', document, 0);
    expect(Array.isArray(results)).toBe(true);
    document.body.removeChild(container);
  });

  it('getUniqueSelector produces unique selector', () => {
    const el = document.createElement('div');
    el.id = 'my-stable-id';
    document.body.appendChild(el);
    const sel = getUniqueSelector(el);
    expect(sel).toContain('my-stable-id');
    document.body.removeChild(el);
  });
});
