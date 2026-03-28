/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FEATURE EXTRACTOR V2 — The 128-Dim Sensory Core               ║
 * ║  Encodes DOM elements into fixed-length numerical vectors       ║
 * ║  for residual-attention neural network processing.              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

export type FieldType = 
  | 'username' | 'email' | 'password' | 'confirm_password' 
  | 'otp_digit' | 'phone' | 'submit_button' | 'honeypot' | 'unknown';

export interface FormContext {
  url: string;
  domain: string;
  isAuthPage: boolean;
  totalVisibleInputs: number;
  formAction?: string;
}

export class FeatureExtractorV2 {
  private static readonly DIMENSIONS = 128;

  /**
   * Main entry point: Extract a 128-dimensional Float32Array from an element.
   */
  public extract(element: HTMLElement, context: FormContext): Float32Array {
    const vector = new Float32Array(FeatureExtractorV2.DIMENSIONS);
    
    // Block 1: Semantic Text Embedding (dims 0-31)
    this.populateSemanticHash(element, vector);

    // Block 2: Element Type + Input Mode (dims 32-43)
    this.populateElementType(element, vector);

    // Block 3: Autocomplete + Credential Hints (dims 44-55)
    this.populateAutocomplete(element, vector);

    // Block 4: DOM Structural Features (dims 56-71)
    this.populateStructural(element, vector, context);

    // Block 5: Pattern + Validation (dims 72-83)
    this.populatePattern(element, vector);

    // Block 6: Contextual Co-occurrence (dims 84-99)
    this.populateContextual(element, vector, context);

    // Block 7: Spatial / Visual Features (dims 100-115)
    this.populateSpatial(element, vector, context);

    // Block 8: Sequence Context (dims 116-127)
    this.populateSequence(element, vector);

    return vector;
  }

  // ─── Block 1: Semantic Text Embedding (32 dims) ────────────────

  private populateSemanticHash(el: HTMLElement, vec: Float32Array): void {
    const textSignals = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.title,
      el.getAttribute('data-testid'),
      this.getLabelText(el)
    ].filter(Boolean).join(' ').toLowerCase();

    // Locality Sensitive Hash (SimHash) implementation
    const hash = this.simHash32(textSignals);
    for (let i = 0; i < 32; i++) {
      vec[i] = (hash >> i) & 1;
    }
  }

  private simHash32(str: string): number {
    const v = new Array(32).fill(0);
    const words = str.split(/[^a-z0-9-]+/).filter(w => w.length > 0);

    for (const word of words) {
      const h = this.jenkinsHash(word);
      for (let i = 0; i < 32; i++) {
        if ((h >> i) & 1) {v[i]++;}
        else {v[i]--;}
      }
    }

    let fingerPrint = 0;
    for (let i = 0; i < 32; i++) {
      if (v[i] >= 0) {fingerPrint |= (1 << i);}
    }
    return fingerPrint;
  }

  private jenkinsHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash += str.charCodeAt(i);
      hash += (hash << 10);
      hash ^= (hash >>> 6);
    }
    hash += (hash << 3);
    hash ^= (hash >>> 11);
    hash += (hash << 15);
    return hash >>> 0;
  }

  // ─── Block 2: Element Type (12 dims) ───────────────────────────

  private populateElementType(el: HTMLElement, vec: Float32Array): void {
    const type = (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase());
    const types = [
      'text', 'password', 'email', 'tel', 'number', 'url', 'search',
      'hidden', 'select', 'textarea', 'div', 'custom'
    ];
    
    let foundIdx = types.indexOf(type);
    if (foundIdx === -1 && el.hasAttribute('contenteditable')) {
      foundIdx = 10;
    }
    if (foundIdx === -1 && el.tagName.includes('-')) {
      foundIdx = 11;
    }
    
    if (foundIdx !== -1) {vec[32 + foundIdx] = 1.0;}
  }

  // ─── Block 3: Autocomplete (12 dims) ───────────────────────────

  private populateAutocomplete(el: HTMLElement, vec: Float32Array): void {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const map = [
      'username', 'email', 'current-password', 'new-password', 
      'one-time-code', 'tel', 'tel-national', 'cc-number', 'cc-exp', 
      'cc-csc', 'off', 'missing'
    ];
    
    const idx = map.indexOf(ac);
    if (idx !== -1) {
      vec[44 + idx] = 1.0;
    } else if (!ac) {
      vec[44 + 11] = 1.0; // missing
    }
  }

  // ─── Block 4: Structural (16 dims) ─────────────────────────────

  private populateStructural(el: HTMLElement, vec: Float32Array, ctx: FormContext): void {
    const form = el.closest('form');
    
    // 56: depth in form
    if (form) {
      let depth = 0;
      let curr: HTMLElement | null = el;
      while (curr && curr !== form) {
        curr = curr.parentElement;
        depth++;
      }
      vec[56] = Math.min(depth / 10, 1.0);
    }

    // 57: sibling index
    const siblings = Array.from(el.parentElement?.children || []);
    vec[57] = siblings.indexOf(el) / Math.max(siblings.length, 1);

    // 60: is inside shadow dom
    vec[60] = (el.getRootNode() instanceof ShadowRoot) ? 1.0 : 0.0;

    // 61: is inside iframe
    vec[61] = (window.self !== window.top) ? 1.0 : 0.0;

    // 63: is inside modal
    vec[63] = el.closest('[role="dialog"], .modal, .overlay') ? 1.0 : 0.0;
  }

  // ─── Block 5: Pattern (12 dims) ────────────────────────────────

  private populatePattern(el: HTMLElement, vec: Float32Array): void {
    if (el instanceof HTMLInputElement) {
      if (el.required) {
        vec[72] = 1.0;
      }
      if (el.hasAttribute('pattern')) {
        vec[73] = 1.0;
      }
      
      const maxLen = el.maxLength;
      if (maxLen > 0) {
        vec[75] = Math.min(maxLen / 256, 1.0);
      }
      
      const inputMode = el.inputMode;
      if (inputMode === 'numeric') {
        vec[78] = 1.0;
      }
      if (inputMode === 'email') {
        vec[79] = 1.0;
      }
    }
  }

  // ─── Block 6: Contextual (16 dims) ─────────────────────────────

  private populateContextual(el: HTMLElement, vec: Float32Array, ctx: FormContext): void {
    const form = el.closest('form') || document.body;
    
    // 84: count password inputs
    const passwords = form.querySelectorAll('input[type="password"]');
    vec[84] = Math.min(passwords.length / 3, 1.0);

    // 85: count text inputs
    const texts = form.querySelectorAll('input[type="text"]');
    vec[85] = Math.min(texts.length / 10, 1.0);

    // 88: check for "forgot password" links
    const links = Array.from(form.querySelectorAll('a'));
    if (links.some(a => /forgot|reset|lost/i.test(a.textContent || ''))) {
      vec[88] = 1.0;
    }

    // 92: check form action
    if (ctx.formAction && /login|auth|signin/i.test(ctx.formAction)) {
      vec[92] = 1.0;
    }
    
    // 94: page title check
    if (/login|sign in|auth|account/i.test(document.title)) {
      vec[94] = 1.0;
    }
  }

  // ─── Block 7: Spatial (16 dims) ────────────────────────────────

  private populateSpatial(el: HTMLElement, vec: Float32Array, ctx: FormContext): void {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (vw > 0 && vh > 0) {
      vec[100] = (rect.left + rect.width / 2) / vw; // x_norm
      vec[101] = (rect.top + rect.height / 2) / vh;  // y_norm
      vec[102] = rect.width / vw;
      vec[103] = rect.height / vh;
    }

    // 105: is above fold
    vec[105] = rect.top < vh ? 1.0 : 0.0;

    // 110: is inside centered container
    const style = window.getComputedStyle(el.parentElement || el);
    if (style.display === 'flex' && style.justifyContent === 'center') {
      vec[110] = 1.0;
    }
    if (style.margin === 'auto' || style.marginLeft === 'auto') {
      vec[110] = 0.5;
    }
  }

  // ─── Block 8: Sequence (12 dims) ───────────────────────────────

  private populateSequence(el: HTMLElement, vec: Float32Array): void {
    const form = el.closest('form') || document.body;
    const inputs = Array.from(form.querySelectorAll('input, select, textarea'));
    const idx = inputs.indexOf(el as any);
    
    if (idx !== -1 && inputs.length > 1) {
      vec[116] = idx / (inputs.length - 1); // position in sequence
    }

    // 119: check for OTP sequence
    const siblings = Array.from(el.parentElement?.children || []);
    const similarSiblings = siblings.filter(s => 
      s.tagName === el.tagName && 
      (s as HTMLInputElement).maxLength === (el as HTMLInputElement).maxLength
    );
    if (similarSiblings.length >= 4 && similarSiblings.length <= 8) {
      vec[119] = 1.0;
    }
  }

  private getLabelText(el: HTMLElement): string {
    // 1. Check <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) {return label.textContent || '';}
    }
    // 2. Check parent <label>
    const parentLabel = el.closest('label');
    if (parentLabel) {return parentLabel.textContent || '';}
    
    // 3. Check aria-labelledby
    const labeledBy = el.getAttribute('aria-labelledby');
    if (labeledBy) {
      const label = document.getElementById(labeledBy);
      if (label) {return label.textContent || '';}
    }
    
    return '';
  }
}

export default FeatureExtractorV2;
