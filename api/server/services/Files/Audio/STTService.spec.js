// Mock all external dependencies so we can test getFileExtensionFromMime in isolation
jest.mock('axios');
jest.mock('form-data');
jest.mock('https-proxy-agent');
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@librechat/api', () => ({
  genAzureEndpoint: jest.fn(),
  logAxiosError: jest.fn(),
  applyAxiosProxyConfig: jest.fn(),
}));
jest.mock('librechat-data-provider', () => ({
  extractEnvVariable: jest.fn((value) => value),
  STTProviders: { OPENAI: 'openai', AZURE_OPENAI: 'azureOpenAI' },
}));
jest.mock('~/server/services/Config', () => ({ getAppConfig: jest.fn() }));

const {
  STTService,
  getFileExtensionFromMime,
  isTransientSttError,
  MIME_TO_EXTENSION_MAP,
} = require('./STTService');

describe('getFileExtensionFromMime', () => {
  it('should normalize audio/x-m4a to m4a', () => {
    expect(getFileExtensionFromMime('audio/x-m4a')).toBe('m4a');
  });

  it('should normalize audio/mp4 to m4a', () => {
    expect(getFileExtensionFromMime('audio/mp4')).toBe('m4a');
  });

  it('should normalize audio/x-wav to wav', () => {
    expect(getFileExtensionFromMime('audio/x-wav')).toBe('wav');
  });

  it('should normalize audio/x-flac to flac', () => {
    expect(getFileExtensionFromMime('audio/x-flac')).toBe('flac');
  });

  it('should normalize audio/mpeg to mp3', () => {
    expect(getFileExtensionFromMime('audio/mpeg')).toBe('mp3');
  });

  it('should return webm for audio/webm', () => {
    expect(getFileExtensionFromMime('audio/webm')).toBe('webm');
  });

  it('should return ogg for audio/ogg', () => {
    expect(getFileExtensionFromMime('audio/ogg')).toBe('ogg');
  });

  it('should fall back to webm for unknown MIME types', () => {
    expect(getFileExtensionFromMime('audio/somethingelse')).toBe('webm');
  });

  it('should return webm for null/undefined input', () => {
    expect(getFileExtensionFromMime(null)).toBe('webm');
    expect(getFileExtensionFromMime(undefined)).toBe('webm');
  });
});

describe('STT audio format validation with MIME normalization', () => {
  const acceptedFormats = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'];

  /**
   * Mirrors the format validation logic in azureOpenAIProvider.
   * Only uses MIME_TO_EXTENSION_MAP for normalization so unknown audio
   * subtypes are not silently accepted via the webm default fallback.
   * Raw subtype matching is gated on audio/video prefix to prevent
   * non-audio types like text/webm from passing.
   */
  function isFormatAccepted(mimetype) {
    const [mimePrefix, rawFormat = ''] = mimetype.split('/');
    const isAudioMime = mimePrefix === 'audio' || mimePrefix === 'video';
    const isKnownMime = mimetype in MIME_TO_EXTENSION_MAP;
    const normalizedFormat = isKnownMime ? MIME_TO_EXTENSION_MAP[mimetype] : null;
    return (
      acceptedFormats.includes(normalizedFormat) ||
      (isAudioMime && acceptedFormats.includes(rawFormat))
    );
  }

  it('should accept audio/x-m4a (browser MIME for .m4a files)', () => {
    expect(isFormatAccepted('audio/x-m4a')).toBe(true);
  });

  it('should accept audio/x-wav', () => {
    expect(isFormatAccepted('audio/x-wav')).toBe(true);
  });

  it('should accept audio/x-flac', () => {
    expect(isFormatAccepted('audio/x-flac')).toBe(true);
  });

  it('should accept standard formats directly', () => {
    expect(isFormatAccepted('audio/mpeg')).toBe(true);
    expect(isFormatAccepted('audio/wav')).toBe(true);
    expect(isFormatAccepted('audio/ogg')).toBe(true);
    expect(isFormatAccepted('audio/webm')).toBe(true);
    expect(isFormatAccepted('audio/flac')).toBe(true);
    expect(isFormatAccepted('audio/mp3')).toBe(true);
    expect(isFormatAccepted('audio/mp4')).toBe(true);
    expect(isFormatAccepted('audio/mpga')).toBe(true);
  });

  it('should reject unknown audio subtypes', () => {
    expect(isFormatAccepted('audio/aac')).toBe(false);
    expect(isFormatAccepted('audio/somethingelse')).toBe(false);
    expect(isFormatAccepted('video/unknown')).toBe(false);
  });

  it('should accept application/ogg (valid Ogg container MIME type in the map)', () => {
    expect(isFormatAccepted('application/ogg')).toBe(true);
  });

  it('should reject non-audio types even if subtype matches an accepted format', () => {
    expect(isFormatAccepted('text/webm')).toBe(false);
    expect(isFormatAccepted('text/plain')).toBe(false);
    expect(isFormatAccepted('application/json')).toBe(false);
  });
});

describe('isTransientSttError', () => {
  it('treats 5xx and 429 responses as transient', () => {
    expect(isTransientSttError({ response: { status: 500 } })).toBe(true);
    expect(isTransientSttError({ response: { status: 503 } })).toBe(true);
    expect(isTransientSttError({ response: { status: 429 } })).toBe(true);
  });

  it('treats 4xx responses as permanent', () => {
    expect(isTransientSttError({ response: { status: 400 } })).toBe(false);
    expect(isTransientSttError({ response: { status: 413 } })).toBe(false);
    expect(isTransientSttError({ response: { status: 401 } })).toBe(false);
  });

  it('treats network reset/timeout codes as transient', () => {
    expect(isTransientSttError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isTransientSttError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientSttError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('treats unknown or malformed errors as permanent', () => {
    expect(isTransientSttError(new Error('boom'))).toBe(false);
    expect(isTransientSttError({})).toBe(false);
    expect(isTransientSttError(null)).toBe(false);
  });
});

describe('STTService.sttRequest retry', () => {
  const axios = require('axios');
  const schema = {
    url: 'http://stt.railway.internal:8000/v1/audio/transcriptions',
    model: 'whisper',
    apiKey: 'test-key',
  };
  const payload = {
    audioBuffer: Buffer.from('fake-audio'),
    audioFile: { originalname: 'a.webm', mimetype: 'audio/webm', size: 10 },
    language: 'ru',
  };

  let service;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new STTService();
  });

  it('retries a transient failure and returns trimmed text on a later attempt', async () => {
    const transient = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
    axios.post
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ status: 200, data: { text: '  hi  ' } });

    const text = await service.sttRequest('openai', schema, payload);

    expect(text).toBe('hi');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent (4xx) failure', async () => {
    const permanent = Object.assign(new Error('bad request'), { response: { status: 400 } });
    axios.post.mockRejectedValue(permanent);

    await expect(service.sttRequest('openai', schema, payload)).rejects.toBe(permanent);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('gives up after the maximum attempts on persistent transient failures', async () => {
    const transient = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    axios.post.mockRejectedValue(transient);

    await expect(service.sttRequest('openai', schema, payload)).rejects.toBe(transient);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });
});
