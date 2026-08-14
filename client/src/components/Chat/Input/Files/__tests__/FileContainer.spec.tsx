import React from 'react';
import { render, screen } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import FileContainer from '../FileContainer';

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
}));

jest.mock('../FilePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="file-preview" />,
}));

jest.mock('../RemoveFile', () => ({
  __esModule: true,
  default: () => <button data-testid="remove-file" />,
}));

const baseFile = (overrides: Partial<TFile> = {}): Partial<TFile> => ({
  file_id: 'f1',
  filename: 'report.pdf',
  type: 'application/pdf',
  ...overrides,
});

describe('FileContainer chip label', () => {
  it('shows the raw filename when no `displayName` is supplied (upload context)', () => {
    /** A user-uploaded file whose name happens to look like the
     * code-execution collision suffix (`-<6 hex>` before extension) must
     * not have its name silently rewritten — historically a global
     * `displayFilename(file.filename)` call here would strip the suffix
     * and turn `report-abc123.pdf` into `report.pdf`. Stripping is now
     * opt-in via `displayName`, so upload chips show the raw name. */
    render(<FileContainer file={baseFile({ filename: 'report-abc123.pdf' })} />);
    expect(screen.getByText('report-abc123.pdf')).toBeInTheDocument();
  });

  it('uses `displayName` when supplied (artifact context opts in)', () => {
    render(
      <FileContainer
        file={baseFile({ filename: 'archive-deadbe.zip', type: 'application/zip' })}
        displayName="archive.zip"
      />,
    );
    expect(screen.getByText('archive.zip')).toBeInTheDocument();
    expect(screen.queryByText(/-deadbe/)).not.toBeInTheDocument();
  });

  it('falls back to empty string when neither `displayName` nor `filename` is set', () => {
    const { container } = render(<FileContainer file={{ file_id: 'noname' } as Partial<TFile>} />);
    /** Title element exists but is empty — no crash, no `undefined`. */
    expect(container.querySelector('.font-medium')?.textContent).toBe('');
  });
});

describe('FileContainer trailing slot reservation (owner 14.08-4)', () => {
  /* The download glyph is an absolutely positioned sibling; the ONLY thing
   * keeping it off the filename is the pr-9 reservation on the content row.
   * The founding case: a measured 31px overlap when nothing reserved it. */
  it('reserves the trailing zone when a trailing control exists', () => {
    const { container } = render(
      <FileContainer file={baseFile()} trailing={<span data-testid="trailing-glyph" />} />,
    );
    const row = container.querySelector('.flex.flex-row.items-center');
    expect(row?.className).toContain('pr-9');
    expect(screen.getByTestId('trailing-glyph')).toBeInTheDocument();
  });

  it('gives the text the full width when there is no trailing control', () => {
    const { container } = render(<FileContainer file={baseFile()} />);
    const row = container.querySelector('.flex.flex-row.items-center');
    expect(row?.className).not.toContain('pr-9');
  });

  it('never grows past its container: the card carries max-w-full', () => {
    /* Squeezable panes (open artifacts panel, agent side-panel strips) can be
     * narrower than the fixed w-64; without the cap the card overflows them. */
    const { container } = render(<FileContainer file={baseFile()} />);
    const wrapper = container.firstElementChild;
    expect(wrapper?.className ?? '').toContain('max-w-full');
  });
});
