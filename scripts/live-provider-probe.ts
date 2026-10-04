/**
 * Read-only by default: npx tsx scripts/live-provider-probe.ts
 * Optional isolated account/inbox check: add --create-inboxes.
 * Limit a check with --provider driftz; --provider yopmail diagnoses the retired adapter.
 * Never sends mail or triggers a signup. Empty inboxes do not prove delivery.
 */
import { randomBytes } from 'node:crypto';
import type { Email, EmailAccount, EmailService } from '../src/types';
import { checkProviderAvailability } from '../src/services/emailServices/providerAvailability';
import { runBoundedProviderOperation } from '../src/services/emailServices/providerOperations';
import { TEMP_EMAIL_PROVIDER_OPTIONS } from '../src/services/emailServices/providerRegistry';

// Isolated in-memory Chrome storage: never reads the user's installed inbox.
const memoryArea = () => {
  const values: Record<string, unknown> = {};
  return {
    get: async (keys: string | string[] | null) =>
      keys === null
        ? { ...values }
        : Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [key, values[key]])
          ),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    },
    remove: async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    setAccessLevel: async () => {},
  };
};
Object.assign(globalThis, {
  chrome: {
    storage: {
      local: memoryArea(),
      session: memoryArea(),
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: { getManifest: () => ({ version: '1.1.5' }) },
  },
});

type Adapter = {
  create: (prefix: string, signal: AbortSignal) => Promise<EmailAccount>;
  inbox: (account: EmailAccount, signal: AbortSignal) => Promise<Email[]>;
};

async function getAdapter(service: EmailService): Promise<Adapter> {
  switch (service) {
    case 'driftz': {
      const { driftzService: adapter } =
        await import('../src/services/emailServices/driftzService');
      return {
        create: (_prefix, signal) => adapter.createAccount(signal),
        inbox: (account, signal) => adapter.getMessages(account.fullEmail, signal),
      };
    }
    case 'catchmail': {
      const { catchmailService: adapter } =
        await import('../src/services/emailServices/catchmailService');
      return {
        create: (prefix, signal) => adapter.createAccount(prefix, signal),
        inbox: (account, signal) => adapter.getMessages(account.fullEmail, signal),
      };
    }
    case 'throwawaymail': {
      const { throwawaymailService: adapter } =
        await import('../src/services/emailServices/throwawaymailService');
      return {
        create: (prefix, signal) => adapter.createAccount(prefix, signal),
        inbox: (account, signal) => adapter.getMessages(account, signal),
      };
    }
    case 'mailtm': {
      const { mailTmService: adapter } =
        await import('../src/services/emailServices/mailTmService');
      return {
        create: (_prefix, signal) => adapter.createAccount(undefined, undefined, signal),
        inbox: (_account, signal) => adapter.getMessages(signal),
      };
    }
    case 'mailgw': {
      const { mailGwService: adapter } =
        await import('../src/services/emailServices/mailGwService');
      return {
        create: (_prefix, signal) => adapter.createAccount(undefined, undefined, signal),
        inbox: (_account, signal) => adapter.getMessages(signal),
      };
    }
    case 'tempmailplus': {
      const { tempmailPlusService: adapter } =
        await import('../src/services/emailServices/tempmailPlusService');
      return {
        create: (prefix, signal) => adapter.createAccount(prefix, signal),
        inbox: (account, signal) => adapter.getMessages(account.fullEmail, signal),
      };
    }
    case 'maildrop': {
      const { maildropService: adapter } =
        await import('../src/services/emailServices/maildropService');
      return {
        create: (prefix, signal) => adapter.createAccount(prefix, signal),
        inbox: (account, signal) => adapter.getMessages(account, signal),
      };
    }
    case 'guerrilla': {
      const { guerrillaMailService: adapter } =
        await import('../src/services/emailServices/guerrillaMailService');
      return {
        create: (_prefix, signal) => adapter.createAccount(signal),
        inbox: (account, signal) => adapter.getMessages(account.token, signal),
      };
    }
    case 'yopmail': {
      const { yopmailService: adapter } =
        await import('../src/services/emailServices/yopmailService');
      return {
        create: (prefix, signal) => adapter.createAccount(prefix, signal),
        inbox: (account, signal) => adapter.getMessages(account.fullEmail, signal),
      };
    }
    default:
      throw new Error('This provider needs a configured integration and is not probed.');
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const index = args.indexOf('--provider');
  const requested = index >= 0 ? args[index + 1] : null;
  const providers: ReadonlyArray<{ value: EmailService }> =
    requested === 'yopmail'
      ? [{ value: 'yopmail' }]
      : TEMP_EMAIL_PROVIDER_OPTIONS.filter(
          ({ value }) => value !== 'custom' && (!requested || value === requested)
        );
  if (providers.length === 0 || (index >= 0 && !requested))
    throw new Error('Choose a supported provider from the extension settings.');
  const results: Record<string, unknown>[] = [];
  for (const { value: service } of providers) {
    const start = Date.now();
    const result: Record<string, unknown> = {
      provider: service,
      availability: 'failed',
      generation: 'not run',
      inbox: 'not run',
      delivery: 'unverified',
    };
    try {
      result.availability = await checkProviderAvailability(service);
      if (args.includes('--create-inboxes')) {
        const adapter = await getAdapter(service);
        const account = await runBoundedProviderOperation(
          (signal) => adapter.create('gf-probe-' + randomBytes(10).toString('hex'), signal),
          undefined,
          25_000
        );
        if (account.service !== service || !account.fullEmail.includes('@'))
          throw new Error('Adapter returned the wrong provider or an invalid address.');
        result.generation = 'requested provider';
        result.domain = account.domain;
        const messages = await runBoundedProviderOperation(
          (signal) => adapter.inbox(account, signal),
          undefined,
          25_000
        );
        if (!Array.isArray(messages)) throw new Error('Adapter returned an invalid inbox.');
        result.inbox = `${messages.length} message(s); delivery still unverified`;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message.slice(0, 180) : 'Provider check failed';
      process.exitCode = 1;
    }
    result.elapsedMs = Date.now() - start;
    results.push(result);
  }
  console.table(results);
  console.log(
    'These checks measure API/adapter reachability only. Receipt needs a separately authorized sent-message test.'
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Provider probe failed');
  process.exitCode = 2;
});
