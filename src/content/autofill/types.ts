import { FrameworkType } from '../../types/form.types';

export interface OTPFieldGroup {
  fields: HTMLInputElement[];
  score: number;
  strategy: string;
  isSplit: boolean;
  expectedLength: number;
  signals: string[];
}

export interface FillDetail {
  fieldType: string;
  selector: string;
  strategy: string;
  success: boolean;
  reason?: string;
}

export interface FillResult {
  success: boolean;
  filledCount: number;
  message: string;
  details: FillDetail[];
  timingMs: number;
}

export interface OTPFillOutcome {
  success: boolean;
  filledCount: number;
  strategy: string;
}

export interface GhostLabelElement extends HTMLElement {
  attachToAttribute?: (input: HTMLElement, onClick: () => void) => void;
}

export interface IdentityWithCredentials {
  email?: string;
  password?: string;
  [key: string]: any;
}
