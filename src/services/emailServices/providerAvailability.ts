import type { EmailService } from '../../types';
import { runBoundedProviderOperation } from './providerOperations';

export type ProviderAvailability = 'available' | 'unchecked';

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function request(
  url: string,
  service: EmailService,
  signal?: AbortSignal,
  options: RequestInit = {}
): Promise<Response> {
  // The outer operation owns this signal until the body has been consumed.
  const response = await fetch(url, {
    ...options,
    signal: signal ?? null,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`${service} availability: HTTP error ${response.status}`);
  }
  return response;
}

function invalid(service: EmailService): never {
  throw new Error(`${service} availability: unexpected API response`);
}

/**
 * One bounded, read-only API check, independent of adapters' static/stale domain
 * fallbacks. Availability never means email delivery was tested. Session-only
 * integrations stay unchecked until real generation/inbox activity supplies evidence.
 */
export function checkProviderAvailability(
  service: EmailService,
  signal?: AbortSignal
): Promise<ProviderAvailability> {
  return runBoundedProviderOperation(
    (boundedSignal) => checkProviderAvailabilityInternal(service, boundedSignal),
    signal
  );
}

async function checkProviderAvailabilityInternal(
  service: EmailService,
  signal: AbortSignal
): Promise<ProviderAvailability> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  switch (service) {
    case 'mailtm':
    case 'mailgw': {
      const host = service === 'mailtm' ? 'api.mail.tm' : 'api.mail.gw';
      const response = await request(`https://${host}/domains`, service, signal, {
        headers: { Accept: 'application/ld+json' },
      });
      const data: unknown = await response.json();
      const domains = Array.isArray(data) ? data : object(data)['hydra:member'];
      if (
        !response.ok ||
        !Array.isArray(domains) ||
        !domains.some((item) => {
          const domain = object(item);
          return (
            typeof domain.domain === 'string' &&
            domain.domain.includes('.') &&
            domain.isActive === true &&
            domain.isPrivate !== true
          );
        })
      ) {
        invalid(service);
      }
      return 'available';
    }
    case 'driftz': {
      const response = await request('https://api.driftz.net/domains', service, signal);
      const data = object(await response.json());
      const domains = object(data.result).temp;
      if (
        !response.ok ||
        data.success !== true ||
        !Array.isArray(domains) ||
        !domains.some((domain) => typeof domain === 'string' && domain.includes('.'))
      ) {
        invalid(service);
      }
      return 'available';
    }
    case 'maildrop': {
      const response = await request('https://api.maildrop.cc/graphql', service, signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ ping }' }),
      });
      const data = object(await response.json());
      if (
        !response.ok ||
        object(data.data).ping !== 'pong' ||
        (Array.isArray(data.errors) && data.errors.length > 0)
      ) {
        invalid(service);
      }
      return 'available';
    }
    case 'catchmail': {
      const address = `ghostfill-health-${crypto.randomUUID()}@catchmail.io`;
      const response = await request(
        `https://api.catchmail.io/api/v1/mailbox?address=${encodeURIComponent(address)}`,
        service,
        signal
      );
      const data = object(await response.json());
      if (response.status === 404 && data.error) {
        return 'available';
      }
      if (!response.ok || !Array.isArray(data.messages)) {
        invalid(service);
      }
      return 'available';
    }
    case 'throwawaymail': {
      // An unallocated UUID exercises the documented inbox route without creating
      // an account or reading an existing user's mailbox. Expected result is 404.
      const response = await request(
        `https://throwawaymail.app/api/mailboxes/${crypto.randomUUID()}/messages`,
        service,
        signal
      );
      const data: unknown = await response.json();
      if (response.status === 404 && typeof object(data).error === 'string') {
        return 'available';
      }
      if (!response.ok || !Array.isArray(data)) {
        invalid(service);
      }
      return 'available';
    }
    case 'tempmailplus': {
      // Match the official inbox client: email is the complete address.
      const address = `ghostfill-health-${crypto.randomUUID()}@mailto.plus`;
      const response = await request(
        `https://tempmail.plus/api/mails?email=${encodeURIComponent(address)}&limit=1`,
        service,
        signal
      );
      const data = object(await response.json());
      if (
        !response.ok ||
        data.result === false ||
        data.err ||
        ![data.mail_list, data.mails, data.result].some(Array.isArray)
      ) {
        invalid(service);
      }
      return 'available';
    }
    case 'guerrilla':
    case 'yopmail':
    case 'custom':
      return 'unchecked';
    default:
      return invalid(service);
  }
}
