/**
 * Popup hooks — OTP extraction and live storage subscription.
 *
 * Merged from the old popup/hooks/ folder so the popup has one hook module
 * instead of three files behind a barrel.
 */
import { useState, useEffect, useMemo, useRef } from 'react';

import {
  extractExplicitVerificationCode,
  isSubjectDomainToken,
} from '../../services/extraction/explicitCode';
import { storageService } from '../../services/storageService';
import { Email, StorageSchema } from '../../types';
import { contentFingerprint } from '../../utils/contentFingerprint';
import { contentToString, isWebUrl } from '../../utils/core';
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

const emailExtractionKey = (email: Email): string =>
  contentFingerprint([
    String(email.id),
    String(email.date),
    contentToString(email.from),
    contentToString(email.subject),
    contentToString(email.body),
    contentToString(email.textBody),
    contentToString(email.htmlBody),
  ]);

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
  const extractedKeysRef = useRef<Record<string, string>>({});
  const emailKey = useMemo(
    () => emails.map(emailExtractionKey).join('|'),
    [emails]
  );
  const stableEmails = useMemo(() => emails, [emailKey]);

  useEffect(() => {
    let mounted = true;
    const activeIds = new Set(
      stableEmails
        .filter((email) => extractedKeysRef.current[email.id] === emailExtractionKey(email))
        .map((email) => email.id)
    );
    extractedKeysRef.current = Object.fromEntries(
      Object.entries(extractedKeysRef.current).filter(([id]) => activeIds.has(id))
    );
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
          const rawBody = contentToString(email.body);
          const rawTextBody = contentToString(email.textBody) || rawBody;
          const rawHtmlBody = contentToString(email.htmlBody) || (rawBody.includes('<') ? rawBody : '');

          const response = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: {
              subject:
                typeof email.subject === 'string' ? email.subject : String(email.subject || ''),
              textBody: rawTextBody,
              htmlBody: rawHtmlBody,
              source: 'popup-inbox',
              emailId: email.id,
              emailFrom: typeof email.from === 'string' ? email.from : String(email.from || ''),
              emailDate: email.date,
              // Keep the shared OTP cache in sync so the content-side floating
              // fill action can use the code extracted from the inbox row.
              saveToLastOTP: true,
            },
          })) as { success: boolean; otp?: string; link?: string };

          if (mounted) {
            const labeledCode = extractExplicitVerificationCode(rawTextBody);
            const responseCode =
              response?.success && response?.otp ? normalizePopupOTP(response.otp) : null;
            const otpVal =
              labeledCode ||
              (responseCode && !isSubjectDomainToken(responseCode, email.subject)
                ? responseCode
                : null);
            const linkVal =
              response?.success && response?.link && isWebUrl(response.link)
                ? response.link
                : null;
            if (response?.success) {
              extractedKeysRef.current[email.id] = emailExtractionKey(email);
              otpsRef.current = { ...otpsRef.current, [email.id]: otpVal };
              setEmailOTPs((prev) => ({ ...prev, [email.id]: otpVal }));
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

export function useStorageSubscription<K extends keyof StorageSchema>(
  key: K,
  initialValue: StorageSchema[K] | null
): StorageSchema[K] | null {
  const [value, setValue] = useState<StorageSchema[K] | null>(initialValue);
  const initialValueRef = useRef(initialValue);
  const refreshSeqRef = useRef(0);

  useEffect(() => {
    initialValueRef.current = initialValue;
  }, [initialValue]);

  useEffect(() => {
    let isMounted = true;
    const refreshValue = async (): Promise<void> => {
      const seq = ++refreshSeqRef.current;
      try {
        const data = await storageService.get(key);
        if (!isMounted || seq !== refreshSeqRef.current) {
          return;
        }
        setValue((data ?? null) as StorageSchema[K] | null);
      } catch {
        if (isMounted && seq === refreshSeqRef.current) {
          setValue(initialValueRef.current);
        }
      }
    };

    // Load initial value
    void refreshValue();

    // Listen via storageService so refreshValue() runs only after the internal
    // cache is synced (including decrypted sensitive values), never against a
    // stale or still-missing cache entry.
    const unsubscribe = storageService.onChanged((changes) => {
      if (changes[key as string]) {
        void refreshValue();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [key]);

  return value;
}
