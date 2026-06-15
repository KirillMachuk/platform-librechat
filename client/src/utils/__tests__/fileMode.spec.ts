import { EToolResources } from 'librechat-data-provider';
import {
  isImageMimetype,
  resolveAutoFileMode,
  resolveFileToolResource,
  autoModeDisplayFromFile,
  type FileMode,
} from '../fileMode';

describe('isImageMimetype', () => {
  it('detects image mime types', () => {
    expect(isImageMimetype('image/png')).toBe(true);
    expect(isImageMimetype('image/jpeg')).toBe(true);
  });

  it('rejects non-image mime types', () => {
    expect(isImageMimetype('application/pdf')).toBe(false);
    expect(isImageMimetype('text/plain')).toBe(false);
  });
});

describe('resolveAutoFileMode', () => {
  it('sends images natively (undefined tool_resource)', () => {
    expect(resolveAutoFileMode({ mimetype: 'image/png', sizeBytes: 5_000_000 })).toBeUndefined();
  });

  it('uses whole-document text (context) for documents that fit the context window', () => {
    expect(
      resolveAutoFileMode({
        mimetype: 'application/pdf',
        sizeBytes: 100_000,
        modelMaxTokens: 200_000,
      }),
    ).toBe(EToolResources.context);
  });

  it('falls back to RAG (file_search) for documents too large for the context window', () => {
    expect(
      resolveAutoFileMode({
        mimetype: 'application/pdf',
        sizeBytes: 600_000,
        modelMaxTokens: 200_000,
      }),
    ).toBe(EToolResources.file_search);
  });

  it('uses a generous default threshold (~10MB) when the model context window is unknown', () => {
    // A typical contract-sized document stays in whole-document mode.
    expect(resolveAutoFileMode({ mimetype: 'application/pdf', sizeBytes: 2 * 1024 * 1024 })).toBe(
      EToolResources.context,
    );
    // Only genuinely large files fall back to RAG.
    expect(resolveAutoFileMode({ mimetype: 'application/pdf', sizeBytes: 11 * 1024 * 1024 })).toBe(
      EToolResources.file_search,
    );
  });

  it('scales the whole-document limit with the model context window', () => {
    const sizeBytes = 480_000;
    // Small context model -> too large -> RAG
    expect(resolveAutoFileMode({ mimetype: 'text/plain', sizeBytes, modelMaxTokens: 32_000 })).toBe(
      EToolResources.file_search,
    );
    // Large context model -> fits -> whole text
    expect(
      resolveAutoFileMode({ mimetype: 'text/plain', sizeBytes, modelMaxTokens: 1_000_000 }),
    ).toBe(EToolResources.context);
  });
});

describe('resolveFileToolResource', () => {
  const input = { mimetype: 'application/pdf', sizeBytes: 100_000, modelMaxTokens: 200_000 };

  it('defers to auto resolution for "auto" mode', () => {
    expect(resolveFileToolResource('auto', input)).toBe(EToolResources.context);
    expect(resolveFileToolResource('auto', { ...input, mimetype: 'image/png' })).toBeUndefined();
  });

  it('maps explicit modes to their tool_resource', () => {
    expect(resolveFileToolResource('text', input)).toBe(EToolResources.context);
    expect(resolveFileToolResource('search', input)).toBe(EToolResources.file_search);
    expect(resolveFileToolResource('native', input)).toBeUndefined();
  });

  it('covers every FileMode variant', () => {
    const modes: FileMode[] = ['auto', 'text', 'native', 'search'];
    for (const mode of modes) {
      expect(() => resolveFileToolResource(mode, input)).not.toThrow();
    }
  });

  it('always sends images natively, even when an explicit non-auto mode is active', () => {
    // The mode atom is conversation-global and persists after a document is
    // removed; a later image must never inherit `search`/`text` (the backend
    // rejects images for file_search).
    const image = { mimetype: 'image/png', sizeBytes: 50_000_000 };
    expect(resolveFileToolResource('search', image)).toBeUndefined();
    expect(resolveFileToolResource('text', image)).toBeUndefined();
    expect(resolveFileToolResource('native', image)).toBeUndefined();
    expect(resolveFileToolResource('auto', image)).toBeUndefined();
  });

  it('explicit overrides ignore size for documents (but not type)', () => {
    const bigDoc = { mimetype: 'application/pdf', sizeBytes: 50_000_000 };
    expect(resolveFileToolResource('text', bigDoc)).toBe(EToolResources.context);
    expect(resolveFileToolResource('native', bigDoc)).toBeUndefined();
  });
});

describe('autoModeDisplayFromFile', () => {
  it('returns null while the upload is still resolving (routing unknown)', () => {
    expect(autoModeDisplayFromFile({ progress: 0.5 })).toBeNull();
    expect(autoModeDisplayFromFile({ progress: 0.99, embedded: true })).toBeNull();
  });

  it('reports "search" for an embedded (RAG) document', () => {
    expect(autoModeDisplayFromFile({ progress: 1, embedded: true })).toBe('search');
  });

  it('reports "search" while a RAG document is still indexing (async embed)', () => {
    expect(autoModeDisplayFromFile({ progress: 1, embeddingStatus: 'pending' })).toBe('search');
    expect(autoModeDisplayFromFile({ progress: 1, embeddingStatus: 'processing' })).toBe('search');
  });

  it('reports "search" for a RAG document even when indexing failed (intent was search)', () => {
    expect(autoModeDisplayFromFile({ progress: 1, embeddingStatus: 'failed' })).toBe('search');
  });

  it('reports "text" for a full-text document with no embedding signals', () => {
    expect(autoModeDisplayFromFile({ progress: 1 })).toBe('text');
    expect(autoModeDisplayFromFile({ progress: 1, embedded: false })).toBe('text');
  });

  it('reflects the server truth, not a size guess: a doc routed to RAG shows "search"', () => {
    // A 300KB contract the client predicted as full text but the backend
    // auto-routed to file_search comes back embedded — the chip must not lie.
    expect(autoModeDisplayFromFile({ progress: 1, embedded: true })).toBe('search');
  });
});
