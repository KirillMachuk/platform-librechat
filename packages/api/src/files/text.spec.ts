import { Readable } from 'stream';
import { FileSources } from 'librechat-data-provider';

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  createReadStream: jest.fn(),
}));

jest.mock('../crypto/jwt', () => ({
  generateShortLivedToken: jest.fn(),
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  interceptors: {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  },
}));

jest.mock('form-data', () => {
  return jest.fn().mockImplementation(() => ({
    append: jest.fn(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' }),
  }));
});

// Mock the utils module to avoid AWS SDK issues
jest.mock('../utils', () => ({
  logAxiosError: jest.fn((args) => {
    if (typeof args === 'object' && args.message) {
      return args.message;
    }
    return 'Error';
  }),
  readFileAsString: jest.fn(),
}));

// Now import everything after mocks are in place
import { parseTextNative, parseText } from './text';
import fs, { ReadStream } from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import type { ServerRequest } from '~/types';
import { generateShortLivedToken } from '~/crypto/jwt';
import { readFileAsString } from '~/utils';

const mockedFs = fs as jest.Mocked<typeof fs>;
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFormData = FormData as jest.MockedClass<typeof FormData>;
const mockedGenerateShortLivedToken = generateShortLivedToken as jest.MockedFunction<
  typeof generateShortLivedToken
>;
const mockedReadFileAsString = readFileAsString as jest.MockedFunction<typeof readFileAsString>;

describe('text', () => {
  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test.txt',
    encoding: '7bit',
    mimetype: 'text/plain',
    size: 100,
    destination: '/tmp',
    filename: 'test.txt',
    path: '/tmp/test.txt',
    buffer: Buffer.from('test content'),
    stream: new Readable(),
  };

  const mockReq = {
    user: { id: 'user123' },
  } as ServerRequest;

  const mockFileId = 'file123';

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.RAG_API_URL;
  });

  describe('parseTextNative', () => {
    it('should successfully parse a text file', async () => {
      const mockText = 'Hello, world!';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      const result = await parseTextNative(mockFile);

      expect(mockedReadFileAsString).toHaveBeenCalledWith('/tmp/test.txt', {
        fileSize: 100,
      });
      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
    });

    it('should handle file read errors', async () => {
      const mockError = new Error('File not found');
      mockedReadFileAsString.mockRejectedValue(mockError);

      await expect(parseTextNative(mockFile)).rejects.toThrow('File not found');
    });
  });

  describe('parseText', () => {
    beforeEach(() => {
      mockedGenerateShortLivedToken.mockReturnValue('mock-jwt-token');

      const mockFormDataInstance = {
        append: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({ 'content-type': 'multipart/form-data' }),
      };
      mockedFormData.mockImplementation(() => mockFormDataInstance as unknown as FormData);

      mockedFs.createReadStream.mockReturnValue({} as unknown as ReadStream);
    });

    it('should fall back to native parsing when RAG_API_URL is not defined', async () => {
      const mockText = 'Native parsing result';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      const result = await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should fall back to native parsing when health check fails', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';
      const mockText = 'Native parsing result';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      mockedAxios.get.mockRejectedValue(new Error('Health check failed'));

      const result = await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(mockedAxios.get).toHaveBeenCalledWith('http://rag-api.test/health', {
        timeout: 10000,
      });
      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
    });

    it('should fall back to native parsing when health check returns non-OK status', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';
      const mockText = 'Native parsing result';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      mockedAxios.get.mockResolvedValue({
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
    });

    it('should accept empty text as valid RAG API response', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';

      mockedAxios.get.mockResolvedValue({
        status: 200,
        statusText: 'OK',
      });

      mockedAxios.post.mockResolvedValue({
        data: {
          text: '',
        },
      });

      const result = await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://rag-api.test/text',
        expect.any(Object),
        expect.objectContaining({
          timeout: 300000,
        }),
      );
      expect(result).toEqual({
        text: '',
        bytes: 0,
        source: FileSources.text,
      });
    });

    it('should fall back to native parsing when RAG API response lacks text property', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';
      const mockText = 'Native parsing result';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      mockedAxios.get.mockResolvedValue({
        status: 200,
        statusText: 'OK',
      });

      mockedAxios.post.mockResolvedValue({
        data: {},
      });

      const result = await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
    });

    it('should fall back to native parsing when user is undefined', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';
      const mockText = 'Native parsing result';
      const mockBytes = Buffer.byteLength(mockText, 'utf8');

      mockedReadFileAsString.mockResolvedValue({
        content: mockText,
        bytes: mockBytes,
      });

      const result = await parseText({
        req: { user: undefined } as ServerRequest,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(mockedGenerateShortLivedToken).not.toHaveBeenCalled();
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result).toEqual({
        text: mockText,
        bytes: mockBytes,
        source: FileSources.text,
      });
    });

    it.each([
      { mimetype: 'text/markdown', originalname: 'notes.md' },
      { mimetype: 'text/x-markdown', originalname: 'notes.md' },
      { mimetype: 'text/md', originalname: 'notes' },
      { mimetype: 'application/markdown', originalname: 'notes.md' },
      { mimetype: 'application/x-markdown', originalname: 'notes.md' },
      { mimetype: 'text/plain', originalname: 'notes.md' },
      { mimetype: 'application/octet-stream', originalname: 'README.md' },
      { mimetype: 'application/octet-stream', originalname: 'GUIDE.MARKDOWN' },
      { mimetype: 'application/octet-stream', originalname: 'post.mdown' },
      { mimetype: 'application/octet-stream', originalname: 'post.mkdn' },
      { mimetype: 'application/octet-stream', originalname: 'post.mkd' },
      { mimetype: 'application/octet-stream', originalname: 'docs.mdwn' },
      { mimetype: 'text/markdown; charset=utf-8', originalname: 'notes' },
      { mimetype: 'TEXT/MARKDOWN', originalname: 'notes' },
      { mimetype: '  text/markdown ; charset=UTF-8  ', originalname: 'notes' },
      { mimetype: '', originalname: 'notes.md' },
    ])(
      'should short-circuit to native parsing for markdown file (%o)',
      async ({ mimetype, originalname }) => {
        process.env.RAG_API_URL = 'http://rag-api.test';
        const mockText = '# Heading\n\n**bold** text';
        const mockBytes = Buffer.byteLength(mockText, 'utf8');

        mockedReadFileAsString.mockResolvedValue({
          content: mockText,
          bytes: mockBytes,
        });

        const result = await parseText({
          req: mockReq,
          file: { ...mockFile, mimetype, originalname },
          file_id: mockFileId,
        });

        expect(mockedAxios.get).not.toHaveBeenCalled();
        expect(mockedAxios.post).not.toHaveBeenCalled();
        expect(mockedReadFileAsString).toHaveBeenCalledWith('/tmp/test.txt', {
          fileSize: 100,
        });
        expect(result).toEqual({
          text: mockText,
          bytes: mockBytes,
          source: FileSources.text,
        });
      },
    );

    it('should still call the RAG API for non-markdown text files', async () => {
      process.env.RAG_API_URL = 'http://rag-api.test';
      const mockText = 'plain text content';

      mockedAxios.get.mockResolvedValue({ status: 200, statusText: 'OK' });
      mockedAxios.post.mockResolvedValue({ data: { text: mockText } });

      await parseText({
        req: mockReq,
        file: mockFile,
        file_id: mockFileId,
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://rag-api.test/text',
        expect.any(Object),
        expect.objectContaining({ timeout: 300000 }),
      );
    });

    /* doc-gateway OCRs one scan at a time and answers 503 + Retry-After for the rest. Native
     * parsing reads only a text layer, so a scanned PDF comes back empty either way — only this
     * flag lets the caller tell "the queue was full, retry" from "the document is unreadable". */
    describe('saturated document parser (503)', () => {
      const scan = { ...mockFile, originalname: 'scan.pdf', mimetype: 'application/pdf' };

      beforeEach(() => {
        process.env.RAG_API_URL = 'http://rag-api.test';
        mockedAxios.get.mockResolvedValue({ status: 200, statusText: 'OK' });
        mockedFs.createReadStream.mockReturnValue('stream' as unknown as ReadStream);
        mockedFormData.mockImplementation(
          () =>
            ({
              append: jest.fn(),
              getHeaders: jest.fn().mockReturnValue({}),
            }) as unknown as FormData,
        );
      });

      it('flags the retryable cause when the lane is saturated and native parsing finds nothing', async () => {
        mockedAxios.post.mockRejectedValue({ response: { status: 503 } });
        mockedReadFileAsString.mockResolvedValue({ content: '', bytes: 0 });

        const result = await parseText({ req: mockReq, file: scan, file_id: mockFileId });

        expect(result.text).toBe('');
        expect(result.retryable).toBe(true);
      });

      it('does not flag other upstream failures', async () => {
        mockedAxios.post.mockRejectedValue({ response: { status: 500 } });
        mockedReadFileAsString.mockResolvedValue({ content: '', bytes: 0 });

        const result = await parseText({ req: mockReq, file: scan, file_id: mockFileId });

        expect(result.retryable).toBeUndefined();
      });

      it('treats a gateway timeout and a throttle as retryable too', async () => {
        for (const status of [429, 504]) {
          mockedAxios.post.mockRejectedValue({ response: { status } });
          mockedReadFileAsString.mockResolvedValue({ content: '', bytes: 0 });

          const result = await parseText({ req: mockReq, file: scan, file_id: mockFileId });

          expect(result.retryable).toBe(true);
        }
      });

      /* The production defect this pair guards: native parsing decodes raw bytes, so on a PDF it
       * returns megabytes of mojibake beginning with "%PDF". That non-empty string looked like a
       * successful extraction, so the 503 was discarded and the upload failed with "the document
       * may be image-based" — for a scan that indexes in 34s once the lane is free. The old test
       * here asserted the opposite behaviour using a mock that returned clean prose for a PDF,
       * which no real native parse can produce. */
      it('never returns a binary document as extracted text', async () => {
        mockedAxios.post.mockRejectedValue({ response: { status: 503 } });
        mockedReadFileAsString.mockResolvedValue({
          content: `%PDF-1.7\n%µ¶\n${'ÿ'.repeat(4096)}`,
          bytes: 6533714,
        });

        const result = await parseText({ req: mockReq, file: scan, file_id: mockFileId });

        expect(result.text).toBe('');
        expect(result.retryable).toBe(true);
        expect(mockedReadFileAsString).not.toHaveBeenCalled();
      });

      it('still falls back to native parsing for real text files', async () => {
        const note = { ...mockFile, originalname: 'note.txt', mimetype: 'text/plain' };
        mockedAxios.post.mockRejectedValue({ response: { status: 503 } });
        mockedReadFileAsString.mockResolvedValue({ content: 'договор аренды', bytes: 26 });

        const result = await parseText({ req: mockReq, file: note, file_id: mockFileId });

        expect(result.text).toBe('договор аренды');
        expect(result.retryable).toBeUndefined();
      });
    });
  });
});
