jest.mock('@librechat/api', () => ({ deleteRagFile: jest.fn() }));
jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

const mockTmpBase = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'crud-traversal-'),
);

jest.mock('~/config/paths', () => {
  const path = require('path');
  return {
    publicPath: path.join(mockTmpBase, 'public'),
    uploads: path.join(mockTmpBase, 'uploads'),
  };
});

// saveFileFromURL fetches bytes over HTTP and probes their metadata; stub both
// so the traversal assertion exercises only the path-containment guard.
jest.mock('axios', () => jest.fn(async () => ({ data: Buffer.from('remote-bytes') })));
jest.mock('~/server/utils', () => ({
  getBufferMetadata: jest.fn(async () => ({
    bytes: 12,
    type: 'image/png',
    dimensions: { width: 1, height: 1 },
    extension: 'png',
  })),
}));
jest.mock('~/server/services/Files/images/resize', () => ({ resizeImageBuffer: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { saveLocalBuffer, saveFileFromURL, getLocalFileStream } = require('../crud');

describe('saveLocalBuffer path containment', () => {
  beforeAll(() => {
    fs.mkdirSync(path.join(mockTmpBase, 'public', 'images'), { recursive: true });
    fs.mkdirSync(path.join(mockTmpBase, 'uploads'), { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(mockTmpBase, { recursive: true, force: true });
  });

  test('rejects filenames with path traversal sequences', async () => {
    await expect(
      saveLocalBuffer({
        userId: 'user1',
        buffer: Buffer.from('malicious'),
        fileName: '../../../etc/passwd',
        basePath: 'uploads',
      }),
    ).rejects.toThrow('Path traversal detected');
  });

  test('rejects prefix-collision traversal (startsWith bypass)', async () => {
    fs.mkdirSync(path.join(mockTmpBase, 'uploads', 'user10'), { recursive: true });
    await expect(
      saveLocalBuffer({
        userId: 'user1',
        buffer: Buffer.from('malicious'),
        fileName: '../user10/evil',
        basePath: 'uploads',
      }),
    ).rejects.toThrow('Path traversal detected');
  });

  test('allows normal filenames', async () => {
    const result = await saveLocalBuffer({
      userId: 'user1',
      buffer: Buffer.from('safe content'),
      fileName: 'file-id__output.csv',
      basePath: 'uploads',
    });

    expect(result).toBe('/uploads/user1/file-id__output.csv');

    const filePath = path.join(mockTmpBase, 'uploads', 'user1', 'file-id__output.csv');
    expect(fs.existsSync(filePath)).toBe(true);
    fs.unlinkSync(filePath);
  });
});

describe('saveFileFromURL path containment (D1)', () => {
  const imagesBase = () => path.join(mockTmpBase, 'public', 'images');

  beforeAll(() => {
    fs.mkdirSync(imagesBase(), { recursive: true });
  });

  test('does not write outside the user output directory for a traversal fileName', async () => {
    const escapeTarget = path.join(mockTmpBase, 'public', 'evil.png');

    const result = await saveFileFromURL({
      userId: 'user1',
      URL: 'https://example.test/whatever',
      fileName: '../../evil',
      basePath: 'images',
    });

    // saveFileFromURL swallows errors and returns null; the guard must have
    // fired before the write so nothing lands outside the user directory.
    expect(result).toBeNull();
    expect(fs.existsSync(escapeTarget)).toBe(false);
  });

  test('writes a legitimate filename inside the user output directory', async () => {
    const result = await saveFileFromURL({
      userId: 'user2',
      URL: 'https://example.test/logo',
      fileName: 'logo',
      basePath: 'images',
    });

    expect(result).toMatchObject({ type: 'image/png' });
    const written = path.join(mockTmpBase, 'public', 'images', 'user2', 'logo.png');
    expect(fs.existsSync(written)).toBe(true);
    fs.unlinkSync(written);
  });
});

describe('getLocalFileStream path containment (D13)', () => {
  const appConfig = {
    paths: {
      uploads: path.join(mockTmpBase, 'uploads'),
      imageOutput: path.join(mockTmpBase, 'public', 'images'),
    },
  };
  const req = { config: appConfig };

  beforeAll(() => {
    fs.mkdirSync(path.join(mockTmpBase, 'uploads', 'user1'), { recursive: true });
    fs.writeFileSync(path.join(mockTmpBase, 'uploads', 'user1', 'ok.txt'), 'hello');
  });

  test('streams a valid /uploads/ file', async () => {
    const stream = await getLocalFileStream(req, '/uploads/user1/ok.txt');
    expect(stream).toBeDefined();
    stream.destroy();
  });

  test('rejects a traversal escape through the /uploads/ marker', async () => {
    await expect(getLocalFileStream(req, '/uploads/../../../etc/passwd')).rejects.toThrow(
      /Invalid file path|Path traversal detected/,
    );
  });

  test('rejects an unmarked absolute path outside the known storage roots', async () => {
    await expect(getLocalFileStream(req, '/etc/passwd')).rejects.toThrow('Invalid file path');
  });
});
