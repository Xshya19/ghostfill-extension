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

    // Listen for changes pushed from background runtime
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes[key as string]) {
        void refreshValue();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }

    return () => {
      isMounted = false;
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    };
  }, [key]);

  return value;
}
