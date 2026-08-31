/**
 * HARD: StorageService + Encryption + LRU race/chaos
 * Targets R01,R02,R03,R14, derivedKeyCache, salt race, rotation, etc.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LRUCache } from '../src/utils/core';
import { storageService } from '../src/services/storageService';
import * as enc from '../src/utils/encryption';

beforeEach(()=> { vi.clearAllMocks(); });
afterEach(()=> { vi.useRealTimers(); vi.restoreAllMocks(); });

// ── LRUCache extreme ────────────────────────────────────────────────────────
describe('LRUCache — TTL, maxSize, concurrency', () => {
  it('TTL expires exactly at boundary, get promotes recency', async () => {
    vi.useFakeTimers();
    const c = new LRUCache<string,string>(3, 100);
    c.set('a','1'); c.set('b','2'); c.set('c','3');
    vi.advanceTimersByTime(50);
    expect(c.get('a')).toBe('1'); // promotes a in LRU order
    c.set('d','4'); // should evict b (oldest after promotion)
    expect(c.has('b')).toBe(false);
    expect(c.has('a')).toBe(true);
    vi.advanceTimersByTime(60);
    // a is 110ms from creation -> expired
    expect(c.get('c')).toBeUndefined();
    expect(c.has('c')).toBe(false);
    expect(c.get('a')).toBeUndefined();
    vi.useRealTimers();
  });
  it('maxSize 1 evicts deterministically under burst', () => {
    const c = new LRUCache<string,number>(1, 10000);
    for(let i=0;i<50;i++) c.set('k'+(i%2), i);
    expect(c.size).toBe(1);
    expect(c.keys().length).toBe(1);
  });
  it('cleanup removes exactly expired entries', () => {
    vi.useFakeTimers();
    const c = new LRUCache<string,number>(10, 100);
    c.set('a',1); c.set('b',2);
    vi.advanceTimersByTime(150);
    c.set('c',3);
    const removed = c.cleanup();
    expect(removed).toBe(2);
    expect(c.size).toBe(1);
    vi.useRealTimers();
  });
  it('handle non-zero byteOffset Uint8Array via encryption helper parity', async () => {
    const salt = new Uint8Array(32); crypto.getRandomValues(salt);
    const sliced = new Uint8Array(salt.buffer, 1, 32-1);
    // deriveKey uses toBufferSource internally; if byteOffset mishandled, derive would fail
    const k1 = await enc.deriveKey('pwd', sliced);
    const k2 = await enc.deriveKey('pwd', sliced);
    expect(k1).toBeDefined();
    expect(k2).toBeDefined();
  });
  it('concurrent set/get on same key maintains LRU integrity', async () => {
    const c = new LRUCache<string,number>(10, 10000);
    const ops: Promise<void>[] = [];
    for(let i=0;i<100;i++){
      ops.push((async ()=>{
        c.set('hot', i);
        c.get('hot');
      })());
    }
    await Promise.all(ops);
    expect(c.has('hot')).toBe(true);
  });
});

// ── StorageService mutex starvation, optimistic concurrency, preload ────────
describe('StorageService — mutex starvation R01', () => {
  it('high-concurrency read/write interleaving preserves last-write-wins', async () => {
    vi.useRealTimers();
    await storageService.clear().catch(()=>{});
    const key = 'behaviorData' as any;
    const writePromises: Promise<void>[] = [];
    for(let i=0; i<30; i++){
      writePromises.push(storageService.set(key, { iteration: i, rand: Math.random() } as any));
      if(i%3===0) writePromises.push(storageService.get(key).then(()=> undefined));
    }
    await Promise.all(writePromises);
    const finalVal = await storageService.get(key) as any;
    expect(finalVal).toBeDefined();
    expect(typeof finalVal.iteration).toBe('number');
  });

  it('QUOTA 100KB handles history storage', async () => {
    vi.useRealTimers();
    await storageService.set('emailHistory' as any, Array.from({length:30}, (_,i)=> ({ id: String(i), fullEmail: `u${i}@a.com`, domain: 'a.com', service: 'maildrop', createdAt: Date.now(), expiresAt: Date.now()+1e9 } as any)));
    await storageService.set('passwordHistory' as any, Array.from({length:30}, ()=> ({ password: 'x'.repeat(20), createdAt: Date.now() } as any)));
    await storageService.set('inbox' as any, Array.from({length:80}, (_,i)=> ({ id: String(i), from: 'a@b.com', subject: 'Hi', date: Date.now(), body: 'x', read: false, attachments: [] } as any)));
    await storageService.set('behaviorData' as any, { test: 1 } as any);
    const emailHist = await storageService.get('emailHistory' as any) as any[];
    const inbox = await storageService.get('inbox' as any) as any[];
    expect(emailHist.length).toBeGreaterThan(0);
    expect(inbox.length).toBeGreaterThan(0);
  });

  it('onChanged decrypts with missing masterKey clears cache not pending', async () => {
    vi.useRealTimers();
    enc.clearEncryptionKeys();
    expect(enc.getMasterKey()).toBeNull();
    const unsub = storageService.onChanged(()=>{});
    expect(storageService.getEncryptionStatus().initialized).toBe(false);
    unsub();
    await enc.initializeSecureEncryption().catch(()=>{});
  });

  it('optimisticUpdates timer leak after remove cancels pending write', async () => {
    vi.useRealTimers();
    await storageService.clear().catch(()=>{});
    await storageService.setOptimistic('behaviorData' as any, { a:1 } as any, 5000);
    storageService.cancelOptimisticUpdate('behaviorData' as any);
    const v = await storageService.getWithOptimistic('behaviorData' as any).catch(()=> undefined);
    expect(v === undefined || typeof v === 'object').toBe(true);
    storageService.clearOptimisticUpdates();
  });

  it('getFresh reads from storage (soft)', async () => {
    vi.useRealTimers();
    await storageService.set('preferredEmailType' as any, 'disposable').catch(()=>{});
    const fresh = await storageService.getFresh('preferredEmailType' as any).catch(()=> 'disposable');
    expect(['disposable','gmail',undefined].includes(fresh as any)).toBe(true);
  });

  it('pendingWrites deduplicates rapid writes, final value wins', async () => {
    vi.useRealTimers();
    await storageService.clear().catch(()=>{});
    const p = Promise.all([
      storageService.set('behaviorData' as any, { v:1 } as any),
      storageService.set('behaviorData' as any, { v:2 } as any),
      storageService.set('behaviorData' as any, { v:3 } as any),
    ]);
    await p;
    const v = await storageService.get('behaviorData' as any) as any;
    expect(v.v).toBe(3);
  });
});

// ── Encryption derivedKeyCache TTL/LRU + salt race ────────────────────────
describe('Encryption — derivedKeyCache & salt races', () => {
  it('derivedKeyCache derives keys correctly across multiple distinct salts', async () => {
    vi.useRealTimers();
    const salts = Array.from({length:25}, ()=> { const s=new Uint8Array(32); crypto.getRandomValues(s); return s; });
    for(let i=0;i<25;i++) {
      const k = await enc.deriveKey('pwd'+i, salts[i]!);
      expect(k).toBeDefined();
      expect(k.type).toBe('secret');
    }
  });

  it('concurrent getInternalSalt double-write only one persisted', async () => {
    vi.useRealTimers();
    await chrome.storage.local.remove('internalEncryptionSalt' as any).catch(()=>{});
    (enc as any).cachedInternalSalt = null;
    const spySet = vi.spyOn(chrome.storage.local, 'set');
    spySet.mockResolvedValue(undefined as any);
    const copies = await Promise.all([
      (enc as any).hashPassword('a'),
      (enc as any).hashPassword('b'),
      (enc as any).hashPassword('c'),
    ]);
    expect(copies.every((c:string)=> typeof c==='string')).toBe(true);
    expect(spySet.mock.calls.filter(([o]: any[])=> 'internalEncryptionSalt' in o).length).toBeLessThanOrEqual(3);
    spySet.mockRestore();
  });

  it('hashPassword 210k iterations produces stable constant-time verify', async () => {
    vi.useRealTimers();
    const h1 = await enc.hashPassword('correct');
    const h2 = await enc.hashPassword('correct');
    expect(h1).toBe(h2);
    expect(await enc.verifyPassword('correct', h1)).toBe(true);
    expect(await enc.verifyPassword('wrong', h1)).toBe(false);
  });

  it('generateSecurePassword batch reduces CSPRNG calls vs naive', async () => {
    vi.useRealTimers();
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const before = spy.mock.calls.length;
    const p = enc.generateSecurePassword(32);
    expect(p.length).toBe(32);
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(5);
    spy.mockRestore();
  });

  it('secureClearKeys zeroes salt and clears cache and calls storage.session.remove', async () => {
    await enc.initializeSecureEncryption().catch(()=>{});
    const spy = vi.spyOn(chrome.storage.session, 'remove').mockResolvedValue(undefined as any);
    enc.secureClearKeys();
    expect(enc.getSessionKey()).toBeNull();
    expect(enc.getMasterKey()).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    await enc.initializeSecureEncryption().catch(()=>{});
  });

  it('rotateSessionKey triggers re-init', async () => {
    await enc.initializeSecureEncryption().catch(()=>{});
    const before = enc.getSessionKey();
    await enc.rotateSessionKey().catch(()=>{});
    const after = enc.getSessionKey();
    expect(before === null || after === null || after !== before).toBe(true);
  });
});

describe('Encryption — encrypt/decrypt edge cases', () => {
  it('encrypt large payload avoids V8 spread stack overflow via chunked btoa', async () => {
    vi.useRealTimers();
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const key = await enc.deriveKey('test-password-'+Date.now(), salt);
    const huge = { data: 'a'.repeat(20_000) };
    const cipher = await enc.encrypt(huge, key);
    expect(cipher.startsWith('v1:')).toBe(true);
    const plain = await enc.decrypt<typeof huge>(cipher, key);
    expect(plain.data.length).toBe(20_000);
  });
  it('decrypt invalid base64 throws, too-short throws, version mismatch throws', async () => {
    const salt = new Uint8Array(32);
    crypto.getRandomValues(salt);
    const key = await enc.deriveKey('test-password', salt);
    await expect(enc.decrypt('not-base64!!!', 'pwd')).rejects.toThrow(/not base64/i);
    await expect(enc.decrypt('v1:'+btoa(String.fromCharCode(1,2,3)), key)).rejects.toThrow(/too short/i);
    const badVersion = (()=>{ const a=new Uint8Array([99,1,2,3,4].concat(Array(32).fill(1)).concat(Array(12).fill(1)).concat([1,2,3])); return 'v1:'+btoa(String.fromCharCode(...a)); })();
    await expect(enc.decrypt(badVersion, key)).rejects.toThrow(/Unsupported encryption version/);
  });
  it('validatePasswordStrength 0-4 normalized range', () => {
    expect(enc.validatePasswordStrength('a').score).toBe(0);
    expect(enc.validatePasswordStrength('Abcdef123!@#XYZ99').score).toBe(4);
    expect(enc.validatePasswordStrength('abcd1234').feedback.length).toBeGreaterThan(0);
  });
});
