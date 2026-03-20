import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../../services/storageService';
import { UserSettings, DEFAULT_SETTINGS } from '../../types';
import type { GetSettingsResponse } from '../../types/message.types';
import { safeSendMessage } from '../../utils/messaging';

export function useStorage() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await safeSendMessage({ action: 'GET_SETTINGS' });
      const typedResponse = response as GetSettingsResponse;
      if (typedResponse && 'settings' in typedResponse && typedResponse.settings) {
        setSettings(typedResponse.settings);
      }
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    try {
      const response = await safeSendMessage({
        action: 'UPDATE_SETTINGS',
        payload: updates,
      });
      const typedResponse = response as GetSettingsResponse;
      if (typedResponse && 'settings' in typedResponse && typedResponse.settings) {
        setSettings(typedResponse.settings);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const clearAllData = useCallback(async () => {
    try {
      await storageService.clear();
      setSettings(DEFAULT_SETTINGS);
      return true;
    } catch {
      return false;
    }
  }, []);

  return {
    settings,
    loading,
    updateSettings,
    clearAllData,
    refresh: loadSettings,
  };
}
