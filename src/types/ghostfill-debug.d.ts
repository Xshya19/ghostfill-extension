/* eslint-disable @typescript-eslint/no-explicit-any */

interface CapturedError {
  timestamp: Date;
  message: string;
  stack: string;
  source: 'error' | 'warn' | 'info' | 'log';
  context: string;
}

interface GhostFillWindow {
  __GHOSTFILL_ERRORS__?: CapturedError[];
  __GHOSTFILL_IS_DEBUG_MODE__?: boolean;
  dumpGhostFillErrors?: () => CapturedError[];
  clearGhostFillErrors?: () => void;
  generateGhostFillReport?: (errors: CapturedError[]) => string;
  copyGhostFillReport?: () => void;
  ghostfillDebug?: {
    enable: () => void;
    disable: () => void;
    isEnabled: () => boolean;
    getErrors: () => CapturedError[];
    getStats: () => { total: number; errors: number; warnings: number };
    printFormatted: () => void;
  };
}

declare global {
  interface Window {
    __GHOSTFILL_ERRORS__?: CapturedError[];
    __GHOSTFILL_IS_DEBUG_MODE__?: boolean;
    dumpGhostFillErrors?: () => CapturedError[];
    clearGhostFillErrors?: () => void;
    generateGhostFillReport?: (errors: CapturedError[]) => string;
    copyGhostFillReport?: () => void;
    ghostfillDebug?: {
      enable: () => void;
      disable: () => void;
      isEnabled: () => boolean;
      getErrors: () => CapturedError[];
      getStats: () => { total: number; errors: number; warnings: number };
      printFormatted: () => void;
    };
  }
}

export {};
