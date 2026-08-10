// src/services/extraction/parseText.ts
// ═══════════════════════════════════════════════════════════════════════
// Parse-time text preparation. NEVER use sanitizeText() before extraction.
// Sanitization is for rendering; this is for parsing.
// ═══════════════════════════════════════════════════════════════════════

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', zwnj: '', zwj: '', shy: '',
};

export function decodeEntities(s: string): string {
  if (!s) return '';
  let out = s;
  // Bounded multi-pass: emails double-encode (&amp;#39;)
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeCp(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (_, d) => safeCp(parseInt(d, 10)))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
    if (next === out) break;
    out = next;
  }
  return out;
}

function safeCp(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

/** Invisible chars used to split OTPs and defeat regex. Must die before parsing. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD\u180E]/g;

/* Homoglyph fold: only for comparison, never for the emitted code. */
const HOMOGLYPH: Record<string, string> = {
  '\u0410': 'A', '\u0412': 'B', '\u0421': 'C', '\u0415': 'E', '\u041D': 'H',
  '\u041A': 'K', '\u041C': 'M', '\u041E': 'O', '\u0420': 'P', '\u0422': 'T',
  '\u0425': 'X', '\u03A1': 'P', '\u0391': 'A', '\u039F': 'O',
  '\uFF10': '0', '\uFF11': '1', '\uFF12': '2', '\uFF13': '3', '\uFF14': '4',
  '\uFF15': '5', '\uFF16': '6', '\uFF17': '7', '\uFF18': '8', '\uFF19': '9',
};

export function foldHomoglyphs(s: string): string {
  return s.replace(/[\u0410\u0412\u0421\u0415\u041D\u041A\u041C\u041E\u0420\u0422\u0425\u03A1\u0391\u039F\uFF10-\uFF19]/g, (c) => HOMOGLYPH[c] ?? c);
}

export interface ParsedEmail {
  /** Plain text with block structure preserved as newlines. Entities decoded. */
  text: string;
  /** Original HTML, entities NOT decoded (needed for tag-boundary tests). */
  html: string;
  /** Decoded HTML for value lookups. */
  htmlDecoded: string;
  subject: string;
}

const BLOCK = /<\/(?:p|div|tr|h[1-6]|li|blockquote|section|header|footer)>/gi;

export function prepareForParsing(
  subject: string,
  textBody: string,
  htmlBody: string
): ParsedEmail {
  const html = (htmlBody || '').replace(INVISIBLE, '');
  const htmlDecoded = decodeEntities(html);

  let text: string;
  if (html) {
    text = html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<hr\s*\/?>/gi, ' ')
      // Keep href visible so URL-context veto can see it
      .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi, ' \u0001$1\u0001 ')
      .replace(BLOCK, '\n')
      .replace(/<[^>]+>/g, ' ');
    text = decodeEntities(text);
  } else {
    // CRITICAL: plaintext must NOT be entity-encoded. Decode only.
    text = decodeEntities((textBody || '').replace(INVISIBLE, ''));
  }

  text = text
    .replace(/[ \t\u00A0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const subj = decodeEntities((subject || '').replace(INVISIBLE, '')).trim();
  return { text: `${subj}\n\n${text}`, html, htmlDecoded, subject: subj };
}
