/* eslint-disable no-console */
/**
 * Headless smoke-test of the built service-worker bundle.
 * Stubs the chrome.* APIs so the bundle can be evaluated in Node.
 * Usage: node scripts/sw-smoke.cjs [path-to-background.js]
 */
const fs = require('fs');
const path = require('path');

const bundle = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../dist/background.js');

if (!fs.existsSync(bundle)) {
  console.error(`Bundle not found: ${bundle}`);
  process.exit(2);
}

// ── Stub `self` / service-worker globals ─────────────────────────────
const noop = () => undefined;
const emptyObj = () => ({});

function makeEvent() {
  const handlers = [];
  return {
    addListener: (fn) => handlers.push(fn),
    addListenerSync: () => undefined,
    removeListener: () => undefined,
    hasListener: () => false,
    hasListeners: () => handlers.length > 0,
    dispatch: (...args) => {
      for (const fn of handlers) {
        try {
          fn(...args);
        } catch (e) {
          console.error('[sw-smoke] listener threw:', e);
        }
      }
    },
  };
}

function makeApi(pathSoFar, depth = 0) {
  if (depth > 12) {
    return new Proxy(() => undefined, {
      get() {
        return makeApi(pathSoFar, depth + 1);
      },
      apply() {
        return undefined;
      },
      construct() {
        return makeApi(pathSoFar, depth + 1);
      },
    });
  }
  return new Proxy(emptyObj(), {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === 'lastError') return undefined;
      if (/^on[A-Z]/.test(prop)) return makeEvent();
      return makeApi(`${pathSoFar}.${prop}`, depth + 1);
    },
    apply() {
      return undefined;
    },
  });
}

const listeners = { error: [], unhandledrejection: [] };

globalThis.self = globalThis;
globalThis.self.addEventListener = (type, fn) => {
  if (!listeners[type]) listeners[type] = [];
  listeners[type].push(fn);
};
globalThis.addEventListener = globalThis.self.addEventListener;
globalThis.importScripts = () => undefined;
globalThis.Registration = function Registration() {};
globalThis.ServiceWorkerContainer = function ServiceWorkerContainer() {};

// ── Stub `chrome` ────────────────────────────────────────────────────
const makeStorage = () => ({
  get: async () => ({}),
  set: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
  getBytesInUse: async () => 0,
  setAccessLevel: async () => undefined,
  getAccessLevel: async () => 'TRUSTED_CONTEXTS',
  onChanged: makeEvent(),
});

const chromeApi = {
  runtime: {
    onInstalled: makeEvent(),
    onStartup: makeEvent(),
    onMessage: makeEvent(),
    onMessageExternal: makeEvent(),
    onConnect: makeEvent(),
    onSuspend: makeEvent(),
    onSuspendCanceled: makeEvent(),
    onConnectExternal: makeEvent(),
    getManifest: () => ({ name: 'GhostFill', version: '1.1.0', permissions: [], oauth2: {} }),
    getURL: (p) => `chrome-extension://test/${p}`,
    sendMessage: noop,
    openOptionsPage: noop,
    setUninstallURL: noop,
    getPlatformInfo: async () => ({}),
    getContexts: async () => [],
    id: 'test-extension-id',
    lastError: undefined,
    OnInstalledReason: {
      INSTALL: 'install',
      UPDATE: 'update',
      CHROME_UPDATE: 'chrome_update',
      SHARED_MODULE_UPDATE: 'shared_module_update',
    },
    OnUpdateAvailableReason: {},
    OnConnectEvent: function () {},
  },
  storage: {
    local: makeStorage(),
    session: makeStorage(),
    managed: makeStorage(),
    onChanged: makeEvent(),
  },
  alarms: {
    create: noop,
    clear: async () => true,
    clearAll: async () => true,
    get: async () => undefined,
    getAll: async () => [],
    onAlarm: makeEvent(),
  },
  commands: { getAll: async () => [], onCommand: makeEvent() },
  contextMenus: {
    create: noop,
    remove: noop,
    removeAll: noop,
    update: noop,
    onClicked: makeEvent(),
    ContextType: {},
  },
  notifications: {
    create: noop,
    clear: async () => true,
    getAll: async () => ({}),
    onClicked: makeEvent(),
    onButtonClicked: makeEvent(),
    onClosed: makeEvent(),
    PermissionLevel: {},
  },
  tabs: {
    query: async () => [],
    get: async () => ({ id: 1 }),
    sendMessage: async () => ({ success: false }),
    create: async () => ({ id: 1 }),
    update: async () => ({}),
    remove: async () => undefined,
    onUpdated: makeEvent(),
    onRemoved: makeEvent(),
    onActivated: makeEvent(),
    onCreated: makeEvent(),
    Tab: function Tab() {},
  },
  action: { setBadgeText: noop, setTitle: noop, setIcon: noop },
  offscreen: {
    hasDocument: async () => false,
    createDocument: async () => undefined,
    closeDocument: async () => undefined,
    Reason: {},
  },
  identity: {
    getAuthToken: async () => ({ token: 'test' }),
    removeCachedAuthToken: async () => undefined,
    getRedirectURL: () => 'chrome-extension://test/oauth',
    launchWebAuthFlow: async () => undefined,
    onSignInChanged: makeEvent(),
  },
  scripting: { executeScript: async () => [], insertCSS: async () => undefined },
  i18n: { getMessage: (k) => k, getUILanguage: () => 'en' },
  downloads: { download: async () => 1 },
  extension: { getURL: () => '', getViews: () => [], getBackgroundPage: () => undefined },
  webRequest: { onBeforeRequest: makeEvent() },
  permissions: { contains: async () => false, request: async () => false },
};

globalThis.chrome = chromeApi;
globalThis.browser = chromeApi;

if (!globalThis.trustedTypes) {
  globalThis.trustedTypes = {
    createPolicy: () => ({
      createHTML: (s) => s,
      createScript: (s) => s,
      createScriptURL: (s) => s,
    }),
  };
}

// ── Capture boot-time errors ─────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION (boot-time):');
  console.error(err && err.stack ? err.stack : err);
  console.error('ERROR_MESSAGE:', String(err));
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ UNHANDLED REJECTION:');
  console.error(reason && reason.stack ? reason.stack : reason);
});

// ── Evaluate the bundle ──────────────────────────────────────────────
console.log(`=== Evaluating SW bundle: ${bundle} ===`);
const code = fs.readFileSync(bundle, 'utf8');
console.log(`Bundle size: ${(code.length / 1024).toFixed(1)} KB`);

try {
  // eslint-disable-next-line no-eval
  (0, eval)(code);
  console.log('=== Bundle evaluated WITHOUT top-level exceptions ===');

  // Drive the service-worker lifecycle to exercise the full boot path.
  const dispatchBoot = () => {
    chrome.runtime.onInstalled.dispatch({ reason: 'install', previousVersion: undefined, id: 'mdjmmlffcgljdgimjehgnhicjdmhmkco' });
    chrome.runtime.onStartup.dispatch();
  };
  try {
    dispatchBoot();
  } catch (e) {
    console.error('[sw-smoke] lifecycle dispatch threw:', e);
  }

  // Give async boot steps a chance to settle, then inspect boot state.
  setTimeout(() => {
    const bootState = globalThis.__swBootState;
    console.log('=== Smoke test complete (no boot crash) ===');
    if (bootState) console.log('bootState at exit:', bootState);
    process.exit(0);
  }, 2500);
} catch (err) {
  console.error('❌ BOOT-TIME EXCEPTION:');
  console.error(err && err.stack ? err.stack : err);
  console.error('ERROR_MESSAGE:', String(err));
  process.exit(1);
}

