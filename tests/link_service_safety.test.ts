import { describe, expect, it } from 'vitest';

import { linkService } from '../src/services/linkService';
import { extractAll } from '../src/services/intelligentExtractor';
import { isWebUrl } from '../src/utils/core';

describe('activation link OTP extraction', () => {
  it('keeps the Qwen code without presenting its email artwork as a verification link', () => {
    const image =
      'https://img.alicdn.com/imgextra/i1/O1CN01JQIbI2CoFjE2BxHU_!!6000000007672-2-tps-1080-1080.png';
    const body = `Your sign-in code\n[${image}]\nHi, reader@example.net,\nUse the verification code below to sign in to your account.\n\n700111\n\nThis code is valid for 5 minutes.`;
    for (const html of [
      '',
      `<img src="${image}"><p>Use the verification code below to sign in.</p><p>700111</p>`,
    ]) {
      const result = extractAll('Your Qwen sign-in code', body, html, 'Qwen');
      expect(result.otp?.code).toBe('700111');
      expect(result.link).toBeNull();
    }
    const url = 'https://accounts.service.net/verify?token=action_1234567890';
    const result = extractAll('Confirm your account', `[${image}]\nConfirm your account: ${url}`);
    expect(result.link?.url).toBe(url);
  });
  it('ignores an HTTP asset even if its anchor says Continue', () => {
    const url = 'http://new-service.example/assets/custom-action.svg?ticket=abc';
    const result = extractAll('Your account', url, `<a href="${url}">Continue</a>`);
    expect(result.link).toBeNull();
    expect(isWebUrl(url)).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
  });
  it('does not mistake activation credentials for fillable OTPs', () => {
    const tokenLinks = [
      'https://service.example/verify?token=ABC12345',
      'https://service.example/verify?oobCode=ABC12345',
      'https://service.example/verify?secret=ABC12345',
      'https://service.example/verify/ABC12345',
      'https://service.example/#token=ABC12345',
    ];
    for (const link of tokenLinks) {
      expect(linkService.extractCodeFromUrl(link), link).toBeNull();
    }
  });

  it('still extracts explicit, short OTP values', () => {
    expect(linkService.extractCodeFromUrl('https://service.example/verify?otp=ABC123')).toBe(
      'ABC123'
    );
    expect(linkService.extractCodeFromUrl('https://service.example/verify?code=123456')).toBe(
      '123456'
    );
    expect(linkService.extractCodeFromUrl('https://service.example/verify/123456')).toBe('123456');
  });
});
