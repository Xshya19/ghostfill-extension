import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearNotification, destroyNotifications, notifyNewEmail } from '../src/background/notifications';

afterEach(() => {
  destroyNotifications();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  const create = chrome.notifications.create as unknown as ReturnType<typeof vi.fn>;
  const clear = chrome.notifications.clear as unknown as ReturnType<typeof vi.fn>;
  const getURL = chrome.runtime.getURL as unknown as ReturnType<typeof vi.fn>;
  getURL.mockImplementation((path: string) => `chrome-extension://test-extension-id/${path}`);
  create.mockImplementation((id: string, _options: unknown, callback: (id: string) => void) => {
    callback(id);
  });
  clear.mockImplementation((_id: string, callback: (cleared: boolean) => void) => {
    callback(true);
  });
});

it('uses a packaged extension image for OTP notifications', async () => {
  const create = chrome.notifications.create as unknown as ReturnType<typeof vi.fn>;
  const id = await notifyNewEmail('sender@example.com', 'Your code', '582914');
  expect(id).toMatch(/^gf-otp-/);
  const options = create.mock.calls[0]?.[1] as chrome.notifications.NotificationOptions<true>;
  expect(options.iconUrl).toBe('chrome-extension://test-extension-id/assets/icons/icon128.png');
  await clearNotification(id);
});

it('uses the same evidence-based sender label in native notifications', async () => {
  const id = await notifyNewEmail('bounces+opaque', 'Your NovaMesh sign-in code', '582914', undefined,
    '<a href="https://novamesh.io/signin">Sign in</a>');
  const options = vi.mocked(chrome.notifications.create).mock.calls[0]![1] as chrome.notifications.NotificationOptions<true>;
  expect(options.message).toBe('NovaMesh\nYour NovaMesh sign-in code');
  await clearNotification(id);
});

it('keeps paired-code notifications within Chrome\'s two-button limit', async () => {
  const id = await notifyNewEmail('sender@example.com', 'Your sign-in alternatives', '005612', 'https://example.com/verify?token=fixture');
  const options = vi.mocked(chrome.notifications.create).mock.calls[0]![1] as chrome.notifications.NotificationOptions<true>;
  expect(options.buttons?.map(button => button.title)).toEqual(['Copy code', 'Open link']);
  await clearNotification(id);
});

it('notifies a new code with the same masked suffix while suppressing an exact repeat', async () => {
  const first = await notifyNewEmail('sender@example.com', 'A new sign-in code', '005612');
  const second = await notifyNewEmail('sender@example.com', 'A new sign-in code', '745612');
  const repeated = await notifyNewEmail('sender@example.com', 'A new sign-in code', '745612');
  expect(first).toMatch(/^gf-otp-/);
  expect(second).toMatch(/^gf-otp-/);
  expect(repeated).toBe('');
  expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
  await clearNotification(first);
  await clearNotification(second);
});
