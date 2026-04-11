import { useState, useEffect } from 'react';
import { storageService } from '../../services/storageService';
import { StorageSchema } from '../../types';

export function useStorageSubscription<K extends keyof StorageSchema>(
  key: K,
  initialValue: StorageSchema[K] | null
): StorageSchema[K] | null {
  const [value, setValue] = useState<StorageSchema[K] | null>(initialValue);

  useEffect(() => {
    let isMounted = true;
    const refreshValue = async (): Promise<void> => {
      try {
        const data = await storageService.get(key);
        if (!isMounted) {
          return;
        }
        setValue((data ?? null) as StorageSchema[K] | null);
      } catch (error) {
        console.error(`[useStorageSubscription] Failed for key ${String(key)}:`, error);
        if (isMounted) {
          setValue(initialValue);
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
        if (isMounted) {
          const newValue = changes[key as string]?.newValue;
          setValue((newValue ?? null) as StorageSchema[K] | null);
        }
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
    }

    return () => {
      isMounted = false;
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(listener);
      }
    };
  }, [key]);

  return value;
}
