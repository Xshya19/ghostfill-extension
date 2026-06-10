import { useState, useEffect, useMemo, useRef } from 'react';
import { Email } from '../../types';
import { safeSendMessage } from '../../utils/messaging';

const normalizePopupOTP = (otp: string | undefined): string | null => {
  if (!otp) {
    return null;
  }

  const clean = otp.replace(/[-\s]/g, '').trim();
  if (clean.length < 4 || clean.length > 10) {
    return null;
  }
  if (!/\d/.test(clean) || !/^[A-Za-z0-9]+$/.test(clean)) {
    return null;
  }

  return clean;
};

/**
 * Hook to asynchronously extract high-quality OTPs from a list of emails
 * using the background script's 12-layer extractor.
 */
export function useOTPExtractor(emails: Email[]): {
  otps: Record<string, string | null>;
  links: Record<string, string | null>;
} {
  const [emailOTPs, setEmailOTPs] = useState<Record<string, string | null>>({});
  const [emailLinks, setEmailLinks] = useState<Record<string, string | null>>({});
  const otpsRef = useRef<Record<string, string | null>>({});
  const linksRef = useRef<Record<string, string | null>>({});
  const emailKey = useMemo(
    () => emails.map((email) => `${email.id}:${email.date}`).join('|'),
    [emails]
  );
  const stableEmails = useMemo(() => emails, [emailKey]);

  useEffect(() => {
    let mounted = true;
    const activeIds = new Set(stableEmails.map((email) => email.id));
    otpsRef.current = Object.fromEntries(
      Object.entries(otpsRef.current).filter(([id]) => activeIds.has(id))
    );
    linksRef.current = Object.fromEntries(
      Object.entries(linksRef.current).filter(([id]) => activeIds.has(id))
    );
    setEmailOTPs((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id)))
    );
    setEmailLinks((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([id]) => activeIds.has(id)))
    );

    const fetchMissing = async () => {
      // Find emails that we haven't extracted yet using ref to avoid stale closure
      const missingOTPs = stableEmails
        .filter((e) => otpsRef.current[e.id] === undefined)
        .sort((a, b) => {
          const dateA = typeof a.date === 'number' ? a.date : Date.parse(String(a.date));
          const dateB = typeof b.date === 'number' ? b.date : Date.parse(String(b.date));
          return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0);
        });
      if (missingOTPs.length === 0) {
        return;
      }

      // Extract sequentially to avoid overloading the message bus.
      for (const email of missingOTPs) {
        if (!mounted) {
          break;
        }

        try {
          const response = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: {
              subject: email.subject,
              textBody: email.textBody || email.body || '',
              htmlBody: email.htmlBody || (email.body?.includes('<') ? email.body : ''),
              source: 'popup-inbox',
              emailId: email.id,
              emailFrom: email.from,
              emailDate: email.date,
              saveToLastOTP: false,
            },
          })) as { success: boolean; otp?: string; link?: string };

          if (mounted) {
            const otpVal =
              response?.success && response?.otp ? normalizePopupOTP(response.otp) : null;
            const linkVal = response?.success && response?.link ? response.link : null;
            otpsRef.current = { ...otpsRef.current, [email.id]: otpVal };
            linksRef.current = { ...linksRef.current, [email.id]: linkVal };
            setEmailOTPs((prev) => ({ ...prev, [email.id]: otpVal }));
            setEmailLinks((prev) => ({ ...prev, [email.id]: linkVal }));
          }
        } catch {
          if (mounted) {
            otpsRef.current = { ...otpsRef.current, [email.id]: null };
            linksRef.current = { ...linksRef.current, [email.id]: null };
            setEmailOTPs((prev) => ({ ...prev, [email.id]: null }));
            setEmailLinks((prev) => ({ ...prev, [email.id]: null }));
          }
        }
      }
    };

    void fetchMissing();

    return () => {
      mounted = false;
    };
  }, [stableEmails]);

  return { otps: emailOTPs, links: emailLinks };
}
