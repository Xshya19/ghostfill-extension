import { fetchWithTimeout, isObject, withTimeout } from './core';

export const AUTOMATIC_UPDATE_STATE_FILE = 'ghostfill-update-state.json';

export interface AutomaticUpdateState {
  schemaVersion: 1;
  autoUpdateEnabled: boolean;
  taskName: string | null;
  installedVersion: string;
  updatedAt: string | null;
  lastCheckedAt: string | null;
  updateId: string | null;
  source: 'windows-helper';
}

function validVersion(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{1,5}(?:\.\d{1,5}){2}$/.test(value)) {
    return false;
  }
  const parts = value.split('.').map(Number);
  return parts.join('.') === value && parts.every((part) => part <= 65535) && parts.some(Boolean);
}

export function compareExtensionVersions(left: string, right: string): number {
  if (!validVersion(left) || !validVersion(right)) {
    throw new Error('Unsupported extension version.');
  }
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return a[i]! - b[i]!;
    }
  }
  return 0;
}

function validDate(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 40 &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      Number.isFinite(Date.parse(value)))
  );
}

export function parseAutomaticUpdateState(value: unknown): AutomaticUpdateState {
  if (
    !isObject(value) ||
    value.schemaVersion !== 1 ||
    value.source !== 'windows-helper' ||
    typeof value.autoUpdateEnabled !== 'boolean' ||
    !validVersion(value.installedVersion) ||
    !validDate(value.updatedAt) ||
    !validDate(value.lastCheckedAt) ||
    !(
      value.taskName === null ||
      (typeof value.taskName === 'string' &&
        /^GhostFill-AutoUpdate-[a-f0-9]{16}$/.test(value.taskName))
    ) ||
    !(
      value.updateId === null ||
      (typeof value.updateId === 'string' && /^[a-f0-9]{32}$/.test(value.updateId))
    ) ||
    (value.autoUpdateEnabled && !value.taskName)
  ) {
    throw new Error('Automatic update status is invalid. Run the setup shortcut again.');
  }
  return {
    schemaVersion: 1,
    autoUpdateEnabled: value.autoUpdateEnabled,
    taskName: value.taskName as string | null,
    installedVersion: value.installedVersion,
    updatedAt: value.updatedAt as string | null,
    lastCheckedAt: value.lastCheckedAt as string | null,
    updateId: value.updateId as string | null,
    source: 'windows-helper',
  };
}

export async function readAutomaticUpdateState(
  signal?: AbortSignal
): Promise<AutomaticUpdateState> {
  const response = await fetchWithTimeout(chrome.runtime.getURL(AUTOMATIC_UPDATE_STATE_FILE), {
    cache: 'no-store',
    credentials: 'omit',
    timeout: 3000,
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw new Error(
      'Automatic update status is unavailable. Open your installed GhostFill folder.'
    );
  }
  const raw = await withTimeout(response.text(), 3000);
  if (signal?.aborted) {
    throw new DOMException('Request cancelled.', 'AbortError');
  }
  if (raw.length > 16_384) {
    throw new Error('Automatic update status is invalid.');
  }
  return parseAutomaticUpdateState(JSON.parse(raw));
}
