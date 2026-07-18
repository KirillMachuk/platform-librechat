import React from 'react';
import { RecoilRoot } from 'recoil';
import { renderHook } from '@testing-library/react';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import store from '~/store';
import useDefaultSelection from '../useDefaultSelection';

/* Дефолт-модель на входе: раньше сид применялся только пользователю с ПУСТЫМ стором, поэтому
 * существующий юзер с восстановленной из localStorage моделью никогда не видел defaultModel.
 * Фикс — defaultModel применяется на первом прогоне даже поверх восстановленной модели; выбор
 * агента и внутрисессионный выбор пользователя не трогаются. */

let mockStartupConfig: { interface?: Record<string, unknown> } | undefined;
let mockModelsByEndpoint: Record<string, string[]> | undefined;
let mockAgentsMap: Record<string, { model?: string }> | undefined;

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));
jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: mockModelsByEndpoint }),
}));
jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => mockAgentsMap,
}));

const DEFAULT = { endpoint: '1ma', model: 'anthropic/claude-sonnet-5' };

function renderWith(
  convo: Partial<TConversation> | null,
  conversationId: string | null = Constants.NEW_CONVO as string,
) {
  const newConversation = jest.fn();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot
      initializeState={({ set }) => {
        if (convo) {
          set(store.conversationByIndex(0), convo as TConversation);
        }
      }}
    >
      {children}
    </RecoilRoot>
  );
  renderHook(() => useDefaultSelection({ index: 0, conversationId, newConversation }), { wrapper });
  return newConversation;
}

beforeEach(() => {
  localStorage.clear();
  mockStartupConfig = { interface: { defaultModel: DEFAULT } };
  mockModelsByEndpoint = { '1ma': [DEFAULT.model, 'anthropic/claude-opus-4.8'] };
  mockAgentsMap = {};
});

describe('useDefaultSelection — дефолт-модель на входе', () => {
  it('пустой стор → применяет defaultModel', () => {
    const newConversation = renderWith(null);
    expect(newConversation).toHaveBeenCalledWith({
      template: { endpoint: DEFAULT.endpoint, model: DEFAULT.model },
    });
  });

  it('восстановленная ДРУГАЯ модель → перекрывает её defaultModel (главный фикс)', () => {
    const newConversation = renderWith({
      endpoint: '1ma' as EModelEndpoint,
      model: 'anthropic/claude-opus-4.8',
    });
    expect(newConversation).toHaveBeenCalledWith({
      template: { endpoint: DEFAULT.endpoint, model: DEFAULT.model },
    });
  });

  it('восстановленная модель уже равна дефолту → без пересборки', () => {
    const newConversation = renderWith({
      endpoint: DEFAULT.endpoint as EModelEndpoint,
      model: DEFAULT.model,
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('выбран агент → уважается, модель-дефолт не перекрывает', () => {
    const newConversation = renderWith({
      endpoint: EModelEndpoint.agents,
      agent_id: 'agent_123',
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('defaultModel не в списке доступных → ждёт (сид не применяется)', () => {
    mockModelsByEndpoint = { '1ma': ['anthropic/claude-opus-4.8'] };
    const newConversation = renderWith({
      endpoint: '1ma' as EModelEndpoint,
      model: 'anthropic/claude-opus-4.8',
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('defaultModel не задан → восстановленная модель остаётся как есть', () => {
    mockStartupConfig = { interface: {} };
    const newConversation = renderWith({
      endpoint: '1ma' as EModelEndpoint,
      model: 'anthropic/claude-opus-4.8',
    });
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('существующий (не пустой) чат → no-op', () => {
    const newConversation = renderWith(
      { endpoint: '1ma' as EModelEndpoint, model: 'anthropic/claude-opus-4.8' },
      'real-convo-id',
    );
    expect(newConversation).not.toHaveBeenCalled();
  });

  it('New Chat сохраняет последнюю модель (дефолт применяется только на первом заходе)', () => {
    const newConversation = jest.fn();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RecoilRoot>{children}</RecoilRoot>
    );
    const { rerender } = renderHook(
      ({ conversationId }: { conversationId: string }) =>
        useDefaultSelection({ index: 0, conversationId, newConversation }),
      { wrapper, initialProps: { conversationId: Constants.NEW_CONVO as string } },
    );
    /** Первый заход (свежий монтаж): дефолт применён один раз. */
    expect(newConversation).toHaveBeenCalledTimes(1);

    /** Переход в реальный чат: сид не применяется. */
    rerender({ conversationId: 'real-convo-1' });
    expect(newConversation).toHaveBeenCalledTimes(1);

    /** New Chat (тот же инстанс): дефолт НЕ переприменяется → последняя модель сохраняется. */
    rerender({ conversationId: Constants.NEW_CONVO as string });
    expect(newConversation).toHaveBeenCalledTimes(1);
  });
});
