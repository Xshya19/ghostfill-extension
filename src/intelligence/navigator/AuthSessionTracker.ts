/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  AUTH SESSION TRACKER — Multi-Step Flow Persistence          ║
 * ║  Links fields across page loads and dynamic DOM swaps.         ║
 * ║  Classifies flows (login, mfa, signup) by step sequence.        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { FormFingerprint } from '../history/FuzzyFormFingerprint';
import { FieldType } from '../ml/FeatureExtractorV2';

export type AuthFlowType = 
  | 'single_page_login' | 'split_login' | 'login_with_mfa' 
  | 'password_reset' | 'signup' | 'unknown';

export interface AuthSession {
  domain: string;
  steps: AuthStep[];
  detectedFlow: AuthFlowType;
  startTime: number;
}

export interface AuthStep {
  url: string;
  timestamp: number;
  formFingerprint: FormFingerprint;
  detectedFields: Array<{ selector: string; type: FieldType }>;
}

export class AuthSessionTracker {
  private static activeSessions: Map<string, AuthSession> = new Map();

  private static STORAGE_KEY = 'ghostfill_auth_sessions';

  /**
   * Resume session tracking from storage.
   */
  public static async resume(): Promise<void> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      const data = await chrome.storage.local.get(this.STORAGE_KEY);
      const saved = data[this.STORAGE_KEY];
      if (saved && typeof saved === 'object') {
        for (const [domain, session] of Object.entries(saved)) {
          if (!this.isSessionStale(session as AuthSession)) {
            this.activeSessions.set(domain, session as AuthSession);
          }
        }
      }
    } catch (e) {
      // Storage might be unavailable in some contexts
    }
  }

  private static async persist(): Promise<void> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage) {
        return;
      }
      const sessionsObj = Object.fromEntries(this.activeSessions);
      await chrome.storage.local.set({ [this.STORAGE_KEY]: sessionsObj });
    } catch (e) {
      // Non-critical
    }
  }

  /**
   * Record a new step in the authentication flow.
   */
  public static async recordStep(domain: string, fingerprint: any, fields: Array<{ selector: string; type: string }>): Promise<AuthSession> {
    let session = AuthSessionTracker.activeSessions.get(domain);

    if (!session || AuthSessionTracker.isSessionStale(session)) {
      session = { domain, steps: [], detectedFlow: 'unknown', startTime: Date.now() };
      AuthSessionTracker.activeSessions.set(domain, session);
    }

    session.steps.push({
      url: window.location.href,
      timestamp: Date.now(),
      formFingerprint: fingerprint,
      detectedFields: fields as any
    });

    session.detectedFlow = AuthSessionTracker.classifyFlow(session);
    void AuthSessionTracker.persist();
    return session;
  }

  private static isSessionStale(session: AuthSession): boolean {
    const MAX_AGE = 10 * 60 * 1000; // 10 minutes
    return Date.now() - session.startTime > MAX_AGE;
  }

  private static classifyFlow(session: AuthSession): AuthFlowType {
    const allFields = session.steps.flatMap(s => s.detectedFields.map(f => f.type));
    
    // Logic for split login: email in step 1, password in step 2
    const step1 = session.steps[0]?.detectedFields.map(f => f.type) || [];
    const step2 = session.steps[1]?.detectedFields.map(f => f.type) || [];

    if (step1.includes('email' as any) && step2.includes('password' as any)) {return 'split_login';}
    if (allFields.includes('email' as any) && allFields.includes('password' as any) && allFields.includes('otp_digit' as any)) {return 'login_with_mfa';}
    if (allFields.includes('email' as any) && allFields.includes('password' as any)) {return 'single_page_login';}
    
    return 'unknown';
  }
}
