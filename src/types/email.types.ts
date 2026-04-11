// Email Types

export interface EmailAccount {
  id: string; // Required: Unique identifier from provider (critical for SSE)
  login?: string; // Legacy - use username instead
  username?: string; // Account username part
  domain: string;
  fullEmail: string;
  createdAt: number;
  expiresAt: number;
  service: EmailService;
  password?: string; // For mail.tm accounts
  token?: string; // JWT token for mail.tm/tmailor
  originUrl?: string; // The website origin where this identity was generated
}

// TMailor added - 500+ rotating domains to avoid blocklisting
// Custom added - for self-hosted/Cloudflare Worker infrastructure
export type EmailService =
  | '1secmail'
  | 'tempmail'
  | 'mailtm'
  | 'mailgw'
  | 'guerrilla'
  | 'maildrop'
  | 'custom';

export interface IEmailProvider {
  name: string;
  priority?: number;
  enabled: boolean;
  createAccount(): Promise<EmailAccount>;
  getMessages(account: EmailAccount): Promise<Email[]>;
}

export interface Email {
  id: string | number;
  from: string;
  to?: string;
  subject: string;
  date: number;
  body: string;
  htmlBody?: string;
  textBody?: string;
  attachments: EmailAttachment[];
  read: boolean;
  otpExtracted?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  size: number;
  url?: string;
}

export interface EmailInbox {
  emails: Email[];
  lastChecked: number;
  unreadCount: number;
}

export interface EmailServiceResponse {
  success: boolean;
  data?: EmailAccount | Email | Email[];
  error?: string;
}

export interface EmailDomain {
  domain: string;
  service: EmailService;
}

export interface TempMailMessage {
  id: number;
  from: string;
  subject: string;
  date: string;
}

export interface TempMailFullMessage extends TempMailMessage {
  body: string;
  htmlBody: string;
  textBody: string;
  attachments: {
    filename: string;
    contentType: string;
    size: number;
  }[];
}

export interface MailTmDomain {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailTmAccount {
  id: string;
  address: string;
  quota: number;
  used: number;
  isDisabled: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailTmMessage {
  id: string;
  accountId: string;
  msgid: string;
  from: {
    address: string;
    name: string;
  };
  to: {
    address: string;
    name: string;
  }[];
  subject: string;
  intro: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  text?: string;
  html?: string[];
}

export interface EmailHistoryItem {
  email: string;
  service: EmailService;
  usedOn: string[];
  createdAt: number;
  emailsReceived: number;
}
