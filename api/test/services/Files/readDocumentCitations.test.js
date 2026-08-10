const { Tools } = require('librechat-data-provider');

/* The citation processor is REAL — that is the point of this file. Only the seams around it
 * are stubbed: the database it enriches sources from, and the permission check (covered by
 * its own tests). `openDocumentSource` comes through untouched, so the card asserted here is
 * the card the tool actually emits. */
jest.mock('~/models', () => ({
  getFiles: jest.fn().mockResolvedValue([]),
  getRoleByName: jest.fn(),
}));
jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return { ...actual, checkAccess: jest.fn().mockResolvedValue(true) };
});

const { openDocumentSource } = require('@librechat/api');
const { processFileCitations } = require('~/server/services/Files/Citations');

/* Defaults straight from the processor's own fallbacks — the thresholds a stand runs with
 * unless an operator overrides them. */
const appConfig = {
  endpoints: { agents: { maxCitations: 30, maxCitationsPerFile: 5, minRelevanceScore: 0.45 } },
  fileStrategy: 'local',
};
const metadata = { run_id: 'run-1', thread_id: 'conv-1' };
const user = { id: 'user-1' };

const readOf = (text) => ({ text, charStart: 0, charEnd: text.length, total: text.length });

const processRead = (source) =>
  processFileCitations({
    toolArtifact: { [Tools.file_search]: { sources: [source] } },
    toolCallId: 'call-1',
    metadata,
    user,
    appConfig,
  });

/**
 * The join between the two halves of "a read document appears in the sources": the tool builds
 * a card, this processor turns cards into the attachment the client renders. Asserting the two
 * separately leaves the seam untested — and the seam is where a read is quietly dropped, since
 * the processor filters on a relevance score a read does not naturally have.
 */
describe('a document read in full becomes a citation attachment', () => {
  it('survives the processor and comes out as a file_search attachment', async () => {
    const attachment = await processRead(
      openDocumentSource({
        fileId: 'file-1',
        fileName: 'Договор аренды.pdf',
        read: readOf('Договор аренды №312/24.'),
      }),
    );

    expect(attachment).toBeTruthy();
    expect(attachment.type).toBe(Tools.file_search);
    expect(attachment[Tools.file_search].sources).toHaveLength(1);
    expect(attachment[Tools.file_search].sources[0].fileId).toBe('file-1');
  });

  /* The processor drops every source scoring below `minRelevanceScore`. A read is not ranked,
   * so its score is assigned — and if that assignment ever falls under the live default, reads
   * vanish from the sources with nothing failing anywhere else. */
  it('is not dropped by the relevance filter a read never earned a score for', async () => {
    const attachment = await processRead(
      openDocumentSource({
        fileId: 'file-1',
        fileName: 'Договор аренды.pdf',
        read: readOf('Договор аренды №312/24.'),
      }),
    );

    expect(attachment).not.toBeNull();
  });

  /* A read has no page index, which is a shape the processor only ever sees from search hits
   * that DID match a page. Nothing about it may throw or blank the card. */
  it('keeps its name when it carries no page numbers', async () => {
    const attachment = await processRead(
      openDocumentSource({
        fileId: 'file-1',
        fileName: 'Договор аренды.pdf',
        read: readOf('Договор аренды №312/24.'),
      }),
    );

    const [source] = attachment[Tools.file_search].sources;
    expect(source.pages).toEqual([]);
    expect(source.fileName).toBe('Договор аренды.pdf');
  });
});
