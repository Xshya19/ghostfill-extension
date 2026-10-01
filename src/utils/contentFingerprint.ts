/** Hash complete, length-delimited inputs without copying large HTML bodies. */
export function contentFingerprint(parts: readonly string[]): string {
  let h1 = 0xdeadbeef,
    h2 = 0x41c6ce57;
  for (const part of parts) {
    h1 = Math.imul(h1 ^ part.length, 2654435761);
    h2 = Math.imul(h2 ^ part.length, 1597334677);
    for (let i = 0; i < part.length; i++) {
      const ch = part.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
