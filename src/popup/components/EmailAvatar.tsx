import React, { useMemo } from 'react';

interface EmailAvatarProps {
  from: string;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

const extractDomain = (emailStr: string): string | null => {
  if (!emailStr) {
    return null;
  }
  // Match anything inside angle brackets if present, e.g. "Mistral AI <no-reply@emails.mistral.ai>"
  const match = emailStr.match(/<([^>]+)>/);
  const email = match && match[1] ? match[1] : emailStr;
  if (!email) {
    return null;
  }
  const parts = email.split('@');
  if (parts.length < 2) {
    return null;
  }
  const domainPart = parts[1];
  if (!domainPart) {
    return null;
  }

  const cleanDomain = domainPart.trim().toLowerCase();
  const domainParts = cleanDomain.split('.');
  if (domainParts.length <= 2) {
    return cleanDomain;
  }

  const last = domainParts[domainParts.length - 1];
  const secondLast = domainParts[domainParts.length - 2];
  if (!last || !secondLast) {
    return cleanDomain;
  }

  const commonSLDs = ['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'nom', 'mil', 'sch'];

  if (secondLast.length <= 3 && (last.length === 2 || commonSLDs.includes(secondLast))) {
    return domainParts.slice(-3).join('.');
  }

  return domainParts.slice(-2).join('.');
};

export const EmailAvatar: React.FC<EmailAvatarProps> = React.memo(
  ({ from, className = '', style, children }) => {
    const domain = useMemo(() => extractDomain(from), [from]);

    const firstLetter = useMemo(() => {
      // Prefer the display name's first letter; fall back to the email/domain so we
      // never render a meaningless "?" when only an address is available.
      const displayName = from.replace(/<[^>]+>/, '').trim();
      const source = displayName || domain || from.trim();
      const firstChar = source.charAt(0);
      return /[a-z0-9]/i.test(firstChar) ? firstChar.toUpperCase() : '?';
    }, [from, domain]);

    return (
      <div className={className} style={style} title={domain || undefined}>
        <span>{firstLetter}</span>
        {children}
      </div>
    );
  }
);

EmailAvatar.displayName = 'EmailAvatar';
