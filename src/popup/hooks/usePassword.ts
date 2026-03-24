import { useState, useCallback, useRef, useEffect } from 'react';
import { PasswordOptions, GeneratedPassword, DEFAULT_PASSWORD_OPTIONS } from '../../types';
import type { GeneratePasswordResponse } from '../../types/message.types';
import { safeSendMessage } from '../../utils/messaging';

export function usePassword() {
  const [password, setPassword] = useState<GeneratedPassword | null>(null);
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef(options);
  const isMounted = useRef(true);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const generate = useCallback(
    async (customOptions?: Partial<PasswordOptions>) => {
      if (isMounted.current) {
        setLoading(true);
        setError(null);
      }
      try {
        const opts = { ...optionsRef.current, ...customOptions };
        const response = await safeSendMessage({
          action: 'GENERATE_PASSWORD',
          payload: opts,
        });
        const typedResponse = response as GeneratePasswordResponse;
        if (typedResponse && 'result' in typedResponse && typedResponse.result) {
          if (isMounted.current) {setPassword(typedResponse.result);}
          return typedResponse.result;
        }
        throw new Error(typedResponse.error || 'Failed to generate password');
      } catch (err) {
        if (isMounted.current) {setError((err as Error).message);}
        return null;
      } finally {
        if (isMounted.current) {setLoading(false);}
      }
    },
    []
  );

  const updateOptions = useCallback((updates: Partial<PasswordOptions>) => {
    setOptions((prev) => ({ ...prev, ...updates }));
  }, []);

  const copyPassword = useCallback(async () => {
    if (!password) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(password.password);
      return true;
    } catch {
      return false;
    }
  }, [password]);

  const saveToHistory = useCallback(
    async (website: string) => {
      if (!password) {
        return false;
      }
      try {
        await safeSendMessage({
          action: 'SAVE_PASSWORD',
          payload: { password: password.password, website },
        });
        return true;
      } catch {
        return false;
      }
    },
    [password]
  );

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
