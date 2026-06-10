import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AliasHistoryItem } from '../../services/aliasService';
import { storageService } from '../../services/storageService';
import { EmailAccount } from '../../types';
import { GmailMessage, GmailProfile } from '../../types/message.types';

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
  preferredEmailType: 'disposable' | 'gmail';
  setPreferredEmailType: (type: 'disposable' | 'gmail') => void;

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
      setPreferredEmailType: (preferredEmailType) =>
        set(() => {
          // CRITICAL: Use setImmediate to bypass the 500ms write debounce.
          // This ensures the service worker's cache is updated instantly via
          // chrome.storage.onChanged, preventing stale identity reads.
          void storageService.setImmediate('preferredEmailType', preferredEmailType);
          return { preferredEmailType };
        }),

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
    }),
    {
      name: 'ghostfill-popup-state',
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as Partial<AppState> | undefined;
        return {
          view: state?.view ?? 'hub',
          isFirstTime: state?.isFirstTime ?? false,
        };
      },
      partialize: (state) => ({
        view: state.view,
        isFirstTime: state.isFirstTime,
      }),
    }
  )
);
