// ─────────────────────────────────────────────────────────────────────
// Context Menu Engine v2 — Declarative, Dynamic, Action-Routed
//
// ┌──────────────────────────────────────────────────────────────────┐
// │  Architecture                                                   │
// │                                                                 │
// │  ┌────────────────┐                                             │
// │  │ Menu Tree Spec │──► declarative item definitions             │
// │  └───────┬────────┘                                             │
// │          ▼                                                      │
// │  ┌────────────────┐                                             │
// │  │ Reconciler     │──► builds / updates chrome.contextMenus     │
// │  └───────┬────────┘                                             │
// │          ▼                                                      │
// │  ┌────────────────┐                                             │
// │  │ Click Router   │──► action registry lookup                   │
// │  └───────┬────────┘                                             │
// │          ▼                                                      │
// │  ┌────────────────┐                                             │
// │  │ Action Handler │──► generate, fill, copy, navigate           │
// │  └───────┬────────┘                                             │
// │          ▼                                                      │
// │  ┌────────────────┐                                             │
// │  │ Feedback       │──► notification + content-script fill       │
// │  └────────────────┘                                             │
// │                                                                 │
// │  Features                                                       │
// │  ─ Declarative menu tree (items defined as data, not code)      │
// │  ─ Action registry with isolated error handling per action      │
// │  ─ Dynamic item state (OTP availability, email presence)        │
// │  ─ Batched menu rebuild (single removeAll + create cycle)       │
// │  ─ OTP masking in menu title                                    │
// │  ─ Stale OTP detection with age display                         │
// │  ─ Auto-fill + clipboard copy in one action                     │
// │  ─ Result feedback via notification engine                      │
// │  ─ Observable metrics (clicks per action, errors)               │
// │  ─ Full lifecycle (setup / teardown)                            │
// └──────────────────────────────────────────────────────────────────┘
// ─────────────────────────────────────────────────────────────────────

import { clipboardService } from '../services/clipboardService';
import { emailService } from '../services/emailServices';
import { otpService } from '../services/otpService';
import { passwordService } from '../services/passwordService';
import { CONTEXT_MENU_IDS } from '../utils/constants';
import { createLogger } from '../utils/logger';
import { safeSendTabMessage } from '../utils/messaging';

const log = createLogger('ContextMenu');

// ━━━ Types ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface MenuItemSpec {
  id: string;
  title: string;
  parentId?: string;
  contexts: chrome.contextMenus.ContextType[];
  type?: 'normal' | 'separator';
  enabled?: boolean;
  visible?: boolean;
  action?: string; // key into action registry
}

interface ActionContext {
  info: chrome.contextMenus.OnClickData;
  tab: chrome.tabs.Tab | undefined;
  tabId: number | null;
}

type ActionHandler = (ctx: ActionContext) => Promise<ActionResult>;

interface ActionResult {
  notifyTitle?: string;
  notifyMessage?: string;
  notifyType?: 'success' | 'error';
  fillValue?: string;
  fillFieldType?: string;
  clipboardValue?: string;
  clipboardType?: 'email' | 'password' | 'otp';
}

interface ActionMetrics {
  clicks: number;
  errors: number;
  lastClickAt: number;
  lastError: string | null;
}

interface MenuMetrics {
  rebuilds: number;
  updates: number;
  totalClicks: number;
  totalErrors: number;
  byAction: Map<string, ActionMetrics>;
}

// ━━━ Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  OTP_STALE_MS: 300_000, // 5 min — show "stale" label
  OTP_EXPIRED_MS: 600_000, // 10 min — disable item
  OTP_MASK_CHAR: '●',
  OTP_VISIBLE_SUFFIX: 2,
  REBUILD_DEBOUNCE_MS: 500,
  DEFAULT_PWD_LENGTH: 16,
  STRONG_PWD_LENGTH: 24,
  PIN_LENGTH: 6,
  PASSPHRASE_WORDS: 4,
} as const;

// ━━━ State ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const actions = new Map<string, ActionHandler>();
const menuItems: MenuItemSpec[] = [];
let initialized = false;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let lastOTPState: { code: string; masked: string; stale: boolean; expired: boolean } | null = null;

const metrics: MenuMetrics = {
  rebuilds: 0,
  updates: 0,
  totalClicks: 0,
  totalErrors: 0,
  byAction: new Map(),
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MENU TREE DEFINITION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildMenuTree(): MenuItemSpec[] {
  return [
    // ── Root ──
    {
      id: CONTEXT_MENU_IDS.PARENT,
      title: '👻 GhostFill',
      contexts: ['all'],
    },

    // ── Quick Actions ──
    {
      id: CONTEXT_MENU_IDS.SMART_AUTOFILL,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '✨ Magic Fill (All Fields)',
      contexts: ['editable'],
      action: 'smart-autofill',
    },
    {
      id: CONTEXT_MENU_IDS.GENERATE_EMAIL_QUICK,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '📧 Generate & Fill Email',
      contexts: ['all'],
      action: 'generate-email',
    },
    {
      id: CONTEXT_MENU_IDS.GENERATE_PASSWORD_STANDARD,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '🔐 Generate & Fill Password',
      contexts: ['all'],
      action: 'generate-password-standard',
    },

    // ── OTP (dynamic) ──
    {
      id: CONTEXT_MENU_IDS.LAST_OTP,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '🔢 No OTP available',
      contexts: ['all'],
      enabled: false,
      action: 'copy-last-otp',
    },

    // ── Separator ──
    {
      id: CONTEXT_MENU_IDS.SEPARATOR_1,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '',
      type: 'separator',
      contexts: ['all'],
    },

    // ── Inbox ──
    {
      id: CONTEXT_MENU_IDS.CHECK_INBOX,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '📥 Refresh Inbox',
      contexts: ['all'],
      action: 'check-inbox',
    },

    // ── Settings ──
    {
      id: CONTEXT_MENU_IDS.SETTINGS,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '⚙️ Settings',
      contexts: ['all'],
      action: 'open-settings',
    },

    // ── Continuous Learning ──
    {
      id: CONTEXT_MENU_IDS.REPORT_MISCLASS,
      parentId: CONTEXT_MENU_IDS.PARENT,
      title: '🧠 Report Misclassification',
      contexts: ['editable'],
    },
    ...['email', 'password', 'new-password', 'otp', 'name', 'phone', 'address', 'card-number', 'card-expiry', 'unknown'].map((cls): MenuItemSpec => ({
      id: `report-${cls}`,
      parentId: CONTEXT_MENU_IDS.REPORT_MISCLASS,
      title: `Correct type: ${cls}`,
      contexts: ['editable'] as chrome.contextMenus.ContextType[],
      action: `report-${cls}`,
    })),
  ];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  ACTION REGISTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function registerDefaultActions(): void {
  // ── Smart Autofill ──
  register('smart-autofill', async (ctx) => {
    if (!ctx.tabId) {
      return { notifyType: 'error', notifyTitle: 'Error', notifyMessage: 'No active tab' };
    }
    await safeSendTabMessage(ctx.tabId, { action: 'SMART_AUTOFILL' });
    return Promise.resolve({});
  });

  // ── Generate Email ──
  register('generate-email', async (ctx) => {
    const email = await emailService.generateEmail({ service: 'tempmail' });
    return {
      clipboardValue: email.fullEmail,
      clipboardType: 'email',
      fillValue: ctx.info.editable ? email.fullEmail : undefined,
      notifyType: 'success',
      notifyTitle: 'GhostFill: Email Generated',
      notifyMessage: `${maskEmail(email.fullEmail)} copied to clipboard!`,
    };
  });

  // ── Generate Password (Standard) ──
  register('generate-password-standard', async (ctx) => {
    const result = passwordService.generate({ length: CONFIG.DEFAULT_PWD_LENGTH });
    return {
      clipboardValue: result.password,
      clipboardType: 'password',
      fillValue: ctx.info.editable ? result.password : undefined,
      fillFieldType: 'password',
      notifyType: 'success',
      notifyTitle: 'GhostFill: Password Generated',
      notifyMessage: 'Standard password copied to clipboard!',
    };
  });

  // ── Generate Password (Strong) ──
  register('generate-password-strong', async (ctx) => {
    const result = passwordService.generate({ length: CONFIG.STRONG_PWD_LENGTH });
    return {
      clipboardValue: result.password,
      clipboardType: 'password',
      fillValue: ctx.info.editable ? result.password : undefined,
      fillFieldType: 'password',
      notifyType: 'success',
      notifyTitle: 'GhostFill: Password Generated',
      notifyMessage: 'Strong password copied to clipboard!',
    };
  });

  // ── Generate PIN ──
  register('generate-pin', async (ctx) => {
    const result = passwordService.generate({
      length: CONFIG.PIN_LENGTH,
      uppercase: false,
      lowercase: false,
      numbers: true,
      symbols: false,
    });
    return {
      clipboardValue: result.password,
      clipboardType: 'password',
      fillValue: ctx.info.editable ? result.password : undefined,
      notifyType: 'success',
      notifyTitle: 'GhostFill: PIN Generated',
      notifyMessage: 'PIN copied to clipboard!',
    };
  });

  // ── Generate Passphrase ──
  register('generate-passphrase', async () => {
    const passphrase = passwordService.generatePassphrase(CONFIG.PASSPHRASE_WORDS);
    return {
      clipboardValue: passphrase,
      clipboardType: 'password',
      notifyType: 'success',
      notifyTitle: 'GhostFill: Passphrase Generated',
      notifyMessage: 'Passphrase copied to clipboard!',
    };
  });

  // ── Copy Last OTP ──
  register('copy-last-otp', async (ctx) => {
    const lastOTP = await otpService.getLastOTP();
    if (!lastOTP) {
      return { notifyType: 'error', notifyTitle: 'No OTP', notifyMessage: 'No OTP available' };
    }
    return {
      clipboardValue: lastOTP.code,
      clipboardType: 'otp',
      fillValue: ctx.info.editable ? lastOTP.code : undefined,
      notifyType: 'success',
      notifyTitle: 'GhostFill: OTP Copied',
      notifyMessage: `${maskOTP(lastOTP.code)} copied to clipboard!`,
    };
  });

  // ── Check Inbox ──
  register('check-inbox', async () => {
    const currentEmail = await emailService.getCurrentEmail();
    if (!currentEmail) {
      return {
        notifyType: 'error',
        notifyTitle: 'GhostFill: No Email',
        notifyMessage: 'Generate an email first',
      };
    }
    const emails = await emailService.checkInbox(currentEmail);
    return {
      notifyType: 'success',
      notifyTitle: 'GhostFill: Inbox Checked',
      notifyMessage: `${emails.length} email(s) found`,
    };
  });

  // ── Fill Email (existing) ──
  register('fill-email', async (ctx) => {
    const email = await emailService.getCurrentEmail();
    if (!email || !ctx.tabId) {
      return { notifyType: 'error', notifyTitle: 'Error', notifyMessage: 'No email or tab' };
    }
    return {
      fillValue: email.fullEmail,
      fillFieldType: 'email',
    };
  });

  // ── Fill Password (new) ──
  register('fill-password', async (ctx) => {
    if (!ctx.tabId) {
      return { notifyType: 'error', notifyTitle: 'Error', notifyMessage: 'No active tab' };
    }
    const result = passwordService.generate();
    return {
      fillValue: result.password,
      fillFieldType: 'password',
    };
  });

  // ── Navigation: History ──
  register('open-history', async () => {
    // Open popup instead of options page
    await chrome.action.openPopup();
    return {};
  });

  // ── Navigation: Settings ──
  register('open-settings', async () => {
    // No options_page defined in manifest — open popup directly
    try {
      await chrome.action.openPopup();
    } catch (error) {
      log.debug('Could not open popup', extractMsg(error));
    }
    return {};
  });

  // ── Continuous Learning ──
  ['email', 'password', 'new-password', 'otp', 'name', 'phone', 'address', 'card-number', 'card-expiry', 'unknown'].forEach((cls) => {
    register(`report-${cls}`, async (ctx) => {
      if (!ctx.tabId) {
        return { notifyType: 'error', notifyTitle: 'Error', notifyMessage: 'No active tab' };
      }
      await safeSendTabMessage(ctx.tabId, {
        action: 'REPORT_MISCLASSIFICATION',
        payload: { correctType: cls },
      });
      return {
        notifyType: 'success',
        notifyTitle: 'GhostFill: Learning',
        notifyMessage: `Thanks! Saved field as '${cls}'.`,
      };
    });
  });
}

function register(action: string, handler: ActionHandler): void {
  actions.set(action, handler);
  metrics.byAction.set(action, {
    clicks: 0,
    errors: 0,
    lastClickAt: 0,
    lastError: null,
  });
}

/** Extend the menu with custom actions (for plugins / future use) */
export function registerAction(action: string, handler: ActionHandler): void {
  register(action, handler);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  LIFECYCLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function setupContextMenu(): Promise<void> {
  if (initialized) {
    log.debug('Already initialized — rebuilding');
  }

  registerDefaultActions();

  const tree = buildMenuTree();
  menuItems.length = 0;
  menuItems.push(...tree);

  await reconcile(tree);
  installClickHandler();

  initialized = true;
  metrics.rebuilds++;

  log.info('📋 Context menu ready', { items: tree.length, actions: actions.size });
}

export async function teardownContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  menuItems.length = 0;
  initialized = false;
  log.debug('Context menu torn down');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RECONCILER — builds / rebuilds chrome.contextMenus
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function reconcile(items: MenuItemSpec[]): Promise<void> {
  await chrome.contextMenus.removeAll();

  for (const item of items) {
    try {
      chrome.contextMenus.create({
        id: item.id,
        title: item.title,
        parentId: item.parentId,
        contexts: item.contexts,
        type: item.type ?? 'normal',
        enabled: item.enabled ?? true,
        visible: item.visible ?? true,
      });
    } catch (error) {
      log.warn('Failed to create menu item', {
        id: item.id,
        error: extractMsg(error),
      });
    }
  }
}

/**
 * Update a single menu item without full rebuild.
 * Falls back to full rebuild if the update fails.
 */
function safeUpdate(id: string, updates: chrome.contextMenus.UpdateProperties): void {
  try {
    chrome.contextMenus.update(id, updates, () => {
      if (chrome.runtime.lastError) {
        log.debug('Menu update failed — scheduling rebuild', {
          id,
          error: chrome.runtime.lastError.message,
        });
        scheduleRebuild();
      } else {
        metrics.updates++;
      }
    });
  } catch {
    scheduleRebuild();
  }
}

function scheduleRebuild(): void {
  if (rebuildTimer) {
    return;
  }
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void reconcile(menuItems)
      .then(() => {
        metrics.rebuilds++;
        log.debug('Menu rebuilt after update failure');
      })
      .catch((error) => {
        log.warn('Deferred menu rebuild failed', extractMsg(error));
      });
  }, CONFIG.REBUILD_DEBOUNCE_MS);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CLICK ROUTER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let clickHandlerInstalled = false;

function installClickHandler(): void {
  if (clickHandlerInstalled) {
    return;
  }
  clickHandlerInstalled = true;

  chrome.contextMenus.onClicked.addListener(
    (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => {
      handleClick(info, tab).catch((error) =>
        log.error('Unhandled click handler error', extractMsg(error))
      );
    }
  );
}

async function handleClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
  const menuId = String(info.menuItemId);
  metrics.totalClicks++;

  // Find the menu item spec
  const spec = menuItems.find((m) => m.id === menuId);
  if (!spec?.action) {
    log.debug('No action for menu item', { menuId });
    return;
  }

  const handler = actions.get(spec.action);
  if (!handler) {
    log.warn('No handler registered for action', { action: spec.action });
    return;
  }

  // Track metrics
  const actionStats = metrics.byAction.get(spec.action);
  if (actionStats) {
    actionStats.clicks++;
    actionStats.lastClickAt = Date.now();
  }

  const ctx: ActionContext = {
    info,
    tab,
    tabId: tab?.id ?? null,
  };

  try {
    const result = await handler(ctx);
    await processResult(result, ctx);
  } catch (error) {
    const msg = extractMsg(error);
    log.error('Action failed', { action: spec.action, error: msg });

    if (actionStats) {
      actionStats.errors++;
      actionStats.lastError = msg;
    }
    metrics.totalErrors++;

    // User-facing error notification
    const { notifyError } = await import('./notifications');
    await notifyError('Error', 'Action failed. Please try again.');
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RESULT PROCESSOR — clipboard, fill, notify
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function processResult(result: ActionResult, ctx: ActionContext): Promise<void> {
  // ── Clipboard ──
  if (result.clipboardValue) {
    switch (result.clipboardType) {
      case 'email':
        await clipboardService.copyEmail(result.clipboardValue);
        break;
      case 'password':
        await clipboardService.copyPassword(result.clipboardValue);
        break;
      case 'otp':
        await clipboardService.copyOTP(result.clipboardValue);
        break;
      default:
        await clipboardService.copyEmail(result.clipboardValue); // generic fallback
    }
  }

  // ── Content-script fill ──
  if (result.fillValue && ctx.tabId && ctx.info.editable) {
    await safeSendTabMessage(ctx.tabId, {
      action: 'FILL_FIELD',
      payload: {
        value: result.fillValue,
        fieldType: result.fillFieldType,
      },
    }).catch((err) => log.debug('Fill message failed', extractMsg(err)));
  }

  // ── Notification ──
  if (result.notifyTitle && result.notifyMessage) {
    const { notifySuccess, notifyError } = await import('./notifications');

    if (result.notifyType === 'error') {
      await notifyError(result.notifyTitle, result.notifyMessage);
    } else {
      await notifySuccess(result.notifyTitle, result.notifyMessage);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  DYNAMIC OTP ITEM UPDATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function updateOTPMenuItem(): Promise<void> {
  const lastOTP = await otpService.getLastOTP();

  if (!lastOTP) {
    if (lastOTPState !== null) {
      lastOTPState = null;
      safeUpdate(CONTEXT_MENU_IDS.LAST_OTP, {
        title: '🔢 No OTP available',
        enabled: false,
      });
    }
    return;
  }

  const age = Date.now() - (lastOTP.extractedAt ?? Date.now());
  const stale = age > CONFIG.OTP_STALE_MS;
  const expired = age > CONFIG.OTP_EXPIRED_MS;
  const masked = maskOTP(lastOTP.code);

  // Skip update if nothing changed
  if (
    lastOTPState &&
    lastOTPState.code === lastOTP.code &&
    lastOTPState.stale === stale &&
    lastOTPState.expired === expired
  ) {
    return;
  }

  lastOTPState = { code: lastOTP.code, masked, stale, expired };

  let title: string;
  if (expired) {
    title = `🔢 OTP expired: ${masked}`;
  } else if (stale) {
    const mins = Math.round(age / 60_000);
    title = `🔢 OTP: ${masked} (${mins}m ago)`;
  } else {
    title = `🔢 OTP: ${masked} (copy)`;
  }

  safeUpdate(CONTEXT_MENU_IDS.LAST_OTP, {
    title,
    enabled: !expired,
  });

  log.debug('OTP menu updated', { masked, stale, expired });
}

/**
 * Convenience: update OTP item and refresh dynamic state.
 * Called from polling manager when a new OTP is detected.
 */
export async function refreshDynamicItems(): Promise<void> {
  await updateOTPMenuItem();
  // Future: add email count badge, connection status, etc.
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  OBSERVABILITY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function getMenuMetrics(): Readonly<{
  rebuilds: number;
  updates: number;
  totalClicks: number;
  totalErrors: number;
  byAction: Record<string, ActionMetrics>;
}> {
  const byAction: Record<string, ActionMetrics> = {};
  for (const [k, v] of metrics.byAction) {
    byAction[k] = { ...v };
  }
  return {
    rebuilds: metrics.rebuilds,
    updates: metrics.updates,
    totalClicks: metrics.totalClicks,
    totalErrors: metrics.totalErrors,
    byAction,
  };
}

export function dumpMenuStats(): void {
  log.info('📋 Context Menu Stats');
  log.info('Rebuilds:', metrics.rebuilds);
  log.info('Updates:', metrics.updates);
  log.info('Total clicks:', metrics.totalClicks);
  log.info('Total errors:', metrics.totalErrors);

  const rows = Array.from(metrics.byAction.entries())
    .sort(([, a], [, b]) => b.clicks - a.clicks)
    .map(([action, s]) => ({
      action,
      clicks: s.clicks,
      errors: s.errors,
      lastErr: s.lastError ? trunc(s.lastError, 40) : '—',
    }));
  log.info('Action Stats:', rows);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  UTILITIES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function maskOTP(otp: string): string {
  if (otp.length <= CONFIG.OTP_VISIBLE_SUFFIX) {
    return CONFIG.OTP_MASK_CHAR.repeat(otp.length);
  }
  return (
    CONFIG.OTP_MASK_CHAR.repeat(otp.length - CONFIG.OTP_VISIBLE_SUFFIX) +
    otp.slice(-CONFIG.OTP_VISIBLE_SUFFIX)
  );
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 2) {
    return email;
  }
  return email[0] + '•'.repeat(Math.min(at - 1, 6)) + email.slice(at);
}

function trunc(s: string | undefined, max: number): string {
  if (!s) {
    return '';
  }
  return s.length > max ? s.substring(0, max) + '…' : s;
}

function extractMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
