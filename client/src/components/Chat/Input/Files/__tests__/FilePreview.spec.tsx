import React from 'react';
import { render } from '@testing-library/react';
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

const Paths: React.FC = () => null;
const fileType = { paths: Paths, fill: '', title: '' };

describe('FilePreview indexing tooltip', () => {
  it('shows an indexing tooltip while the document is still embedding', () => {
    const { container } = render(
      <FilePreview
        file={{ embeddingStatus: 'processing' } as Partial<TFile>}
        fileType={fileType}
      />,
    );
    // The async-embed spinner alone reads as "stuck"; a hover tooltip tells the
    // user it is still indexing (e.g. a large scan can take minutes).
    expect(container.querySelector('[title="com_ui_indexing"]')).toBeInTheDocument();
  });

  it('shows no indexing tooltip once the document is ready', () => {
    const { container } = render(
      <FilePreview file={{ embeddingStatus: 'ready' } as Partial<TFile>} fileType={fileType} />,
    );
    expect(container.querySelector('[title]')).not.toBeInTheDocument();
  });
});
