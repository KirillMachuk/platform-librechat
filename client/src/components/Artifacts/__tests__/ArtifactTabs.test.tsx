import React from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Artifact } from '~/common';
import { EditorProvider } from '~/Providers/EditorContext';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import ArtifactTabs from '../ArtifactTabs';

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
}));

/* Monaco does not run in jsdom. The stub stands in for the editor and exposes
 * the shared buffer, which is what these tests are about. */
jest.mock('../ArtifactCodeEditor', () => {
  const { useCodeState: useCode } = jest.requireActual('~/Providers/EditorContext');
  const TYPE_LABEL = 'type';
  const TYPED_TEXT = 'edited by the user';
  return {
    ArtifactCodeEditor: () => {
      const { currentCode, setCurrentCode } = useCode();
      return (
        <div>
          <span data-testid="editor-buffer">{currentCode ?? '<empty>'}</span>
          <button
            type="button"
            aria-label={TYPE_LABEL}
            onClick={() => setCurrentCode(TYPED_TEXT)}
          />
        </div>
      );
    },
  };
});

jest.mock('../ArtifactPreview', () => ({
  ArtifactPreview: () => <div data-testid="artifact-preview" />,
}));

const buildArtifact = (id: string, title: string): Artifact =>
  ({
    id,
    identifier: id,
    title,
    type: TOOL_ARTIFACT_TYPES.MARKDOWN,
    content: `content of ${title}`,
    lastUpdateTime: 1,
  }) as Artifact;

const fileA = buildArtifact('artifact-a', 'notes.md');
const fileB = buildArtifact('artifact-b', 'summary.md');

const renderTabs = (artifact: Artifact) =>
  render(
    <EditorProvider>
      <Tabs.Root value="code">
        <ArtifactTabs
          artifact={artifact}
          previewRef={{ current: null } as never}
          isSharedConvo={false}
        />
      </Tabs.Root>
    </EditorProvider>,
  );

describe('ArtifactTabs editor buffer', () => {
  it('keeps unsaved edits while the same file stays open', () => {
    const { rerender } = renderTabs(fileA);

    fireEvent.click(screen.getByRole('button', { name: 'type' }));
    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('edited by the user');

    rerender(
      <EditorProvider>
        <Tabs.Root value="code">
          <ArtifactTabs
            artifact={{ ...fileA, content: 'streamed more content' }}
            previewRef={{ current: null } as never}
            isSharedConvo={false}
          />
        </Tabs.Root>
      </EditorProvider>,
    );

    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('edited by the user');
  });

  /**
   * Today the panel shows one file at a time and the editor buffer is shared,
   * so opening another file discards whatever was typed into the previous one.
   * The redesign (Ф1) gives the panel a tab per open file, and the canon
   * requires each file to keep its own unsaved edits — see the row
   * "Unsaved editor edits survive switching files" in e2e/COVERAGE_MAP.md.
   */
  it('drops unsaved edits when another file is opened', () => {
    const { rerender } = renderTabs(fileA);

    fireEvent.click(screen.getByRole('button', { name: 'type' }));
    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('edited by the user');

    rerender(
      <EditorProvider>
        <Tabs.Root value="code">
          <ArtifactTabs
            artifact={fileB}
            previewRef={{ current: null } as never}
            isSharedConvo={false}
          />
        </Tabs.Root>
      </EditorProvider>,
    );

    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('<empty>');
  });

  it.failing('gives each open file its own unsaved edits (canon §6.15, arrives with Ф1)', () => {
    const { rerender } = renderTabs(fileA);
    fireEvent.click(screen.getByRole('button', { name: 'type' }));

    const showFile = (artifact: Artifact) =>
      rerender(
        <EditorProvider>
          <Tabs.Root value="code">
            <ArtifactTabs
              artifact={artifact}
              previewRef={{ current: null } as never}
              isSharedConvo={false}
            />
          </Tabs.Root>
        </EditorProvider>,
      );

    showFile(fileB);
    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('<empty>');

    showFile(fileA);
    expect(screen.getByTestId('editor-buffer')).toHaveTextContent('edited by the user');
  });
});
