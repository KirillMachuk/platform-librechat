import { HumanMessage } from '@langchain/core/messages';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { BaseMessage } from '@langchain/core/messages';
import type { DeepResearchState } from '../state';
import { createScopeNode, parseScopeOutput } from './scope';

const NOW = '2026-06-25T00:00:00Z';

function stateWith(messages: BaseMessage[]): DeepResearchState {
  return {
    messages,
    jurisdiction: '',
    researchBrief: '',
    currentSubQuestion: '',
    findings: [],
    round: 0,
    researcherCount: 0,
    tokenUsage: { input: 0, output: 0, total: 0 },
    errors: [],
    finalReport: '',
    finalizeReason: null,
    concludeReason: null,
  };
}

const scopeWith = (response: string) =>
  createScopeNode({ model: new FakeListChatModel({ responses: [response] }), now: NOW });

describe('parseScopeOutput', () => {
  it('parses a clean JSON object', () => {
    expect(parseScopeOutput('{"jurisdiction":"RU","brief":"Рынок CRM."}')).toEqual({
      jurisdiction: 'RU',
      brief: 'Рынок CRM.',
    });
  });

  it('strips a ```json code fence', () => {
    expect(parseScopeOutput('```json\n{"jurisdiction":"KZ","brief":"y"}\n```')).toEqual({
      jurisdiction: 'KZ',
      brief: 'y',
    });
  });

  it('maps an unknown jurisdiction to UNSPECIFIED (never RU)', () => {
    expect(parseScopeOutput('{"jurisdiction":"FR","brief":"x"}').jurisdiction).toBe('UNSPECIFIED');
  });

  it('treats missing jurisdiction as UNSPECIFIED', () => {
    expect(parseScopeOutput('{"brief":"z"}')).toEqual({ jurisdiction: 'UNSPECIFIED', brief: 'z' });
  });

  it('falls back to raw text as the brief when not JSON', () => {
    expect(parseScopeOutput('просто текст')).toEqual({
      jurisdiction: 'UNSPECIFIED',
      brief: 'просто текст',
    });
  });
});

describe('createScopeNode', () => {
  it('sets jurisdiction + brief from valid model output', async () => {
    const update = await scopeWith('{"jurisdiction":"RU","brief":"Исследовать рынок CRM в РФ."}')(
      stateWith([new HumanMessage('изучи рынок CRM в России')]),
    );
    expect(update.jurisdiction).toBe('RU');
    expect(update.researchBrief).toBe('Исследовать рынок CRM в РФ.');
    expect(update.errors ?? []).toHaveLength(0);
  });

  it('degrades to UNSPECIFIED + raw request when the model returns noise', async () => {
    const update = await scopeWith('я не знаю')(
      stateWith([new HumanMessage('запрос пользователя')]),
    );
    expect(update.jurisdiction).toBe('UNSPECIFIED');
    expect(update.researchBrief).toBe('я не знаю');
  });

  it('forwards the abort signal to the model call (H1)', async () => {
    const model = new FakeListChatModel({ responses: ['{"jurisdiction":"RU","brief":"b"}'] });
    const spy = jest.spyOn(model, 'invoke');
    const controller = new AbortController();
    await createScopeNode({ model, now: NOW })(stateWith([new HumanMessage('q')]), {
      signal: controller.signal,
    });
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
