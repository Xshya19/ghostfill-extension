import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, unknown> = {};

vi.mock('../storageService', () => ({
  storageService: {
    get: vi.fn(async (key: string) => store[key]),
    set: vi.fn(async (key: string, value: unknown) => {
      store[key] = value;
    }),
  },
}));

import {
  buildGmailAliasSearchQuery,
  filterGmailMessagesForAliasSession,
  getGmailAliasProcessingBaseline,
  rememberGmailAliasSession,
  setGmailConnectedAt,
  getOrCreateGmailAliasSessionByDomain,
  getGmailAliasSession,
} from '../gmailAliasSessionService';
import { GmailMessage } from '../../types/message.types';

function message(id: string, date: number, to = 't.aayush515+twitter@gmail.com'): GmailMessage {
  return {
    id,
    threadId: id,
    snippet: '',
    subject: 'Verification',
    from: 'no-reply@example.com',
    fromEmail: 'no-reply@example.com',
    fromName: 'Example',
    to,
    date,
    dateFormatted: '',
    isUnread: true,
    labelIds: ['INBOX'],
  };
}

describe('gmailAliasSessionService', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
  });

  it('filters out Gmail messages that predate the alias session', () => {
    const startedAt = 1_000_000;
    const session = {
      alias: 't.aayush515+twitter@gmail.com',
      originalEmail: 'taayush515@gmail.com',
      website: 'twitter.com',
      startedAt,
      lastUsedAt: startedAt,
    };

    expect(
      filterGmailMessagesForAliasSession(
        [message('old', startedAt - 310_000), message('new', startedAt - 290_000)],
        session
      ).map((item) => item.id)
    ).toEqual(['new']);
  });

  it('filters out Gmail messages that predate the Gmail connection baseline', () => {
    const startedAt = 1_000_000;
    const session = {
      alias: 't.aayush515+twitter@gmail.com',
      originalEmail: 'taayush515@gmail.com',
      website: 'twitter.com',
      startedAt,
      lastUsedAt: startedAt,
      inboxBaselineAt: startedAt + 5_000,
    };

    expect(getGmailAliasProcessingBaseline(session)).toBe(startedAt + 5_000 - 300_000);
    expect(
      filterGmailMessagesForAliasSession(
        [message('old', startedAt + 5_000 - 310_000), message('new', startedAt + 5_000 - 290_000)],
        session
      ).map((item) => item.id)
    ).toEqual(['new']);
  });

  it('pins new alias sessions to the Gmail connection baseline', async () => {
    await setGmailConnectedAt(50_000);

    const session = await rememberGmailAliasSession(
      'T.Aayush515+Twitter@gmail.com',
      'taayush515@gmail.com',
      'twitter.com',
      60_000
    );

    expect(session.startedAt).toBe(60_000);
    expect(session.inboxBaselineAt).toBe(60_000);
  });

  it('preserves the start line while the alias is still in the active flow', async () => {
    const first = await rememberGmailAliasSession(
      'T.Aayush515+Twitter@gmail.com',
      'taayush515@gmail.com',
      'twitter.com',
      10_000
    );
    const second = await rememberGmailAliasSession(
      't.aayush515+twitter@gmail.com',
      'taayush515@gmail.com',
      'twitter.com',
      10_000 + 60_000
    );

    expect(second.startedAt).toBe(first.startedAt);
    expect(second.lastUsedAt).toBe(70_000);
  });

  it('builds an alias-scoped Gmail query', () => {
    expect(buildGmailAliasSearchQuery('T.Aayush515+Twitter@gmail.com')).toBe(
      'in:anywhere to:"t.aayush515+twitter@gmail.com" newer_than:7d'
    );
    expect(buildGmailAliasSearchQuery('T.Aayush515+Twitter@gmail.com', 1600000000000)).toBe(
      'in:anywhere to:"t.aayush515+twitter@gmail.com" after:1600000000'
    );
  });

  it('returns the same alias session for concurrent getOrCreateGmailAliasSessionByDomain calls', async () => {
    await setGmailConnectedAt(50_000);
    const mockFactory = vi.fn((orig, site) => `${orig.split('@')[0]}+${site}@gmail.com`);

    const [session1, session2] = await Promise.all([
      getOrCreateGmailAliasSessionByDomain(
        'taayush515@gmail.com',
        'netflix.com',
        mockFactory,
        60_000
      ),
      getOrCreateGmailAliasSessionByDomain(
        'taayush515@gmail.com',
        'netflix.com',
        mockFactory,
        60_000
      ),
    ]);

    expect(session1.alias).toBe('taayush515+netflix.com@gmail.com');
    expect(session2.alias).toBe('taayush515+netflix.com@gmail.com');
    expect(session1.startedAt).toBe(60_000);
    expect(session2.startedAt).toBe(60_000);
    expect(mockFactory).toHaveBeenCalledTimes(1); // Factory should only be called once atomically
  });

  it('filters out recent Gmail messages sent to the base Gmail address (does not match alias)', () => {
    const startedAt = 1_000_000;
    const session = {
      alias: 't.aayush515+twitter@gmail.com',
      originalEmail: 'taayush515@gmail.com',
      website: 'twitter.com',
      startedAt,
      lastUsedAt: startedAt,
      inboxBaselineAt: startedAt,
    };

    const baseMessage = message('m1', startedAt + 10_000);
    baseMessage.to = 'taayush515@gmail.com'; // Sent to base address, not the alias
    baseMessage.cc = 'random@gmail.com';

    const aliasMessage = message('m2', startedAt + 10_000);
    aliasMessage.to = 't.aayush515+twitter@gmail.com'; // Sent to the alias

    const filtered = filterGmailMessagesForAliasSession([baseMessage, aliasMessage], session);
    expect(filtered.map((m) => m.id)).toEqual(['m2']);
  });

  it('ignores messages before inboxBaselineAt - 5min (baseline grace period)', () => {
    const startedAt = 1_000_000;
    const session = {
      alias: 't.aayush515+twitter@gmail.com',
      originalEmail: 'taayush515@gmail.com',
      website: 'twitter.com',
      startedAt,
      lastUsedAt: startedAt,
      inboxBaselineAt: startedAt,
    };

    // Grace period is 5 minutes (300,000 ms), so threshold is 700,000 ms.
    const msgBeforeGrace = message('m1', 700_000 - 10_000); // 690,000 ms (should be ignored)
    const msgAfterGrace = message('m2', 700_000 + 10_000); // 710,000 ms (should be kept)

    msgBeforeGrace.to = 't.aayush515+twitter@gmail.com';
    msgAfterGrace.to = 't.aayush515+twitter@gmail.com';

    const filtered = filterGmailMessagesForAliasSession([msgBeforeGrace, msgAfterGrace], session);
    expect(filtered.map((m) => m.id)).toEqual(['m2']);
  });

  it('does not crash the extension and recovers gracefully when gmailAliasSessions is malformed', async () => {
    // Set malformed stored session
    store['gmailAliasSessions'] = 'malformed_string';
    let session = await getGmailAliasSession('any@gmail.com');
    expect(session).toBeNull(); // Recovers gracefully with empty object, returns null

    // Set object with malformed properties
    store['gmailAliasSessions'] = {
      'invalid@gmail.com': {
        alias: 'invalid@gmail.com',
        // missing fields
      },
      'valid+tag@gmail.com': {
        alias: 'valid+tag@gmail.com',
        originalEmail: 'valid@gmail.com',
        website: 'valid.com',
        startedAt: 100_000,
        lastUsedAt: 120_000,
        inboxBaselineAt: 100_000,
      },
    };

    session = await getGmailAliasSession('valid+tag@gmail.com');
    expect(session).not.toBeNull();
    expect(session?.alias).toBe('valid+tag@gmail.com');

    session = await getGmailAliasSession('invalid@gmail.com');
    expect(session).toBeNull(); // Dropped from readAliasSessions because it is malformed
  });
});
