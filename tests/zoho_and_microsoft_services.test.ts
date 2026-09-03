import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isZohoEmail,
  getZohoAlias,
  searchZohoInbox,
  disconnectZoho,
} from '../src/services/zohoMailService';
import {
  isMicrosoftEmail,
  getMicrosoftAlias,
  searchMicrosoftInbox,
  disconnectMicrosoft,
} from '../src/services/microsoftMailService';
import { storageService } from '../src/services/storageService';

describe('ZohoMailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isZohoEmail', () => {
    it('identifies zoho domains correctly', () => {
      expect(isZohoEmail('user@zoho.com')).toBe(true);
      expect(isZohoEmail('user@zoho.eu')).toBe(true);
      expect(isZohoEmail('user@zoho.in')).toBe(true);
      expect(isZohoEmail('user@zoho.com.au')).toBe(true);
      expect(isZohoEmail('user@zmail.com')).toBe(true);
      expect(isZohoEmail('user@gmail.com')).toBe(false);
      expect(isZohoEmail('user@outlook.com')).toBe(false);
    });
  });

  describe('getZohoAlias', () => {
    it('generates plus alias with website tag', async () => {
      const alias = await getZohoAlias('github.com', 'testuser@zoho.com');
      expect(alias).toBe('testuser+ghostfill-github@zoho.com');
    });

    it('handles subdomain website tags', async () => {
      const alias = await getZohoAlias('login.service.com', 'testuser@zoho.com');
      expect(alias).toBe('testuser+ghostfill-service@zoho.com');
    });

    it('throws when no base email is provided and storage is empty', async () => {
      vi.spyOn(storageService, 'get').mockResolvedValue(null);
      await expect(getZohoAlias('github.com')).rejects.toThrow();
    });
  });

  describe('disconnectZoho', () => {
    it('clears zoho connection and profile in storage', async () => {
      const setSpy = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
      await disconnectZoho();
      expect(setSpy).toHaveBeenCalledWith('zohoConnected', false);
      expect(setSpy).toHaveBeenCalledWith('zohoConnectedAt', null);
      expect(setSpy).toHaveBeenCalledWith('zohoProfile', null);
    });
  });
});

describe('MicrosoftMailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isMicrosoftEmail', () => {
    it('identifies Microsoft personal email domains', () => {
      expect(isMicrosoftEmail('user@outlook.com')).toBe(true);
      expect(isMicrosoftEmail('user@hotmail.com')).toBe(true);
      expect(isMicrosoftEmail('user@live.com')).toBe(true);
      expect(isMicrosoftEmail('user@msn.com')).toBe(true);
      expect(isMicrosoftEmail('user@gmail.com')).toBe(false);
      expect(isMicrosoftEmail('user@zoho.com')).toBe(false);
    });
  });

  describe('getMicrosoftAlias', () => {
    it('generates plus alias with website tag', async () => {
      const alias = await getMicrosoftAlias('amazon.com', 'msuser@outlook.com');
      expect(alias).toBe('msuser+ghostfill-amazon@outlook.com');
    });

    it('throws when no base email is provided and storage is empty', async () => {
      vi.spyOn(storageService, 'get').mockResolvedValue(null);
      await expect(getMicrosoftAlias('amazon.com')).rejects.toThrow();
    });
  });

  describe('disconnectMicrosoft', () => {
    it('clears microsoft connection and profile in storage', async () => {
      const setSpy = vi.spyOn(storageService, 'set').mockResolvedValue(undefined);
      await disconnectMicrosoft();
      expect(setSpy).toHaveBeenCalledWith('microsoftConnected', false);
      expect(setSpy).toHaveBeenCalledWith('microsoftConnectedAt', null);
      expect(setSpy).toHaveBeenCalledWith('microsoftProfile', null);
    });
  });
});
