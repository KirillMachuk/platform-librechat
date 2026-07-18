import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { render, waitFor } from '@testing-library/react';
import { Tools, Constants } from 'librechat-data-provider';
import type { TStartupConfig } from 'librechat-data-provider';
import { ephemeralAgentByConvoId } from '~/store';
import BadgeRowProvider from '../BadgeRowContext';

/* Дефолт тумблера «Поиск файлов» — прод-инцидент: сотрудник не знает про бейдж, тул не
 * вооружается, модель отвечает «в системе нет файлов» поверх полной библиотеки. Серверный
 * `interface.fileSearchDefault` включает тумблер из коробки; выбор пользователя (localStorage)
 * всегда сильнее. */

let mockStartupConfig: Partial<TStartupConfig> | undefined;

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));
jest.mock('~/hooks', () => ({
  useGetAgentsConfig: () => ({ agentsConfig: null }),
  useMCPServerManager: () => ({}),
  useSearchApiKeyForm: () => ({}),
  useToolToggle: () => ({}),
}));

function EphemeralProbe({ onValue }: { onValue: (v: unknown) => void }) {
  const value = useRecoilValue(ephemeralAgentByConvoId(Constants.NEW_CONVO as string));
  onValue(value);
  return null;
}

function renderProvider() {
  const seen: unknown[] = [];
  const utils = render(
    <RecoilRoot>
      <BadgeRowProvider conversationId={null}>
        <EphemeralProbe onValue={(v) => seen.push(v)} />
      </BadgeRowProvider>
    </RecoilRoot>,
  );
  return { ...utils, last: () => seen[seen.length - 1] as Record<string, unknown> | null };
}

beforeEach(() => {
  localStorage.clear();
  mockStartupConfig = undefined;
});

describe('BadgeRowProvider — серверный дефолт тумблера «Поиск файлов»', () => {
  it('fileSearchDefault: true включает тумблер пользователю без сохранённого выбора', async () => {
    mockStartupConfig = { interface: { fileSearchDefault: true } } as Partial<TStartupConfig>;
    const { last } = renderProvider();
    await waitFor(() => {
      expect(last()?.[Tools.file_search]).toBe(true);
    });
  });

  it('выбор пользователя сильнее дефолта: выключил — остаётся выключенным', async () => {
    mockStartupConfig = { interface: { fileSearchDefault: true } } as Partial<TStartupConfig>;
    const suffix = Constants.NEW_CONVO as string;
    localStorage.setItem(`LAST_FILE_SEARCH_TOGGLE_${suffix}`, 'false');
    localStorage.setItem(`LAST_FILE_SEARCH_TOGGLE_${suffix}:timestamp`, new Date().toISOString());
    const { last } = renderProvider();
    await waitFor(() => {
      expect(last()?.[Tools.file_search]).toBe(false);
    });
  });

  it('без дефолта поведение прежнее: состояние не создаётся (тумблер выключен)', async () => {
    mockStartupConfig = { interface: {} } as Partial<TStartupConfig>;
    const { last } = renderProvider();
    await waitFor(() => {
      expect(last() ?? null).toBeNull();
    });
  });

  it('инициализация ЖДЁТ загрузку startupConfig — дефолт не теряется из-за гонки', async () => {
    /* Конфиг грузится асинхронно; одноразовый init, отработавший до его прихода, молча съел бы
     * дефолт. Первый рендер — без конфига, затем конфиг приходит → тумблер включается. */
    mockStartupConfig = undefined;
    const { last, rerender } = renderProvider();
    expect(last() ?? null).toBeNull();

    mockStartupConfig = { interface: { fileSearchDefault: true } } as Partial<TStartupConfig>;
    rerender(
      <RecoilRoot>
        <BadgeRowProvider conversationId={null}>
          <EphemeralProbe onValue={() => undefined} />
        </BadgeRowProvider>
      </RecoilRoot>,
    );
    const probe: unknown[] = [];
    rerender(
      <RecoilRoot>
        <BadgeRowProvider conversationId={null}>
          <EphemeralProbe onValue={(v) => probe.push(v)} />
        </BadgeRowProvider>
      </RecoilRoot>,
    );
    await waitFor(() => {
      const lastValue = probe[probe.length - 1] as Record<string, unknown> | null;
      expect(lastValue?.[Tools.file_search]).toBe(true);
    });
  });
});

describe('BadgeRowProvider — серверный дефолт тумблера «Веб-поиск»', () => {
  it('webSearchDefault: true включает тумблер пользователю без сохранённого выбора', async () => {
    mockStartupConfig = { interface: { webSearchDefault: true } } as Partial<TStartupConfig>;
    const { last } = renderProvider();
    await waitFor(() => {
      expect(last()?.[Tools.web_search]).toBe(true);
    });
  });

  it('выбор пользователя сильнее дефолта: выключил — остаётся выключенным', async () => {
    mockStartupConfig = { interface: { webSearchDefault: true } } as Partial<TStartupConfig>;
    const suffix = Constants.NEW_CONVO as string;
    localStorage.setItem(`LAST_WEB_SEARCH_TOGGLE_${suffix}`, 'false');
    localStorage.setItem(`LAST_WEB_SEARCH_TOGGLE_${suffix}:timestamp`, new Date().toISOString());
    const { last } = renderProvider();
    await waitFor(() => {
      expect(last()?.[Tools.web_search]).toBe(false);
    });
  });
});
