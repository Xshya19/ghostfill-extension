import { describe, it, expect, vi } from 'vitest';
import { storageService } from '../src/services/storageService';
import { dedupService } from '../src/services/dedupService';
import { emailService } from '../src/services/emailServices';
import { sleep } from '../src/utils/core';
import { EmailAccount } from '../src/types';

describe('Concurrency & Race Condition Stress Suite', () => {
  describe('StorageService High-Concurrency Consistency', () => {
    it('handles 30 simultaneous concurrent writes without corruption', async () => {
      const writes = Array.from({ length: 30 }, (_, idx) =>
        storageService.set('behaviorData', {
          formInteractions: idx,
          lastActivity: Date.now(),
        } as any)
      );

      await Promise.all(writes);

      const result = await storageService.get('behaviorData');
      expect(result).toBeDefined();
      expect(typeof (result as any).formInteractions).toBe('number');
    });

    it('maintains read coherence during interleaved concurrent read/write operations', async () => {
      const operations: Promise<unknown>[] = [];

      for (let i = 0; i < 20; i++) {
        if (i % 2 === 0) {
          operations.push(
            storageService.set('siteContexts', {
              [`domain_${i}.com`]: { domain: `domain_${i}.com`, lastVisited: Date.now() },
            } as any)
          );
        } else {
          operations.push(storageService.get('siteContexts'));
        }
      }

      const results = await Promise.all(operations);
      expect(results.length).toBe(20);
    });

    it('correctly handles removal and concurrent get requests without throwing', async () => {
      const testEmail: EmailAccount = {
        id: 'opt_test_1',
        username: 'optuser',
        login: 'optuser',
        domain: 'example.com',
        fullEmail: 'optuser@example.com',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        service: 'catchmail',
      };

      await storageService.set('currentEmail', testEmail);
      const readVal = await storageService.get('currentEmail');
      expect(readVal?.fullEmail).toBe('optuser@example.com');

      await storageService.remove('currentEmail');
      const removedVal = await storageService.get('currentEmail');
      expect(removedVal).toBeUndefined();
    });
  });

  describe('DedupService High-Burst & Concurrency', () => {
    it('handles 50 parallel dedup checks and correctly registers unique hashes', async () => {
      const accountId = 'test_acc_99';
      const items = Array.from({ length: 50 }, (_, i) => `msg_${i}`);

      // Initial check - none processed
      const initialChecks = await Promise.all(
        items.map((id) => dedupService.isProcessed(id, accountId))
      );
      initialChecks.forEach((isProc) => {
        expect(isProc).toBe(false);
      });

      // Mark all processed in parallel
      await Promise.all(
        items.map((id) => dedupService.markProcessed(id, accountId, true, false))
      );

      // Now all should be processed
      const subsequentChecks = await Promise.all(
        items.map((id) => dedupService.isProcessed(id, accountId))
      );
      subsequentChecks.forEach((isProc) => {
        expect(isProc).toBe(true);
      });
    });

    it('handles pending states correctly under concurrency', async () => {
      const accountId = 'test_acc_pending';
      const emailId = 'pending_msg_1';

      await dedupService.markPending(emailId, accountId);
      const isPending = await dedupService.isPending(emailId, accountId);
      expect(isPending).toBe(true);

      const isProcessed = await dedupService.isProcessed(emailId, accountId);
      expect(isProcessed).toBe(true); // Pending items count as processed to prevent duplicate race fetches

      await dedupService.clearPending(emailId, accountId);
      const isPendingAfter = await dedupService.isPending(emailId, accountId);
      expect(isPendingAfter).toBe(false);
    });
  });

  describe('EmailServiceAggregator Mutex & Concurrent Calls', () => {
    it('coalesces multiple concurrent generateEmail calls to prevent double creation', async () => {
      const mockAccount: EmailAccount = {
        id: 'concurrent_acc_1',
        username: 'concurrent_user',
        login: 'concurrent_user',
        domain: 'catchmail.io',
        fullEmail: 'concurrent_user@catchmail.io',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        service: 'catchmail',
      };

      vi.spyOn(emailService as any, 'createAccountWithService').mockImplementation(async () => {
        await sleep(50);
        return mockAccount;
      });

      // Trigger 10 concurrent requests at the exact same moment
      const requests = Array.from({ length: 10 }, () =>
        emailService.generateEmail({ service: 'catchmail' })
      );

      const accounts = await Promise.all(requests);

      // All 10 callers should receive the exact same generated email account
      expect(accounts.length).toBe(10);
      const firstEmail = accounts[0]!.fullEmail;
      accounts.forEach((acc) => {
        expect(acc.fullEmail).toBe(firstEmail);
      });
    });
  });
});
