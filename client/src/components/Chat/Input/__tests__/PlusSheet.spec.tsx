/**
 * The phone's «+» sheet (book screen 5): one entry point for uploads and tool
 * toggles, replacing the separate Tools button below md. This spec covers the
 * mechanics the book's caption promises: the trigger opens the sheet, the
 * three tiles arm the right picker (Camera adds `capture`), and a switch row
 * drives the tool's debounced toggle.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockDebouncedChange = jest.fn();
const toggle = (state = false) => ({
  toggleState: state,
  debouncedChange: mockDebouncedChange,
  isPinned: false,
  authData: { authenticated: true },
});

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    agentsConfig: null,
    toolLoopUnavailable: false,
    activeModel: 'e2e',
    skills: toggle(),
    webSearch: toggle(),
    deepResearch: toggle(),
    artifacts: toggle(),
    fileSearch: toggle(),
    codeInterpreter: toggle(),
    searchApiKeyForm: {},
    mcpServerManager: {},
  }),
}));

jest.mock('../Files/useAttachConfig', () => ({
  __esModule: true,
  default: () => ({
    attachMode: 'direct',
    endpoint: 'openAI',
    endpointType: undefined,
    endpointFileConfig: undefined,
    useResponsesApi: undefined,
    conversationId: 'c1',
    isAgents: false,
    isUploadDisabled: false,
  }),
}));

const mockHandleFileChange = jest.fn();
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
  useAgentCapabilities: () => ({
    contextEnabled: false,
    fileSearchEnabled: true,
    codeEnabled: true,
    webSearchEnabled: true,
    deepResearchEnabled: true,
    artifactsEnabled: true,
    skillsEnabled: true,
  }),
  useAgentToolPermissions: () => ({
    fileSearchAllowedByAgent: true,
    codeAllowedByAgent: true,
    provider: undefined,
  }),
  useFileHandlingNoChatContext: () => ({ handleFileChange: mockHandleFileChange }),
}));

jest.mock('recoil', () => ({
  useRecoilState: () => [{}, jest.fn()],
}));

jest.mock('~/store', () => ({
  ephemeralAgentByConvoId: () => 'ephemeral-agent',
}));

import PlusSheet from '../PlusSheet';

const renderSheet = () =>
  render(
    <PlusSheet
      conversation={null}
      disableInputs={false}
      showEphemeralBadges={true}
      files={new Map()}
      setFiles={jest.fn()}
      setFilesLoading={jest.fn()}
    />,
  );

const openSheet = async () => {
  fireEvent.click(screen.getByTestId('plus-sheet-trigger'));
  await waitFor(() => expect(screen.getByTestId('plus-sheet')).toBeInTheDocument());
};

describe('the plus sheet', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens from the trigger with the three tiles and the tool rows', async () => {
    renderSheet();
    await openSheet();

    expect(screen.getByText('com_ui_camera')).toBeInTheDocument();
    expect(screen.getByText('com_ui_photo')).toBeInTheDocument();
    expect(screen.getByText('com_ui_files')).toBeInTheDocument();
    for (const row of [
      'web_search',
      'deep_research',
      'run_code',
      'file_search',
      'skills',
      'artifacts',
    ]) {
      expect(screen.getByTestId(`plus-sheet-${row}`)).toBeInTheDocument();
    }
  });

  it('arms the camera capture on the Camera tile, and no capture on Photo', async () => {
    const { container } = renderSheet();
    await openSheet();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = jest.spyOn(input, 'click').mockImplementation(() => {
      /* jsdom would open nothing anyway; the assertion is the attributes at click time */
      expect(input.getAttribute('capture')).toBe('environment');
      expect(input.accept).toBe('image/*');
    });
    fireEvent.click(screen.getByText('com_ui_camera'));
    expect(click).toHaveBeenCalledTimes(1);

    await openSheet();
    click.mockImplementation(() => {
      expect(input.getAttribute('capture')).toBeNull();
      expect(input.accept).toBe('image/*,.heif,.heic');
    });
    fireEvent.click(screen.getByText('com_ui_photo'));
    expect(click).toHaveBeenCalledTimes(2);
  });

  /* 12.08, владелец: iOS вставляет свой выбор «Медиатека/Снять/Файлы», когда в
   * accept есть image/video; список из ОДНИХ документов открывает Файлы сразу.
   * Сторож держит ровно момент клика — после него accept сбрасывается. */
  it('keeps image types out of the Files tile, so iOS opens its file browser directly', async () => {
    const { container } = renderSheet();
    await openSheet();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = jest.spyOn(input, 'click').mockImplementation(() => {
      expect(input.accept).toContain('.pdf');
      expect(input.accept).not.toMatch(/image|video|audio|heic|heif/);
      expect(input.getAttribute('capture')).toBeNull();
    });
    fireEvent.click(screen.getByText('com_ui_files'));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('drives a tool toggle from its switch row', async () => {
    renderSheet();
    await openSheet();
    const row = screen.getByTestId('plus-sheet-file_search');
    fireEvent.click(row.querySelector('button[role="switch"]') as HTMLElement);
    expect(mockDebouncedChange).toHaveBeenCalledWith({ value: true });
  });
});
