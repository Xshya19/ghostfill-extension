import { describe, expect, it } from 'vitest';

import { linkService } from '../src/services/linkService';

describe('activation link OTP extraction', () => {
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
