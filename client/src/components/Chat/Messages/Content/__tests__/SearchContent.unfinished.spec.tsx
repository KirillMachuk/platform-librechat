import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import type { TMessage } from 'librechat-data-provider';
import SearchContent from '~/components/Chat/Messages/Content/SearchContent';

/**
 * The public share page renders through THIS component, and a shared snapshot carries
 * `unfinished` with it (see share.ts).
 *
 * Nothing tells a reader that a Deep Research report was cut short any more — owner
 * decision, 27.08.2026: a report written from less material is still a real synthesis, and
 * a self-deprecating line under it reads as an unreliable platform rather than as candour.
 *
 * The SUPPRESSION is what this file guards, and it is not the same thing as the note. Left
 * to itself this component turns `unfinished` into a red `role="alert"` box prefixed «Не
 * удалось выполнить запрос. Сообщение об ошибке: …» — a false statement about a report that
 * was written successfully. Every truncated report already in the database still carries the
 * flag, so deleting the rule along with the note would hand exactly those reports an error
 * box on the one surface a client is most likely to open: a link someone sent them.
 */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
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

describe('SearchContent (share page) — a truncated DR report is neither flagged nor failed', () => {
  it('says nothing at all about a truncated report — no note, no alert', async () => {
    renderShared(message({ unfinished: true, drKind: 'report' } as Partial<TMessage>));
    await screen.findByTestId('part');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Не удалось выполнить запрос/)).not.toBeInTheDocument();
  });

  it('says nothing about a complete report either', async () => {
    renderShared(message({ drKind: 'report' } as Partial<TMessage>));
    await screen.findByTestId('part');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * The regression this file exists to catch, and the reason the rule survives the note.
   *
   * An ordinary answer the reader stopped IS genuinely unfinished, and it keeps the platform
   * indicator it has always had. A guard written as "never show the box" instead of "never
   * show the box on a DR report" would take it away from every stopped answer on the site.
   */
  it('keeps the existing indicator for a stopped ordinary answer', async () => {
    renderShared(message({ unfinished: true }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  /** The rule is drKind-gated, not text-gated: a stopped answer that merely LOOKS like a
   *  report keeps the indicator. */
  it('keeps it for a stopped answer with no drKind, however report-like its text', async () => {
    renderShared(message({ unfinished: true, text: '# Отчёт по рынку CRM' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
