// src/services/extraction/domEngine.ts
// ═══════════════════════════════════════════════════════════════════════
//  COGNITIVE DOM ENGINE
//  Stack-based HTML tokenizer — correctly handles nested identical tags,
//  malformed/unclosed tags (extremely common in ESP-generated HTML), and
//  gives every node an ABSOLUTE position in the original document.
//  This deliberately avoids backreference/non-greedy regex tag matching,
//  which is fundamentally broken for nested structures.
// ═══════════════════════════════════════════════════════════════════════

export type DOMNodeType = 'element' | 'text';

export interface DOMNode {
  type: DOMNodeType;
  tag?: string;
  attrs?: Record<string, string>;
  ownStyle?: Record<string, string>;
  text?: string;
  children: DOMNode[];
  parent: DOMNode | null;
  startIndex: number;
  endIndex: number;
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Content of these must be swallowed raw (never parsed as tags/entities).
const RAW_CONTENT_TAGS = new Set(['script', 'style', 'head', 'title', 'noscript']);

// ── Unicode / evasion-technique normalization ───────────────────────────
// Handles zero-width chars, NBSP variants, full-width digits (NFKC),
// smart quotes — the #1 silent-failure cause in banking/enterprise templates.
export function normalizeForExtraction(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"');
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–',
};

function decodeEntitiesLocal(text: string): string {
  const decoded = text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1]?.toLowerCase() === 'x'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY_MAP[ent.toLowerCase()] ?? m;
  });
  return normalizeForExtraction(decoded);
}

function parseStyleAttr(styleStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of styleStr.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim().toLowerCase();
    if (prop && val) out[prop] = val;
  }
  return out;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!attrStr) return attrs;
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr)) !== null) {
    const name = m[1]!.toLowerCase();
    attrs[name] = m[3] ?? m[4] ?? m[5] ?? '';
  }
  return attrs;
}

/**
 * Builds a real DOM tree using an explicit stack — this is the only
 * approach that correctly handles nested-identical-tag structures
 * (nested tables/divs are the norm in email HTML, not the exception).
 * Tolerant of unclosed/mismatched tags (auto-recovers like a browser).
 */
export function buildDom(html: string): DOMNode {
  const root: DOMNode = {
    type: 'element', tag: '#root', children: [], parent: null,
    startIndex: 0, endIndex: html.length,
  };
  const stack: DOMNode[] = [root];
  // Matches: comments, CDATA, closing tags, opening/self-closing tags.
  const tagRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)\s*(\/)?>/g;
  let lastIndex = 0;
  let rawSwallowTag: string | null = null;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const closing = m[1];
    const tagName = (m[2] || '').toLowerCase();
    const attrStr = m[3] || '';
    const selfClose = m[4];
    const idx = m.index;

    // Emit preceding text as a text node (unless we're swallowing raw content)
    if (idx > lastIndex) {
      const raw = html.slice(lastIndex, idx);
      if (!rawSwallowTag && raw) {
        const parent = stack[stack.length - 1]!;
        parent.children.push({
          type: 'text', text: decodeEntitiesLocal(raw), children: [],
          parent, startIndex: lastIndex, endIndex: idx,
        });
      }
    }
    lastIndex = idx + full.length;

    if (full.startsWith('<!--') || full.startsWith('<![CDATA[')) continue;

    if (rawSwallowTag) {
      if (closing && tagName === rawSwallowTag) rawSwallowTag = null;
      continue;
    }

    if (closing) {
      // Browser-style error recovery: find matching ancestor, pop up to it.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === tagName) {
          stack[i]!.endIndex = idx + full.length;
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const parent = stack[stack.length - 1]!;
    const node: DOMNode = {
      type: 'element', tag: tagName, attrs: parseAttrs(attrStr),
      children: [], parent, startIndex: idx, endIndex: idx + full.length,
    };
    if (node.attrs?.style) node.ownStyle = parseStyleAttr(node.attrs.style);
    parent.children.push(node);

    if (RAW_CONTENT_TAGS.has(tagName) && !selfClose) {
      rawSwallowTag = tagName;
      continue;
    }
    if (!VOID_TAGS.has(tagName) && !selfClose) {
      stack.push(node);
    }
  }

  if (lastIndex < html.length) {
    const raw = html.slice(lastIndex);
    if (raw.trim()) {
      const parent = stack[stack.length - 1]!;
      parent.children.push({
        type: 'text', text: decodeEntitiesLocal(raw), children: [],
        parent, startIndex: lastIndex, endIndex: html.length,
      });
    }
  }

  return root;
}

// ── Tree traversal utilities ─────────────────────────────────────────────

export function getFlattenedText(node: DOMNode): string {
  if (node.type === 'text') return node.text || '';
  let out = '';
  for (const child of node.children) {
    out += getFlattenedText(child);
    if (child.type === 'element' && /^(td|th|tr|p|div|br|h[1-6]|li)$/i.test(child.tag || '')) {
      out += ' ';
    }
  }
  return out;
}

export function* walkTextNodes(node: DOMNode): Generator<DOMNode> {
  if (node.type === 'text') {
    if ((node.text || '').trim()) yield node;
    return;
  }
  for (const child of node.children) yield* walkTextNodes(child);
}

export function* walkElements(node: DOMNode, tags?: Set<string>): Generator<DOMNode> {
  if (node.type === 'element') {
    if (!tags || tags.has(node.tag || '')) yield node;
    for (const child of node.children) yield* walkElements(child, tags);
  }
}

/** Walks all elements recursively. */
export function* walkAllElementsExported(node: DOMNode): Generator<DOMNode> {
  if (node.type === 'element') {
    yield node;
    for (const child of node.children) {
      yield* walkAllElementsExported(child);
    }
  }
}

/** CSS-inheritance approximation: nearest ancestor (including self) that
 *  explicitly defines the property wins — this correctly models how
 *  font-size/font-weight/letter-spacing cascade in real rendered emails. */
export function getEffectiveStyle(node: DOMNode, prop: string): string | null {
  let cur: DOMNode | null = node.type === 'text' ? node.parent : node;
  let depth = 0;
  while (cur && depth < 12) {
    if (cur.ownStyle?.[prop]) return cur.ownStyle[prop];
    cur = cur.parent;
    depth++;
  }
  return null;
}

/** Returns the ancestor chain from immediate parent up to root, capped. */
export function getAncestorChain(node: DOMNode, maxDepth = 8): DOMNode[] {
  const chain: DOMNode[] = [];
  let cur = node.parent;
  let depth = 0;
  while (cur && depth < maxDepth) {
    chain.push(cur);
    cur = cur.parent;
    depth++;
  }
  return chain;
}

export function findAncestorTag(node: DOMNode, tag: string, maxDepth = 6): DOMNode | null {
  let cur = node.parent;
  let depth = 0;
  while (cur && depth < maxDepth) {
    if (cur.tag === tag) return cur;
    cur = cur.parent;
    depth++;
  }
  return null;
}

/** Is this text node the sole meaningful content of its parent element? */
export function isIsolatedInParent(node: DOMNode): boolean {
  const parent = node.parent;
  if (!parent) return false;
  const meaningfulSiblings = parent.children.filter((c) => {
    if (c === node) return false;
    if (c.type === 'text') return (c.text || '').trim().length > 0;
    return true; // element siblings count against isolation
  });
  return meaningfulSiblings.length === 0;
}
