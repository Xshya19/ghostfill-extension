/**
 * dedup_service_deep.test.ts
 * Deep test suite for src/services/dedupService.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock storageService before importing dedupService
vi.mock('../src/services/storageService', () => {
  const store = new Map<string, any>();
  return {
    storageService: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: any) => { store.set(key, value); }),
      remove: vi.fn(async (key: string) => { store.delete(key); }),
      _store: store,
    },
  };
});

import { storageService } from '../src/services/storageService';

import { dedupService } from '../src/services/dedupService';

// Exercise production code with a fresh instance for each case.
const DedupServiceConstructor = dedupService.constructor as new () => typeof dedupService;

describe('DedupService deep tests', () => {
  let dedup: typeof dedupService;

  beforeEach(async () => {
    vi.clearAllMocks();
    (storageService as any)._store.clear();
    dedup = new DedupServiceConstructor();
    await dedup.initialize();
  });

  afterEach(() => {
    dedup.destroy();
    vi.restoreAllMocks();
  });

  // ── Basic Operations ──

  it('marks email as processed and retrieves it', async () => {
    await dedup.markProcessed('email-1', 'acct-1', true, false);
    const record = await dedup.getRecord('email-1', 'acct-1');
    expect(record).not.toBeNull();
    expect(record.hadOTP).toBe(true);
    expect(record.hadLink).toBe(false);
  });

  it('isProcessed returns true for processed emails', async () => {
    await dedup.markProcessed('e1', 'a1', false, true);
    expect(await dedup.isProcessed('e1', 'a1')).toBe(true);
  });

  it('isProcessed returns false for unknown emails', async () => {
    expect(await dedup.isProcessed('unknown', 'a1')).toBe(false);
  });

  it('respects account isolation', async () => {
    await dedup.markProcessed('e1', 'acct-A', true, false);
    expect(await dedup.isProcessed('e1', 'acct-A')).toBe(true);
    expect(await dedup.isProcessed('e1', 'acct-B')).toBe(false);
  });

  it('handles numeric email IDs', async () => {
    await dedup.markProcessed(12345, 'a1', true, true);
    expect(await dedup.isProcessed(12345, 'a1')).toBe(true);
    expect(await dedup.isProcessed('12345', 'a1')).toBe(true);
  });

  // ── TTL Expiry ──

  it('returns null for expired records', async () => {
    await dedup.markProcessed('e1', 'a1', true, false);
    const record = await dedup.getRecord('e1', 'a1');
    expect(record).not.toBeNull();
    vi.spyOn(Date, 'now').mockReturnValue(record!.ttlExpiresAt);
    expect(await dedup.getRecord('e1', 'a1')).toBeNull();
    expect(await dedup.isProcessed('e1', 'a1')).toBe(false);
  });

  // ── Pending Records ──

  it('marks email as pending and checks', async () => {
    await dedup.markPending('e1', 'a1', 60000);
    expect(await dedup.isPending('e1', 'a1')).toBe(true);
    expect(await dedup.isProcessed('e1', 'a1')).toBe(true); // pending counts as processed
  });

  it('clears pending state', async () => {
    await dedup.markPending('e1', 'a1');
    await dedup.clearPending('e1', 'a1');
    expect(await dedup.isPending('e1', 'a1')).toBe(false);
  });

  it('pending expires after TTL', async () => {
    await dedup.markPending('e1', 'a1', 10); // 10ms TTL
    await new Promise(r => setTimeout(r, 20));
    expect(await dedup.isPending('e1', 'a1')).toBe(false);
  });

  it('markProcessed clears pending', async () => {
    await dedup.markPending('e1', 'a1');
    await dedup.markProcessed('e1', 'a1', true, false);
    expect(await dedup.isPending('e1', 'a1')).toBe(false);
  });

  // ── Bulk Operations ──

  it('handles 100 simultaneous dedup checks', async () => {
    const promises = Array.from({ length: 100 }, (_, i) =>
      dedup.markProcessed(`email-${i}`, 'a1', i % 2 === 0, i % 3 === 0)
    );
    await Promise.all(promises);

    expect(dedup.size).toBe(100);

    const checks = Array.from({ length: 100 }, (_, i) =>
      dedup.isProcessed(`email-${i}`, 'a1')
    );
    const results = await Promise.all(checks);
    expect(results.every(r => r === true)).toBe(true);
  });

  // ── Prune ──

  it('prune removes zero records when all are fresh', async () => {
    await dedup.markProcessed('e1', 'a1', true, false);
    await dedup.markProcessed('e2', 'a1', false, true);
    const pruned = await dedup.prune();
    expect(pruned).toBe(0);
    expect(dedup.size).toBe(2);
  });

  // ── Clear ──

  it('clear empties all records', async () => {
    await dedup.markProcessed('e1', 'a1', true, false);
    await dedup.markProcessed('e2', 'a1', false, true);
    await dedup.clear();
    expect(dedup.size).toBe(0);
    expect(await dedup.isProcessed('e1', 'a1')).toBe(false);
  });

  it('clear also clears pending records', async () => {
    await dedup.markPending('e1', 'a1');
    await dedup.clear();
    expect(await dedup.isPending('e1', 'a1')).toBe(false);
  });

  it('double clear is safe', async () => {
    await dedup.markProcessed('e1', 'a1', true, false);
    await dedup.clear();
    await dedup.clear(); // Should not throw
    expect(dedup.size).toBe(0);
  });

  // ── Edge Cases ──

  it('handles special characters in emailId', async () => {
    const specialId = 'email:<script>alert(1)</script>';
    await dedup.markProcessed(specialId, 'a1', true, false);
    expect(await dedup.isProcessed(specialId, 'a1')).toBe(true);
  });

  it('handles empty accountId', async () => {
    await dedup.markProcessed('e1', '', true, false);
    expect(await dedup.isProcessed('e1', '')).toBe(true);
  });

  it('handles very long IDs', async () => {
    const longId = 'x'.repeat(10000);
    await dedup.markProcessed(longId, 'a1', true, false);
    expect(await dedup.isProcessed(longId, 'a1')).toBe(true);
  });
});
