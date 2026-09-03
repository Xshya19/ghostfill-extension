import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { storageService } from '../../services/storageService';
import { EmailAccount } from '../../types';
import { GmailMessage, GmailProfile, AliasHistoryItem } from '../../types/email.types';

// Advanced State Management for GhostFill 3.0
// Persisted state using Zustand
export interface AppState {
  view: 'hub' | 'email' | 'password' | 'otp' | 'aliases';
  setView: (view: 'hub' | 'email' | 'password' | 'otp' | 'aliases') => void;
  emailAccount: EmailAccount | null;
  setEmailAccount: (email: EmailAccount | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  toast: string | null;
  setToast: (toast: string | null) => void;
  isFirstTime: boolean;
  setIsFirstTime: (isFirstTime: boolean) => void;

  // Gmail Alias Feature states
  gmailBase: string | null;
  setGmailBase: (email: string | null) => void;
  aliasHistory: AliasHistoryItem[];
  setAliasHistory: (history: AliasHistoryItem[]) => void;
  addAliasToHistory: (item: AliasHistoryItem) => void;
  clearAliasHistory: () => void;
  gmailAliasType: 'combined';
  setGmailAliasType: (type: 'combined') => void;
  preferredEmailType: 'disposable' | 'gmail' | 'zoho' | 'microsoft';
  setPreferredEmailType: (type: 'disposable' | 'gmail' | 'zoho' | 'microsoft') => void;

  // Selected Real Email Provider (Gmail, Zoho Mail, Microsoft Outlook)
  selectedRealProvider: 'gmail' | 'zoho' | 'microsoft';
  setSelectedRealProvider: (provider: 'gmail' | 'zoho' | 'microsoft') => void;

  // Gmail OAuth2 connection states
  gmailConnected: boolean;
  setGmailConnected: (connected: boolean) => void;
  gmailProfile: GmailProfile | null;
  setGmailProfile: (profile: GmailProfile | null) => void;
  gmailInbox: GmailMessage[];
  setGmailInbox: (messages: GmailMessage[]) => void;
  gmailInboxLoading: boolean;
  setGmailInboxLoading: (loading: boolean) => void;
  gmailInboxError: string | null;
  setGmailInboxError: (error: string | null) => void;
  gmailIsManual: boolean;
  setGmailIsManual: (isManual: boolean) => void;

  // Zoho Mail connection states
  zohoConnected: boolean;
  setZohoConnected: (connected: boolean) => void;
  zohoProfile: { accountId: string; email: string; displayName: string } | null;
  setZohoProfile: (profile: { accountId: string; email: string; displayName: string } | null) => void;

  // Microsoft Outlook connection states
  microsoftConnected: boolean;
  setMicrosoftConnected: (connected: boolean) => void;
  microsoftProfile: { userId: string; email: string; displayName: string } | null;
  setMicrosoftProfile: (profile: { userId: string; email: string; displayName: string } | null) => void;

  // Current tab hostname (read once on mount by Hub)
  currentTabHostname: string | null;
  setCurrentTabHostname: (hostname: string | null) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      view: 'hub',
      setView: (view) => set({ view }),
      emailAccount: null,
      setEmailAccount: (emailAccount) => set({ emailAccount }),
      loading: false,
      setLoading: (loading) => set({ loading }),
      toast: null,
      setToast: (toast) => set({ toast }),
      isFirstTime: false,
      setIsFirstTime: (isFirstTime) => set({ isFirstTime }),

      // Gmail Alias initial states
      gmailBase: null,
      setGmailBase: (gmailBase) => set({ gmailBase }),
      aliasHistory: [],
      setAliasHistory: (aliasHistory) => set({ aliasHistory }),
      addAliasToHistory: (item) =>
        set((state) => {
          if (
            state.aliasHistory.some((h) => h.alias === item.alias && h.website === item.website)
          ) {
            return state;
          }
          const MAX_HISTORY = 500;
          const updated = [item, ...state.aliasHistory].slice(0, MAX_HISTORY);
          void storageService.set('aliasHistory', updated);
          return { aliasHistory: updated };
        }),
      clearAliasHistory: () => {
        set({ aliasHistory: [] });
        void storageService.set('aliasHistory', []);
      },
      gmailAliasType: 'combined',
      setGmailAliasType: () =>
        set(() => {
          void storageService.set('gmailAliasType', 'combined');
          return { gmailAliasType: 'combined' };
        }),
      preferredEmailType: 'disposable',
      setPreferredEmailType: (preferredEmailType) => {
        // Write to chrome.storage immediately so service-worker GET_IDENTITY
        // sees Provider/Temp Mail preference before the next fill.
        void storageService.setImmediate('preferredEmailType', preferredEmailType);
        set({ preferredEmailType });
      },

      // Selected Real Provider
      selectedRealProvider: 'gmail',
      setSelectedRealProvider: (selectedRealProvider) => {
        void storageService.setImmediate('selectedRealProvider', selectedRealProvider);
        set({ selectedRealProvider });
      },

      // Gmail OAuth2 initial states
      gmailConnected: false,
      setGmailConnected: (gmailConnected) => set({ gmailConnected }),
      gmailProfile: null,
      setGmailProfile: (gmailProfile) => set({ gmailProfile }),
      gmailInbox: [],
      setGmailInbox: (gmailInbox) => set({ gmailInbox }),
      gmailInboxLoading: false,
      setGmailInboxLoading: (gmailInboxLoading) => set({ gmailInboxLoading }),
      gmailInboxError: null,
      setGmailInboxError: (gmailInboxError) => set({ gmailInboxError }),
      gmailIsManual: false,
      setGmailIsManual: (gmailIsManual) =>
        set(() => {
          void storageService.setImmediate('gmailIsManual', gmailIsManual);
          return { gmailIsManual };
        }),

      // Zoho Mail initial states
      zohoConnected: false,
      setZohoConnected: (zohoConnected) => set({ zohoConnected }),
      zohoProfile: null,
      setZohoProfile: (zohoProfile) => set({ zohoProfile }),

      // Microsoft Outlook initial states
      microsoftConnected: false,
      setMicrosoftConnected: (microsoftConnected) => set({ microsoftConnected }),
      microsoftProfile: null,
      setMicrosoftProfile: (microsoftProfile) => set({ microsoftProfile }),

      // Current tab hostname
      currentTabHostname: null,
      setCurrentTabHostname: (currentTabHostname) => set({ currentTabHostname }),
    }),
    {
      name: 'ghostfill-popup-state',
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<AppState> | undefined;
        return {
          view: 'hub',
          isFirstTime: state?.isFirstTime ?? false,
        };
      },
      partialize: (state) => ({
        isFirstTime: state.isFirstTime,
      }),
    }
  )
);

