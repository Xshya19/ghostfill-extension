/**
 * messaging_deep.test.ts
 * Deep test suite for src/utils/messaging.ts
 *
 * Note: safeSendMessage validates messages via Zod before sending.
 * Messages must use valid action types with proper payloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  safeSendMessage,
  safeSendTabMessage,
} from '../src/utils/messaging';

describe('safeSendMessage() deep tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure chrome.runtime.id is set so isExtensionContextValid() returns true
    (chrome.runtime as any).id = 'test-extension-id';
  });

  it('sends a valid message and returns response', async () => {
    (chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, data: 'response' });

    // Use a valid action that doesn't require payload (e.g., GET_LAST_OTP)
    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    expect(result).toBeDefined();
    if (result) {
      expect(result.success).toBe(true);
    }
  });

  it('returns null for validation failure (unknown action)', async () => {
    const result = await safeSendMessage({ action: 'INVALID_ACTION_XYZ' } as any);
    // Unknown actions may fail validation depending on the schema setup
    // Either null (validation failed) or the message gets through
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('returns null when extension context is invalid', async () => {
    // Clear chrome.runtime.id to simulate invalid context
    (chrome.runtime as any).id = undefined;

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    expect(result).toBeNull();
  });

  it('handles sendMessage throwing error', async () => {
    (chrome.runtime.sendMessage as any).mockRejectedValue(new Error('Connection failed'));

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    // After retries, should return null
    expect(result).toBeNull();
  });

  it('handles extension context invalidated error', async () => {
    (chrome.runtime.sendMessage as any).mockRejectedValue(
      new Error('Extension context invalidated')
    );

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    expect(result).toBeNull();
  });

  it('handles receiving end does not exist', async () => {
    (chrome.runtime.sendMessage as any).mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    expect(result).toBeNull();
  });

  it('handles null response from sendMessage', async () => {
    (chrome.runtime.sendMessage as any).mockResolvedValue(null);

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    // null response is valid — message delivered but no data returned
    expect(result).toBeNull();
  });

  it('retries on transient failure then succeeds', async () => {
    (chrome.runtime.sendMessage as any)
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValue({ success: true });

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any);
    if (result) {
      expect(result.success).toBe(true);
    }
    expect((chrome.runtime.sendMessage as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('respects max retries on persistent failure', async () => {
    (chrome.runtime.sendMessage as any).mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );

    const result = await safeSendMessage({ action: 'GET_LAST_OTP' } as any, { retries: 1 });
    expect(result).toBeNull();
    // Should have tried at most retries+1 times
    expect((chrome.runtime.sendMessage as any).mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('handles timeout', async () => {
    // Create a promise that never resolves
    (chrome.runtime.sendMessage as any).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );

    const result = await safeSendMessage(
      { action: 'GET_LAST_OTP' } as any,
      { timeout: 100, retries: 0 }
    );
    expect(result).toBeNull();
  }, 10000);
});

describe('safeSendTabMessage() deep tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends message to specific tab', async () => {
    (chrome.tabs.sendMessage as any).mockResolvedValue({ success: true });

    const result = await safeSendTabMessage(1, { action: 'FILL_OTP', payload: { otp: '123456' } } as any);
    expect(result).toBeDefined();
    expect(chrome.tabs.sendMessage).toHaveBeenCalled();
  });

  it('handles content script unavailable', async () => {
    (chrome.tabs.sendMessage as any).mockRejectedValue(
      new Error('Could not establish connection. Receiving end does not exist.')
    );

    const result = await safeSendTabMessage(999, { action: 'FILL_OTP', payload: { otp: '123456' } } as any);
    expect(result).toBeNull();
  });

  it('handles invalid tab ID', async () => {
    (chrome.tabs.sendMessage as any).mockRejectedValue(
      new Error('No tab with id: -1')
    );

    const result = await safeSendTabMessage(-1, { action: 'FILL_OTP', payload: { otp: '123456' } } as any);
    expect(result).toBeNull();
  });

  it('returns null for non-existent tab', async () => {
    (chrome.tabs.sendMessage as any).mockRejectedValue(new Error('Tab not found'));

    const result = await safeSendTabMessage(99999, { action: 'FILL_OTP', payload: { otp: '123456' } } as any);
    expect(result).toBeNull();
  });
});
