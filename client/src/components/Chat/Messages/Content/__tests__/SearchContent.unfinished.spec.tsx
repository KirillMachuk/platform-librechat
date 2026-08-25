import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import SearchContent from '~/components/Chat/Messages/Content/SearchContent';

/**
 * The public share page renders through THIS component, and a shared snapshot carries
 * `unfinished` with it (see share.ts). So a Deep Research report whose gathering was cut
 * short — a real, usable synthesis — greeted whoever opened the link with a red
 * `role="alert"` reading «Не удалось выполнить запрос. Сообщение об ошибке: …».
 *
 * The chat surface was fixed and this one was not: the rule lived inline in ContentRender and
 * nowhere else. It is imported from one place now, and this test is why it stays that way.
 */
const NOTE = 'Сбор материала для этого отчёта прервался раньше времени.';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => (key === 'com_ui_dr_report_truncated' ? NOTE : key),
}));

jest.mock('~/components/Chat/Messages/Content/Part', () => ({
  __esModule: true,
  default: () => <div data-testid="part" />,
}));
jest.mock('~/components/Chat/Messages/Content/MarkdownLite', () => ({
  __esModule: true,
  default: () => <div />,
}));

const message = (partial: Partial<TMessage>): TMessage =>
  ({
    messageId: 'm1',
    conversationId: 'c1',
    isCreatedByUser: false,
    text: '# Отчёт',
    content: [{ type: 'text', text: '# Отчёт' }],
    ...partial,
  }) as unknown as TMessage;

const renderShared = (msg: TMessage) =>
  render(
    <RecoilRoot>
      <SearchContent message={msg} />
    </RecoilRoot>,
  );

describe('SearchContent (share page) — a truncated DR report is a note, not a failure', () => {
  it('shows the plain note and no alert for a truncated report', async () => {
    renderShared(message({ unfinished: true, drKind: 'report' } as Partial<TMessage>));
    expect(await screen.findByTestId('dr-unfinished-notice')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Не удалось выполнить запрос/)).not.toBeInTheDocument();
  });

  it('says nothing at all for a complete report', () => {
    renderShared(message({ drKind: 'report' } as Partial<TMessage>));
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });

  /**
   * An ordinary answer the reader stopped IS genuinely unfinished, and this change does not
   * take that indicator away — it only stops a Deep Research report being called a failure.
   */
  it('leaves the existing indicator alone for a stopped ordinary answer', async () => {
    renderShared(message({ unfinished: true }));
    expect(screen.queryByTestId('dr-unfinished-notice')).not.toBeInTheDocument();
  });
});
