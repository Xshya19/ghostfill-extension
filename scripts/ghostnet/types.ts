import type { PageVerificationExpectation } from '../../src/services/types/extraction.types';

export type GhostNetIntentClass =
  | 'verification'
  | 'activation'
  | 'magic-link-login'
  | 'password-reset'
  | 'two-factor'
  | 'invitation'
  | 'transactional'
  | 'marketing';

export type GhostNetActionClass =
  | 'fill-otp'
  | 'open-link'
  | 'fill-otp-and-open-link'
  | 'show-review'
  | 'ignore';

export interface CorpusEmailSample {
  id: string;
  split: 'train' | 'val' | 'test';
  source:
    | 'hf-zefang-phish'
    | 'hf-seven-phish'
    | 'hf-sinabis'
    | 'hf-enron'
    | 'hf-sms-otp'
    | 'open-vocab-discourse';
  category:
    | 'pure-otp'
    | 'pure-link'
    | 'paired-both'
    | 'transactional-none'
    | 'marketing-none'
    | 'adversarial-phish';
  subject: string;
  body: string;
  htmlBody: string;
  sender: string;
  expectedDomains: string[];
  originUrl?: string | undefined;
  pageExpectation?: PageVerificationExpectation | undefined;
  label: {
    intent: GhostNetIntentClass;
    otp: string | null;
    linkSubstring: string | null;
    action: GhostNetActionClass;
  };
}
