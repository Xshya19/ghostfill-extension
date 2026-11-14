import { catchmailService } from '../src/services/emailServices/catchmailService';
import { throwawaymailService } from '../src/services/emailServices/throwawaymailService';
import { tempmailPlusService } from '../src/services/emailServices/tempmailPlusService';
import { mailTmService } from '../src/services/emailServices/mailTmService';
import { mailGwService } from '../src/services/emailServices/mailGwService';
import { guerrillaMailService } from '../src/services/emailServices/guerrillaMailService';
import { maildropService } from '../src/services/emailServices/maildropService';
import { driftzService } from '../src/services/emailServices/driftzService';
import { yopmailService } from '../src/services/emailServices/yopmailService';
import { mailCxService } from '../src/services/emailServices/mailCxService';
import { dropmailService } from '../src/services/emailServices/dropmailService';
import { mailboxtempService } from '../src/services/emailServices/mailboxtempService';
import { openinboxService } from '../src/services/emailServices/openinboxService';
import { evilmailService } from '../src/services/emailServices/evilmailService';
import { getnadaService } from '../src/services/emailServices/getnadaService';
import { tempMailLolService } from '../src/services/emailServices/tempMailLolService';
import { mailnesiaService } from '../src/services/emailServices/mailnesiaService';
import { mailinatorService } from '../src/services/emailServices/mailinatorService';
import { tempMailService } from '../src/services/emailServices/tempMailService';

// Mock chrome environment
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

async function testAll() {
  console.log('Testing ALL email services for account creation & message polling...\n');

  const providers: Array<{ name: string; service: any }> = [
    { name: 'catchmail', service: catchmailService },
    { name: 'throwawaymail', service: throwawaymailService },
    { name: 'tempmailplus', service: tempmailPlusService },
    { name: 'mailtm', service: mailTmService },
    { name: 'mailgw', service: mailGwService },
    { name: 'guerrilla', service: guerrillaMailService },
    { name: 'maildrop', service: maildropService },
    { name: 'driftz', service: driftzService },
    { name: 'yopmail', service: yopmailService },
    { name: 'mailcx', service: mailCxService },
    { name: 'dropmail', service: dropmailService },
    { name: 'mailboxtemp', service: mailboxtempService },
    { name: 'openinbox', service: openinboxService },
    { name: 'evilmail', service: evilmailService },
    { name: 'getnada', service: getnadaService },
    { name: 'tempmaillol', service: tempMailLolService },
    { name: 'mailnesia', service: mailnesiaService },
    { name: 'mailinator', service: mailinatorService },
    { name: 'tempmail (1secmail)', service: tempMailService },
  ];

  const results: Array<{ Provider: string; Create: string; Messages: string; Notes: string }> = [];

  for (const { name, service } of providers) {
    let createStatus = 'FAIL';
    let msgStatus = 'SKIP';
    let notes = '';
    let account: any = null;

    try {
      const abortCtrl = new AbortController();
      const timer = setTimeout(() => abortCtrl.abort(), 8000);
      account = await service.createAccount(undefined, abortCtrl.signal);
      clearTimeout(timer);
      if (account && account.fullEmail) {
        createStatus = 'OK (' + account.fullEmail + ')';
      } else {
        createStatus = 'WARN: no email';
      }
    } catch (e: any) {
      createStatus = `ERR: ${e.message?.slice(0, 40)}`;
      notes = e.message || '';
    }

    if (account) {
      try {
        const abortCtrl = new AbortController();
        const timer = setTimeout(() => abortCtrl.abort(), 8000);
        let msgs: any[] = [];
        if (service.getMessages.length === 1) {
          msgs = await service.getMessages(account.fullEmail || account);
        } else {
          // Some accept account, some accept (fullEmail, signal) or (account, signal)
          msgs = await service.getMessages(account.fullEmail || account, abortCtrl.signal);
        }
        clearTimeout(timer);
        msgStatus = `OK (${msgs.length} msgs)`;
      } catch (e: any) {
        msgStatus = `ERR: ${e.message?.slice(0, 40)}`;
      }
    }

    results.push({
      Provider: name,
      Create: createStatus.slice(0, 45),
      Messages: msgStatus.slice(0, 30),
      Notes: notes.slice(0, 50),
    });
    console.log(`[${name}] Create: ${createStatus} | Messages: ${msgStatus}`);
  }

  console.log('\nFinal Results:');
  console.table(results);
}

void testAll();
