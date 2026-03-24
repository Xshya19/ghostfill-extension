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

export const selectView = (state: AppState) => state.view;
export const selectSetView = (state: AppState) => state.setView;
export const selectLoading = (state: AppState) => state.loading;
export const selectSetLoading = (state: AppState) => state.setLoading;
export const selectToast = (state: AppState) => state.toast;
export const selectSetToast = (state: AppState) => state.setToast;
export const selectIsFirstTime = (state: AppState) => state.isFirstTime;
export const selectSetIsFirstTime = (state: AppState) => state.setIsFirstTime;
