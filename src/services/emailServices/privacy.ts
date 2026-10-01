import type { EmailAccount, EmailService } from '../../types';
import { getSenderDomain } from '../../utils/emailIdentity';
import { sameVerificationSite } from '../../utils/verificationSite';

const AUTHENTICATED_INBOX_SERVICES: ReadonlySet<EmailService> = new Set([
  'gmail',
  'zoho',
  'microsoft',
]);

const TOKEN_PROTECTED_INBOX_CREDENTIALS: Partial<Record<EmailService, 'token' | 'password'>> = {
  custom: 'token',
  dropmail: 'token',
  mailgw: 'password',
  mailtm: 'token',
  tempmaillol: 'token',
  throwawaymail: 'token',
};

/**
 * Public inboxes can be read by anyone who knows the address. This reports
 * mailbox privacy; automatic page actions still need sender/site matching.
 * Unknown providers fail closed until their access model is reviewed.
 */
export function isPrivateInbox(account: EmailAccount | null | undefined): boolean {
  if (!account) {
    return false;
  }

  if (AUTHENTICATED_INBOX_SERVICES.has(account.service)) {
    return true;
  }

  const credential = TOKEN_PROTECTED_INBOX_CREDENTIALS[account.service];
  return credential ? Boolean(account[credential]) : false;
}

/** Require the sender address to belong to the site's registrable domain. */
export function senderMatchesSite(sender: string, siteUrl: string): boolean {
  const senderDomain = getSenderDomain(sender);
  if (!senderDomain || !siteUrl) {
    return false;
  }

  try {
    return sameVerificationSite(senderDomain, new URL(siteUrl).hostname);
  } catch {
    return false;
  }
}

/** Verification-link opening uses its own setting and sender/site match. */
export function canAutoOpenVerificationLink(
  account: EmailAccount | null | undefined,
  sender: string,
  linkUrl: string
): boolean {
  if (!account?.fullEmail) {
    return false;
  }

  // Bind the sender and destination to the signup site when known. Older
  // addresses can still use a sender-to-link match.
  if (account.originUrl) {
    try {
      return (
        senderMatchesSite(sender, account.originUrl) &&
        sameVerificationSite(new URL(account.originUrl).hostname, new URL(linkUrl).hostname)
      );
    } catch {
      return false;
    }
  }
  return senderMatchesSite(sender, linkUrl);
}
