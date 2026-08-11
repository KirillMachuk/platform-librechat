import { renderHook, act } from '@testing-library/react';
import { useLibraryUpload } from './useLibraryUpload';

const mockMutateAsync = jest.fn();
const mockShowToast = jest.fn();
const mockValidateFiles = jest.fn();
let mockFilesList: Array<{ filename: string }> = [];
let mockFileConfig: Record<string, unknown> = {};
/** Every localize(key, values) call, so a test can assert the NUMBERS a message carries and not
 * just its key — the whole point of naming the limit is the numbers inside it. */
const localizeCalls: Array<[string, Record<string, string> | undefined]> = [];

jest.mock('~/data-provider', () => ({
  useGetFiles: () => ({ data: mockFilesList }),
  useUploadFileMutation: () => ({ mutateAsync: mockMutateAsync }),
  useGetFileConfig: () => ({ data: mockFileConfig }),
}));
/* NO ChatContext mock — deliberately. The hook is rendered here WITHOUT a ChatContext.Provider,
 * exactly as it is in production when the Files modal opens from the global sidebar / account
 * menu. An earlier version read `useChatContext()`, which throws outside a provider; mocking it
 * hid that the upload died before any request left the browser. The library is standalone, so
 * the hook must not depend on chat context at all. */
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) => {
    localizeCalls.push([key, values]);
    return key;
  },
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('librechat-data-provider', () => ({
  EModelEndpoint: { agents: 'agents' },
  EToolResources: { context: 'context' },
  mergeFileConfig: (d: unknown) => d,
  getEndpointFileConfig: () => ({ fileLimit: 10 }),
}));
jest.mock('~/utils', () => ({
  validateFiles: (...args: unknown[]) => mockValidateFiles(...args),
}));

/**
 * Drives the REAL upload path: openFilePicker() creates a body-level <input>, then we set its
 * files and dispatch a genuine `change` — exercising the same DOM the browser does, not a fake
 * event object. (The old direct-handler test missed the whole picker/dialog interaction.)
 */
async function pick(openFilePicker: () => void, files: File[]) {
  await act(async () => {
    openFilePicker();
  });
  const input = document.body.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) {
    throw new Error('openFilePicker did not create a file input on document.body');
  }
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change'));
  });
}

function formDataAt(call: number): FormData {
  return mockMutateAsync.mock.calls[call][0] as FormData;
}

function dropEvent(files: File[]) {
  return {
    dataTransfer: { files, types: ['Files'] },
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
  } as unknown as React.DragEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFilesList = [];
  mockFileConfig = {};
  localizeCalls.length = 0;
  mockMutateAsync.mockResolvedValue({});
  mockValidateFiles.mockReturnValue(true); // valid by default
});

describe('useLibraryUpload', () => {
  it('mounts and uploads WITHOUT a ChatContext.Provider (regression: sidebar/account menu)', async () => {
    /* renderHook wraps nothing — no ChatContext. Before the fix this threw and no upload fired. */
    const { result } = renderHook(() => useLibraryUpload());
    const doc = new File(['contract'], 'lease.pdf', { type: 'application/pdf' });
    await pick(result.current.openFilePicker, [doc]);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    const fd = formDataAt(0);
    expect(fd.get('tool_resource')).toBe('context');
    expect(fd.get('message_file')).toBe('true');
    // Fixed standalone endpoint — routes to processAgentFileUpload (context + library indexing).
    expect(fd.get('endpoint')).toBe('agents');
  });

  it('uploads an image WITHOUT tool_resource and warns it is not searchable', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const img = new File(['bytes'], 'scan.png', { type: 'image/png' });
    await pick(result.current.openFilePicker, [img]);
    expect(formDataAt(0).get('tool_resource')).toBeNull();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_images_not_indexed', status: 'info' }),
    );
  });

  it('fires one upload per file for a batch (multi-select)', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
      new File(['c'], 'c.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ];
    await pick(result.current.openFilePicker, files);
    expect(mockMutateAsync).toHaveBeenCalledTimes(3);
  });

  it('rejects a selection larger than the batch cap without uploading', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const many = Array.from(
      { length: 201 },
      (_, i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }),
    );
    await pick(result.current.openFilePicker, many);
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_upload_too_many', status: 'warning' }),
    );
  });

  /* The conflict this pair guards: the hook advertised a 200-file batch while the stand was
   * configured for 50 per hour. Measured live — 100 files in, 50 accepted in 3 seconds, 50
   * refused, and the user was told only "uploaded 50 of 100". The offer now comes from the
   * server's own limit, and a refusal names it. */
  it('never offers a bigger batch than the server accepts', async () => {
    mockFileConfig = { uploadLimits: { userMax: 50, userWindowInMinutes: 60 } };
    const { result } = renderHook(() => useLibraryUpload());
    const many = Array.from(
      { length: 51 },
      (_, i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }),
    );

    await pick(result.current.openFilePicker, many);

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(localizeCalls).toContainEqual(['com_ui_library_upload_too_many', { 0: '50' }]);
  });

  it('names the server limit when a batch is cut short by it', async () => {
    mockFileConfig = { uploadLimits: { userMax: 50, userWindowInMinutes: 60 } };
    mockMutateAsync
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 429 } });
    const { result } = renderHook(() => useLibraryUpload());
    const files = [0, 1, 2].map((i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }));

    await pick(result.current.openFilePicker, files);

    expect(localizeCalls).toContainEqual([
      'com_ui_library_upload_rate_limited',
      { 0: '1', 1: '3', 2: '50', 3: '60' },
    ]);
    /* "the rest failed, please retry them" is the advice that makes it worse: a refused request
     * counts against the window too. */
    expect(localizeCalls.map(([key]) => key)).not.toContain('com_ui_library_uploaded_partial');
  });

  it('falls back to its own cap when the server states no limit', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const many = Array.from(
      { length: 201 },
      (_, i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }),
    );

    await pick(result.current.openFilePicker, many);

    expect(localizeCalls).toContainEqual(['com_ui_library_upload_too_many', { 0: '200' }]);
  });

  it('keeps its own ceiling when the server reports an implausible one', async () => {
    mockFileConfig = { uploadLimits: { userMax: 5000, userWindowInMinutes: 60 } };
    const { result } = renderHook(() => useLibraryUpload());
    const many = Array.from(
      { length: 201 },
      (_, i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }),
    );

    await pick(result.current.openFilePicker, many);

    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(localizeCalls).toContainEqual(['com_ui_library_upload_too_many', { 0: '200' }]);
  });

  /* The endpoint's aggregate budget is a chat limit (200 MB here) and silently contradicted the
   * batch: 200 files at that ceiling demands an average under 1 MB, while the client's scanned
   * contracts average 6.7 MB. A realistic archive was refused in full before a single upload. */
  it('sizes the aggregate budget to the batch it offers, not to the chat budget', async () => {
    mockFileConfig = { uploadLimits: { userMax: 400, userWindowInMinutes: 60 } };
    const { result } = renderHook(() => useLibraryUpload());

    await pick(result.current.openFilePicker, [
      new File(['x'], 'scan.pdf', { type: 'application/pdf' }),
    ]);

    const passed = mockValidateFiles.mock.calls[0][0].endpointFileConfig;
    expect(passed.fileLimit).toBe(200);
    expect(passed.totalSizeLimit).toBe(200 * 10 * 1024 * 1024);
  });

  it('names the limit even when every file was refused', async () => {
    mockFileConfig = { uploadLimits: { userMax: 50, userWindowInMinutes: 60 } };
    mockMutateAsync.mockRejectedValue({ response: { status: 429 } });
    const { result } = renderHook(() => useLibraryUpload());

    await pick(result.current.openFilePicker, [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      new File(['x'], 'b.pdf', { type: 'application/pdf' }),
    ]);

    expect(localizeCalls).toContainEqual([
      'com_ui_library_upload_rate_limited',
      { 0: '0', 1: '2', 2: '50', 3: '60' },
    ]);
    expect(localizeCalls.map(([key]) => key)).not.toContain('com_error_files_upload');
  });

  it('does not blame the limit for an ordinary failure', async () => {
    mockFileConfig = { uploadLimits: { userMax: 50, userWindowInMinutes: 60 } };
    mockMutateAsync.mockRejectedValue({ response: { status: 500 } });
    const { result } = renderHook(() => useLibraryUpload());

    await pick(result.current.openFilePicker, [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    ]);

    expect(localizeCalls.map(([key]) => key)).not.toContain('com_ui_library_upload_rate_limited');
    expect(localizeCalls.map(([key]) => key)).toContain('com_error_files_upload');
  });

  /* Server numbers unavailable: still "later", never "retry them" — that advice is what makes
   * the wait longer, because a refused request counts against the window too. */
  it('avoids the harmful retry advice when the limit is unknown', async () => {
    mockFileConfig = {};
    mockMutateAsync.mockResolvedValueOnce({}).mockRejectedValueOnce({ response: { status: 429 } });
    const { result } = renderHook(() => useLibraryUpload());

    await pick(result.current.openFilePicker, [
      new File(['x'], 'a.pdf', { type: 'application/pdf' }),
      new File(['x'], 'b.pdf', { type: 'application/pdf' }),
    ]);

    const keys = localizeCalls.map(([key]) => key);
    expect(keys).toContain('com_ui_library_upload_rate_limited_unknown');
    expect(keys).not.toContain('com_ui_library_uploaded_partial');
  });

  it('does not upload when validation fails', async () => {
    mockValidateFiles.mockImplementation(({ setError }: { setError: (e: string) => void }) => {
      setError('Unsupported file type: application/x-msdownload');
      return false;
    });
    const { result } = renderHook(() => useLibraryUpload());
    const bad = new File(['x'], 'evil.exe', { type: 'application/x-msdownload' });
    await pick(result.current.openFilePicker, [bad]);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('reports a partial-failure summary when some uploads fail', async () => {
    mockMutateAsync
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({});
    const { result } = renderHook(() => useLibraryUpload());
    const files = [
      new File(['a'], 'a.pdf', { type: 'application/pdf' }),
      new File(['b'], 'b.pdf', { type: 'application/pdf' }),
      new File(['c'], 'c.pdf', { type: 'application/pdf' }),
    ];
    await pick(result.current.openFilePicker, files);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_uploaded_partial', status: 'warning' }),
    );
  });

  it('does nothing when no files are selected', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    await pick(result.current.openFilePicker, []);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('uploads even after the host dialog UNMOUNTS (the production bug)', async () => {
    /* Opening the OS picker blurs the window, which closes the Radix/Headless dialog and would
     * unmount an in-tree <input> before `change` fires. The body-level input survives that.
     * Simulate it: open the picker, unmount the hook, THEN deliver the file selection. */
    const { result, unmount } = renderHook(() => useLibraryUpload());
    const openFilePicker = result.current.openFilePicker;
    await act(async () => {
      openFilePicker();
    });
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;
    unmount(); // dialog closed
    const doc = new File(['contract'], 'lease.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [doc], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('useLibraryUpload — drag-and-drop и дубликаты', () => {
  it('drop загружает файлы и глушит чатовый dropzone (stopPropagation)', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const doc = new File(['contract'], 'lease.pdf', { type: 'application/pdf' });
    const event = dropEvent([doc]);
    await act(async () => {
      result.current.dropHandlers.onDrop(event);
    });
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(formDataAt(0).get('tool_resource')).toBe('context');
  });

  it('drag чего-то, кроме файлов (текст со страницы), полностью игнорируется', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const event = {
      dataTransfer: { files: [], types: ['text/plain'] },
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    } as unknown as React.DragEvent;
    await act(async () => {
      result.current.dropHandlers.onDrop(event);
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('повторная загрузка существующего имени: файл грузится, но пользователю называют дубль', async () => {
    /* «0 реакции» на повторную загрузку выглядело как «не загрузилось» — теперь исход назван. */
    mockFilesList = [{ filename: 'lease.pdf' }];
    const { result } = renderHook(() => useLibraryUpload());
    const doc = new File(['contract v2'], 'lease.pdf', { type: 'application/pdf' });
    await pick(result.current.openFilePicker, [doc]);
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_duplicate_names', status: 'info' }),
    );
  });

  it('новое имя дубль-тоста не вызывает', async () => {
    mockFilesList = [{ filename: 'other.pdf' }];
    const { result } = renderHook(() => useLibraryUpload());
    const doc = new File(['contract'], 'lease.pdf', { type: 'application/pdf' });
    await pick(result.current.openFilePicker, [doc]);
    expect(mockShowToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_duplicate_names' }),
    );
  });
});
