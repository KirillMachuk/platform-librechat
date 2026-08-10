import type { ServerRequest } from '~/types';
import {
  openDocumentSlice,
  openDocumentSource,
  OPEN_DOCUMENT_SLICE_TOKENS,
  OPEN_DOCUMENT_EXCERPT_CHARS,
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

    const { content, read } = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Договор.pdf',
      text,
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(content).toContain('Договор.pdf');
    expect(content).toContain('(end of document)');
    expect(content).toContain(text);
    expect(content).not.toContain('Truncated');
    expect(read).toEqual({ text, charStart: 0, charEnd: text.length, total: text.length });
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
      const { content, read } = await openDocumentSlice({
        documentId: 'file-1',
        filename: 'Долгий.txt',
        text,
        offset,
        tokenLimit,
        tokenCountFn,
      });
      const range = readRange(content);
      calls++;

      expect(range.total).toBe(text.length);
      expect(range.start).toBe(offset + 1);
      expect(content).toContain(text.slice(range.start - 1, range.end));
      /* The reported range and the machine-readable one describe the same read — the source
       * card is built from the second, so a drift between them would credit the wrong span. */
      expect(read).toEqual({
        text: text.slice(range.start - 1, range.end),
        charStart: range.start - 1,
        charEnd: range.end,
        total: text.length,
      });

      reassembled += text.slice(range.start - 1, range.end);
      offset = range.end;

      if (content.includes('(end of document)')) {
        break;
      }
      expect(content).toContain(`offset ${range.end}`);
      expect(calls).toBeLessThan(50);
    }

    expect(calls).toBeGreaterThan(1);
    expect(reassembled).toBe(text);
  });

  it('reports how much is left so the model can decide whether to keep reading', async () => {
    const text = makeText(4000);

    const { content } = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Долгий.txt',
      tokenLimit: 100,
      text,
      tokenCountFn,
    });

    const { end } = readRange(content);
    expect(content).toContain(`${text.length - end} characters remain`);
    expect(content).toContain('document_id "file-1"');
  });

  it('tells the model the document is finished when offset is past the end', async () => {
    const text = makeText(100);

    const { content, read } = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Короткий.txt',
      text,
      offset: 100,
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(content).toContain('already been read in full');
    /* Nothing was read, so nothing may be credited as read: this call must not spend the
     * turn's read budget nor put the document in the answer's source list. */
    expect(read).toBeUndefined();
  });

  it('clamps a negative or malformed offset to the start of the document', async () => {
    const text = makeText(200);

    for (const offset of [-50, Number.NaN]) {
      const { content, read } = await openDocumentSlice({
        documentId: 'file-1',
        filename: 'Короткий.txt',
        text,
        offset,
        tokenLimit: 8000,
        tokenCountFn,
      });
      expect(readRange(content).start).toBe(1);
      expect(read?.charStart).toBe(0);
    }
  });

  /* Files uploaded before the library stored full text: the honest answer is "re-upload",
   * never a silent empty read the model would report as "the document is blank". */
  it('asks for a re-upload when the document has no stored text', async () => {
    const { content, read } = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Старый.pdf',
      text: '',
      tokenLimit: 8000,
      tokenCountFn,
    });

    expect(content).toContain('re-upload');
    expect(read).toBeUndefined();
  });

  /* A budget too small to yield any text would otherwise return the same offset forever. */
  it('refuses to return an empty slice instead of looping on the same offset', async () => {
    const { content, read } = await openDocumentSlice({
      documentId: 'file-1',
      filename: 'Долгий.txt',
      text: makeText(4000),
      tokenLimit: 0.0001,
      tokenCountFn,
    });

    expect(content).toContain('too small');
    expect(read).toBeUndefined();
  });
});

describe('openDocumentSource', () => {
  const read = { text: 'Договор аренды №14/7', charStart: 0, charEnd: 20, total: 20 };

  it('describes the read document the same way a found one is described', () => {
    const source = openDocumentSource({ fileId: 'file-1', fileName: 'Договор.pdf', read });

    expect(source).toMatchObject({
      type: 'file',
      fileId: 'file-1',
      fileName: 'Договор.pdf',
      content: read.text,
    });
  });

  /* The citation processor drops any source below `minRelevanceScore` (0.45 by default).
   * A read that scored itself out of its own source list is exactly the failure this
   * feature exists to prevent, so the floor is asserted, not assumed. */
  it('clears the citation relevance floor', () => {
    const source = openDocumentSource({ fileId: 'file-1', fileName: 'Договор.pdf', read });

    expect(source.relevance).toBeGreaterThanOrEqual(0.45);
  });

  /* Reading works on stored text, which carries no page index. An invented page number
   * would point the user at the wrong part of their own contract. */
  it('claims no pages, because a full-text read has none', () => {
    const source = openDocumentSource({ fileId: 'file-1', fileName: 'Договор.pdf', read });

    expect(source.pages).toEqual([]);
    expect(source.pageRelevance).toEqual({});
  });

  /* The panel shows the filename, not the text: carrying the whole slice would add tens of
   * KB per read to the stored attachment and the stream for nothing on screen. */
  it('keeps only a short excerpt of a long read', () => {
    const long = 'я'.repeat(5000);
    const source = openDocumentSource({
      fileId: 'file-1',
      fileName: 'Долгий.txt',
      read: { text: long, charStart: 0, charEnd: long.length, total: long.length },
    });

    expect(source.content).toHaveLength(OPEN_DOCUMENT_EXCERPT_CHARS);
    expect(long.startsWith(source.content)).toBe(true);
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
