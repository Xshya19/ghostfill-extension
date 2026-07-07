import { EmailAccount, Email } from '../../types';
import { fetchWithTimeout } from '../../utils/core';
import { createLogger } from '../../utils/logger';

const log = createLogger('DriftzService');
const BASE_URL = 'https://api.driftz.net';

export class DriftzService {
  async getDomains(signal?: AbortSignal): Promise<string[]> {
    try {
      const response = await fetchWithTimeout(`${BASE_URL}/domains`, { signal: signal ?? null });
      if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
      const data = await response.json();
      if (!data.success) {throw new Error(data.error || 'Failed to fetch domains');}
      
      // We primarily use temp domains for standard Ghostfill generation
      return data.result.temp; 
    } catch (error) {
      log.error('Failed to fetch Driftz domains', error);
      return ['temp.driftz.net']; // Fallback
    }
  }

  async createAccount(signal?: AbortSignal): Promise<EmailAccount> {
    const response = await fetchWithTimeout(`${BASE_URL}/temp/generate`, {
      method: 'POST',
      signal: signal ?? null
    });
    if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to generate driftz email');}
    
    const address = data.result.address;
    const expiresAt = data.result.expiresAt * 1000; // API gives seconds
    const domain = address.split('@')[1] || 'temp.driftz.net';

    return {
      id: address,
      fullEmail: address,
      domain,
      service: 'driftz',
      createdAt: Date.now(),
      expiresAt: expiresAt
    };
  }

  async getMessages(address: string, signal?: AbortSignal): Promise<Email[]> {
    const response = await fetchWithTimeout(`${BASE_URL}/temp/${address}?limit=50`, { signal: signal ?? null });
    if (!response.ok) {
      if (response.status === 404) {return [];} // Empty or expired
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to fetch messages');}

    return data.result.items.map((msg: any) => ({
      id: msg.id,
      from: msg.fromAddress,
      to: msg.toAddress,
      subject: msg.subject || '',
      date: msg.receivedAt * 1000,
      body: '', // Body requires fetching the full email
      read: false,
      attachments: []
    }));
  }

  async getMessage(address: string, emailId: string, signal?: AbortSignal): Promise<Email> {
    const response = await fetchWithTimeout(`${BASE_URL}/temp/${address}/${emailId}`, { signal: signal ?? null });
    if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to fetch message');}

    const msg = data.result;
    return {
      id: msg.id,
      from: msg.fromAddress,
      to: msg.toAddress,
      subject: msg.subject || '',
      date: msg.receivedAt * 1000,
      body: msg.textContent || msg.htmlContent || '',
      htmlBody: msg.htmlContent || msg.textContent || '',
      read: true,
      attachments: msg.hasAttachments ? [{ filename: 'Attachments exist (requires API)', contentType: 'unknown', size: 0 }] : []
    };
  }

  // --- Permanent Inboxes & Payments API (Advanced Features) ---
  
  async getPermanentMessages(address: string, password?: string, signal?: AbortSignal): Promise<Email[]> {
    const headers: Record<string, string> = {};
    if (password) {headers['x-inbox-password'] = password;}
    
    const response = await fetchWithTimeout(`${BASE_URL}/emails/${address}?limit=50`, { headers, signal: signal ?? null });
    if (!response.ok) {
      if (response.status === 404) {return [];}
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to fetch permanent messages');}

    return data.result.items.map((msg: any) => ({
      id: msg.id,
      from: msg.fromAddress,
      to: msg.toAddress,
      subject: msg.subject || '',
      date: msg.receivedAt * 1000,
      body: '',
      read: false,
      attachments: []
    }));
  }

  async getPermanentMessage(emailId: string, password?: string, signal?: AbortSignal): Promise<Email> {
    const headers: Record<string, string> = {};
    if (password) {headers['x-inbox-password'] = password;}
    
    const response = await fetchWithTimeout(`${BASE_URL}/inbox/${emailId}`, { headers, signal: signal ?? null });
    if (!response.ok) {throw new Error(`HTTP error! status: ${response.status}`);}
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to fetch permanent message');}

    const msg = data.result;
    return {
      id: msg.id,
      from: msg.fromAddress,
      to: msg.toAddress,
      subject: msg.subject || '',
      date: msg.receivedAt * 1000,
      body: msg.textContent || msg.htmlContent || '',
      htmlBody: msg.htmlContent || msg.textContent || '',
      read: true,
      attachments: msg.hasAttachments ? [{ filename: 'Attachments exist (requires API)', contentType: 'unknown', size: 0 }] : []
    };
  }

  async createLockInvoice(emailAddress: string, password: string): Promise<{ paymentId: string, invoiceUrl: string }> {
    const response = await fetchWithTimeout(`${BASE_URL}/payments/create-lock-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailAddress, password })
    });
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to create lock invoice');}
    return data.result;
  }

  async relockInbox(emailAddress: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const response = await fetchWithTimeout(`${BASE_URL}/payments/relock-inbox`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-inbox-password': currentPassword
      },
      body: JSON.stringify({ emailAddress, newPassword })
    });
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to relock inbox');}
    return data.result.updated;
  }

  async getPaymentStatus(paymentId: string): Promise<{ status: string, locked: boolean }> {
    const response = await fetchWithTimeout(`${BASE_URL}/payments/${paymentId}/status`);
    const data = await response.json();
    if (!data.success) {throw new Error(data.error || 'Failed to get payment status');}
    return data.result;
  }
}

export const driftzService = new DriftzService();
