import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  /* Ariakit only opens hover tooltips while its GLOBAL mouse-moving tracker is
   * armed, and the tracker demands a real movement delta: `movementX/Y` or a
   * `screenX/screenY` change between mousemoves (@ariakit/react-core,
   * hasMouseMovement). Under NODE_ENV=test the guard short-circuits — which is
   * why a bare user.hover() passed locally — but CI runs the suite with
   * NODE_ENV=development, where it is live: this spec was green on CI only
   * while a lucky worker neighbour left the tracker armed. Two mousemoves
   * with screen deltas arm it deterministically in every environment. */
  const armAriakitMouseTracker = () => {
    act(() => {
      fireEvent.mouseMove(document.body, { screenX: 5, screenY: 5 });
      fireEvent.mouseMove(document.body, { screenX: 12, screenY: 17 });
    });
  };

  it('shows the ink indexing tooltip while the document is still embedding', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const { container } = render(
      <FilePreview file={{ embeddingStatus: 'processing' } as Partial<TFile>} />,
    );
    // The async-embed spinner alone reads as "stuck"; a hover tooltip tells the
    // user it is still indexing (e.g. a large scan can take minutes).
    armAriakitMouseTracker();
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
    armAriakitMouseTracker();
    await user.hover(container.firstElementChild as Element);
    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByText('com_ui_indexing')).not.toBeInTheDocument();
    expect(container.querySelector('[title]')).not.toBeInTheDocument();
  });
});

describe('FilePreview glyph fallback (owner 19.08-3)', () => {
  /* During upload the record carries the browser MIME, which is '' for
   * .sql/.toml and friends — the glyph must come from the extension instead
   * of drawing generic and swapping on the server response. Asserted
   * relatively (same path data as the resolved-type glyph) so the icon set
   * can change without rewriting this spec. */
  const glyphPath = (container: HTMLElement) =>
    container.querySelector('svg path')?.getAttribute('d');

  it('draws the extension glyph when the record type is empty', () => {
    const byName = render(<FilePreview file={{ filename: 'schema.sql', type: '' } as TFile} />);
    const byType = render(
      <FilePreview file={{ filename: 'x', type: 'application/sql' } as TFile} />,
    );
    const generic = render(<FilePreview file={{ filename: 'noextension', type: '' } as TFile} />);
    expect(glyphPath(byName.container)).toBe(glyphPath(byType.container));
    expect(glyphPath(byName.container)).not.toBe(glyphPath(generic.container));
  });
});
