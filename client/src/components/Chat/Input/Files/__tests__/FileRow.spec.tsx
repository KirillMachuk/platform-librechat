import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FileSources, dataService } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import FileRow from '../FileRow';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: { ...actual.dataService, getFiles: jest.fn().mockResolvedValue([]) },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useDeleteFilesMutation: jest.fn(),
}));

jest.mock('~/hooks/Files', () => ({
  useFileDeletion: jest.fn(),
}));

jest.mock('~/utils', () => ({
  logger: {
    log: jest.fn(),
  },
  getCachedPreview: jest.fn(() => undefined),
}));

const mockShowToast = jest.fn();
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('../Image', () => {
  return function MockImage({ url, progress, source }: any) {
    return (
      <div data-testid="mock-image">
        <span data-testid="image-url">{url}</span>
        <span data-testid="image-progress">{progress}</span>
        <span data-testid="image-source">{source}</span>
      </div>
    );
  };
});

jest.mock('../FileContainer', () => {
  return function MockFileContainer({ file }: any) {
    return (
      <div data-testid="mock-file-container">
        <span data-testid="file-name">{file.filename}</span>
      </div>
    );
  };
});

const mockUseLocalize = jest.requireMock('~/hooks').useLocalize;
const mockUseDeleteFilesMutation = jest.requireMock('~/data-provider').useDeleteFilesMutation;
const mockUseFileDeletion = jest.requireMock('~/hooks/Files').useFileDeletion;

describe('FileRow', () => {
  const mockSetFiles = jest.fn();
  const mockSetFilesLoading = jest.fn();
  const mockDeleteFile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseLocalize.mockReturnValue((key: string) => {
      const translations: Record<string, string> = {
        com_ui_deleting_file: 'Deleting file...',
      };
      return translations[key] || key;
    });

    mockUseDeleteFilesMutation.mockReturnValue({
      mutateAsync: jest.fn(),
    });

    mockUseFileDeletion.mockReturnValue({
      deleteFile: mockDeleteFile,
    });
  });

  /**
   * Creates a mock ExtendedFile with sensible defaults
   */
  const createMockFile = (overrides: Partial<ExtendedFile> = {}): ExtendedFile => ({
    file_id: 'test-file-id',
    type: 'image/png',
    preview: 'blob:http://localhost:3080/preview-blob-url',
    filepath: '/images/user123/test-file-id__image.png',
    filename: 'test-image.png',
    progress: 1,
    size: 1024,
    source: FileSources.local,
    ...overrides,
  });

  const renderFileRow = (files: Map<string, ExtendedFile>) => {
    return render(
      <FileRow files={files} setFiles={mockSetFiles} setFilesLoading={mockSetFilesLoading} />,
    );
  };

  describe('Image URL Selection Logic', () => {
    it('should prefer cached preview over filepath when upload is complete', () => {
      const file = createMockFile({
        file_id: 'uploaded-file',
        preview: 'blob:http://localhost:3080/temp-preview',
        filepath: '/images/user123/uploaded-file__image.png',
        progress: 1,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe('blob:http://localhost:3080/temp-preview');
    });

    it('should use preview when progress is less than 1 (uploading)', () => {
      const file = createMockFile({
        file_id: 'uploading-file',
        preview: 'blob:http://localhost:3080/temp-preview',
        filepath: undefined,
        progress: 0.5,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe('blob:http://localhost:3080/temp-preview');
    });

    it('should fallback to filepath when preview is undefined and progress is less than 1', () => {
      const file = createMockFile({
        file_id: 'file-without-preview',
        preview: undefined,
        filepath: '/images/user123/file-without-preview__image.png',
        progress: 0.7,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe('/images/user123/file-without-preview__image.png');
    });

    it('should prefer preview over filepath when both exist and progress is 1', () => {
      const file = createMockFile({
        file_id: 'complete-file',
        preview: 'blob:http://localhost:3080/old-blob',
        filepath: '/images/user123/complete-file__image.png',
        progress: 1.0,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe('blob:http://localhost:3080/old-blob');
    });
  });

  describe('Progress States', () => {
    it('should pass correct progress value during upload', () => {
      const file = createMockFile({
        progress: 0.65,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const progress = screen.getByTestId('image-progress').textContent;
      expect(progress).toBe('0.65');
    });

    it('should pass progress value of 1 when upload is complete', () => {
      const file = createMockFile({
        progress: 1,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const progress = screen.getByTestId('image-progress').textContent;
      expect(progress).toBe('1');
    });
  });

  describe('File Source', () => {
    it('should pass local source to Image component', () => {
      const file = createMockFile({
        source: FileSources.local,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const source = screen.getByTestId('image-source').textContent;
      expect(source).toBe(FileSources.local);
    });

    it('should pass openai source to Image component', () => {
      const file = createMockFile({
        source: FileSources.openai,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const source = screen.getByTestId('image-source').textContent;
      expect(source).toBe(FileSources.openai);
    });
  });

  describe('File Type Detection', () => {
    it('should render Image component for image files', () => {
      const file = createMockFile({
        type: 'image/jpeg',
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      expect(screen.getByTestId('mock-image')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-file-container')).not.toBeInTheDocument();
    });

    it('should render FileContainer for non-image files', () => {
      const file = createMockFile({
        type: 'application/pdf',
        filename: 'document.pdf',
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      expect(screen.getByTestId('mock-file-container')).toBeInTheDocument();
      expect(screen.queryByTestId('mock-image')).not.toBeInTheDocument();
    });
  });

  describe('Multiple Files', () => {
    it('should render multiple image files with correct URLs based on their progress', () => {
      const filesMap = new Map<string, ExtendedFile>();

      const uploadingFile = createMockFile({
        file_id: 'file-1',
        preview: 'blob:http://localhost:3080/preview-1',
        filepath: undefined,
        progress: 0.3,
      });

      const completedFile = createMockFile({
        file_id: 'file-2',
        preview: 'blob:http://localhost:3080/preview-2',
        filepath: '/images/user123/file-2__image.png',
        progress: 1,
      });

      filesMap.set(uploadingFile.file_id, uploadingFile);
      filesMap.set(completedFile.file_id, completedFile);

      renderFileRow(filesMap);

      const images = screen.getAllByTestId('mock-image');
      expect(images).toHaveLength(2);

      const urls = screen.getAllByTestId('image-url').map((el) => el.textContent);
      expect(urls).toContain('blob:http://localhost:3080/preview-1');
      expect(urls).toContain('blob:http://localhost:3080/preview-2');
    });

    it('should deduplicate files with the same file_id', () => {
      const filesMap = new Map<string, ExtendedFile>();

      const file1 = createMockFile({ file_id: 'duplicate-id' });
      const file2 = createMockFile({ file_id: 'duplicate-id' });

      filesMap.set('key-1', file1);
      filesMap.set('key-2', file2);

      renderFileRow(filesMap);

      const images = screen.getAllByTestId('mock-image');
      expect(images).toHaveLength(1);
    });
  });

  describe('Empty State', () => {
    it('should render nothing when files map is empty', () => {
      const filesMap = new Map<string, ExtendedFile>();

      const { container } = renderFileRow(filesMap);

      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when files is undefined', () => {
      const { container } = render(
        <FileRow files={undefined} setFiles={mockSetFiles} setFilesLoading={mockSetFilesLoading} />,
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Preview Cache Integration', () => {
    it('should prefer preview blob URL over filepath for zero-flicker rendering', () => {
      const file = createMockFile({
        file_id: 'cache-test',
        preview: 'blob:http://localhost:3080/d25f730c-152d-41f7-8d79-c9fa448f606b',
        filepath:
          '/images/68c98b26901ebe2d87c193a2/c0fe1b93-ba3d-456c-80be-9a492bfd9ed0__image.png',
        progress: 1,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe('blob:http://localhost:3080/d25f730c-152d-41f7-8d79-c9fa448f606b');
    });

    it('should fall back to filepath when no preview exists', () => {
      const file = createMockFile({
        file_id: 'no-preview',
        preview: undefined,
        filepath:
          '/images/68c98b26901ebe2d87c193a2/c0fe1b93-ba3d-456c-80be-9a492bfd9ed0__image.png',
        progress: 1,
      });

      const filesMap = new Map<string, ExtendedFile>();
      filesMap.set(file.file_id, file);

      renderFileRow(filesMap);

      const imageUrl = screen.getByTestId('image-url').textContent;
      expect(imageUrl).toBe(
        '/images/68c98b26901ebe2d87c193a2/c0fe1b93-ba3d-456c-80be-9a492bfd9ed0__image.png',
      );
    });
  });

  describe('async embedding gate (RAG_ASYNC_EMBED)', () => {
    const mockGetFiles = dataService.getFiles as jest.Mock;

    it('keeps send disabled while an uploaded attachment is still indexing', () => {
      const file = createMockFile({
        file_id: 'indexing-1',
        type: 'application/pdf',
        progress: 1,
        embeddingStatus: 'pending',
      });
      renderFileRow(new Map([[file.file_id, file]]));

      expect(mockSetFilesLoading).toHaveBeenCalledWith(true);
      expect(mockSetFilesLoading).not.toHaveBeenCalledWith(false);
    });

    it('enables send once the attachment finished indexing (ready)', () => {
      const file = createMockFile({
        file_id: 'ready-1',
        type: 'application/pdf',
        progress: 1,
        embeddingStatus: 'ready',
      });
      renderFileRow(new Map([[file.file_id, file]]));

      expect(mockSetFilesLoading).toHaveBeenCalledWith(false);
    });

    it('does not gate synchronous uploads (no embeddingStatus field)', () => {
      const file = createMockFile({ file_id: 'sync-1', type: 'application/pdf', progress: 1 });
      renderFileRow(new Map([[file.file_id, file]]));

      expect(mockSetFilesLoading).toHaveBeenCalledWith(false);
      expect(mockGetFiles).not.toHaveBeenCalled();
    });

    it('warns once when an indexing attachment fails to embed', async () => {
      jest.useFakeTimers();
      try {
        const file = createMockFile({
          file_id: 'fail-1',
          type: 'application/pdf',
          filename: 'contract.pdf',
          progress: 1,
          embeddingStatus: 'pending',
        });
        // The background embed worker marked the document `failed`.
        mockGetFiles.mockResolvedValue([{ ...file, embeddingStatus: 'failed' }]);
        renderFileRow(new Map([[file.file_id, file]]));

        await act(async () => {
          jest.advanceTimersByTime(5000);
          await Promise.resolve();
          await Promise.resolve();
        });

        expect(mockShowToast).toHaveBeenCalledTimes(1);
        expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' }));
      } finally {
        jest.useRealTimers();
      }
    });

    it('drops an indexing attachment that disappeared server-side (releases the block)', async () => {
      jest.useFakeTimers();
      try {
        mockGetFiles.mockResolvedValue([]); // file no longer exists on the server
        const file = createMockFile({
          file_id: 'gone-1',
          type: 'application/pdf',
          progress: 1,
          embeddingStatus: 'pending',
        });
        renderFileRow(new Map([[file.file_id, file]]));

        await act(async () => {
          jest.advanceTimersByTime(5000);
          await Promise.resolve();
          await Promise.resolve();
        });

        const updater = mockSetFiles.mock.calls.at(-1)?.[0];
        expect(typeof updater).toBe('function');
        const result = updater(new Map([[file.file_id, file]]));
        expect(result.has('gone-1')).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
