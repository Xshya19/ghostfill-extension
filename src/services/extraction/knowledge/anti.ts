import type { AntiPattern } from '../../types/extraction.types';

export const ANTI_PATTERN_DATABASE: AntiPattern[] = [
  // MEDIUM: Years — context-aware (reject handled in otpExtractor.checkAntiPatterns)
  {
    pattern: /\b(19|20)\d{2}\b/g,
    name: 'year-4digit',
    reject: false,
    description: '4-digit year (1900-2099) — context-aware penalty only',
    severity: 'medium',
  },
  {
    pattern: /\b\d{2}\b(?![-\d])/g,
    name: 'year-2digit',
    reject: false,
    description: '2-digit year — context-aware penalty only',
    severity: 'low',
  },

  // Dates (All Formats)
  {
    pattern: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g,
    name: 'date-us',
    reject: true,
    description: 'US date format',
    severity: 'critical',
  },
  {
    pattern: /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g,
    name: 'date-iso',
    reject: true,
    description: 'ISO date format',
    severity: 'critical',
  },
  {
    pattern: /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/gi,
    name: 'date-text-month',
    reject: true,
    description: 'Date with text month',
    severity: 'critical',
  },

  // Phone Numbers
  {
    pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    name: 'phone-us',
    reject: true,
    description: 'US phone format',
    severity: 'critical',
  },
  {
    pattern: /^\+?\d{10,15}$/,
    name: 'phone-intl',
    reject: true,
    description: 'International phone',
    severity: 'critical',
  },

  // Financial Numbers
  {
    pattern: /\$[\d,]+(\.\d{2})?/g,
    name: 'money-usd',
    reject: true,
    description: 'USD amount',
    severity: 'critical',
  },
  {
    pattern: /€[\d,]+(\.\d{2})?/g,
    name: 'money-eur',
    reject: true,
    description: 'Euro amount',
    severity: 'critical',
  },
  {
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    name: 'credit-card',
    reject: true,
    description: 'Credit card',
    severity: 'critical',
  },

  // IDs
  {
    pattern: /\b[A-Z0-9]{32,}\b/g,
    name: 'hash-uuid',
    reject: true,
    description: 'Hash/UUID',
    severity: 'high',
  },
  {
    pattern: /\b[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\b/gi,
    name: 'uuid-standard',
    reject: true,
    description: 'Standard UUID',
    severity: 'high',
  },
  {
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    name: 'ssn-us',
    reject: true,
    description: 'SSN',
    severity: 'critical',
  },

  // Other False Positives
  {
    pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    name: 'ip-address',
    reject: true,
    description: 'IP address',
    severity: 'high',
  },
  {
    pattern: /\b\d+(\.\d+)?%/g,
    name: 'percentage',
    reject: true,
    description: 'Percentage',
    severity: 'medium',
  },
  {
    pattern: /\b\d{1,2}:\d{2}(:\d{2})?(AM|PM)?\b/gi,
    name: 'time-format',
    reject: true,
    description: 'Time format',
    severity: 'medium',
  },
  {
    pattern: /\b\d+\s*(bytes?|KB|MB|GB|TB)\b/gi,
    name: 'file-size',
    reject: true,
    description: 'File size',
    severity: 'medium',
  },
  {
    pattern: /\b\d{5}(?:[-\s]?\d{4})?\b/g,
    name: 'zip-code',
    reject: true,
    description: 'ZIP code',
    severity: 'medium',
  },
];
