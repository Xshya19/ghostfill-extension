import { useState, useEffect } from 'react';
import { storageService } from '../../services/storageService';
import { StorageSchema } from '../../types';

export function useStorageSubscription<K extends keyof StorageSchema>(key: K, initialValue: StorageSchema[K] | null): StorageSchema[K] | null {
    const [value, setValue] = useState<StorageSchema[K] | null>(initialValue);

    useEffect(() => {
        let isMounted = true;

        // Load initial value
        storageService.get(key).then(data => {
            if (isMounted && data !== undefined && data !== null) {
                setValue(data as StorageSchema[K]);
            }
        });

        // Listen for changes pushed from background runtime
        const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
            if (areaName === 'local' && changes[key as string]) {
                // Ensure we correctly decrypt the new value by asking StorageService to get it
                storageService.get(key).then(data => {
                    if (isMounted && data !== undefined && data !== null) {
                        setValue(data as StorageSchema[K]);
                    }
                });
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
