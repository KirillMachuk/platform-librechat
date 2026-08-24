import React from 'react';
import { RecoilRoot } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import { a as MarkdownAnchor } from '../MarkdownComponents';
import store from '~/store';

const mockOpenGoogleWorkspacePreview = jest.fn();
const mockUseGetStartupConfig = jest.fn();

jest.mock('~/data-provider', () => ({
  useFileDownload: () => ({ refetch: jest.fn() }),
  useGetStartupConfig: () => mockUseGetStartupConfig(),
}));

jest.mock('~/hooks/Artifacts/useOpenGoogleWorkspacePreview', () => ({
  __esModule: true,
  default: () => mockOpenGoogleWorkspacePreview,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

const renderLink = (href: string, label = 'Quarterly plan', role = 'ADMIN') =>
  render(
    <RecoilRoot initializeState={({ set }) => set(store.user, { id: 'owner', role } as never)}>
      {React.createElement(MarkdownAnchor, { href }, label)}
    </RecoilRoot>,
  );

describe('Markdown Google Workspace links', () => {
  beforeEach(() => {
    mockOpenGoogleWorkspacePreview.mockReset();
    mockOpenGoogleWorkspacePreview.mockReturnValue(true);
    mockUseGetStartupConfig.mockReset();
  });

  it('opens a supported link in the panel when the feature flag is enabled', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: true } },
    });
    renderLink('https://docs.google.com/document/d/doc_123/edit?tab=t.0');

    const link = screen.getByRole('link', { name: 'Quarterly plan' });
    expect(link).toHaveAttribute('href', 'https://docs.google.com/document/d/doc_123/edit');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);

    expect(mockOpenGoogleWorkspacePreview).toHaveBeenCalledWith(
      'https://docs.google.com/document/d/doc_123/edit',
      'Quarterly plan',
    );
  });

  it.each([
    [
      'https://docs.google.com/presentation/d/slides_456/edit?usp=sharing',
      'https://docs.google.com/presentation/d/slides_456/edit',
    ],
    [
      'https://drive.google.com/file/d/file_789/view?usp=sharing',
      'https://drive.google.com/file/d/file_789/view',
    ],
  ])('opens another supported Google file type in the panel', (href, normalizedHref) => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: true } },
    });
    renderLink(href, 'Shared file');

    const link = screen.getByRole('link', { name: 'Shared file' });
    expect(link).toHaveAttribute('href', normalizedHref);
    fireEvent.click(link);

    expect(mockOpenGoogleWorkspacePreview).toHaveBeenCalledWith(normalizedHref, 'Shared file');
  });

  it('leaves the link as ordinary external navigation when the flag is disabled', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: false } },
    });
    const href = 'https://docs.google.com/spreadsheets/d/sheet_123/edit';
    renderLink(href, 'Budget');

    const link = screen.getByRole('link', { name: 'Budget' });
    expect(link).toHaveAttribute('href', href);
    fireEvent.click(link);

    expect(mockOpenGoogleWorkspacePreview).not.toHaveBeenCalled();
  });

  it('opens enabled previews for users who can use the connector', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: true } },
    });
    const href = 'https://docs.google.com/document/d/doc_123/edit';
    renderLink(href, 'Quarterly plan', 'USER');

    fireEvent.click(screen.getByRole('link', { name: 'Quarterly plan' }));
    expect(mockOpenGoogleWorkspacePreview).toHaveBeenCalledWith(href, 'Quarterly plan');
  });

  it('never intercepts a Google lookalike domain', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: true } },
    });
    const href = 'https://docs.google.com.attacker.example/document/d/doc_123/edit';
    renderLink(href);

    fireEvent.click(screen.getByRole('link', { name: 'Quarterly plan' }));
    expect(mockOpenGoogleWorkspacePreview).not.toHaveBeenCalled();
  });

  it('preserves modified-click external navigation', () => {
    mockUseGetStartupConfig.mockReturnValue({
      data: { interface: { googleWorkspacePreview: true } },
    });
    renderLink('https://docs.google.com/document/d/doc_123/edit');

    fireEvent.click(screen.getByRole('link', { name: 'Quarterly plan' }), { metaKey: true });
    expect(mockOpenGoogleWorkspacePreview).not.toHaveBeenCalled();
  });
});
