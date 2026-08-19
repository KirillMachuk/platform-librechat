import React from 'react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Artifact } from '~/common';
import { EditorProvider } from '~/Providers/EditorContext';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import ArtifactsPanel from '../Artifacts';
import store from '~/store';

const mockCopy = jest.fn();
jest.mock('copy-to-clipboard', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCopy(...args),
}));

jest.mock('~/hooks', () => ({
  useLocalize:
    () =>
    (key: string, params?: Record<string, string>): string =>
      params ? `${key} ${Object.values(params).join(' ')}` : key,
}));

/* The real tabs mount Monaco and Sandpack, neither of which runs in jsdom.
 * The stub reports which artifact the panel handed down so the tests can
 * assert on the panel's own behavior. */
jest.mock('../ArtifactTabs', () => ({
  __esModule: true,
  default: ({ artifact }: { artifact: { id: string } }) => (
    <div data-testid="artifact-tabs">{artifact.id}</div>
  ),
}));

const mockUseArtifacts = jest.fn();
jest.mock('~/hooks/Artifacts/useArtifacts', () => ({
  __esModule: true,
  default: () => mockUseArtifacts(),
}));

const mockUseMutationState = jest.fn();
jest.mock('~/Providers', () => ({
  useShareContext: () => ({ isSharedConvo: false }),
  useMutationState: () => mockUseMutationState(),
}));

const buildArtifact = (overrides: Partial<Artifact> = {}): Artifact =>
  ({
    id: 'artifact-1',
    identifier: 'artifact-1',
    title: 'report.html',
    type: TOOL_ARTIFACT_TYPES.HTML,
    content: '<p>hello</p>',
    lastUpdateTime: 1,
    ...overrides,
  }) as Artifact;

const setPanelState = (overrides: Record<string, unknown> = {}) => {
  const setActiveTab = jest.fn();
  const setCurrentArtifactId = jest.fn();
  mockUseArtifacts.mockReturnValue({
    activeTab: 'preview',
    setActiveTab,
    currentIndex: 0,
    currentArtifact: buildArtifact(),
    orderedArtifactIds: ['artifact-1'],
    setCurrentArtifactId,
    ...overrides,
  });
  return { setActiveTab, setCurrentArtifactId };
};

/** Makes `useMediaQuery('(max-width: Npx)')` answer for a simulated viewport. */
const setViewportWidth = (width: number) => {
  window.matchMedia = jest.fn().mockImplementation((query: string) => {
    const match = query.match(/max-width:\s*([\d.]+)px/);
    const matches = match ? width <= Number(match[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
  }) as unknown as typeof window.matchMedia;
};

let visibilityProbe: boolean | undefined;
let artifactIdProbe: string | null | undefined;

function StateProbe() {
  visibilityProbe = useRecoilValue(store.artifactsVisibility);
  artifactIdProbe = useRecoilValue(store.currentArtifactId);
  return null;
}

/* The panel's download control fetches the stored original for the office
 * preview buckets, so it needs the query client the app always provides. */
const renderPanel = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RecoilRoot
        initializeState={({ set }) => {
          set(store.artifactsVisibility, true);
          set(store.currentArtifactId, 'artifact-1');
        }}
      >
        <EditorProvider>
          <StateProbe />
          <ArtifactsPanel />
        </EditorProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );

describe('Artifacts panel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseArtifacts.mockReset();
    mockUseMutationState.mockReset();
    mockCopy.mockReset();
    mockUseMutationState.mockReturnValue({ isMutating: false, setIsMutating: jest.fn() });
    setViewportWidth(1280);
    visibilityProbe = undefined;
    artifactIdProbe = undefined;
  });

  afterEach(() => {
    /* Discard rather than run: the panel's entry animation and the copied-state
     * reset are scheduled with setTimeout, and firing them after the test has
     * torn the tree down leaves React updating unmounted components. */
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('view choices per artifact type', () => {
    it('offers both code and preview for a rendered artifact', () => {
      setPanelState();
      renderPanel();

      const choices = screen.getAllByRole('radio').map((node) => node.textContent);
      expect(choices).toEqual(['com_ui_code', 'com_ui_preview']);
    });

    it('offers only the preview, labelled with the file name, for an office document', () => {
      setPanelState({
        currentArtifact: buildArtifact({
          title: 'contract.docx',
          type: TOOL_ARTIFACT_TYPES.DOCX,
        }),
      });
      renderPanel();

      const choices = screen.getAllByRole('radio');
      expect(choices).toHaveLength(1);
      expect(choices[0]).toHaveTextContent('contract.docx');
      expect(screen.queryByText('com_ui_code')).not.toBeInTheDocument();
    });

    it('offers only the source view, labelled with the file name, for a code file', () => {
      setPanelState({
        currentArtifact: buildArtifact({
          title: 'analysis.py',
          type: TOOL_ARTIFACT_TYPES.CODE,
        }),
      });
      renderPanel();

      const choices = screen.getAllByRole('radio');
      expect(choices).toHaveLength(1);
      expect(choices[0]).toHaveTextContent('analysis.py');
      expect(screen.queryByText('com_ui_preview')).not.toBeInTheDocument();
    });

    it('forces a constrained artifact onto its only view', () => {
      const { setActiveTab } = setPanelState({
        activeTab: 'code',
        currentArtifact: buildArtifact({
          title: 'sheet.xlsx',
          type: TOOL_ARTIFACT_TYPES.SPREADSHEET,
        }),
      });
      renderPanel();

      expect(setActiveTab).toHaveBeenCalledWith('preview');
    });
  });

  /* The panel picks which artifact to show and hands it to the editor tabs.
   * Handing down a stale one is the failure mode the version stepper makes
   * possible, and nothing else in this file reads what the tabs received. */
  it('hands the shown artifact down to the editor', () => {
    setPanelState({ currentArtifact: buildArtifact({ id: 'artifact-2', title: 'second.html' }) });
    renderPanel();

    expect(screen.getByTestId('artifact-tabs')).toHaveTextContent('artifact-2');
  });

  describe('header actions', () => {
    it('copies the artifact content', () => {
      setPanelState();
      renderPanel();

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_copy' }));

      expect(mockCopy).toHaveBeenCalledWith('<p>hello</p>', { format: 'text/plain' });
    });

    it('does not touch the clipboard when the artifact is empty', () => {
      setPanelState({ currentArtifact: buildArtifact({ content: '' }) });
      const { unmount } = renderPanel();

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_copy' }));
      expect(mockCopy).not.toHaveBeenCalled();

      /* The same click on a filled artifact must copy. Without this the
       * assertion above would also hold if the button were simply dead. */
      unmount();
      setPanelState();
      renderPanel();
      fireEvent.click(screen.getByRole('button', { name: 'com_ui_copy' }));
      expect(mockCopy).toHaveBeenCalledTimes(1);
    });

    it('closes the panel and forgets the shown artifact', () => {
      setPanelState();
      renderPanel();

      /* Both probes are read before the click. Without the second one,
       * "the panel forgot the artifact" would also hold if the id had never
       * been set — the assertion would pass without the close doing anything. */
      expect(visibilityProbe).toBe(true);
      expect(artifactIdProbe).toBe('artifact-1');

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_close' }));

      expect(visibilityProbe).toBe(false);
      expect(artifactIdProbe).toBeNull();
    });

    it('shows the refresh action on the preview view only', () => {
      setPanelState({ activeTab: 'preview' });
      const { unmount } = renderPanel();
      expect(screen.getByRole('button', { name: 'com_ui_refresh' })).toBeInTheDocument();
      unmount();

      setPanelState({ activeTab: 'code' });
      renderPanel();
      expect(screen.queryByRole('button', { name: 'com_ui_refresh' })).not.toBeInTheDocument();
    });

    it('offers the version stepper only when more than one artifact is open', () => {
      setPanelState({ orderedArtifactIds: ['artifact-1'] });
      const { unmount } = renderPanel();
      expect(
        screen.queryByRole('button', { name: 'com_ui_change_version' }),
      ).not.toBeInTheDocument();
      unmount();

      setPanelState({ orderedArtifactIds: ['artifact-1', 'artifact-2'] });
      renderPanel();
      expect(screen.getByRole('button', { name: 'com_ui_change_version' })).toBeInTheDocument();
    });

    it('moves to another open file from the version stepper', async () => {
      const { setCurrentArtifactId } = setPanelState({
        orderedArtifactIds: ['artifact-1', 'artifact-2'],
      });
      renderPanel();

      fireEvent.click(screen.getByRole('button', { name: 'com_ui_change_version' }));
      const second = await screen.findByRole('menuitem', { name: /com_ui_version_var 2/ });
      fireEvent.click(second);

      expect(setCurrentArtifactId).toHaveBeenCalledWith('artifact-2');
    });

    it('locks the view switch while a save is in flight, except on the source view', () => {
      mockUseMutationState.mockReturnValue({ isMutating: true, setIsMutating: jest.fn() });
      setPanelState({ activeTab: 'preview' });
      const { unmount } = renderPanel();
      expect(screen.getAllByRole('radio')[0]).toBeDisabled();
      unmount();

      setPanelState({ activeTab: 'code' });
      renderPanel();
      expect(screen.getAllByRole('radio')[0]).toBeEnabled();
    });

    it('keeps only the safe external action for a Google document preview', () => {
      setPanelState({
        currentArtifact: buildArtifact({
          id: 'google-workspace:document:doc_123',
          title: 'Quarterly plan',
          type: TOOL_ARTIFACT_TYPES.GOOGLE_WORKSPACE,
          content: '',
          googleWorkspace: {
            provider: 'google_drive',
            fileId: 'doc_123',
            name: 'Quarterly plan',
            mimeType: 'application/vnd.google-apps.document',
            viewUrl: 'https://docs.google.com/document/d/doc_123/edit',
            kind: 'document',
          },
        }),
      });
      renderPanel();

      expect(screen.getByText('Quarterly plan')).toBeInTheDocument();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_refresh' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_copy' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'com_ui_download_artifact' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'com_ui_open_in_google_docs' })).toHaveAttribute(
        'href',
        'https://docs.google.com/document/d/doc_123/edit',
      );
    });
  });

  /* Phone and desktop differ in where the view switch lives: the desktop keeps
   * it inline in the header, the phone moves it to a full-width strip at the
   * foot of the sheet. `fullWidth` is what makes the buttons stretch, so it is
   * the observable difference between the two layouts. */
  describe('layout', () => {
    it('keeps the view switch inline in the header on the desktop', () => {
      setPanelState();
      renderPanel();

      expect(screen.getByRole('radiogroup')).not.toHaveClass('flex');
      expect(screen.getAllByRole('radio')[0]).not.toHaveClass('flex-1');
    });

    it('moves the view switch to a full-width strip on a phone', () => {
      setViewportWidth(390);
      setPanelState();
      renderPanel();

      expect(screen.getByRole('radiogroup')).toHaveClass('flex');
      expect(screen.getAllByRole('radio')[0]).toHaveClass('flex-1');
    });

    it('uses a non-draggable full-screen surface for Google files on a phone', () => {
      setViewportWidth(390);
      setPanelState({
        currentArtifact: buildArtifact({
          id: 'google-workspace:spreadsheet:sheet_123',
          title: 'Budget',
          type: TOOL_ARTIFACT_TYPES.GOOGLE_WORKSPACE,
          content: '',
          googleWorkspace: {
            provider: 'google_drive',
            fileId: 'sheet_123',
            name: 'Budget',
            mimeType: 'application/vnd.google-apps.spreadsheet',
            viewUrl: 'https://docs.google.com/spreadsheets/d/sheet_123/edit',
            kind: 'spreadsheet',
          },
        }),
      });
      renderPanel();

      const frame = screen.getByTitle('Budget');
      const surface = frame.closest('.fixed');
      expect(surface).toHaveStyle({ height: '100vh' });
      expect(surface).not.toHaveClass('rounded-t-[20px]');
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'com_ui_open_in_google_sheets' }),
      ).toBeInTheDocument();
    });
  });
});
