import type { EmailService } from '../../types';

// New inbox selection is deliberately narrower than legacy account read support.
// Keep picker membership and automatic fallback membership together.
export const TEMP_EMAIL_PROVIDER_OPTIONS = [
  { value: 'driftz', label: 'Driftz.net · Preferred' },
  { value: 'catchmail', label: 'CatchMail.io' },
  { value: 'throwawaymail', label: 'Throwawaymail.app · Fast' },
  { value: 'mailtm', label: 'Mail.tm' },
  { value: 'tempmailplus', label: 'Tempmail.plus · Multi-domain' },
  { value: 'maildrop', label: 'Maildrop.cc · Public inbox' },
  { value: 'guerrilla', label: 'Guerrilla Mail' },
  { value: 'mailgw', label: 'Mail.gw' },
  { value: 'custom', label: 'Custom service · Private' },
] as const satisfies ReadonlyArray<{ value: EmailService; label: string }>;

// Ordering is a tie-breaker, not a claim that delivery has been verified.
export const GENERATION_PROVIDER_PRIORITY: readonly EmailService[] = [
  'catchmail',
  'throwawaymail',
  'mailtm',
  'tempmailplus',
  'maildrop',
  'driftz',
  'guerrilla',
  'mailgw',
  'custom',
];

const selectable = new Set<EmailService>(TEMP_EMAIL_PROVIDER_OPTIONS.map(({ value }) => value));
export function isSelectableEmailProvider(value: unknown): value is EmailService {
  return typeof value === 'string' && selectable.has(value as EmailService);
}

export function filterSelectableEmailProviders(values: unknown): EmailService[] {
  return Array.isArray(values) ? [...new Set(values.filter(isSelectableEmailProvider))] : [];
}
