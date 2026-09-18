const MAIL_TM_MERCURE_ORIGIN = 'https://mercure.mail.tm';
const MAIL_TM_MERCURE_PATH = '/.well-known/mercure';
const ACCOUNT_ID_PATTERN = /^[a-z0-9_-]{1,128}$/i;

/** Restrict the privileged offscreen fetch relay to the one supported hub/topic. */
export function isAllowedMailTmSseRequest(url: unknown, accountId: unknown): boolean {
  if (
    typeof url !== 'string' ||
    typeof accountId !== 'string' ||
    !ACCOUNT_ID_PATTERN.test(accountId)
  ) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const parameters = Array.from(parsed.searchParams.entries());
    return (
      parsed.origin === MAIL_TM_MERCURE_ORIGIN &&
      parsed.pathname === MAIL_TM_MERCURE_PATH &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.hash === '' &&
      parameters.length === 1 &&
      parameters[0]?.[0] === 'topic' &&
      parameters[0]?.[1] === `/accounts/${accountId}`
    );
  } catch {
    return false;
  }
}
