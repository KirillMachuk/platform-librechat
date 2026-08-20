import { logger } from '@librechat/data-schemas';
import { AIMessage } from '@langchain/core/messages';
import { readAnswer } from './shared';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const answer = (content: string, finishReason?: string) =>
  new AIMessage({
    content,
    response_metadata: finishReason ? { finish_reason: finishReason } : {},
  });

describe('readAnswer — a degraded answer can no longer pass in silence', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes a complete answer through untouched and says nothing', () => {
    expect(readAnswer('report', answer('# Отчёт', 'stop'))).toEqual({
      text: '# Отчёт',
      empty: false,
      truncated: false,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('flags a CUT answer — the one that shipped 1013 chars ending mid-word as a report', () => {
    const read = readAnswer('report', answer('…оптимальным по соотношению выгля', 'length'));
    expect(read.truncated).toBe(true);
    expect(read.empty).toBe(false);
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain('report');
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain('finish_reason=length');
  });

  it('flags an EMPTY answer, naming the node that got it', () => {
    const read = readAnswer('supervisor', answer('   ', 'stop'));
    expect(read).toEqual({ text: '', empty: true, truncated: false });
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain('supervisor');
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain('EMPTY');
  });

  it('handles the worst case: cut AND empty', () => {
    // Measured live: with a small output ceiling a reasoning model spends the whole budget
    // thinking and returns zero characters with finish_reason "length".
    const read = readAnswer('scope', answer('', 'length'));
    expect(read.empty).toBe(true);
    expect(read.truncated).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the provider omits finish_reason and the text is fine', () => {
    expect(readAnswer('compress', answer('дайджест')).truncated).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
