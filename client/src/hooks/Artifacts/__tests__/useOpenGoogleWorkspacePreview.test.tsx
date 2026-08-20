import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { fireEvent, render, screen } from '@testing-library/react';
import useOpenGoogleWorkspacePreview from '../useOpenGoogleWorkspacePreview';
import store from '~/store';

function Harness({ url }: { url: string }) {
  const openPreview = useOpenGoogleWorkspacePreview();
  const artifacts = useRecoilValue(store.artifactsState);
  const currentArtifactId = useRecoilValue(store.currentArtifactId);
  const isVisible = useRecoilValue(store.artifactsVisibility);

  return (
    <>
      <button
        type="button"
        data-testid="open-preview"
        onClick={() => openPreview(url, 'Quarterly plan')}
      />
      <output data-testid="artifact-count">{Object.keys(artifacts ?? {}).length}</output>
      <output data-testid="artifact-id">{currentArtifactId ?? ''}</output>
      <output data-testid="visibility">{String(isVisible)}</output>
    </>
  );
}

describe('useOpenGoogleWorkspacePreview', () => {
  it('registers and focuses a valid Google document', () => {
    render(
      <RecoilRoot initializeState={({ set }) => set(store.artifactsVisibility, false)}>
        <Harness url="https://docs.google.com/document/d/doc_123/edit?tab=t.0" />
      </RecoilRoot>,
    );

    fireEvent.click(screen.getByTestId('open-preview'));

    expect(screen.getByTestId('artifact-count')).toHaveTextContent('1');
    expect(screen.getByTestId('artifact-id')).toHaveTextContent(
      'google-workspace:document:doc_123',
    );
    expect(screen.getByTestId('visibility')).toHaveTextContent('true');
  });

  it.each([
    [
      'https://docs.google.com/presentation/d/slides_456/edit?usp=sharing',
      'google-workspace:presentation:slides_456',
    ],
    [
      'https://drive.google.com/file/d/file_789/view?usp=sharing',
      'google-workspace:drive_file:file_789',
    ],
  ])('registers another supported Google file type', (url, expectedId) => {
    render(
      <RecoilRoot initializeState={({ set }) => set(store.artifactsVisibility, false)}>
        <Harness url={url} />
      </RecoilRoot>,
    );

    fireEvent.click(screen.getByTestId('open-preview'));

    expect(screen.getByTestId('artifact-count')).toHaveTextContent('1');
    expect(screen.getByTestId('artifact-id')).toHaveTextContent(expectedId);
    expect(screen.getByTestId('visibility')).toHaveTextContent('true');
  });

  it('does not change panel state for an untrusted URL', () => {
    render(
      <RecoilRoot initializeState={({ set }) => set(store.artifactsVisibility, false)}>
        <Harness url="https://docs.google.com.attacker.example/document/d/doc_123/edit" />
      </RecoilRoot>,
    );

    fireEvent.click(screen.getByTestId('open-preview'));

    expect(screen.getByTestId('artifact-count')).toHaveTextContent('0');
    expect(screen.getByTestId('artifact-id')).toHaveTextContent('');
    expect(screen.getByTestId('visibility')).toHaveTextContent('false');
  });
});
