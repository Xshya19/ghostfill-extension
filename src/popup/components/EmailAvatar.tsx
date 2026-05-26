import React, { useState, useMemo } from 'react';

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
  const email = (match && match[1]) ? match[1] : emailStr;
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
  
  if (
    secondLast.length <= 3 && 
    (last.length === 2 || commonSLDs.includes(secondLast))
  ) {
    return domainParts.slice(-3).join('.');
  }
  
  return domainParts.slice(-2).join('.');
};

export const EmailAvatar: React.FC<EmailAvatarProps> = React.memo(({ from, className = '', style, children }) => {
  const [imgFailed, setImgFailed] = useState(false);

  const domain = useMemo(() => extractDomain(from), [from]);
  
  const firstLetter = useMemo(() => {
    // If the from contains a display name, try to use its first letter, otherwise use email
    const cleanFrom = from.replace(/<[^>]+>/, '').trim();
    const name = cleanFrom || '?';
    return name.charAt(0).toUpperCase();
  }, [from]);

  const hasImage = domain && !imgFailed;

  const containerStyle: React.CSSProperties = {
    ...style,
    ...(hasImage ? { background: '#ffffff' } : {})
  };

  return (
    <div className={`${className} ${hasImage ? 'has-image' : ''}`} style={containerStyle}>
      {hasImage ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
          alt={`${domain} logo`}
          onError={() => setImgFailed(true)}
          className="inbox-item-avatar-img"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
            borderRadius: 'inherit',
          }}
        />
      ) : (
        <span>{firstLetter}</span>
      )}
      {children}
    </div>
  );
});

EmailAvatar.displayName = 'EmailAvatar';
