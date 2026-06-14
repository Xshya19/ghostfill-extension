import { guerrillaMailService } from '../src/services/emailServices/guerrillaMailService';
import { maildropService } from '../src/services/emailServices/maildropService';
import { mailGwService } from '../src/services/emailServices/mailGwService';
import { mailTmService } from '../src/services/emailServices/mailTmService';
import { tempMailService } from '../src/services/emailServices/tempMailService';

// Mock chrome for storage-backed services when this manual checker runs in Node.
(globalThis as any).chrome = {
  storage: {
    local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    session: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      setAccessLevel: async () => {},
    },
  },
  runtime: { getManifest: () => ({ version: '1.0' }) },
};

async function testProviders() {
  console.log('Starting health checks for Email Providers...');
  const results: Array<{ Provider: string; Status: string; Details: string }> = [];

  const addResult = (name: string, status: string, details: string) => {
    results.push({ Provider: name, Status: status, Details: details.substring(0, 50) });
    console.log(`[${status}] ${name} - ${details}`);
  };

  try {
    const domains = await mailTmService.getDomains();
    addResult('Mail.tm', domains.length > 0 ? 'OK' : 'WARN', `Domains: ${domains.length}`);
  } catch (e: any) {
    addResult('Mail.tm', 'FAIL', e.message);
  }

  try {
    const domains = await mailGwService.getDomains();
    addResult('Mail.gw', domains.length > 0 ? 'OK' : 'WARN', `Domains: ${domains.length}`);
  } catch (e: any) {
    addResult('Mail.gw', 'FAIL', e.message);
  }

  try {
    const domains = await tempMailService.getDomains();
    addResult(
      'TempMail (1secmail)',
      domains.length > 0 ? 'OK' : 'WARN',
      `Domains: ${domains.length}`
    );
  } catch (e: any) {
    addResult('TempMail', 'FAIL', e.message);
  }

  try {
    const acc = await maildropService.createAccount('testrunner');
    addResult('Maildrop', acc.fullEmail ? 'OK' : 'WARN', `Generated: ${acc.fullEmail}`);
  } catch (e: any) {
    addResult('Maildrop', 'FAIL', e.message);
  }

  try {
    const acc = await guerrillaMailService.createAccount();
    addResult('GuerrillaMail', acc.fullEmail ? 'OK' : 'WARN', `Generated: ${acc.fullEmail}`);
  } catch (e: any) {
    addResult('GuerrillaMail', 'FAIL', e.message);
  }

  console.log('\nSummary Table:');
  console.table(results);
}

void testProviders();
