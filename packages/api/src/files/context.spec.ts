import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import { extractFileContext } from './context';

describe('extractFileContext', () => {
  const tokenCountFn = (text: string) => Math.ceil(text.length / 4);

  const makeReq = () =>
    ({
      body: { fileTokenLimit: 10000 },
      config: {},
    }) as unknown as ServerRequest;

  const makeFile = (overrides: Partial<IMongoFile>): IMongoFile =>
    ({
      file_id: 'file-1',
      filename: 'doc.pdf',
      type: 'application/pdf',
      bytes: 1024,
      ...overrides,
    }) as unknown as IMongoFile;

  /* Context files retain their original upload (source `local`/s3) while
   * `text` holds the extracted content the model reads. The gate must be
   * the presence of `text`, not `source === 'text'` — gating on source
   * silently dropped every retained-original context file from the prompt. */
  it('includes files with extracted text regardless of storage source', async () => {
    const file = makeFile({
      filename: 'КП.pdf',
      source: 'local',
      filepath: '/uploads/u/КП.pdf',
      text: 'extracted commercial proposal',
    } as Partial<IMongoFile>);

    const result = await extractFileContext({ attachments: [file], req: makeReq(), tokenCountFn });

    expect(result).toContain('КП.pdf');
    expect(result).toContain('extracted commercial proposal');
  });

  it('includes legacy text-source files (no stored original)', async () => {
    const file = makeFile({
      filename: 'legacy.csv',
      source: 'text',
      text: 'legacy extract',
    } as Partial<IMongoFile>);

    const result = await extractFileContext({ attachments: [file], req: makeReq(), tokenCountFn });

    expect(result).toContain('legacy extract');
  });

  it('skips files without extracted text (plain document attachments)', async () => {
    const file = makeFile({
      source: 'local',
      filepath: '/uploads/u/raw.pdf',
    } as Partial<IMongoFile>);

    const result = await extractFileContext({ attachments: [file], req: makeReq(), tokenCountFn });

    expect(result).toBeUndefined();
  });
});
