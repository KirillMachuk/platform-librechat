import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import { buildColumns, type TFileRow } from '../columns';

jest.mock('~/components/Chat/Input/Files/FilePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="file-icon" />,
}));
jest.mock('~/components/Chat/Input/Files/ImagePreview', () => ({
  __esModule: true,
  default: () => <div data-testid="image-icon" />,
}));

const file = (over: Partial<TFile> = {}): TFileRow =>
  ({
    id: 'f1',
    file_id: 'f1',
    filename: 'Скан_2026_final(3).pdf',
    type: 'application/pdf',
    bytes: 1024,
    embedded: true,
    user: 'u1',
    filepath: '/files/f1',
    object: 'file',
    usage: 0,
    ...over,
  }) as TFileRow;

/** The name column's own cell renderer, rendered the way the table calls it. */
function renderNameCell(row: TFileRow) {
  const nameColumn = buildColumns({ onAttach: jest.fn() })[0];
  const Cell = nameColumn.cell as (props: { row: { original: TFileRow } }) => React.ReactElement;
  return render(<RecoilRoot>{Cell({ row: { original: row } })}</RecoilRoot>);
}

/**
 * A row in the Files list. The rule the whole feature rests on: the filename the person chose
 * is what the row says, and anything extracted goes UNDER it. People name files the way they
 * search for them — replacing that with a generated title takes their handle away.
 */
describe('Files list — the name row', () => {
  it('keeps the name the person gave the file', () => {
    renderNameCell(
      file({
        docMetadata: {
          docType: 'договор',
          parties: ['ООО «Ромашка»'],
          primaryDate: '2024-01-15',
          identifiers: [],
          columns: [],
        },
      }),
    );

    expect(screen.getByText('Скан_2026_final(3).pdf')).toBeInTheDocument();
  });

  it('says underneath what the document turned out to be', () => {
    renderNameCell(
      file({
        docMetadata: {
          docType: 'договор',
          parties: ['ООО «Ромашка»'],
          primaryDate: '2024-01-15',
          identifiers: [],
          columns: [],
        },
      }),
    );

    expect(screen.getByText(/Договор.*Ромашка/)).toBeInTheDocument();
  });

  /* An unindexed file, a legacy upload, a scan whose header could not be read: the row stays
   * exactly what it was before this feature — one line, the filename. */
  it('adds no second line to a file nothing was extracted from', () => {
    const { container } = renderNameCell(file());

    expect(screen.getByText('Скан_2026_final(3).pdf')).toBeInTheDocument();
    expect(container.querySelectorAll('span')).toHaveLength(1);
  });
});
