import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'util';

if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = NodeTextEncoder as typeof globalThis.TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = NodeTextDecoder as typeof globalThis.TextDecoder;
}

import { decodeBytes } from '../text';

function buf(...bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function utf8(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function cp1251(text: string): ArrayBuffer {
  const cyrillicMap: Record<string, number> = {
    А: 0xc0, Б: 0xc1, В: 0xc2, Г: 0xc3, Д: 0xc4, Е: 0xc5, Ж: 0xc6, З: 0xc7,
    И: 0xc8, Й: 0xc9, К: 0xca, Л: 0xcb, М: 0xcc, Н: 0xcd, О: 0xce, П: 0xcf,
    Р: 0xd0, С: 0xd1, Т: 0xd2, У: 0xd3, Ф: 0xd4, Х: 0xd5, Ц: 0xd6, Ч: 0xd7,
    Ш: 0xd8, Щ: 0xd9, Ъ: 0xda, Ы: 0xdb, Ь: 0xdc, Э: 0xdd, Ю: 0xde, Я: 0xdf,
    а: 0xe0, б: 0xe1, в: 0xe2, г: 0xe3, д: 0xe4, е: 0xe5, ж: 0xe6, з: 0xe7,
    и: 0xe8, й: 0xe9, к: 0xea, л: 0xeb, м: 0xec, н: 0xed, о: 0xee, п: 0xef,
    р: 0xf0, с: 0xf1, т: 0xf2, у: 0xf3, ф: 0xf4, х: 0xf5, ц: 0xf6, ч: 0xf7,
    ш: 0xf8, щ: 0xf9, ъ: 0xfa, ы: 0xfb, ь: 0xfc, э: 0xfd, ю: 0xfe, я: 0xff,
    Ё: 0xa8, ё: 0xb8,
  };
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (code < 0x80) {
      out[i] = code;
    } else if (cyrillicMap[ch] != null) {
      out[i] = cyrillicMap[ch];
    } else {
      throw new Error(`Unsupported char for cp1251 test fixture: ${ch}`);
    }
  }
  return out.buffer as ArrayBuffer;
}

describe('decodeBytes', () => {
  it('decodes UTF-8 with BOM, stripping the BOM bytes', () => {
    const bytes = buf(0xef, 0xbb, 0xbf, 0xd0, 0x9f, 0xd1, 0x80, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xb5, 0xd1, 0x82);
    expect(decodeBytes(bytes)).toBe('Привет');
  });

  it('decodes plain UTF-8 Cyrillic without BOM', () => {
    expect(decodeBytes(utf8('Привет, мир'))).toBe('Привет, мир');
  });

  it('decodes UTF-16 LE with BOM', () => {
    const bytes = buf(0xff, 0xfe, 0x1f, 0x04, 0x40, 0x04, 0x38, 0x04, 0x32, 0x04, 0x35, 0x04, 0x42, 0x04);
    expect(decodeBytes(bytes)).toBe('Привет');
  });

  it('decodes UTF-16 BE with BOM', () => {
    const bytes = buf(0xfe, 0xff, 0x04, 0x1f, 0x04, 0x40, 0x04, 0x38, 0x04, 0x32, 0x04, 0x35, 0x04, 0x42);
    expect(decodeBytes(bytes)).toBe('Привет');
  });

  it('falls back to Windows-1251 when strict UTF-8 fails', () => {
    expect(decodeBytes(cp1251('Привет, мир'))).toBe('Привет, мир');
  });

  it('returns ASCII unchanged via the UTF-8 path', () => {
    expect(decodeBytes(utf8('hello world'))).toBe('hello world');
  });

  it('handles empty input', () => {
    expect(decodeBytes(buf())).toBe('');
  });
});
