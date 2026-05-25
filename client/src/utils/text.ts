/**
 * Decode raw bytes into a string by detecting the most likely text encoding.
 *
 * Order of attempts:
 *   1. BOM-based detection (UTF-8, UTF-16 LE/BE)
 *   2. Strict UTF-8 (throws on invalid sequences)
 *   3. Windows-1251 fallback (covers the typical Cyrillic-mojibake case)
 *
 * Avoids new dependencies — relies on the browser-native `TextDecoder`,
 * which ships with `windows-1251` support in every supported runtime.
 */
export function decodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}
