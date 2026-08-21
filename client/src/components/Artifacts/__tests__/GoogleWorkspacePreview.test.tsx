import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Artifact } from '~/common';
import GoogleWorkspacePreview from '../GoogleWorkspacePreview';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const buildArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'google-workspace:document:doc_123',
  type: TOOL_ARTIFACT_TYPES.GOOGLE_WORKSPACE,
  title: 'Planning document',
  content: '',
  lastUpdateTime: 1,
  googleWorkspace: {
    provider: 'google_drive',
    fileId: 'doc_123',
    name: 'Planning document',
    mimeType: 'application/vnd.google-apps.document',
    viewUrl: 'https://docs.google.com/document/d/doc_123/edit?unsafe=discarded',
    kind: 'document',
  },
  ...overrides,
});

describe('GoogleWorkspacePreview', () => {
  it('renders only the normalized Google URL with the restricted iframe policy', () => {
    render(<GoogleWorkspacePreview artifact={buildArtifact()} isMobile={false} />);

    const frame = screen.getByTitle('Planning document');
    expect(frame).toHaveAttribute('src', 'https://docs.google.com/document/d/doc_123/edit');
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
    );
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('renders a normalized Google Drive viewer URL with the same iframe policy', () => {
    render(
      <GoogleWorkspacePreview
        isMobile={false}
        artifact={buildArtifact({
          id: 'google-workspace:drive_file:file_789',
          title: 'Shared PDF',
          googleWorkspace: {
            provider: 'google_drive',
            fileId: 'file_789',
            name: 'Shared PDF',
            mimeType: 'application/octet-stream',
            viewUrl: 'https://drive.google.com/file/d/file_789/view?unsafe=discarded',
            kind: 'drive_file',
          },
        })}
      />,
    );

    const frame = screen.getByTitle('Shared PDF');
    expect(frame).toHaveAttribute('src', 'https://drive.google.com/file/d/file_789/preview');
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
    );
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('uses the stable HTML viewer for spreadsheets on mobile', () => {
    render(
      <GoogleWorkspacePreview
        isMobile={true}
        artifact={buildArtifact({
          id: 'google-workspace:spreadsheet:sheet_987',
          title: 'Market analysis',
          googleWorkspace: {
            provider: 'google_drive',
            fileId: 'sheet_987',
            name: 'Market analysis',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            viewUrl: 'https://docs.google.com/spreadsheets/d/sheet_987/edit?unsafe=discarded',
            kind: 'spreadsheet',
          },
        })}
      />,
    );

    expect(screen.getByTitle('Market analysis')).toHaveAttribute(
      'src',
      'https://docs.google.com/spreadsheets/d/sheet_987/htmlview?widget=true&headers=true&chrome=false',
    );
  });

  it('refuses a stored URL whose identity does not match the artifact', () => {
    render(
      <GoogleWorkspacePreview
        isMobile={false}
        artifact={buildArtifact({
          googleWorkspace: {
            ...buildArtifact().googleWorkspace!,
            fileId: 'different_file',
          },
        })}
      />,
    );

    expect(screen.queryByTitle('Planning document')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_google_workspace_preview_unavailable')).toBeInTheDocument();
  });

  it('refuses a non-Google URL even if it was placed into artifact state', () => {
    render(
      <GoogleWorkspacePreview
        isMobile={false}
        artifact={buildArtifact({
          googleWorkspace: {
            ...buildArtifact().googleWorkspace!,
            viewUrl: 'https://example.com/document/d/doc_123/edit',
          },
        })}
      />,
    );

    expect(screen.queryByRole('iframe')).not.toBeInTheDocument();
    expect(screen.getByText('com_ui_google_workspace_preview_unavailable')).toBeInTheDocument();
  });
});
