// Browser-only. Collects privacy-safe RawFieldRecords from the current page so
// you can build a labeling/eval corpus. Pierces shadow DOM. Emits JSON lines on
// the console (or returns the array) with NO user values.
//
// Usage (in a content script or devtools console with the bundle loaded):
//   const rows = harvestPage();
//   console.log(rows.map(r => JSON.stringify(r)).join('\n'));

import { extractFieldRecord } from '../pageAnalyzer';
import type { RawFieldRecord } from '../IntelligenceCore';

const FILLABLE = 'input, textarea';
const SKIP_TYPES = new Set([
  'submit',
  'button',
  'reset',
  'image',
  'file',
  'range',
  'color',
  'checkbox',
  'radio',
]);

function collectDeep(root: Document | ShadowRoot, out: Element[]): void {
  out.push(...Array.from(root.querySelectorAll(FILLABLE)));
  // descend into open shadow roots
  const all = root.querySelectorAll('*');
  for (const el of Array.from(all)) {
    const sr = (el as HTMLElement).shadowRoot;
    if (sr) {
      collectDeep(sr, out);
    }
  }
}

export function harvestPage(): RawFieldRecord[] {
  const found: Element[] = [];
  collectDeep(document, found);
  const seen = new Set<Element>();
  const rows: RawFieldRecord[] = [];
  for (const el of found) {
    if (seen.has(el)) {
      continue;
    }
    seen.add(el);
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    if (SKIP_TYPES.has(type)) {
      continue;
    }
    try {
      rows.push(extractFieldRecord(el as HTMLInputElement));
    } catch {
      // ignore extraction errors on exotic elements
    }
  }
  return rows;
}

export function harvestPageJsonl(): string {
  return harvestPage()
    .map((r) => JSON.stringify(r))
    .join('\n');
}
