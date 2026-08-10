import { useState, useEffect, useRef } from 'react';
import { storageService } from '../../services/storageService';
import { StorageSchema } from '../../types';

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
