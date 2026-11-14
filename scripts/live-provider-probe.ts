/**
 * Live provider probe — GhostFill
 *
 * Exercises EVERY disposable provider over the real network through the
 * production aggregator path (getDomains → generateEmail → checkInbox),
 * exactly as the extension uses them. Read-only except for creating one
 * disposable test account per provider (normal free-tier usage).
 *
 * Run: npx tsx scripts/live-provider-probe.ts
 * Exit 0 = all probed providers operational (legacy tier allowed to fail
 * with a warning); exit 1 = a HEALTHY-tier provider failed.
 */
import { EmailServiceAggregator } from '../src/services/emailServices';
import type { EmailService } from '../src/types';

const HEALTHY_TIER: EmailService[] = [
  'driftz',
  'catchmail',
  'throwawaymail',
  'tempmailplus',
  'mailtm',
  'mailgw',
  'guerrilla',
  'maildrop',
  'yopmail',
];

const LEGACY_TIER: EmailService[] = [
  'mailcx',
  'dropmail',
  'mailboxtemp',
  'openinbox',
  'evilmail',
  'getnada',
  'tempmaillol',
  'tempmail',
  '1secmail',
  'mailinator',
  'mailnesia',
];

const OP_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OP_TIMEOUT_MS);
  // Race the work against a timeout; abort signal is best-effort.
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${OP_TIMEOUT_MS}ms`)), OP_TIMEOUT_MS + 500)
    ),
  ]);
}

interface ProbeResult {
  service: string;
  tier: string;
  domains: string;
  generated: string;
  inbox: string;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

async function probeService(
  emailService: EmailServiceAggregator,
  service: EmailService,
  tier: string
): Promise<ProbeResult> {
  const started = Date.now();
  const result: ProbeResult = {
    service,
    tier,
    domains: '—',
    generated: '—',
    inbox: '—',
    latencyMs: 0,
    ok: false,
  };
  try {
    const domains = await withTimeout(emailService.getDomains(service), `${service} getDomains`);
    result.domains = `${domains.length} (${domains.slice(0, 2).join(', ')}${domains.length > 2 ? '…' : ''})`;

    const prefix = `probe${Date.now().toString(36)}`;
    const account = await withTimeout(
      emailService.generateEmail({ service, prefix }),
      `${service} generateEmail`
    );
    result.generated = account.fullEmail;

    const messages = await withTimeout(
      emailService.checkInbox(account),
      `${service} checkInbox`
    );
    result.inbox = `${messages.length} msg(s)`;

    // If mail arrived (unlikely on fresh inbox), verify full-body read path.
    if (messages.length > 0 && messages[0]) {
      const full = await withTimeout(
        emailService.readEmail(messages[0].id, account),
        `${service} readEmail`
      );
      result.inbox += `, read ok (${(full.body || '').length} chars)`;
    }

    result.ok = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message.slice(0, 160) : String(error);
  }
  result.latencyMs = Date.now() - started;
  return result;
}

async function main(): Promise<void> {
  const emailService = new EmailServiceAggregator();
  const results: ProbeResult[] = [];

  for (const service of [...HEALTHY_TIER, ...LEGACY_TIER]) {
    process.stdout.write(`probing ${service}… `);
    const result = await probeService(emailService, service, HEALTHY_TIER.includes(service) ? 'healthy' : 'legacy');
    results.push(result);
    console.log(result.ok ? `OK (${result.latencyMs}ms)` : `FAIL: ${result.error}`);
    // Be polite to free APIs.
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n ─── Live provider report ───');
  console.log(
    'service'.padEnd(15) +
      'tier'.padEnd(9) +
      'domains'.padEnd(34) +
      'generated'.padEnd(42) +
      'inbox'.padEnd(24) +
      'latency'
  );
  for (const r of results) {
    console.log(
      `${r.ok ? '✅' : '❌'} ${r.service.padEnd(12)}${r.tier.padEnd(9)}${r.domains.padEnd(34)}${r.generated.padEnd(42)}${r.inbox.padEnd(24)}${r.latencyMs}ms` +
        (r.error ? `  ← ${r.error}` : '')
    );
  }

  const healthyFailed = results.filter((r) => r.tier === 'healthy' && !r.ok);
  const legacyFailed = results.filter((r) => r.tier === 'legacy' && !r.ok);
  console.log(
    `\nHealthy tier: ${HEALTHY_TIER.length - healthyFailed.length}/${HEALTHY_TIER.length} operational` +
      (healthyFailed.length > 0 ? ` (FAILED: ${healthyFailed.map((r) => r.service).join(', ')})` : '')
  );
  console.log(
    `Legacy tier: ${LEGACY_TIER.length - legacyFailed.length}/${LEGACY_TIER.length} operational` +
      (legacyFailed.length > 0 ? ` (failed as expected-tolerant: ${legacyFailed.map((r) => r.service).join(', ')})` : '')
  );

  if (healthyFailed.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exit(2);
});
