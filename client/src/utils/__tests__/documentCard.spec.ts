import type { TDocMetadata } from 'librechat-data-provider';
import { buildDocumentCard } from '../documentCard';

const meta = (over: Partial<TDocMetadata> = {}): TDocMetadata => ({
  docType: 'договор',
  parties: ['ООО «Ромашка»'],
  primaryDate: '2024-01-15',
  identifiers: [],
  columns: [],
  ...over,
});

/**
 * The line under a filename in the Files list. Its whole job is to answer "what IS this" for a
 * document whose name does not say — so every case here is about not answering it wrongly:
 * a card that states a fact the extractor never established is worse than no card at all.
 */
describe('buildDocumentCard', () => {
  it('says what the document is, who it is with and when it was drawn up', () => {
    const card = buildDocumentCard(meta());

    expect(card).toContain('Договор');
    expect(card).toContain('ООО «Ромашка»');
    expect(card).toContain('2024');
  });

  /* No metadata means "not established" — for legacy uploads, for a scan whose header could not
   * be read, for anything never indexed. An empty card leaves the filename alone; an invented
   * one would be read as fact. */
  it('shows nothing when nothing was extracted', () => {
    expect(buildDocumentCard(undefined)).toBe('');
  });

  /* "иное" is the extractor's word for "could not tell", not a kind of document. Printing it
   * tells the reader nothing they did not already see on the row. */
  it('does not present "unknown kind" as a kind', () => {
    expect(buildDocumentCard(meta({ docType: 'иное', parties: [], primaryDate: null }))).toBe('');
  });

  it('keeps the parts that exist when others are missing', () => {
    const card = buildDocumentCard(meta({ parties: [], primaryDate: null }));

    expect(card).toBe('Договор');
  });

  it('names the counterparties of a document with no kind and no date', () => {
    const card = buildDocumentCard(
      meta({ docType: 'иное', parties: ['ООО «Ромашка»'], primaryDate: null }),
    );

    expect(card).toBe('ООО «Ромашка»');
  });

  /* A table lists its 140 clients as parties; the row is a line, not a list. Two names identify
   * a contract, and the cut keeps the date on screen. */
  it('cuts a long list of counterparties instead of pushing the date off the row', () => {
    const card = buildDocumentCard(
      meta({ parties: ['Альфа', 'Бета', 'Гамма', 'Дельта'], primaryDate: null }),
    );

    expect(card).toBe('Договор · Альфа, Бета');
  });

  /* The date comes from the document's header as free text, so an unparseable value is a real
   * case. Showing it raw next to formatted dates reads as a different kind of fact. */
  it('drops a date it cannot read rather than printing it raw', () => {
    const card = buildDocumentCard(meta({ parties: [], primaryDate: 'без даты' }));

    expect(card).toBe('Договор');
  });

  it('ignores blank counterparties left by extraction', () => {
    const card = buildDocumentCard(meta({ parties: ['  ', ''], primaryDate: null }));

    expect(card).toBe('Договор');
  });
});
