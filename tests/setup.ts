import { vi } from 'vitest';

// Mock chrome API with complete coverage
const chromeMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getBytesInUse: vi.fn().mockResolvedValue(0),
    },
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
      getBytesInUse: vi.fn().mockResolvedValue(0),
    },
    sync: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(),
    onAlarm: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
      hasListener: vi.fn(),
    },
    id: 'test-extension-id',
    getManifest: vi.fn(() => ({ version: '1.0.0' })),
    getURL: vi.fn().mockReturnValue('chrome-extension://mock/'),
    lastError: null,
    reload: vi.fn(),
  },
  tabs: {
    sendMessage: vi.fn().mockResolvedValue({}),
    query: vi.fn().mockResolvedValue([{ id: 1, url: 'https://example.com' }]),
    create: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({}),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  notifications: {
    create: vi.fn().mockResolvedValue(true),
    clear: vi.fn().mockResolvedValue(true),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  scripting: {
    executeScript: vi.fn().mockResolvedValue([]),
  },
  commands: {
    getAll: vi.fn().mockResolvedValue([]),
  },
} as unknown as typeof chrome;

globalThis.chrome = chromeMock;

// Mock crypto API for JSDOM
try {
  const { webcrypto } = require('node:crypto');
  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  } else if (!globalThis.crypto.subtle) {
    Object.defineProperty(globalThis.crypto, 'subtle', {
      value: webcrypto.subtle,
      configurable: true,
    });
  }
  if (!globalThis.crypto.getRandomValues) {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', {
      value: webcrypto.getRandomValues.bind(webcrypto),
      configurable: true,
    });
  }
} catch {
  // Fallback if node:crypto unavailable
}

// Mock navigator.clipboard
if (!globalThis.navigator?.clipboard) {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn().mockResolvedValue(''),
    },
    configurable: true,
  });
}

// Mock performance.now
if (!globalThis.performance) {
  Object.defineProperty(globalThis, 'performance', {
    value: { now: vi.fn(() => Date.now()) },
    configurable: true,
  });
}
