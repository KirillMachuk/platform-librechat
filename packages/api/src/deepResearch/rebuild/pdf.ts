import vfs from 'pdfmake/build/vfs_fonts';
import { createPdf } from 'pdfmake/build/pdfmake';

import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * Renders the Deep Research final report (Markdown) into a plain, unstyled PDF the
 * user can download as a chat attachment (D4). Deliberately "без оформления": default
 * Roboto font (its vfs bundle carries Cyrillic — verified end-to-end), structural
 * heading sizes only, no branding/logo/color. Converts ONLY the Markdown subset our
 * report prompt (D1) emits — anything unrecognized degrades to a paragraph, and every
 * step is fail-soft so a malformed report never throws (the caller is also fail-open).
 */

const FONTS = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
};

/** A4 width (595pt) minus the 40pt page margins on each side. */
const CONTENT_WIDTH = 515;

/** Emoji/pictographs + variation selectors + ZWJ: Roboto has no glyphs for these, so
 *  they would render as .notdef boxes (e.g. the ⚠️ in the partial-report banner). */
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{200D}]/gu;

/** One inline formatting token: link, bold (`**`/`__`), italic (`*`/`_`), or code. */
const INLINE_TOKEN =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_|`([^`]+?)`/g;

interface InlineContext {
  bold: boolean;
  italics: boolean;
}

/** Parses inline Markdown into pdfmake text runs, recursing so emphasis nests
 *  (`**bold *italic* **`). Unmatched markers fall through as literal text. */
function parseInline(
  text: string,
  ctx: InlineContext = { bold: false, italics: false },
): Content[] {
  const runs: Content[] = [];
  const pushLiteral = (value: string) => {
    if (value.length > 0) {
      runs.push({ text: value, bold: ctx.bold, italics: ctx.italics });
    }
  };

  let cursor = 0;
  INLINE_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushLiteral(text.slice(cursor, index));
    }
    if (match[1] !== undefined) {
      runs.push({
        text: match[1],
        link: match[2],
        decoration: 'underline',
        bold: ctx.bold,
        italics: ctx.italics,
      });
    } else if (match[3] !== undefined || match[4] !== undefined) {
      runs.push(...parseInline(match[3] ?? match[4], { ...ctx, bold: true }));
    } else if (match[5] !== undefined || match[6] !== undefined) {
      runs.push(...parseInline(match[5] ?? match[6], { ...ctx, italics: true }));
    } else if (match[7] !== undefined) {
      runs.push({ text: match[7], bold: ctx.bold, italics: ctx.italics });
    }
    cursor = index + match[0].length;
  }
  pushLiteral(text.slice(cursor));
  return runs.length > 0 ? runs : [{ text: '', bold: ctx.bold, italics: ctx.italics }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const UNORDERED = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BLOCKQUOTE = /^\s*>\s?(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DELIMITER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const HEADING_STYLE = ['h1', 'h2', 'h3', 'h3', 'h3', 'h3'] as const;

/** Splits a `| a | b |` row into trimmed cell strings (outer pipes dropped). */
function splitTableRow(line: string): string[] {
  const inner = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|\s*$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

/** pdfmake throws on ragged tables, so every body row is padded/truncated to the
 *  header column count. */
function buildTable(headerCells: string[], bodyRows: string[][]): Content {
  const columns = headerCells.length;
  const normalize = (cells: string[]): string[] => {
    const copy = cells.slice(0, columns);
    while (copy.length < columns) {
      copy.push('');
    }
    return copy;
  };
  const header: TableCell[] = headerCells.map((cell) => ({ text: parseInline(cell), bold: true }));
  const body: TableCell[][] = bodyRows.map((row) =>
    normalize(row).map((cell) => ({ text: parseInline(cell) })),
  );
  return {
    table: {
      headerRows: 1,
      widths: new Array(columns).fill('*'),
      body: [header, ...body],
    },
    margin: [0, 4, 0, 8],
  };
}

/** Converts the report Markdown into a pdfmake document definition (block-level). */
export function reportToDocDefinition(markdown: string): TDocumentDefinitions {
  const cleaned = (markdown ?? '').replace(PICTOGRAPH, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n');
  const content: Content[] = [];

  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      content.push({ text: parseInline(paragraph.join(' ')), margin: [0, 0, 0, 6] });
      paragraph = [];
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      content.push({ text: parseInline(heading[2].trim()), style: HEADING_STYLE[level - 1] });
      index += 1;
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      content.push({
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.5 }],
        margin: [0, 6, 0, 10],
      });
      index += 1;
      continue;
    }

    if (
      TABLE_ROW.test(line) &&
      index + 1 < lines.length &&
      TABLE_DELIMITER.test(lines[index + 1])
    ) {
      flushParagraph();
      const headerCells = splitTableRow(line);
      const bodyRows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        bodyRows.push(splitTableRow(lines[index]));
        index += 1;
      }
      content.push(buildTable(headerCells, bodyRows));
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      flushParagraph();
      const quote: string[] = [];
      while (index < lines.length && BLOCKQUOTE.test(lines[index])) {
        quote.push((BLOCKQUOTE.exec(lines[index]) as RegExpExecArray)[1]);
        index += 1;
      }
      content.push({
        text: parseInline(quote.join(' ').trim()),
        italics: true,
        margin: [12, 4, 0, 8],
      });
      continue;
    }

    if (UNORDERED.test(line) || ORDERED.test(line)) {
      flushParagraph();
      const ordered = ORDERED.test(line) && !UNORDERED.test(line);
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: Content[] = [];
      while (index < lines.length && pattern.test(lines[index])) {
        const item = (pattern.exec(lines[index]) as RegExpExecArray)[1];
        items.push({ text: parseInline(item.trim()) });
        index += 1;
      }
      content.push(
        ordered ? { ol: items, margin: [0, 0, 0, 6] } : { ul: items, margin: [0, 0, 0, 6] },
      );
      continue;
    }

    paragraph.push(line.trim());
    index += 1;
  }
  flushParagraph();

  if (content.length === 0) {
    content.push({ text: '' });
  }

  return {
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25 },
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 10, 0, 6] },
      h2: { fontSize: 15, bold: true, margin: [0, 8, 0, 4] },
      h3: { fontSize: 13, bold: true, margin: [0, 6, 0, 3] },
    },
    pageMargins: [40, 40, 40, 40],
  };
}

/** Hang guard for the PDF engine: `getBuffer` is callback-based with no failure contract,
 *  so a renderer hang would otherwise freeze the run's finalization forever (and leak a
 *  concurrency-cap slot). Rejecting lets the caller's fail-open path ship the report
 *  without a file. */
const PDF_RENDER_TIMEOUT_MS = 15_000;

/** Renders the report Markdown to a PDF Buffer. `getBuffer` yields a Uint8Array, so it
 *  is wrapped for the file-storage layer (which expects a Node Buffer). */
export function reportToPdfBuffer(
  markdown: string,
  timeoutMs = PDF_RENDER_TIMEOUT_MS,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`PDF render timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    try {
      createPdf(reportToDocDefinition(markdown), undefined, FONTS, vfs).getBuffer((result) => {
        clearTimeout(timer);
        resolve(Buffer.from(result));
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
