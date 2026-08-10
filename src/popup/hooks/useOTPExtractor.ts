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
          const toSafeStr = (v: unknown): string => {
            if (typeof v === 'string') return v;
            if (!v) return '';
            if (typeof v === 'object') {
              const obj = v as Record<string, unknown>;
              if (typeof obj.text === 'string') return obj.text;
              if (typeof obj.html === 'string') return obj.html;
              if (typeof obj.body === 'string') return obj.body;
              if (typeof obj.content === 'string') return obj.content;
              try { return JSON.stringify(v); } catch { return String(v); }
            }
            return String(v);
          };

          const rawBody = toSafeStr(email.body);
          const rawTextBody = toSafeStr(email.textBody) || rawBody;
          const rawHtmlBody = toSafeStr(email.htmlBody) || (rawBody.includes('<') ? rawBody : '');

          const response = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: {
              subject: typeof email.subject === 'string' ? email.subject : String(email.subject || ''),
              textBody: rawTextBody,
              htmlBody: rawHtmlBody,
              source: 'popup-inbox',
              emailId: email.id,
              emailFrom: typeof email.from === 'string' ? email.from : String(email.from || ''),
              emailDate: email.date,
              saveToLastOTP: false,
            },
          })) as { success: boolean; otp?: string; link?: string };

          if (mounted) {
            const otpVal =
              response?.success && response?.otp ? normalizePopupOTP(response.otp) : null;
            const linkVal = response?.success && response?.link ? response.link : null;
            if (otpVal !== null) {
              otpsRef.current = { ...otpsRef.current, [email.id]: otpVal };
              setEmailOTPs((prev) => ({ ...prev, [email.id]: otpVal }));
            }
            if (linkVal !== null) {
              linksRef.current = { ...linksRef.current, [email.id]: linkVal };
              setEmailLinks((prev) => ({ ...prev, [email.id]: linkVal }));
            }
          }
        } catch {
          // Keep the id unmarked so it is retried on the next pass instead of being cached as null
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
