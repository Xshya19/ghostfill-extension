import { describe, it, expect } from 'vitest';
import { contentToString } from '../core';

describe('contentToString', () => {
  it('passes plain strings through unchanged', () => {
    expect(contentToString('hello world')).toBe('hello world');
    expect(contentToString('')).toBe('');
  });

  it('returns the fallback for null/undefined', () => {
    expect(contentToString(null)).toBe('');
    expect(contentToString(undefined)).toBe('');
    expect(contentToString(undefined, 'fallback')).toBe('fallback');
    expect(contentToString(null, 'x')).toBe('x');
  });

  it('safely converts provider object bodies to strings', () => {
    // Providers sometimes hand the body over as { text, html } — this used to
    // crash the popup with "TypeError: m.slice is not a function".
    expect(contentToString({ text: 'hello', html: '<b>hi</b>' })).toBe('hello');
    expect(contentToString({ html: '<b>hi</b>' })).toBe('<b>hi</b>');
    expect(contentToString({ body: 'plain body' })).toBe('plain body');
    expect(contentToString({ content: 'content' })).toBe('content');
  });

  it('stringifies objects without string fields', () => {
    const obj = { a: 1, b: 2 };
    expect(contentToString(obj)).toBe(JSON.stringify(obj));
  });

  it('converts numbers and other primitives to strings', () => {
    expect(contentToString(42)).toBe('42');
    expect(contentToString(true)).toBe('true');
  });

  it('never returns a non-string (guards .slice/.replace callers)', () => {
    const values: unknown[] = [
      { a: 1 },
      ['arr'],
      [{ text: 'x' }],
      new Date(0),
      Symbol.for('s'),
      0,
      false,
    ];
    for (const value of values) {
      const out = contentToString(value);
      expect(typeof out).toBe('string');
      // Calling .slice() on the result must never throw.
      expect(() => out.slice(0, 5)).not.toThrow();
    }
  });
});
