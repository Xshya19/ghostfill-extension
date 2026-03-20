declare module '@onedaydevelopers/otp-detector' {
  interface DetectorOptions {
    positiveKeywords?: string[];
    negativeKeywords?: string[];
    neighborhood?: number;
  }

  export function extractOTPFromEmail(
    params?: { subject?: string; text?: string; html?: string },
    options?: DetectorOptions
  ): string | null;

  export function extractOTP(value: string, options?: DetectorOptions): string | null;
}
