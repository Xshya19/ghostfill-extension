import { useState, useCallback } from 'react';
import { PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';
import type { GeneratePasswordResponse } from '../../types/message.types';
import { safeSendMessage } from '../../utils/messaging';

export function usePassword() {
    const [password, setPassword] = useState<GeneratedPassword | null>(null);
    const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generate = useCallback(async (customOptions?: Partial<PasswordOptions>) => {
        setLoading(true);
        setError(null);
        try {
            const opts = { ...options, ...customOptions };
            const response = await safeSendMessage({
                action: 'GENERATE_PASSWORD',
                payload: opts,
            });
            const typedResponse = response as GeneratePasswordResponse;
            if (typedResponse && 'result' in typedResponse && typedResponse.result) {
                setPassword(typedResponse.result);
                return typedResponse.result;
            }
            throw new Error((typedResponse as any)?.error || 'Failed to generate password');
        } catch (err) {
            setError((err as Error).message);
            return null;
        } finally {
            setLoading(false);
        }
    }, [options]);

    const updateOptions = useCallback((updates: Partial<PasswordOptions>) => {
        setOptions((prev) => ({ ...prev, ...updates }));
    }, []);

    const copyPassword = useCallback(async () => {
        if (!password) {return false;}
        try {
            await navigator.clipboard.writeText(password.password);
            return true;
        } catch {
            return false;
        }
    }, [password]);

    const saveToHistory = useCallback(async (website: string) => {
        if (!password) {return false;}
        try {
            await safeSendMessage({
                action: 'SAVE_PASSWORD',
                payload: { password: password.password, website },
            });
            return true;
        } catch {
            return false;
        }
    }, [password]);

    return {
        password,
        options,
        loading,
        error,
        generate,
        updateOptions,
        copyPassword,
        saveToHistory,
    };
}
