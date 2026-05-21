const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { sanitizeFilename } = require('@librechat/api');
const {
  mergeFileConfig,
  getEndpointFileConfig,
  fileConfig: defaultFileConfig,
} = require('librechat-data-provider');
const { getAppConfig } = require('~/server/services/Config');

const MOJIBAKE_PATTERN = /[\xC2-\xF7][\x80-\xBF]/;

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const appConfig = req.config;
    const outputPath = path.join(appConfig.paths.uploads, 'temp', req.user.id);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    cb(null, outputPath);
  },
  filename: function (req, file, cb) {
    req.file_id = crypto.randomUUID();
    // Busboy decodes the multipart Content-Disposition `filename=` parameter
    // as Latin-1 by default (RFC 2183). When the client sends UTF-8 bytes for
    // the filename, that decoding turns multi-byte sequences into mojibake —
    // e.g. "Название.md" becomes "ÐÐ°Ð·Ð²Ð°Ð½Ð¸Ðµ.md".
    //
    // Detect by signature: a UTF-8 leading byte (0xC2-0xF7) followed by a
    // continuation byte (0x80-0xBF). Re-encode latin1 -> utf8 only then.
    // Names that already arrive as proper UTF-8 (RFC 5987
    // `filename*=UTF-8''…` — busboy gives us the decoded string directly),
    // pure ASCII, or natural Latin-1 accented text are left untouched.
    if (MOJIBAKE_PATTERN.test(file.originalname)) {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    }
    try {
      file.originalname = decodeURIComponent(file.originalname);
    } catch (_err) {
      // Filename wasn't URL-encoded — keep the name as-is.
    }
    const sanitizedFilename = sanitizeFilename(file.originalname);
    cb(null, sanitizedFilename);
  },
});

const importFileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/json') {
    cb(null, true);
  } else if (path.extname(file.originalname).toLowerCase() === '.json') {
    cb(null, true);
  } else {
    cb(new Error('Only JSON files are allowed'), false);
  }
};

/**
 *
 * @param {import('librechat-data-provider').FileConfig | undefined} customFileConfig
 */
const createFileFilter = (customFileConfig) => {
  /**
   * @param {ServerRequest} req
   * @param {Express.Multer.File}
   * @param {import('multer').FileFilterCallback} cb
   */
  const fileFilter = (req, file, cb) => {
    if (!file) {
      return cb(new Error('No file provided'), false);
    }

    if (req.originalUrl.endsWith('/speech/stt') && file.mimetype.startsWith('audio/')) {
      return cb(null, true);
    }

    const endpoint = req.body.endpoint;
    const endpointType = req.body.endpointType;
    const endpointFileConfig = getEndpointFileConfig({
      fileConfig: customFileConfig,
      endpoint,
      endpointType,
    });

    if (!defaultFileConfig.checkType(file.mimetype, endpointFileConfig.supportedMimeTypes)) {
      return cb(new Error('Unsupported file type: ' + file.mimetype), false);
    }

    cb(null, true);
  };

  return fileFilter;
};

const createMulterInstance = async () => {
  const appConfig = await getAppConfig();
  const fileConfig = mergeFileConfig(appConfig?.fileConfig);
  const fileFilter = createFileFilter(fileConfig);
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: fileConfig.serverFileSizeLimit },
  });
};

module.exports = { createMulterInstance, storage, importFileFilter };
