import { selectChatFileSearchInputs } from './files';

describe('selectChatFileSearchInputs (bug ② — chat-only file_search)', () => {
  it('maps embedded files to file_search inputs', () => {
    expect(
      selectChatFileSearchInputs([{ file_id: 'f1', filename: 'договор.pdf', embedEntityId: 'e1' }]),
    ).toEqual([{ file_id: 'f1', filename: 'договор.pdf', entity_id: 'e1' }]);
  });

  it('prefers embedEntityId, falls back to project_id, then undefined', () => {
    const result = selectChatFileSearchInputs([
      { file_id: 'a', filename: 'a.pdf', embedEntityId: 'ent', project_id: 'proj' },
      { file_id: 'b', filename: 'b.pdf', project_id: 'proj' },
      { file_id: 'c', filename: 'c.pdf' },
    ]);
    expect(result.map((r) => r.entity_id)).toEqual(['ent', 'proj', undefined]);
  });

  it('skips records without a file_id and defaults a missing filename', () => {
    expect(selectChatFileSearchInputs([{ filename: 'orphan.pdf' }, { file_id: 'x' }])).toEqual([
      { file_id: 'x', filename: 'x', entity_id: undefined },
    ]);
  });

  it('returns an empty list for no files', () => {
    expect(selectChatFileSearchInputs([])).toEqual([]);
  });
});
