// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

describe('background command registration', () => {
  it('runs shortcuts on worker wake and keeps one listener after initialization', async () => {
    const events: Record<string, Function[]> = {};
    const event = (name: string) => ({
      addListener: (listener: Function) => (events[name] ??= []).push(listener),
    });
    const quiet = { info() {}, debug() {}, warn: vi.fn(), error: vi.fn() };
    const send = vi.fn().mockResolvedValue(undefined);
    let initialize: (trigger: string) => Promise<void>;
    const dependencies: Record<string, unknown> = {
      '../services/performanceService': {
        errorTracker: { init() {} },
        performanceMonitor: { init() {} },
      },
      '../utils/core': { sleep: async () => {} },
      '../utils/logger': { createLogger: () => quiet, initRemoteLogger() {} },
      '../utils/messaging': { safeSendTabMessage: send },
      './contextMenu': {},
      './initGuard': {
        registerInitCallbacks: (callback: typeof initialize) => {
          initialize = callback;
        },
        setInitialized() {},
        setActiveInitPromise() {},
      },
      './messageHandler': { setupMessageHandler() {} },
      './notifications': { initNotifications() {} },
      './pollingManager': {},
      './serviceWorker': { initServiceWorker: async () => {}, getBootState: () => 'ready' },
      './autoUpdater': { setupUpdateAlarm: async () => {} },
      '../services/storageService': {
        storageService: {
          getSettings: async () => ({ keyboardShortcuts: true, clearOnClose: false }),
        },
      },
    };
    const chrome = {
      runtime: {
        onInstalled: event('installed'),
        onStartup: event('startup'),
        onSuspend: event('suspend'),
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
      },
      commands: { onCommand: event('command') },
      alarms: { onAlarm: event('alarm'), clear: async () => true, create: async () => {} },
      notifications: { onClicked: event('notification') },
      tabs: { query: async () => [{ id: 42 }] },
    };
    const { outputText } = ts.transpileModule(
      readFileSync(resolve('src/background/index.ts'), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
    );
    const exports: { getMetrics?: () => { byCommand: Record<string, unknown> } } = {};
    runInNewContext(outputText, {
      exports,
      chrome,
      self: { addEventListener() {} },
      require: (id: string) => {
        if (!(id in dependencies)) throw new Error(`Unexpected import ${id}`);
        return dependencies[id];
      },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    });
    expect(Object.keys(exports.getMetrics!().byCommand).sort()).toEqual([
      'auto-fill',
      'check-inbox',
      'generate-email',
      'generate-password',
    ]);
    events.command[0]('auto-fill');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(42, { action: 'SMART_AUTOFILL' }));
    await initialize!('startup');
    expect(events.command).toHaveLength(1);
    expect(quiet.warn).not.toHaveBeenCalledWith('Unknown command', expect.anything());
    expect(quiet.error).not.toHaveBeenCalled();
  });
});

describe('diagnostic issue reporter', () => {
  it.each([true, false])('reports command success=%s without hiding failures', (succeeds) => {
    const commands: string[] = [];
    const lines: string[] = [];
    const module = {
      exports: {} as Record<string, { success: boolean; exitCode?: number; output: string }>,
    };
    runInNewContext(readFileSync(resolve('scripts/issue-reporter.js'), 'utf8'), {
      module,
      console: { log: (...args: unknown[]) => lines.push(args.join(' ')) },
      require: (id: string) => {
        if (id === 'child_process')
          return {
            execSync: (command: string) => {
              commands.push(command);
              if (succeeds || command.includes('||')) return 'check output';
              throw Object.assign(new Error('check failed'), {
                status: 2,
                stdout: 'failing check output',
                stderr: 'failure detail',
              });
            },
          };
        return {};
      },
    });
    expect(commands).toHaveLength(4);
    expect(Object.values(module.exports).every((result) => result.success === succeeds)).toBe(true);
    if (!succeeds) {
      expect(lines.filter((line) => line.includes('FAIL'))).toHaveLength(4);
      expect(Object.values(module.exports).every((result) => result.exitCode === 2)).toBe(true);
      expect(module.exports.tsResult.output).toContain('failure detail');
    }
  });
});
