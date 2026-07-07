import { classifyField as legacyClassifyField } from './classifier/classify';
import { RawFieldRecord, FieldClass, ClassificationResult } from './types';
import { FieldType } from '../types/form.types';

export interface FiredSignal {
  name: string;
  weight: number;
}

export interface CalibratedResult {
  fieldType: FieldType;
  rawScore: number;
  confidence: number;
  margin: number;
  signals: string[];
  decision: 'FILL' | 'ABSTAIN' | 'BLOCK';
  safetyReason?: string | undefined;
}

export function mapFieldClassToFieldType(cls: FieldClass): FieldType {
  switch (cls) {
    case 'Email':
      return 'email';
    case 'Username':
      return 'username';
    case 'Password':
      return 'password';
    case 'Target_Password_Confirm':
      return 'confirm-password';
    case 'First_Name':
      return 'first-name';
    case 'Last_Name':
      return 'last-name';
    case 'Full_Name':
      return 'full-name';
    case 'Phone':
      return 'phone';
    case 'OTP':
      return 'otp';
    default:
      return 'unknown';
  }
}

export class IntelligenceCore {
  private temperature = 1.0;

  constructor(temperature: number = 1.0) {
    this.temperature = temperature;
  }

  /**
   * Main entry point for classifying a field.
   */
  classify(record: RawFieldRecord): CalibratedResult {
    const { result, decision } = legacyClassifyField(record, {
      temperature: this.temperature,
    });

    const fieldType = mapFieldClassToFieldType(result.top);
    const confidence = result.topProb; // softmax probability is the calibrated confidence
    const rawScore = Math.log(result.topProb / (1 - result.topProb + 1e-9)); // log-odds of top class

    let finalDecision: 'FILL' | 'ABSTAIN' | 'BLOCK' = 'FILL';
    if (decision.action === 'BLOCK') {
      finalDecision = 'BLOCK';
    } else if (decision.action === 'ABSTAIN') {
      finalDecision = 'ABSTAIN';
    }

    return {
      fieldType,
      rawScore,
      confidence,
      margin: result.margin,
      signals: result.signals,
      decision: finalDecision,
      safetyReason: decision.safety,
    };
  }

  /**
   * Calibrate score using temperature parameter.
   */
  setTemperature(t: number): void {
    if (t > 0) {
      this.temperature = t;
    }
  }
}
