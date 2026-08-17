import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import FilePreview from '../FilePreview';

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  Spinner: () => <div data-testid="spinner" />,
  FileIcon: () => <div data-testid="file-icon" />,
}));

jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('../SourceIcon', () => ({
  __esModule: true,
  default: () => <div data-testid="source-icon" />,
}));
jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

/* The hint is the canon INK plate (real TooltipAnchor, 300ms show delay), never
 * the native `title` balloon — the guard `check:tooltips` bans the attribute
 * tree-wide, and this spec pins the replacement actually working. */
describe('FilePreview indexing tooltip', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the ink indexing tooltip while the document is still embedding', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { container } = render(
      <FilePreview file={{ embeddingStatus: 'processing' } as Partial<TFile>} />,
    );
    // The async-embed spinner alone reads as "stuck"; a hover tooltip tells the
    // user it is still indexing (e.g. a large scan can take minutes).
    await user.hover(container.firstElementChild as Element);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.getByText('com_ui_indexing')).toBeInTheDocument();
    // ...and via the ink plate only — a native balloon would double the tooltip.
    expect(container.querySelector('[title]')).not.toBeInTheDocument();
  });

  it('shows no indexing tooltip once the document is ready', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { container } = render(
      <FilePreview file={{ embeddingStatus: 'ready' } as Partial<TFile>} />,
    );
    // Same hover + same wait as the positive case, so "nothing appeared" is a
    // measured outcome, not a missing sync point.
    await user.hover(container.firstElementChild as Element);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByText('com_ui_indexing')).not.toBeInTheDocument();
    expect(container.querySelector('[title]')).not.toBeInTheDocument();
  });
});
