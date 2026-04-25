import { useState, useEffect, useCallback, useRef } from 'react';
import { storageService } from '../../services/storageService';
import { UserSettings, DEFAULT_SETTINGS } from '../../types';
import type { GetSettingsResponse } from '../../types/message.types';
import { safeSendMessage } from '../../utils/messaging';

export function useStorage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    void loadSettings();

    const handleChange = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      // storageService wraps settings under the key 'settings'
      if (areaName === 'local' && changes.settings && isMounted.current) {
        void loadSettings();
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleChange);
    }

    return () => {
      isMounted.current = false;
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleChange);
      }
    };
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      if (isMounted.current) {
        setLoading(true);
        setError(null);
      }
      const response = await safeSendMessage({ action: 'GET_SETTINGS' });
      const typedResponse = response as GetSettingsResponse;
      if (
        isMounted.current &&
        typedResponse &&
        'settings' in typedResponse &&
        typedResponse.settings
      ) {
        setSettings(typedResponse.settings);
      }
    } catch {
      if (isMounted.current) {
        setError('Failed to load settings');
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    try {
      if (isMounted.current) {
        setError(null);
      }
      const response = await safeSendMessage({
        action: 'UPDATE_SETTINGS',
        payload: updates,
      });
      const typedResponse = response as GetSettingsResponse;
      if (
        isMounted.current &&
        typedResponse &&
        'settings' in typedResponse &&
        typedResponse.settings
      ) {
        setSettings(typedResponse.settings);
        return true;
      }
      return false;
    } catch {
      if (isMounted.current) {
        setError('Failed to update settings');
      }
      return false;
    }
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      if (isMounted.current) {
        setError(null);
      }
      await storageService.clear();
      if (isMounted.current) {
        setSettings(DEFAULT_SETTINGS);
      }
      return true;
    } catch {
      if (isMounted.current) {
        setError('Failed to clear data');
      }
      return false;
    }
  }, []);

  return {
    settings,
    loading,
    error,
    updateSettings,
    clearAllData,
    refresh: loadSettings,
  };
}
