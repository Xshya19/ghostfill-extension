# Backend efficiency and reliability

The 1.1.5 backend audit covers provider I/O, verification extraction, browser storage, polling, SSE recovery, keyboard startup, notifications, and diagnostic logging. Changes target reproduced defects and repeated work without changing extension permissions or sending diagnostics to a remote monitoring service.

## Measurements

Baseline: 1.1.4 source at `98d141aef6e57eaecb38e32f207040a332f5e0f3`. Measurements use local fixtures and mocked browser/provider APIs on Windows with Node 24.16.0. They do not measure real provider latency or claim universal website compatibility.

| Workload                                                           | Before                                            | After                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------- |
| Three unchanged five-message Driftz/Catchmail inbox polls          | 18 HTTP requests                                  | 8 HTTP requests; all three inbox lists refreshed                            |
| 32 simultaneous identical verification requests                    | 32 extractions; 65 session reads; 32 cache writes | 1 extraction; 0 session reads; 1 encrypted cache write after initialization |
| Overlapping batch, overlapping batch, and single-key storage reads | 3 storage requests                                | 1 storage request with unique keys                                          |
| 600 log messages with debug history available                      | 600 history copies                                | 0 history copies until the debug history is read                            |

The extraction fixture is about 13 KB of HTML and contains an explicitly labeled six-digit code. The recorded concurrent baseline took about 318 ms; optimized validation runs took about 17–38 ms on the same machine. Timing depends on hardware, runtime, and load. Request and extraction counts are the primary regression guarantees.

Run the benchmark without a browser or provider credentials:

```bash
npm run benchmark:extraction
```

It checks plain codes, leading-zero codes paired with links, large HTML, newsletters containing postal codes and numeric HTML entities, and fragment-based magic links. It reports median/p95 extraction timing, CPU time, concurrency, and browser-storage operation counts. It does not use time thresholds as CI gates.

## Cache and concurrency boundaries

- **Provider bodies:** successful Driftz/Catchmail hydration is kept only in worker memory, scoped by mailbox address and message ID. Each provider cache holds at most 50 entries with an estimated text/attachment budget of 1 MiB, expires entries after five minutes without extending their deadline on hits, skips oversized messages, and clears on inbox-session invalidation. JavaScript object overhead is additional to the estimated payload budget. Inbox lists continue to refresh normally; failed or empty hydration is retried.
- **Cancellation:** requests with independent abort signals do not share a cancellable fetch. Cancellation stops generation cooldowns and fallback/backoff and does not mark a provider unhealthy. Coalescing preserves the `preventRegeneration` policy.
- **Timestamps:** Driftz/Catchmail use a valid list timestamp or the hydrated detail timestamp. Missing timestamps are explicitly unknown, remain stable across polls, and appear as **Date unavailable**. Those messages remain accessible for manual review; automatic verification and notifications require established freshness. Other adapters retain their previous date-only comparison behavior so fallback times cannot introduce new inbox-write storms.
- **Verification:** simultaneous identical inputs and site contexts share extraction. Each caller receives its own result/decision copy. Code-evidence normalization is scoped to that extraction and retains no message text afterward.
- **Detection cache:** at most 100 tracked encrypted results and 100 shared in-flight request keys. Writes and index changes serialize. Only indexed detection keys are read or removed; unrelated session data is not scanned. A worker restart creates a new memory-only key and discards the previous worker's indexed ciphertext. A one-second optional-cache deadline allows extraction to continue if storage or crypto stalls; the cache stays disabled for that worker after an operation failure to avoid late writes racing newer updates.
- **Storage:** single-key, fresh, and batch requests share current in-flight work. Request identity guards reject older responses after writes, deletion, fresh reads, change events, clears, or unload. One cache-change listener serves subscribers in each `StorageService` instance. Superseded optimistic timers are cancelled. Existing encrypted writes, bounded retries, and disk verification remain in place.
- **Logs:** the 100-entry redacted history remains available. Its global console surface returns a current snapshot when read; logging no longer copies the full history per entry. Debug settings and normal console visibility are preserved, and OTP redaction does not repeat the captured code.

## Lifecycle fixes

The polling scheduler uses a generation check after asynchronous browser/settings reads. Stopping or restarting polling cannot install an obsolete timer or let an old disabled setting stop a newer cycle.

SSE connection work checks its generation before applying results, errors, reader data, or offscreen replies. Reconnect attempts preserve increasing delay and the eight-retry limit. Successful connection and explicit disconnection reset recovery state. An obsolete connection cannot tear down a newer stream. Ordinary worker suspension leaves the offscreen relay available; explicit disconnect/reset still stops its stream.

Keyboard commands register independently of the listener-installation guard and use the same cold-start initialization guard as messages. Notification requests capture the inbox generation before their first asynchronous gate; stale requests and retries are suppressed after a session reset.

## Regression checks

```bash
npx vitest run tests/storage_read_consistency.test.ts tests/storage_lifecycle_regression.test.ts tests/logger_console_visibility.test.ts tests/email_io_efficiency.test.ts tests/detection_cache_efficiency.test.ts tests/backend_polling_scheduler.test.ts tests/backend_sse_sessions.test.ts tests/backend_notification_sessions.test.ts tests/backend_command_lifecycle.test.ts
npm run type-check
npm run lint
npm test
```

The existing verification-precision and delivery suites remain required. They prevent postal codes, invisible HTML entities, stale messages, newsletter links, and ambiguous verification evidence from becoming automatic actions. Release builds, bundle limits, vulnerability checks, and the Windows updater are validated locally under the repository's [manual release process](RELEASING.md).

## Practical limits

Live provider availability, browser notification delivery, unfamiliar form frameworks, and third-party site acceptance are outside a fixture benchmark. The notification API callback wrappers still depend on Chrome completing its callbacks; there was no observed callback-stall reproduction in this audit. Live signup and OAuth flows need a configured account and browser session. These changes improve tested efficiency and recovery; they do not establish that every website or email format succeeds.
