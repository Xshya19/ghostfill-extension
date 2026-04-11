import { useState, useEffect } from 'react';
import { Email } from '../../types';
import { safeSendMessage } from '../../utils/messaging';

/**
 * Hook to asynchronously extract high-quality OTPs from a list of emails
 * using the background script's 12-layer extractor.
 */
export function useOTPExtractor(emails: Email[]): { otps: Record<string, string | null>, links: Record<string, string | null> } {
  const [emailOTPs, setEmailOTPs] = useState<Record<string, string | null>>({});
  const [emailLinks, setEmailLinks] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let mounted = true;
    
    const fetchMissing = async () => {
      // Find emails that we haven't extracted yet
      const missingOTPs = emails.filter((e) => emailOTPs[e.id] === undefined);
      if (missingOTPs.length === 0) return;

      // Extract up to 10 at a time to avoid overloading the message bus
      for (const email of missingOTPs.slice(0, 10)) {
        if (!mounted) break;
        
        try {
          const response = (await safeSendMessage({
            action: 'EXTRACT_OTP',
            payload: { 
              subject: email.subject,
              textBody: email.textBody || email.body || '',
              htmlBody: email.htmlBody || (email.body.includes('<') ? email.body : ''),
              source: 'popup-inbox' 
            },
          })) as { success: boolean; otp?: string; link?: string };

          if (mounted) {
            setEmailOTPs((prev) => ({
              ...prev,
              [email.id]: response?.success && response?.otp ? response.otp : null,
            }));
            setEmailLinks((prev) => ({
              ...prev,
              [email.id]: response?.success && response?.link ? response.link : null,
            }));
          }
        } catch {
          if (mounted) {
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
  }, [emails, emailOTPs]);

  return { otps: emailOTPs, links: emailLinks };
}
