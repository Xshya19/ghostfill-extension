import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../../services/storageService';
import { LastOTP } from '../../types';
import { safeSendMessage, safeSendTabMessage } from '../../utils/messaging';

export function useOTP() {
  const [lastOTP, setLastOTP] = useState<LastOTP | null>(null);
  const [loading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  useEffect(() => {
    const fetchOTP = async () => {
      const otp = await storageService.get('lastOTP');
      if (otp) {
        setLastOTP(otp);
      }
    };

    void fetchOTP();

    // Listen for changes
    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.lastOTP) {
        setLastOTP((changes.lastOTP.newValue as LastOTP | null) ?? null);
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleChange);
    }

    return () => {
      if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    if (lastOTP) {
      const updateTimer = () => {
        const elapsed = Date.now() - lastOTP.extractedAt;
        const remaining = 5 * 60 * 1000 - elapsed; // 5 minutes
        setTimeRemaining(Math.max(0, remaining));
      };

      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    }
  }, [lastOTP]);

  const loadLastOTP = async () => {
    try {
      const response = await safeSendMessage({ action: 'GET_LAST_OTP' });
      if (response && 'lastOTP' in response) {
        const newOTP = response.lastOTP || null;
        setLastOTP(newOTP);
        // Cache it
        if (newOTP) {
          await chrome.storage.local.set({ lastOTP: newOTP });
        }
      }
    } catch {
      // Ignore errors
    }
  };

  const copyOTP = useCallback(async () => {
    if (!lastOTP) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(lastOTP.code);
      return true;
    } catch {
      return false;
    }
  }, [lastOTP]);

  const fillOTP = useCallback(async () => {
    if (!lastOTP) {
      return false;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await safeSendTabMessage(tab.id, {
          action: 'FILL_OTP',
          payload: { otp: lastOTP.code, fieldSelectors: [] },
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [lastOTP]);

  const isExpired = timeRemaining <= 0;
  const formattedTime = (() => {
    if (isExpired) {
      return 'Expired';
    }
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  })();

  return {
    lastOTP,
    loading,
    timeRemaining,
    formattedTime,
    isExpired,
    copyOTP,
    fillOTP,
    refresh: loadLastOTP,
  };
}
