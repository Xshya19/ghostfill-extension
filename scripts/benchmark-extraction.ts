/** Local, deterministic service-worker benchmark; never contacts a provider. */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const output = console.log.bind(console);
let extractionRuns = 0;
for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
  console[level] = (...args: unknown[]) => {
    if (
      args.some((arg) => typeof arg === 'string' && arg.includes('GhostFill Intelligent Extractor'))
    ) {
      extractionRuns++;
    }
  };
}
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const session = new Map<string, unknown>();
const operations = { get: 0, set: 0, remove: 0, fullReads: 0 };
Object.assign(globalThis, {
  chrome: {
    storage: {
      local: { get: async () => ({}) },
      session: {
        get: async (keys: string | string[] | null) => {
          operations.get++;
          if (keys === null) {
            operations.fullReads++;
          }
          const selected =
            keys === null ? [...session.keys()] : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            selected
              .filter((key) => session.has(key))
              .map((key) => [key, structuredClone(session.get(key))])
          );
        },
        set: async (data: Record<string, unknown>) => {
          operations.set++;
          for (const [key, value] of Object.entries(data)) {
            session.set(key, structuredClone(value));
          }
        },
        remove: async (keys: string | string[]) => {
          operations.remove++;
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            session.delete(key);
          }
        },
      },
    },
    runtime: { getManifest: () => ({ version: 'benchmark' }), getURL: (path: string) => path },
  },
});

async function main(): Promise<void> {
  const { extractAll } = await import('../src/services/intelligentExtractor');
  const evidence = await import('../src/services/extraction/verificationEvidence');
  const { smartDetectionService } = await import('../src/services/otpService');
  // Let worker boot/key initialization finish before running synchronous CPU
  // fixtures; otherwise the benchmark itself starves the optional cache deadline.
  await smartDetectionService.detect(
    'Your verification code',
    'Your verification code is 582914.',
    '',
    'warmup@example.com'
  );
  const pairedLink =
    'https://app.example.com/loginwithemail?state=fixture_long_state_token&password=009165&isSignup=true';
  const largeBody = `${'<tr><td>A short account notice without numeric metadata.</td></tr>'.repeat(200)}<tr><td>Your verification code is <strong>582914</strong>.</td></tr>`;
  const newsletterBody = `${'<p>Make your work easier. &#8203; Connect your tools.</p>'.repeat(200)}<footer>548 Market St, PMB 90375. San Francisco, CA 94104. <a href="https://example.com/unsubscribe?user=fixture">Unsubscribe</a></footer>`;
  const fixtures = [
    {
      name: 'plain-code',
      subject: 'Your verification code',
      body: 'Enter your verification code: 582914. It expires in 10 minutes.',
      html: '',
      code: '582914',
      link: false,
    },
    {
      name: 'paired-leading-zero',
      subject: 'Your sign-up code',
      body: `Enter the code 009165 or sign in with your magic link: ${pairedLink}`,
      html: `<p>Enter the code <strong>009165</strong> or use the magic link.</p><a href="${pairedLink}">Sign in with Magic Link</a>`,
      code: '009165',
      link: true,
    },
    {
      name: 'large-html-code',
      subject: 'Your verification code',
      body: '',
      html: `<table>${largeBody}</table>`,
      code: '582914',
      link: false,
    },
    {
      name: 'marketing-postal-entities',
      subject: 'Welcome to your workspace',
      body: '',
      html: newsletterBody,
      code: undefined,
      link: false,
    },
    {
      name: 'fragment-magic-link',
      subject: 'Sign in with your magic link',
      body: 'Click the button to finish signing in.',
      html: '<a href="https://example.com/magic-link#fixture_token:fixture_payload">Sign in</a>',
      code: undefined,
      link: true,
    },
  ];
  const measurements: Record<string, unknown> = {};
  for (const fixture of fixtures) {
    for (let i = 0; i < 5; i++) {
      extractAll(fixture.subject, fixture.body, fixture.html, 'accounts@example.com');
    }
    const samples: number[] = [];
    const cpuStart = process.cpuUsage();
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      const result = extractAll(
        fixture.subject,
        fixture.body,
        fixture.html,
        'accounts@example.com'
      );
      samples.push(performance.now() - start);
      assert.equal(result.otp?.code, fixture.code, fixture.name);
      assert.equal(Boolean(result.link), fixture.link, fixture.name);
    }
    const cpu = process.cpuUsage(cpuStart);
    samples.sort((a, b) => a - b);
    measurements[fixture.name] = {
      samples: samples.length,
      inputBytes: fixture.body.length + fixture.html.length,
      medianMs: Number(samples[20]!.toFixed(3)),
      p95Ms: Number(samples[38]!.toFixed(3)),
      cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    };
  }
  const normalizationStart = performance.now();
  for (let i = 0; i < 100; i++) {
    const maybeFactory = evidence as typeof evidence & {
      createVerificationCodeEvidence?: (
        subject: string,
        body: string,
        html: string
      ) => (code: string) => boolean;
    };
    const check =
      maybeFactory.createVerificationCodeEvidence?.(
        'Your verification code',
        '',
        `<table>${largeBody}</table>`
      ) ??
      ((code: string) =>
        evidence.hasVerificationCodeEvidence(
          code,
          'Your verification code',
          '',
          `<table>${largeBody}</table>`
        ));
    for (const code of ['582914', '582914', '582914']) {
      assert.equal(check(code), true);
    }
  }
  measurements.evidenceRepeatedCandidates = {
    batches: 100,
    checksPerBatch: 3,
    totalMs: Number((performance.now() - normalizationStart).toFixed(3)),
  };

  // Wait only for local initialization, then measure a fresh content key.
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (const key of Object.keys(operations) as Array<keyof typeof operations>) {
    operations[key] = 0;
  }
  extractionRuns = 0;
  const request = fixtures[2]!;
  const start = performance.now();
  const detections = await Promise.all(
    Array.from({ length: 32 }, () =>
      smartDetectionService.detect(
        request.subject,
        request.body,
        request.html,
        'benchmark@example.com'
      )
    )
  );
  for (const result of detections) {
    assert.equal(result.code, request.code);
  }
  measurements.concurrentIdenticalDetection = {
    requests: 32,
    totalMs: Number((performance.now() - start).toFixed(3)),
    extractionRuns,
    storageOperations: { ...operations },
  };
  extractionRuns = 0;
  for (const key of Object.keys(operations) as Array<keyof typeof operations>) {
    operations[key] = 0;
  }
  const cachedStart = performance.now();
  for (let i = 0; i < 32; i++) {
    assert.equal(
      (
        await smartDetectionService.detect(
          request.subject,
          request.body,
          request.html,
          'benchmark@example.com'
        )
      ).code,
      request.code
    );
  }
  measurements.cachedSequentialDetection = {
    requests: 32,
    totalMs: Number((performance.now() - cachedStart).toFixed(3)),
    extractionRuns,
    storageOperations: { ...operations },
  };
  output(
    JSON.stringify(
      {
        environment: {
          node: process.version,
          context: 'service-worker (no DOM)',
          fixtureCount: fixtures.length,
          providerRequests: 0,
        },
        measurements,
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  output(error);
  process.exitCode = 1;
});
