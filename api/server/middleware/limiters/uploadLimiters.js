const rateLimit = require('express-rate-limit');
const { ViolationTypes } = require('librechat-data-provider');
const { limiterCache, removePorts } = require('@librechat/api');
const logViolation = require('~/cache/logViolation');
const { getFileUploadEnvironment: getEnvironmentVariables } = require('./config');

const createFileUploadHandler = (ip = true) => {
  const {
    fileUploadIpMax,
    fileUploadIpWindowInMinutes,
    fileUploadUserMax,
    fileUploadUserWindowInMinutes,
    fileUploadViolationScore,
  } = getEnvironmentVariables();

  return async (req, res) => {
    const type = ViolationTypes.FILE_UPLOAD_LIMIT;
    const errorMessage = {
      type,
      max: ip ? fileUploadIpMax : fileUploadUserMax,
      limiter: ip ? 'ip' : 'user',
      windowInMinutes: ip ? fileUploadIpWindowInMinutes : fileUploadUserWindowInMinutes,
    };

    await logViolation(req, res, type, errorMessage, fileUploadViolationScore);
    res.status(429).json({ message: 'Too many file upload requests. Try again later' });
  };
};

const createFileLimiters = () => {
  const { fileUploadIpWindowMs, fileUploadIpMax, fileUploadUserWindowMs, fileUploadUserMax } =
    getEnvironmentVariables();

  const ipLimiterOptions = {
    windowMs: fileUploadIpWindowMs,
    max: fileUploadIpMax,
    handler: createFileUploadHandler(),
    keyGenerator: removePorts,
    store: limiterCache('file_upload_ip_limiter'),
  };

  const userLimiterOptions = {
    windowMs: fileUploadUserWindowMs,
    max: fileUploadUserMax,
    handler: createFileUploadHandler(false),
    keyGenerator: function (req) {
      return req.user?.id;
    },
    store: limiterCache('file_upload_user_limiter'),
  };

  const fileUploadIpLimiter = rateLimit(ipLimiterOptions);
  const fileUploadUserLimiter = rateLimit(userLimiterOptions);

  return { fileUploadIpLimiter, fileUploadUserLimiter };
};

module.exports = {
  createFileLimiters,
};
