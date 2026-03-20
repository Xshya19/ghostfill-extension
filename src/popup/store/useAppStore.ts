import { create } from 'zustand';

// Advanced State Management for GhostFill 3.0
// Readied for future expansion using Zustand
export interface AppState {
  view: 'hub' | 'email' | 'password' | 'otp';
  setView: (view: 'hub' | 'email' | 'password' | 'otp') => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  toast: string | null;
  setToast: (toast: string | null) => void;
  isFirstTime: boolean;
  setIsFirstTime: (isFirstTime: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: 'hub',
  setView: (view) => set({ view }),
  loading: false,
  setLoading: (loading) => set({ loading }),
  toast: null,
  setToast: (toast) => set({ toast }),
  isFirstTime: false,
  setIsFirstTime: (isFirstTime) => set({ isFirstTime }),
}));
