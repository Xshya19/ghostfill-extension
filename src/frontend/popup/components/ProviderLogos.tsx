import React from 'react';
import gmailIconPng from '../../../assets/icons/gmail_icon.png';
import outlookIconPng from '../../../assets/icons/outlook_icon.png';
import zohoIconPng from '../../../assets/icons/zoho_icon.png';

export interface ProviderLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Official Google Gmail brand icon
 */
export const GmailLogo: React.FC<ProviderLogoProps> = ({ size = 20, className = '', style }) => (
  <img
    src={gmailIconPng}
    width={size}
    height={size}
    alt="Gmail"
    className={`hub-gmail-logo ${className}`.trim()}
    style={{
      width: size,
      height: size,
      display: 'inline-block',
      verticalAlign: 'middle',
      objectFit: 'contain',
      flexShrink: 0,
      ...style,
    }}
  />
);

/**
 * Official Zoho Mail brand icon (from user provided design)
 * Represents the open mailbox with amber paper tab
 * Soft rounded corner applied ONLY to Zoho
 */
export const ZohoLogo: React.FC<ProviderLogoProps> = ({ size = 20, className = '', style }) => {
  const borderRadius = Math.max(3, Math.round(size * 0.22));
  return (
    <img
      src={zohoIconPng}
      width={size}
      height={size}
      alt="Zoho Mail"
      className={`hub-zoho-logo ${className}`.trim()}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        verticalAlign: 'middle',
        objectFit: 'contain',
        borderRadius: `${borderRadius}px`,
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    />
  );
};

/**
 * Official Microsoft Outlook brand icon (from user provided design)
 * Modern Fluent 3D folded envelope with 'O' badge
 */
export const OutlookLogo: React.FC<ProviderLogoProps> = ({ size = 20, className = '', style }) => (
  <img
    src={outlookIconPng}
    width={size}
    height={size}
    alt="Microsoft Outlook"
    className={`hub-outlook-logo ${className}`.trim()}
    style={{
      width: size,
      height: size,
      display: 'inline-block',
      verticalAlign: 'middle',
      objectFit: 'contain',
      transform: 'scale(1.16)',
      transformOrigin: 'center',
      flexShrink: 0,
      ...style,
    }}
  />
);

/**
 * Crisp vector SVG for Zoho Mail
 */
export const ZohoVectorLogo: React.FC<ProviderLogoProps> = ({ size = 24, className = '', style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
    aria-label="Zoho Mail"
  >
    {/* Inner Amber/Gold Tab */}
    <path
      d="M 30 52 L 30 46 A 8 8 0 0 1 38 38 L 62 38 A 8 8 0 0 1 70 46 L 70 58"
      stroke="#EAA83B"
      strokeWidth="7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Blue Envelope Body & Overlapping Flap */}
    <path
      d="M 18 61 L 18 78 A 7 7 0 0 0 25 85 L 75 85 A 7 7 0 0 0 82 78 L 82 44 L 50 16 L 18 44 L 18 52 L 50 71 L 73 57"
      stroke="#3B70A2"
      strokeWidth="7.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Accent shadow on right flap intersection */}
    <path
      d="M 68 60 L 73 57"
      stroke="#2B5885"
      strokeWidth="7.5"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * Crisp vector SVG for Microsoft Outlook
 */
export const OutlookVectorLogo: React.FC<ProviderLogoProps> = ({ size = 24, className = '', style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
    aria-label="Microsoft Outlook"
  >
    <defs>
      <linearGradient id="ol-grad-top" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#2886DE" />
        <stop offset="100%" stopColor="#004E8C" />
      </linearGradient>
      <linearGradient id="ol-grad-right" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#0078D4" />
        <stop offset="100%" stopColor="#106EBE" />
      </linearGradient>
      <linearGradient id="ol-grad-front" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00A4EF" />
        <stop offset="100%" stopColor="#50E6FF" />
      </linearGradient>
      <linearGradient id="ol-grad-badge" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#0078D4" />
        <stop offset="100%" stopColor="#004E8C" />
      </linearGradient>
    </defs>
    {/* 3D Envelope Panels */}
    <path d="M 50 14 L 84 32 L 84 68 L 50 86 L 16 68 L 16 32 Z" fill="#002050" />
    <path d="M 50 14 L 84 32 L 50 52 L 16 32 Z" fill="url(#ol-grad-top)" />
    <path d="M 50 52 L 84 32 L 84 68 L 50 86 Z" fill="url(#ol-grad-right)" />
    <path d="M 16 32 L 50 52 L 50 86 L 16 68 Z" fill="url(#ol-grad-front)" opacity="0.9" />
    {/* Front Badge */}
    <rect x="10" y="44" width="38" height="38" rx="9" fill="url(#ol-grad-badge)" />
    <circle cx="29" cy="63" r="8" fill="white" />
    <circle cx="29" cy="63" r="4.2" fill="#005A9E" />
  </svg>
);
