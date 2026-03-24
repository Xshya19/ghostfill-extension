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
        // Do not update state if we throw, leaving the hook with its previous value
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
        // Ensure we correctly decrypt the new value by asking StorageService to get it
        void refreshValue();
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
