/**
 * GhostFill Autofill Engine
 * Modular entry point for form-filling and OTP detection.
 */

export * from './types';
export * from './engines/page-intelligence';
export * from './engines/otp-discovery';
export * from './engines/field-setter';
export * from './engines/field-watcher';
export * from './engines/otp-filler';
export * from './engines/auto-submit';
export * from './engines/phantom-typer';
export * from './utils/field-classifier';

export * from './engines/phantom-typer';
export * from './utils/field-classifier';
