import type { ServerRequest } from '~/types';
import {
  openDocumentSlice,
  OPEN_DOCUMENT_SLICE_TOKENS,
  resolveOpenDocumentTokenLimit,
} from './open';

describe('openDocumentSlice', () => {
  /** Deterministic stand-in for the real tokenizer: 4 characters per token. */
  const tokenCountFn = (text: string) => Math.ceil(text.length / 4);

  const makeText = (length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(97 + (i % 26))).join('');

  const readRange = (output: string) => {
    const match = output.match(/characters (\d+)-(\d+) of (\d+)/);
    if (!match) {
      throw new Error(`no character range in output: ${output.slice(0, 120)}`);
    }
    return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
  };

  it('returns the whole document in one call when it fits the budget', async () => {
    const text = 'Договор аренды №14/7 от 2026-03-01. Арендодатель: ООО «Ромашка».';

    const output = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Договор.pdf',
      text,
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(output).toContain('Договор.pdf');
    expect(output).toContain('(end of document)');
    expect(output).toContain(text);
    expect(output).not.toContain('Truncated');
  });

  /* The whole point of `offset`: a long contract must come back across several calls
   * with no character dropped between them and none read twice. Anything else and a
   * clause on the boundary silently disappears from the model's view of the document. */
  it('reads a long document across calls with no gap and no overlap', async () => {
    const text = makeText(4000);
    const tokenLimit = 100;
    let offset = 0;
    let reassembled = '';
    let calls = 0;

    for (;;) {
      const output = await openDocumentSlice({
        documentId: 'file-1',
        filename: 'Долгий.txt',
        text,
        offset,
        tokenLimit,
        tokenCountFn,
      });
      const range = readRange(output);
      calls++;

      expect(range.total).toBe(text.length);
      expect(range.start).toBe(offset + 1);
      expect(output).toContain(text.slice(range.start - 1, range.end));

      reassembled += text.slice(range.start - 1, range.end);
      offset = range.end;

      if (output.includes('(end of document)')) {
        break;
      }
      expect(output).toContain(`offset ${range.end}`);
      expect(calls).toBeLessThan(50);
    }

    expect(calls).toBeGreaterThan(1);
    expect(reassembled).toBe(text);
  });

  it('reports how much is left so the model can decide whether to keep reading', async () => {
    const text = makeText(4000);

    const output = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Долгий.txt',
      tokenLimit: 100,
      text,
      tokenCountFn,
    });

    const { end } = readRange(output);
    expect(output).toContain(`${text.length - end} characters remain`);
    expect(output).toContain('document_id "file-1"');
  });

  it('tells the model the document is finished when offset is past the end', async () => {
    const text = makeText(100);

    const output = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Короткий.txt',
      text,
      offset: 100,
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(output).toContain('already been read in full');
  });

  it('clamps a negative or malformed offset to the start of the document', async () => {
    const text = makeText(200);

    for (const offset of [-50, Number.NaN]) {
      const output = await openDocumentSlice({
        documentId: 'file-1',
        filename: 'Короткий.txt',
        text,
        offset,
        tokenLimit: 8000,
        tokenCountFn,
      });
      expect(readRange(output).start).toBe(1);
    }
  });

  /* Files uploaded before the library stored full text: the honest answer is "re-upload",
   * never a silent empty read the model would report as "the document is blank". */
  it('asks for a re-upload when the document has no stored text', async () => {
    const output = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Старый.pdf',
      text: '',
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(output).toContain('re-upload');
  });

  /* A budget too small to yield any text would otherwise return the same offset forever. */
  it('refuses to return an empty slice instead of looping on the same offset', async () => {
    const output = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Долгий.txt',
      text: makeText(4000),
      tokenLimit: 0.0001,
      tokenCountFn,
    });

    expect(output).toContain('too small');
  });
});

describe('resolveOpenDocumentTokenLimit', () => {
  const makeReq = (body?: Record<string, number>) =>
    ({ body: body ?? {}, config: {} }) as unknown as ServerRequest;

  it('defaults to the per-call slice budget', () => {
    expect(resolveOpenDocumentTokenLimit(makeReq())).toBe(OPEN_DOCUMENT_SLICE_TOKENS);
  });

  it('never exceeds the slice budget even when the file budget is far larger', () => {
    expect(resolveOpenDocumentTokenLimit(makeReq({ fileTokenLimit: 100000 }))).toBe(
      OPEN_DOCUMENT_SLICE_TOKENS,
    );
  });

  /* One knob: lowering the attachment budget lowers what a tool result may return too. */
  it('honours a file token limit lower than the slice budget', () => {
    expect(resolveOpenDocumentTokenLimit(makeReq({ fileTokenLimit: 1500 }))).toBe(1500);
  });

  it('falls back to the slice budget when no limit is configured', () => {
    expect(resolveOpenDocumentTokenLimit(undefined)).toBe(OPEN_DOCUMENT_SLICE_TOKENS);
  });
});
