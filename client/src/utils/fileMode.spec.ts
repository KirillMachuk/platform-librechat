import { autoModeDisplayFromFile, resolveFileToolResource } from './fileMode';
import { EToolResources } from 'librechat-data-provider';

describe('autoModeDisplayFromFile', () => {
  it('returns null while the file is still uploading', () => {
    expect(autoModeDisplayFromFile({ progress: 0.4 })).toBeNull();
  });

  /* Full-text documents are also embedded — for the cross-chat library, not for
   * retrieval in this chat. The chip must not claim "search" for them: it did,
   * and the false label sent both the owner and the debugging down a wrong path
   * (prod, 26.07). */
  it('shows a library-scoped (full-text) document as text, not search', () => {
    expect(autoModeDisplayFromFile({ embedded: true, embeddingScope: 'library' })).toBe('text');
    expect(autoModeDisplayFromFile({ embeddingStatus: 'ready', embeddingScope: 'library' })).toBe(
      'text',
    );
  });

  it('shows a chat-scoped embedded document as search', () => {
    expect(autoModeDisplayFromFile({ embedded: true })).toBe('search');
    expect(autoModeDisplayFromFile({ embeddingStatus: 'pending' })).toBe('search');
    expect(autoModeDisplayFromFile({ embedded: true, embeddingScope: 'chat' })).toBe('search');
  });

  it('shows a plain text-mode document as text', () => {
    expect(autoModeDisplayFromFile({})).toBe('text');
  });
});

describe('resolveFileToolResource', () => {
  const doc = { mimetype: 'application/pdf', sizeBytes: 1024 };

  it('maps the explicit search mode to file_search', () => {
    expect(resolveFileToolResource('search', doc)).toBe(EToolResources.file_search);
  });

  it('maps the explicit text mode to context', () => {
    expect(resolveFileToolResource('text', doc)).toBe(EToolResources.context);
  });

  it('sends images natively regardless of mode', () => {
    const image = { mimetype: 'image/png', sizeBytes: 1024 };
    expect(resolveFileToolResource('search', image)).toBeUndefined();
    expect(resolveFileToolResource('text', image)).toBeUndefined();
  });
});
