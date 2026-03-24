import { useState, useEffect, useCallback, useRef } from 'react';
import { storageService } from '../../services/storageService';
import { LastOTP } from '../../types';
import { safeSendMessage, safeSendTabMessage } from '../../utils/messaging';

export function useOTP() {
  const [lastOTP, setLastOTP] = useState<LastOTP | null>(null);
  const [loading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const fetchOTP = async () => {
      const otp = await storageService.get('lastOTP');
      if (isMounted.current && otp) {
        setLastOTP(otp);
      }
    };

    void fetchOTP();

    // Listen for changes
    const handleChange = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && isMounted.current && changes.lastOTP) {
        setLastOTP((changes.lastOTP.newValue as LastOTP | null) ?? null);
      }
    };

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener(handleChange);
    }

    return () => {
      isMounted.current = false;
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(handleChange);
      }
    };
  }, []);

  useEffect(() => {
    if (!lastOTP) {return;}

    let interval: ReturnType<typeof setInterval>;
    
    const updateTimer = () => {
      const elapsed = Date.now() - lastOTP.extractedAt;
      const remaining = 5 * 60 * 1000 - elapsed; // 5 minutes
      setTimeRemaining(Math.max(0, remaining));

      if (remaining <= 0) {
        clearInterval(interval);
      }
    };

    updateTimer();
    interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lastOTP?.extractedAt]);

  const loadLastOTP = useCallback(async () => {
    try {
      if (isMounted.current) { setError(null); }
      const response = await safeSendMessage({ action: 'GET_LAST_OTP' });
      if (response && 'lastOTP' in response) {
        const newOTP = response.lastOTP || null;
        if (!isMounted.current) { return; }
        setLastOTP(newOTP);
        // Cache it securely
        if (newOTP && typeof chrome !== 'undefined' && chrome.storage?.local) {
          await chrome.storage.local.set({ lastOTP: newOTP });
        }
      }
    } catch {
      if (isMounted.current) { setError('Failed to refresh OTP'); }
    }
  }, []);

  const copyOTP = useCallback(async () => {
    if (!lastOTP) {
      return false;
    }
    try {
      if (isMounted.current) { setError(null); }
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
      if (isMounted.current) { setError(null); }
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
      if (isMounted.current) { setError('Failed to auto-fill OTP'); }
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
    error,
    timeRemaining,
    formattedTime,
    isExpired,
    copyOTP,
    fillOTP,
    refresh: loadLastOTP,
  };
}
