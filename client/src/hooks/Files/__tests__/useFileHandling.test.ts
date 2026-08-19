import { renderHook, act } from '@testing-library/react';
import { Constants, EModelEndpoint, getEndpointFileConfig } from 'librechat-data-provider';

beforeAll(() => {
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  global.URL.revokeObjectURL = jest.fn();
});

const mockShowToast = jest.fn();
const mockSetFilesLoading = jest.fn();
const mockMutate = jest.fn();

let mockConversation: Record<string, string | null | undefined> = {};
let mockIsTemporary = false;

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: jest.fn(() => ({
    files: new Map(),
    setFiles: jest.fn(),
    setFilesLoading: mockSetFilesLoading,
    conversation: mockConversation,
  })),
}));

jest.mock('@librechat/client', () => ({
  useToastContext: jest.fn(() => ({
    showToast: mockShowToast,
  })),
}));

jest.mock('recoil', () => ({
  ...jest.requireActual('recoil'),
  useSetRecoilState: jest.fn(() => jest.fn()),
  useRecoilValue: jest.fn(() => mockIsTemporary),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: { isTemporary: { key: 'isTemporary' } },
  ephemeralAgentByConvoId: jest.fn(() => ({ key: 'mock' })),
  fileModeByConvoId: jest.fn(() => ({ key: 'mockFileMode' })),
}));

/** Endpoints config the hook reads out of the query cache; set per test. */
let mockEndpointsConfig: Record<string, unknown> | undefined;

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(() => ({
    getQueryData: jest.fn(() => mockEndpointsConfig),
    refetchQueries: jest.fn(),
  })),
}));

/* The upload mutation's own callbacks, captured so a test can play the server's
 * answer back. The image-capability notice is decided on that answer — an image
 * the server read through comes back carrying `text` — so a mock that only
 * swallows `mutate` cannot exercise it. */
let uploadCallbacks: { onSuccess?: (data: Record<string, unknown>) => void } = {};

jest.mock('~/data-provider', () => ({
  useGetFileConfig: jest.fn(() => ({ data: null })),
  useUploadFileMutation: jest.fn((opts: Record<string, unknown>) => {
    uploadCallbacks = opts as { onSuccess?: (data: Record<string, unknown>) => void };
    return { mutate: mockMutate };
  }),
}));

/**
 * `useLocalize` is a hook that *returns* the localize function — the previous mock
 * stood in for the localize function itself, so `useLocalize()` yielded undefined
 * and any code path that actually localized threw. No test reached one until the
 * image-capability warning below.
 */
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: jest.fn(() => (key: string) => key),
  TranslationKeys: {},
}));

jest.mock('../useDelayedUploadToast', () => ({
  useDelayedUploadToast: jest.fn(() => ({
    startUploadTimer: jest.fn(),
    clearUploadTimer: jest.fn(),
  })),
}));

jest.mock('~/utils/heicConverter', () => ({
  processFileForUpload: jest.fn(async (file: File) => file),
}));

jest.mock('../useClientResize', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    resizeImageIfNeeded: jest.fn(async (file: File) => ({ file, resized: false })),
  })),
}));

jest.mock('../useUpdateFiles', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    addFile: jest.fn(),
    replaceFile: jest.fn(),
    updateFileById: jest.fn(),
    deleteFileById: jest.fn(),
  })),
}));

jest.mock('~/utils', () => ({
  logger: { log: jest.fn() },
  validateFiles: jest.fn(() => true),
  cachePreview: jest.fn(),
  getCachedPreview: jest.fn(() => undefined),
}));

const mockValidateFiles = jest.requireMock('~/utils').validateFiles;

describe('useFileHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConversation = {};
    mockIsTemporary = false;
    mockEndpointsConfig = undefined;
  });

  const loadHook = async () => (await import('../useFileHandling')).default;

  describe('endpointOverride', () => {
    it('uses conversation endpoint when no override is provided', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling());

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockValidateFiles).toHaveBeenCalledTimes(1);
      const validateCall = mockValidateFiles.mock.calls[0][0];
      const configResult = getEndpointFileConfig({
        endpoint: 'openAI',
        endpointType: 'custom',
        fileConfig: null,
      });
      expect(validateCall.endpointFileConfig).toEqual(configResult);
    });

    it('uses endpointOverride for validation instead of conversation endpoint', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() =>
        useFileHandling({ endpointOverride: EModelEndpoint.agents }),
      );

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockValidateFiles).toHaveBeenCalledTimes(1);
      const validateCall = mockValidateFiles.mock.calls[0][0];
      const agentsConfig = getEndpointFileConfig({
        endpoint: EModelEndpoint.agents,
        endpointType: EModelEndpoint.agents,
        fileConfig: null,
      });
      expect(validateCall.endpointFileConfig).toEqual(agentsConfig);
    });

    it('falls back to conversation endpoint when endpointOverride is undefined', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'anthropic',
        endpointType: undefined,
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling({ endpointOverride: undefined }));

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockValidateFiles).toHaveBeenCalledTimes(1);
      const validateCall = mockValidateFiles.mock.calls[0][0];
      const anthropicConfig = getEndpointFileConfig({
        endpoint: 'anthropic',
        endpointType: undefined,
        fileConfig: null,
      });
      expect(validateCall.endpointFileConfig).toEqual(anthropicConfig);
    });

    it('sends correct endpoint in upload form data when override is set', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() =>
        useFileHandling({
          endpointOverride: EModelEndpoint.agents,
          additionalMetadata: { agent_id: 'agent-123' },
        }),
      );

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('endpoint')).toBe(EModelEndpoint.agents);
      expect(formData.get('endpointType')).toBe(EModelEndpoint.agents);
      expect(formData.get('conversationId')).toBeNull();
    });

    it('does not enter assistants upload path when override is agents', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'assistants',
        endpointType: 'assistants',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() =>
        useFileHandling({
          endpointOverride: EModelEndpoint.agents,
          additionalMetadata: { agent_id: 'agent-123' },
        }),
      );

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('endpoint')).toBe(EModelEndpoint.agents);
      expect(formData.get('message_file')).toBeNull();
      expect(formData.get('version')).toBeNull();
      expect(formData.get('model')).toBeNull();
      expect(formData.get('assistant_id')).toBeNull();
    });

    it('enters assistants path without override when conversation is assistants', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'assistants',
        endpointType: 'assistants',
        assistant_id: 'asst-456',
        model: 'gpt-4',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling());

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('endpoint')).toBe('assistants');
      expect(formData.get('message_file')).toBe('true');
    });

    it('falls back to "default" when no conversation endpoint and no override', async () => {
      mockConversation = {
        conversationId: Constants.NEW_CONVO as string,
        endpoint: null,
        endpointType: undefined,
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling());

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('endpoint')).toBe('default');
      expect(formData.get('conversationId')).toBeNull();
    });

    it('sends temporary flag for temporary chat uploads', async () => {
      mockIsTemporary = true;
      mockConversation = {
        conversationId: Constants.NEW_CONVO as string,
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling());

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('conversationId')).toBeNull();
      expect(formData.get('isTemporary')).toBe('true');
    });

    it('does not send temporary flag for assistant builder uploads', async () => {
      mockIsTemporary = true;
      mockConversation = {
        conversationId: 'temporary-convo',
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() =>
        useFileHandling({
          additionalMetadata: { assistant_id: 'asst-123' },
        }),
      );

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('assistant_id')).toBe('asst-123');
      expect(formData.get('conversationId')).toBeNull();
      expect(formData.get('isTemporary')).toBeNull();
    });

    it('does not send temporary flag for agent builder uploads', async () => {
      mockIsTemporary = true;
      mockConversation = {
        conversationId: 'temporary-convo',
        endpoint: 'openAI',
        endpointType: 'custom',
      };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() =>
        useFileHandling({
          endpointOverride: EModelEndpoint.agents,
          additionalMetadata: { agent_id: 'agent-123' },
        }),
      );

      const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });

      await act(async () => {
        await result.current.handleFiles([textFile]);
      });

      expect(mockMutate).toHaveBeenCalledTimes(1);
      const formData: FormData = mockMutate.mock.calls[0][0];
      expect(formData.get('agent_id')).toBe('agent-123');
      expect(formData.get('conversationId')).toBeNull();
      expect(formData.get('isTemporary')).toBeNull();
    });
  });

  /**
   * Attaching a picture to a model that cannot read one warns the user. Getting
   * this wrong is not neutral in either direction: a false warning tells someone
   * on a working model that their model is broken (which is what a stale name
   * list did when Claude 5 shipped), and a missing one lets the attachment fail
   * silently at the provider.
   */
  describe('image capability warning', () => {
    /** Plays back the upload response for one attached image. `text` present =
     * the OCR gate read the picture and the model will receive words, not pixels. */
    const attachImage = async ({
      text = '',
      count = 1,
    }: { text?: string; count?: number } = {}) => {
      const useFileHandling = (await import('../useFileHandling')).default;
      const { result } = renderHook(() => useFileHandling());
      const images = Array.from(
        { length: count },
        (_, i) => new File(['x'], `photo-${i}.png`, { type: 'image/png' }),
      );
      await act(async () => {
        await result.current.handleFiles(images);
      });
      await act(async () => {
        for (let i = 0; i < count; i++) {
          uploadCallbacks.onSuccess?.({
            temp_file_id: `temp-${i}`,
            file_id: `file-${i}`,
            type: 'image/png',
            filename: `photo-${i}.png`,
            text,
          });
        }
      });
    };

    const warned = () =>
      mockShowToast.mock.calls.some(
        ([arg]) => (arg as { message?: string })?.message === 'com_warning_model_no_vision',
      );

    const withCatalogue = (capabilities: Record<string, unknown>) => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'custom-gw',
        model: 'vendor/model',
      };
      mockEndpointsConfig = { 'custom-gw': { modelCapabilities: capabilities } };
    };

    it('stays silent when the gateway says the model reads images', async () => {
      withCatalogue({ 'vendor/model': { vision: true } });

      await attachImage();

      expect(warned()).toBe(false);
    });

    it('warns when the gateway says the model does not read images', async () => {
      withCatalogue({ 'vendor/model': { vision: false } });

      await attachImage();

      expect(warned()).toBe(true);
    });

    /**
     * The picture the platform read for you is not a picture any more. Warning
     * here is worse than useless: it sends someone on a text-only model off to
     * switch models for a receipt whose text is already on its way to that same
     * model. The verdict therefore waits for the upload response.
     */
    it('stays silent when the server read the image and returned its text', async () => {
      withCatalogue({ 'vendor/model': { vision: false } });

      await attachImage({ text: 'ИТОГО 785.00 БЕЗНАЛИЧНЫМИ' });

      expect(warned()).toBe(false);
    });

    it('warns once for a batch, not once per image', async () => {
      withCatalogue({ 'vendor/model': { vision: false } });

      await attachImage({ count: 3 });

      const warnings = mockShowToast.mock.calls.filter(
        ([arg]) => (arg as { message?: string })?.message === 'com_warning_model_no_vision',
      );
      expect(warnings).toHaveLength(1);
    });

    /**
     * The behaviour this replaces treated the catalogue as a whitelist, so any
     * model missing from it was declared image-blind. A model the catalogue does
     * not cover is unknown, not incapable — fall back to name matching.
     */
    it('falls back to name matching for a model the catalogue does not cover', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'custom-gw',
        model: 'gpt-4o',
      };
      mockEndpointsConfig = {
        'custom-gw': { modelCapabilities: { 'vendor/other': { vision: true } } },
      };

      await attachImage();

      expect(warned()).toBe(false);
    });

    it('falls back when the catalogue lists the model but states no modalities', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'custom-gw',
        model: 'gpt-4o',
      };
      mockEndpointsConfig = { 'custom-gw': { modelCapabilities: { 'gpt-4o': {} } } };

      await attachImage();

      expect(warned()).toBe(false);
    });

    it('falls back when the gateway published no catalogue at all', async () => {
      mockConversation = {
        conversationId: 'convo-1',
        endpoint: 'custom-gw',
        model: 'text-only-model',
      };
      mockEndpointsConfig = { 'custom-gw': {} };

      await attachImage();

      expect(warned()).toBe(true);
    });
  });

  describe('initial chip record (owner 19.08-2)', () => {
    /* The chip renders from this record from the very first frame. Without
     * `filename` the card spent the whole upload as a bare size line and the
     * name popped in only with the server response. */
    it('carries the filename before any server response', async () => {
      mockConversation = { conversationId: 'convo-1', endpoint: 'openAI' };

      const useFileHandling = await loadHook();
      const { result } = renderHook(() => useFileHandling());

      const sqlFile = new File(['select 1;'], 'schema.sql', { type: '' });
      await act(async () => {
        await result.current.handleFiles([sqlFile]);
      });

      const updateFilesMock = jest.requireMock('../useUpdateFiles').default;
      const addFileCalls = updateFilesMock.mock.results.flatMap(
        (result: { value: { addFile: jest.Mock } }) => result.value.addFile.mock.calls,
      );
      expect(addFileCalls.length).toBeGreaterThan(0);
      expect(addFileCalls[0][0]).toEqual(
        expect.objectContaining({ filename: 'schema.sql', progress: 0.1 }),
      );
    });
  });
});
