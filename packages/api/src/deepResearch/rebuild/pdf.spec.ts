import type { Content, ContentText, ContentTable } from 'pdfmake/interfaces';
import { reportToDocDefinition, reportToPdfBuffer } from './pdf';

/** The converter always returns an array; narrow once for readable assertions. */
function blocks(markdown: string): Content[] {
  return reportToDocDefinition(markdown).content as Content[];
}

describe('reportToDocDefinition (Markdown → pdfmake doc)', () => {
  it('maps #/##/### to h1/h2/h3 styles', () => {
    const content = blocks('# Заголовок\n\n## Раздел\n\n### Подраздел');
    expect(content.map((c) => (c as ContentText).style)).toEqual(['h1', 'h2', 'h3']);
  });

  it('parses a pipe table, marks the header bold, and normalizes ragged rows', () => {
    const md = [
      '| Критерий | Битрикс24 | AmoCRM |',
      '| --- | --- | --- |',
      '| Цена | бесплатно | 599 руб. |',
      '| Язык | русский |',
    ].join('\n');
    const table = blocks(md).find((c) => (c as ContentTable).table) as ContentTable;
    expect(table).toBeDefined();
    expect(table.table.widths).toEqual(['*', '*', '*']);
    expect(table.table.body).toHaveLength(3);
    for (const row of table.table.body) {
      expect(row).toHaveLength(3);
    }
    expect((table.table.body[0][0] as ContentText).bold).toBe(true);
    expect((table.table.body[2][2] as ContentText).text).toEqual([
      { text: '', bold: false, italics: false },
    ]);
  });

  it('parses bold, italic, inline code and links into runs', () => {
    const runs = (
      blocks('Это **жирный**, *курсив*, `код` и [сайт](https://vc.ru).')[0] as ContentText
    ).text as ContentText[];
    expect(runs.some((r) => r.bold && r.text === 'жирный')).toBe(true);
    expect(runs.some((r) => r.italics && r.text === 'курсив')).toBe(true);
    expect(runs.some((r) => r.text === 'код')).toBe(true);
    const link = runs.find((r) => r.link);
    expect(link?.link).toBe('https://vc.ru');
    expect(link?.text).toBe('сайт');
  });

  it('nests emphasis: bold containing italic yields a run that is both', () => {
    const runs = (blocks('**жирный и *ещё курсив* внутри**')[0] as ContentText)
      .text as ContentText[];
    expect(runs.some((r) => r.bold && r.italics)).toBe(true);
  });

  it('renders unordered and ordered lists', () => {
    const ul = blocks('- раз\n- два\n- три')[0] as { ul?: Content[] };
    expect(ul.ul).toHaveLength(3);
    const ol = blocks('1. первый\n2. второй')[0] as { ol?: Content[] };
    expect(ol.ol).toHaveLength(2);
  });

  it('renders a blockquote as italic text', () => {
    const quote = blocks('> Оценки экспертов расходятся.')[0] as ContentText;
    expect(quote.italics).toBe(true);
    expect((quote.text as ContentText[])[0].text).toContain('Оценки экспертов');
  });

  it('renders a horizontal rule as a canvas line', () => {
    const content = blocks('текст\n\n---\n\nещё текст');
    expect(content.some((c) => Array.isArray((c as { canvas?: unknown[] }).canvas))).toBe(true);
  });

  it('strips emoji/pictographs so the font never renders tofu boxes', () => {
    const runs = (blocks('> ⚠️ Внимание ✅ готово 🚀')[0] as ContentText).text as ContentText[];
    const text = runs.map((r) => r.text).join('');
    expect(text).not.toContain('⚠');
    expect(text).not.toContain('✅');
    expect(text).not.toContain('🚀');
    expect(text).not.toContain(String.fromCharCode(0xfe0f));
    expect(text).toContain('Внимание');
    expect(text).toContain('готово');
  });

  it('never throws and always yields non-empty content on empty/garbage input', () => {
    expect(blocks('').length).toBeGreaterThan(0);
    expect(blocks('   \n\n   ').length).toBeGreaterThan(0);
    expect(() => reportToDocDefinition('| broken | table\nбез разделителя строк')).not.toThrow();
  });

  it('always sets the Cyrillic-capable Roboto default font', () => {
    expect(reportToDocDefinition('привет').defaultStyle?.font).toBe('Roboto');
  });

  it('normalizes NBSP-glued numbers so table columns can wrap instead of overflowing', () => {
    const nb = String.fromCharCode(0x00a0);
    const nnb = String.fromCharCode(0x202f);
    const runs = (blocks(`Тариф от 389${nb}₽/мес. за сотр. 1${nnb}945`)[0] as ContentText)
      .text as ContentText[];
    const text = runs.map((r) => r.text).join('');
    expect(text).toContain('389 ₽/мес.');
    expect(text).toContain('1 945');
    expect(text).not.toContain(nb);
    expect(text).not.toContain(nnb);
  });

  it('replaces glyphs missing from the vfs Roboto (arrows, minus) with ASCII fallbacks', () => {
    const runs = (blocks(`CRM → Аналитика, ${String.fromCharCode(0x2212)}5 %`)[0] as ContentText)
      .text as ContentText[];
    const text = runs.map((r) => r.text).join('');
    expect(text).toContain('CRM -> Аналитика');
    expect(text).toContain('-5 %');
    expect(text).not.toContain('→');
  });

  it('inserts soft break points into over-long tokens (long URLs never push past the edge)', () => {
    const url = 'https://it-federation.ru/amocrm/amocrm/polnoe-sravnenie-tarifov-amocrm.html';
    const runs = (blocks(`Источник: ${url}`)[0] as ContentText).text as ContentText[];
    const text = runs.map((r) => r.text).join('');
    const zwsp = String.fromCharCode(0x200b);
    expect(text).toContain(zwsp);
    expect(text.split(zwsp).join('')).toContain(url);
  });

  it('renders comparison tables at a compact font size', () => {
    const md = '| А | Б |\n| --- | --- |\n| 1 | 2 |';
    const table = blocks(md).find((c) => (c as ContentTable).table) as ContentTable & {
      fontSize?: number;
    };
    expect(table.fontSize).toBe(9);
  });

  it('embeds the report title as PDF metadata when provided', () => {
    const doc = reportToDocDefinition('# Отчёт', { title: 'Сравнение CRM' });
    expect(doc.info?.title).toBe('Сравнение CRM');
    expect(reportToDocDefinition('# Отчёт').info).toBeUndefined();
  });
});

describe('reportToPdfBuffer', () => {
  it('produces a valid, non-trivial PDF Buffer for a Cyrillic report with a table', async () => {
    const md = [
      '# Отчёт по CRM',
      '',
      '## Ключевые выводы',
      '- Битрикс24 — универсальная платформа',
      '',
      '| Критерий | Битрикс24 | AmoCRM |',
      '| --- | --- | --- |',
      '| Цена | бесплатно | 599 руб. |',
      '',
      '## Рекомендация',
      'Рекомендуемая система — **Битрикс24**.',
    ].join('\n');
    const buffer = await reportToPdfBuffer(md);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Embedded font subset + content → the buffer is substantial, not an empty shell.
    expect(buffer.length).toBeGreaterThan(3000);
  });

  it('resolves (never rejects) on empty input', async () => {
    const buffer = await reportToPdfBuffer('');
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejects when the PDF engine hangs (timeout guard) instead of freezing the run', async () => {
    jest.resetModules();
    jest.doMock('pdfmake/build/pdfmake', () => ({
      createPdf: () => ({ getBuffer: () => undefined }),
    }));
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const hanging = require('./pdf') as typeof import('./pdf');
      await expect(hanging.reportToPdfBuffer('# зависание', { timeoutMs: 25 })).rejects.toThrow(
        /timed out/,
      );
    } finally {
      jest.dontMock('pdfmake/build/pdfmake');
      jest.resetModules();
    }
  });
});
