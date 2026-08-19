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
    render(<GoogleWorkspacePreview artifact={buildArtifact()} />);

    const frame = screen.getByTitle('Planning document');
    expect(frame).toHaveAttribute('src', 'https://docs.google.com/document/d/doc_123/edit');
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts',
    );
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('refuses a stored URL whose identity does not match the artifact', () => {
    render(
      <GoogleWorkspacePreview
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
