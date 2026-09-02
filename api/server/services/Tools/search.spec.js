jest.mock('@librechat/api', () => ({
  GenerationJobManager: { emitChunk: jest.fn() },
  prefetchFavicons: jest.fn(),
}));

const { prefetchFavicons } = require('@librechat/api');
const { createOnSearchResults } = require('./search');

/**
 * The seam this pins: the server learns which sites a search turned up strictly
 * before the browser does, and hands them straight to the icon cache. If this
 * call is ever dropped or handed the wrong collection, nothing breaks and nothing
 * says so — every icon still arrives, just as slowly as before the cache existed.
 */
describe('onSearchResults hands the source domains to the icon cache', () => {
  const runnableConfig = {
    metadata: { user_id: 'u1', thread_id: 't1', run_id: 'r1' },
    toolCall: { id: 'call_1', name: 'web_search', turn: 0 },
  };

  const results = (data) => ({ success: true, data: { organic: [], topStories: [], ...data } });
  const sent = () => [...prefetchFavicons.mock.calls[0][0]];

  beforeEach(() => jest.clearAllMocks());

  it('passes every source link, organic and top stories alike', () => {
    const { onSearchResults } = createOnSearchResults({ headersSent: true, write: jest.fn() });

    onSearchResults(
      results({
        organic: [{ link: 'https://www.example.com/a' }, { link: 'https://other.example/b' }],
        topStories: [{ link: 'https://news.example/c' }],
      }),
      runnableConfig,
    );

    expect(prefetchFavicons).toHaveBeenCalledTimes(1);
    expect(sent().sort()).toEqual([
      'https://news.example/c',
      'https://other.example/b',
      'https://www.example.com/a',
    ]);
  });

  it('warms the icons on the path that only returns the attachment, too', () => {
    /* Whether the sources are streamed or returned depends on whether headers are
     * already out; the reader sees them either way. */
    const { onSearchResults } = createOnSearchResults({ headersSent: false, write: jest.fn() });

    const attachment = onSearchResults(
      results({ organic: [{ link: 'https://example.com/a' }] }),
      runnableConfig,
    );

    expect(attachment).toBeDefined();
    expect(sent()).toEqual(['https://example.com/a']);
  });

  it('asks for nothing when the search itself failed', () => {
    const { onSearchResults } = createOnSearchResults({ headersSent: true, write: jest.fn() });

    onSearchResults({ success: false, error: 'upstream down' }, runnableConfig);

    expect(prefetchFavicons).not.toHaveBeenCalled();
  });

  it('still streams the sources when warming the icons throws', () => {
    /* The icons are a garnish on this path. A fault in them must never cost the
     * reader the sources themselves. */
    prefetchFavicons.mockImplementation(() => {
      throw new Error('cache exploded');
    });
    const write = jest.fn();
    const { onSearchResults } = createOnSearchResults({ headersSent: true, write });

    expect(() =>
      onSearchResults(results({ organic: [{ link: 'https://example.com/a' }] }), runnableConfig),
    ).not.toThrow();
    expect(write).toHaveBeenCalled();
  });
});
