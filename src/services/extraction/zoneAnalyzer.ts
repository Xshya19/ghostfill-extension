// src/services/extraction/zoneAnalyzer.ts
// ═══════════════════════════════════════════════════════════════════════
//  EMAIL ZONE ANALYZER
//  Structural analysis of email HTML to identify content zones
// ═══════════════════════════════════════════════════════════════════════

import type { EmailZone, ZoneType } from './types';
import { decodeHtmlEntities } from './urlExtractor';

// Re-export for use by other modules
export { decodeHtmlEntities };

// ═══════════════════════════════════════════════════════════════════════
//  ZONE WEIGHTS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Zone importance weights for scoring
 * Higher weights indicate zones more likely to contain primary content
 */
export const ZONE_WEIGHTS: Record<ZoneType, number> = {
  preheader: 0.3,
  header: 0.2,
  hero: 0.95,
  'body-primary': 0.85,
  'body-secondary': 0.6,
  cta: 1.0,
  footer: 0.15,
  sidebar: 0.4,
  unknown: 0.5,
} as const;

// ═══════════════════════════════════════════════════════════════════════
//  ZONE DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Patterns for detecting preheader sections
 * Preheaders are often hidden preview text at the start of emails
 */
const PREHEADER_PATTERNS = [
  /(<[^>]{0,300}(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0|max-height\s*:\s*0|overflow\s*:\s*hidden)[^>]{0,300}>)([\s\S]{0,2000}?)(<\/[^>]{1,20}>)/gi,
  /(<[^>]{0,300}class\s*=\s*["'][^"']{0,100}(?:preheader|preview)[^"']{0,100}["'][^>]{0,300}>)([\s\S]{0,2000}?)(<\/[^>]{1,20}>)/gi,
] as const;

/**
 * Patterns for detecting CTA (Call-to-Action) buttons
 * CTAs are typically styled links with background colors and padding
 */
const CTA_PATTERNS = [
  /<a[^>]{0,300}style\s*=\s*["'][^"']{0,200}(?:background(?:-color)?)\s*:[^"']{0,200}padding[^"']{0,200}["'][^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}>([\s\S]{0,500}?)<\/a>/gi,
  /<a[^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}style\s*=\s*["'][^"']{0,200}(?:background(?:-color)?)\s*:[^"']{0,200}padding[^"']{0,200}["'][^>]{0,300}>([\s\S]{0,500}?)<\/a>/gi,
  /<a[^>]{0,300}class\s*=\s*["'][^"']{0,100}(?:btn|button|cta|action|primary)[^"']{0,100}["'][^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}>([\s\S]{0,500}?)<\/a>/gi,
  /<td[^>]{0,300}(?:background(?:-color)?|bgcolor)\s*[=:][^>]{0,300}>\s*<a[^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}>([\s\S]{0,500}?)<\/a>/gi,
  /v:roundrect[^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}>([\s\S]{0,500}?)<\/v:roundrect>/gi,
  /<a[^>]{0,300}style\s*=\s*["'][^"']{0,200}border-radius[^"']{0,200}padding[^"']{0,200}["'][^>]{0,300}href\s*=\s*["']([^"']{1,500})["'][^>]{0,300}>([\s\S]{0,500}?)<\/a>/gi,
] as const;

/**
 * Patterns indicating footer content
 * Footers typically contain unsubscribe links and legal text
 */
const FOOTER_SIGNALS = [
  /unsubscribe/i,
  /email preferences/i,
  /privacy policy/i,
  /©\s*\d{4}/i,
  /all rights reserved/i,
  /no longer wish to receive/i,
  /manage.*(?:preferences|subscription)/i,
  /this email was sent/i,
  /you are receiving this/i,
  /update your preferences/i,
  /view in browser/i,
  /view this email/i,
  /<footer/i,
  /class\s*=\s*["'][^"']*footer[^"']*["']/i,
] as const;

// ═══════════════════════════════════════════════════════════════════════
//  HTML STRIPPING UTILITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strips HTML tags and returns plain text with structure preserved
 * @param html - The HTML content to strip
 * @returns Plain text with newlines for structure
 */
export function stripHtmlPreserveStructure(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<style[^>]*>[\s\S]{0,50000}?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]{0,50000}?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]{0,50000}?<\/head>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<hr[^>]{0,50}>/gi, '\n---\n')
    .replace(/<[^>]{1,500}>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strips HTML tags and returns compact plain text
 * @param html - The HTML content to strip
 * @returns Compact plain text
 */
export function stripHtml(html: string): string {
  if (!html) {
    return '';
  }

  return html
    .replace(/<style[^>]*>[\s\S]{0,50000}?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]{0,50000}?<\/script>/gi, ' ')
    .replace(/<head[^>]*>[\s\S]{0,50000}?<\/head>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]{0,50000}?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]{1,500}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════
//  ZONE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Analyzes email HTML to identify structural zones
 * @param html - The email HTML content
 * @param plainText - Optional pre-computed plain text
 * @returns Array of identified zones with content and weights
 */
export function analyzeEmailZones(html: string, plainText: string): EmailZone[] {
  const zones: EmailZone[] = [];

  if (!html || html.trim().length === 0) {
    return [
      {
        zone: 'body-primary',
        content: plainText,
        htmlContent: plainText,
        weight: ZONE_WEIGHTS['body-primary'],
        startIndex: 0,
        endIndex: plainText.length,
      },
    ];
  }

  const decoded = decodeHtmlEntities(html);
  const lower = decoded.toLowerCase();

  // Extract preheaders
  for (const regex of PREHEADER_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(decoded)) !== null) {
      const content = stripHtml(m[2]);
      if (content.length > 5) {
        zones.push({
          zone: 'preheader',
          content,
          htmlContent: m[0],
          weight: ZONE_WEIGHTS.preheader,
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }
  }

  // Extract CTA buttons
  for (const regex of CTA_PATTERNS) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(decoded)) !== null) {
      const url = decodeHtmlEntities((m[1] || '').trim());
      const text = stripHtml(m[2] || m[3] || '');
      if (url && url.length > 10) {
        zones.push({
          zone: 'cta',
          content: text,
          htmlContent: m[0],
          weight: ZONE_WEIGHTS.cta,
          startIndex: m.index,
          endIndex: m.index + m[0].length,
        });
      }
    }
  }

  // Find footer start
  const footerStart = findFooterStart(lower);
  if (footerStart > 0) {
    zones.push({
      zone: 'footer',
      content: stripHtml(decoded.substring(footerStart)),
      htmlContent: decoded.substring(footerStart),
      weight: ZONE_WEIGHTS.footer,
      startIndex: footerStart,
      endIndex: decoded.length,
    });
  }

  // Find header end
  const headerEnd = findHeaderEnd(lower);
  if (headerEnd > 0) {
    zones.push({
      zone: 'header',
      content: stripHtml(decoded.substring(0, headerEnd)),
      htmlContent: decoded.substring(0, headerEnd),
      weight: ZONE_WEIGHTS.header,
      startIndex: 0,
      endIndex: headerEnd,
    });
  }

  // Body primary zone
  const bodyStart = headerEnd > 0 ? headerEnd : 0;
  const bodyEnd = footerStart > 0 ? footerStart : decoded.length;
  if (bodyEnd > bodyStart) {
    zones.push({
      zone: 'body-primary',
      content: stripHtml(decoded.substring(bodyStart, bodyEnd)),
      htmlContent: decoded.substring(bodyStart, bodyEnd),
      weight: ZONE_WEIGHTS['body-primary'],
      startIndex: bodyStart,
      endIndex: bodyEnd,
    });
  }

  // Fallback if no zones found
  if (zones.length === 0) {
    zones.push({
      zone: 'body-primary',
      content: plainText || stripHtml(html),
      htmlContent: html,
      weight: ZONE_WEIGHTS['body-primary'],
      startIndex: 0,
      endIndex: html.length,
    });
  }

  return zones;
}

/**
 * Finds the start position of the footer section
 * @param lower - Lowercase HTML content
 * @returns The index where footer starts, or -1 if not found
 */
function findFooterStart(lower: string): number {
  let earliest = -1;

  for (const signal of FOOTER_SIGNALS) {
    const m = lower.match(signal);
    if (m?.index !== undefined && m.index > lower.length * 0.6) {
      const blockStart = findBlockStart(lower, m.index);
      if (earliest === -1 || blockStart < earliest) {
        earliest = blockStart;
      }
    }
  }

  return earliest;
}

/**
 * Finds the end position of the header section
 * @param lower - Lowercase HTML content
 * @returns The index where header ends, or -1 if not found
 */
function findHeaderEnd(lower: string): number {
  const signals = [/<h[12][^>]*>/i, /class\s*=\s*["'][^"']*(?:content|main|body)[^"']*["']/i];

  for (const signal of signals) {
    const m = lower.match(signal);
    if (m?.index !== undefined && m.index < lower.length * 0.3) {
      return m.index;
    }
  }

  return -1;
}

/**
 * Finds the start of a block element near a given position
 * @param html - HTML content
 * @param idx - Reference index
 * @returns The index of the block start
 */
function findBlockStart(html: string, idx: number): number {
  const tags = ['<table', '<div', '<tr', '<section', '<footer'];
  let best = idx;
  const searchStart = Math.max(0, idx - 500);

  for (const tag of tags) {
    const pos = html.lastIndexOf(tag, idx);
    if (pos >= searchStart && pos < best) {
      best = pos;
    }
  }

  return best;
}

/**
 * Gets the zone that contains a given position
 * @param zones - Array of zones
 * @param pos - Position to find zone for
 * @returns The containing zone or null
 */
export function getZoneForPosition(zones: EmailZone[], pos: number): EmailZone | null {
  let best: EmailZone | null = null;
  let bestSize = Infinity;

  for (const z of zones) {
    if (pos >= z.startIndex && pos <= z.endIndex) {
      const size = z.endIndex - z.startIndex;
      if (size < bestSize) {
        bestSize = size;
        best = z;
      }
    }
  }

  return best;
}

// ═══════════════════════════════════════════════════════════════════════
//  CONTEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Gets context text around a search term
 * @param text - The full text
 * @param term - The term to find context around
 * @param radius - Number of characters on each side
 * @returns Context string
 */
export function getContextAround(text: string, term: string, radius: number = 150): string {
  if (!text || !term) {
    return '';
  }

  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) {
    return text.substring(0, radius * 2);
  }

  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return text.substring(start, end);
}
