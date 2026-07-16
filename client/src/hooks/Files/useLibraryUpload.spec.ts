import { renderHook, act } from '@testing-library/react';
import { useLibraryUpload } from './useLibraryUpload';

const mockMutateAsync = jest.fn();
const mockShowToast = jest.fn();
const mockValidateFiles = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetFiles: () => ({ data: [] }),
  useUploadFileMutation: () => ({ mutateAsync: mockMutateAsync }),
  useGetFileConfig: () => ({ data: {} }),
}));
jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({ conversation: null }),
}));
jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));
jest.mock('@librechat/client', () => ({
  useToastContext: () => ({ showToast: mockShowToast }),
}));
jest.mock('librechat-data-provider', () => ({
  EToolResources: { context: 'context' },
  mergeFileConfig: (d: unknown) => d,
  getEndpointFileConfig: () => ({ fileLimit: 10 }),
}));
jest.mock('~/utils', () => ({
  validateFiles: (...args: unknown[]) => mockValidateFiles(...args),
}));

function changeEvent(files: File[]) {
  return { target: { files, value: 'x' } } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function formDataAt(call: number): FormData {
  return mockMutateAsync.mock.calls[call][0] as FormData;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMutateAsync.mockResolvedValue({});
  mockValidateFiles.mockReturnValue(true); // valid by default
});

describe('useLibraryUpload', () => {
  it('uploads a document with tool_resource=context so it indexes into the library', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const doc = new File(['contract'], 'lease.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.handleFileUpload(changeEvent([doc]));
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    const fd = formDataAt(0);
    expect(fd.get('tool_resource')).toBe('context');
    expect(fd.get('message_file')).toBe('true');
    expect(fd.get('endpoint')).toBe('default');
  });

  it('uploads an image WITHOUT tool_resource and warns it is not searchable', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const img = new File(['bytes'], 'scan.png', { type: 'image/png' });
    await act(async () => {
      await result.current.handleFileUpload(changeEvent([img]));
    });
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
    await act(async () => {
      await result.current.handleFileUpload(changeEvent(files));
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(3);
  });

  it('rejects a selection larger than the batch cap without uploading', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    const many = Array.from(
      { length: 201 },
      (_, i) => new File(['x'], `f${i}.pdf`, { type: 'application/pdf' }),
    );
    await act(async () => {
      await result.current.handleFileUpload(changeEvent(many));
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_upload_too_many', status: 'warning' }),
    );
  });

  it('does not upload when validation fails', async () => {
    mockValidateFiles.mockImplementation(({ setError }: { setError: (e: string) => void }) => {
      setError('Unsupported file type: application/x-msdownload');
      return false;
    });
    const { result } = renderHook(() => useLibraryUpload());
    const bad = new File(['x'], 'evil.exe', { type: 'application/x-msdownload' });
    await act(async () => {
      await result.current.handleFileUpload(changeEvent([bad]));
    });
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
    await act(async () => {
      await result.current.handleFileUpload(changeEvent(files));
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'com_ui_library_uploaded_partial', status: 'warning' }),
    );
  });

  it('does nothing when no files are selected', async () => {
    const { result } = renderHook(() => useLibraryUpload());
    await act(async () => {
      await result.current.handleFileUpload(changeEvent([]));
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
