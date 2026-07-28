import { buildSearchResultUrl } from '../url';
import type { SearchItem } from '../types';

/**
 * Search results used to hardcode `/c/<id>`, in two separate copies — one for the
 * mouse click, one for Enter. A chat that belongs to a project lives at
 * `/projects/<pid>/c/<id>`, so both copies opened the project-less URL and the
 * app had to redirect to repair it.
 */

const item = (over: Partial<SearchItem> = {}): SearchItem => ({
  id: 'x',
  conversationId: 'convo-1',
  title: 'Договор аренды',
  ...over,
});

describe('buildSearchResultUrl', () => {
  it('keeps a chat inside its project', () => {
    expect(buildSearchResultUrl(item({ projectId: 'proj-1' }))).toBe('/projects/proj-1/c/convo-1');
  });

  it('uses the plain path when there is no project', () => {
    expect(buildSearchResultUrl(item())).toBe('/c/convo-1');
  });

  it('deep-links to the matched message, project or not', () => {
    expect(buildSearchResultUrl(item({ messageId: 'msg-9' }))).toBe('/c/convo-1#msg=msg-9');
    expect(buildSearchResultUrl(item({ projectId: 'proj-1', messageId: 'msg-9' }))).toBe(
      '/projects/proj-1/c/convo-1#msg=msg-9',
    );
  });

  it('encodes ids so an odd conversation id cannot break the path', () => {
    const url = buildSearchResultUrl(item({ conversationId: 'a b/c', projectId: 'p/1' }));
    expect(url).toBe('/projects/p%2F1/c/a%20b%2Fc');
  });
});
