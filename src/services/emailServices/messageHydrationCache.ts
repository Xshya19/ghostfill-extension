import { Email } from '../../types';

interface CachedMessage {
  email: Email;
  expiresAt: number;
  bytes: number;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Message request cancelled', 'AbortError');
  }
}

function copyEmail(email: Email): Email {
  return { ...email, attachments: email.attachments.map((attachment) => ({ ...attachment })) };
}

/**
 * Email bodies are normally immutable. Reuse successful hydration for five
 * minutes while continuing to fetch fresh inbox lists. Keep this in memory;
 * neither private bodies nor mailbox addresses are written to another store.
 */
export class MessageHydrationCache {
  private readonly entries = new Map<string, CachedMessage>();
  private readonly pending = new Map<string, Promise<Email>>();
  private bytes = 0;
  private generation = 0;
  private readonly ttlMs = 5 * 60_000;
  private readonly maxEntries = 50;
  private readonly maxBytes = 1_048_576;

  async get(
    address: string,
    messageId: string,
    load: () => Promise<Email>,
    signal?: AbortSignal
  ): Promise<Email> {
    throwIfCancelled(signal);
    const key = JSON.stringify([address, messageId]);
    const now = Date.now();
    for (const [entryKey, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.remove(entryKey);
      }
    }
    const cached = this.entries.get(key);
    if (cached) {
      // Update LRU order without extending the freshness deadline.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return copyEmail(cached.email);
    }

    // Never let one caller's AbortSignal cancel another caller's request.
    const existing = signal ? undefined : this.pending.get(key);
    if (existing) {
      return copyEmail(await existing);
    }

    const generation = this.generation;
    const promise = (async () => {
      const email = await load();
      throwIfCancelled(signal);
      if (generation === this.generation && (email.body || email.htmlBody || email.textBody)) {
        this.store(key, email);
      }
      return email;
    })();
    if (!signal) {
      this.pending.set(key, promise);
    }
    try {
      return copyEmail(await promise);
    } finally {
      if (this.pending.get(key) === promise) {
        this.pending.delete(key);
      }
    }
  }

  clear(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  private store(key: string, email: Email): void {
    const bytes =
      2 *
      (key.length +
        email.body.length +
        (email.htmlBody?.length ?? 0) +
        (email.textBody?.length ?? 0) +
        email.from.length +
        (email.to?.length ?? 0) +
        email.subject.length +
        JSON.stringify(email.attachments).length);
    if (bytes > this.maxBytes) {
      return;
    }
    this.remove(key);
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.remove(oldestKey);
    }
    this.entries.set(key, {
      email: copyEmail(email),
      expiresAt: Date.now() + this.ttlMs,
      bytes,
    });
    this.bytes += bytes;
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
}
