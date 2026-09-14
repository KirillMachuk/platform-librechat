import { ContentTypes } from 'librechat-data-provider';
import { hasNoAbortContent, hasPersistableAbortContent } from '../abortContent';

/**
 * Two questions the abort path asks of a stopped run's content, and they are not
 * the same question. «Is there something to persist?» strips OAuth prompts. «Did the
 * run produce nothing at all?» must NOT count an OAuth-only abort as nothing: that
 * abort is the coalesced-connection replay contract and keeps its response id, while
 * a Stop before the first token leaves no answer behind (the owner's 14.09 report:
 * an empty turn with the whole action row under it).
 */
const oauthPrompt = {
  type: ContentTypes.TOOL_CALL,
  tool_call: { id: 'oauth-1', name: 'oauth_mcp_Google', args: '', auth: 'https://auth.example' },
};

describe('hasNoAbortContent', () => {
  it('nothing streamed: true', () => {
    expect(hasNoAbortContent([])).toBe(true);
    expect(hasNoAbortContent(undefined)).toBe(true);
  });

  it('a thinking block that never got a word, or an empty text part: still nothing', () => {
    expect(hasNoAbortContent([{ type: ContentTypes.THINK, think: '  ' }])).toBe(true);
    expect(hasNoAbortContent([{ type: ContentTypes.TEXT, text: '' }])).toBe(true);
  });

  it('a few words of text or thought: something', () => {
    expect(hasNoAbortContent([{ type: ContentTypes.TEXT, text: 'Начал…' }])).toBe(false);
    expect(hasNoAbortContent([{ type: ContentTypes.THINK, think: 'Мысль 1' }])).toBe(false);
  });

  it('an OAuth prompt alone: not persistable, yet NOT nothing', () => {
    expect(hasPersistableAbortContent([oauthPrompt])).toBe(false);
    expect(hasNoAbortContent([oauthPrompt])).toBe(false);
  });
});
