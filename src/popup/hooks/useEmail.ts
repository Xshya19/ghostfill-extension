import { useState, useEffect, useCallback } from 'react';
import { EmailAccount, Email } from '../../types';
import type { GenerateEmailResponse, CheckInboxResponse } from '../../types/message.types';
import { safeSendMessage } from '../../utils/messaging';

export function useEmail() {
    const [email, setEmail] = useState<EmailAccount | null>(null);
    const [inbox, setInbox] = useState<Email[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadCurrentEmail();
    }, []);

    const loadCurrentEmail = async () => {
        try {
            const response = await safeSendMessage({ action: 'GET_CURRENT_EMAIL' });
            const typedResponse = response as GenerateEmailResponse;
            if (typedResponse && 'email' in typedResponse && typedResponse.email) {
                setEmail(typedResponse.email as EmailAccount);
            }
        } catch (err) {
            setError('Failed to load email');
        }
    };

    const generateEmail = useCallback(async (options?: { service?: string; prefix?: string }) => {
        setLoading(true);
        setError(null);
        try {
            const response = await safeSendMessage({
                action: 'GENERATE_EMAIL',
                payload: options as any || {},  // Type assertion for dynamic service selection
            });
            const typedResponse = response as GenerateEmailResponse;
            if (typedResponse && 'email' in typedResponse && typedResponse.email) {
                setEmail(typedResponse.email as EmailAccount);
                setInbox([]);
                return typedResponse.email as EmailAccount;
            }
            throw new Error((typedResponse as any)?.error || 'Failed to generate email');
        } catch (err) {
            setError((err as Error).message);
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    const checkInbox = useCallback(async () => {
        if (!email) {return [];}
        setLoading(true);
        try {
            const response = await safeSendMessage({ action: 'CHECK_INBOX' });
            const typedResponse = response as CheckInboxResponse;
            if (typedResponse && 'emails' in typedResponse && typedResponse.emails) {
                setInbox(typedResponse.emails);
                return typedResponse.emails;
            }
            return [];
        } catch (err) {
            setError('Failed to check inbox');
            return [];
        } finally {
            setLoading(false);
        }
    }, [email]);

    const copyEmail = useCallback(async () => {
        if (!email) {return false;}
        try {
            await navigator.clipboard.writeText(email.fullEmail);
            return true;
        } catch {
            return false;
        }
    }, [email]);

    return {
        email,
        inbox,
        loading,
        error,
        generateEmail,
        checkInbox,
        copyEmail,
        refresh: loadCurrentEmail,
    };
}
