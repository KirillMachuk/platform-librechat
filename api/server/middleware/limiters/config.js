/**
 * Configured file-upload limits, read from the environment.
 *
 * Separate from the limiter itself because the values have a second consumer: the client sizes
 * its upload batch from them, and it must never offer a batch larger than the server accepts.
 * Kept dependency-free on purpose — importing the limiter would drag Redis and violation logging
 * into a plain GET /files/config.
 */

const getFileUploadEnvironment = () => {
  const FILE_UPLOAD_IP_MAX = parseInt(process.env.FILE_UPLOAD_IP_MAX) || 100;
  const FILE_UPLOAD_IP_WINDOW = parseInt(process.env.FILE_UPLOAD_IP_WINDOW) || 15;
  const FILE_UPLOAD_USER_MAX = parseInt(process.env.FILE_UPLOAD_USER_MAX) || 50;
  const FILE_UPLOAD_USER_WINDOW = parseInt(process.env.FILE_UPLOAD_USER_WINDOW) || 15;
  const FILE_UPLOAD_VIOLATION_SCORE = process.env.FILE_UPLOAD_VIOLATION_SCORE;

  const fileUploadIpWindowMs = FILE_UPLOAD_IP_WINDOW * 60 * 1000;
  const fileUploadIpMax = FILE_UPLOAD_IP_MAX;
  const fileUploadIpWindowInMinutes = fileUploadIpWindowMs / 60000;

  const fileUploadUserWindowMs = FILE_UPLOAD_USER_WINDOW * 60 * 1000;
  const fileUploadUserMax = FILE_UPLOAD_USER_MAX;
  const fileUploadUserWindowInMinutes = fileUploadUserWindowMs / 60000;

  return {
    fileUploadIpWindowMs,
    fileUploadIpMax,
    fileUploadIpWindowInMinutes,
    fileUploadUserWindowMs,
    fileUploadUserMax,
    fileUploadUserWindowInMinutes,
    fileUploadViolationScore: FILE_UPLOAD_VIOLATION_SCORE,
  };
};

/**
 * The per-user upload allowance, for surfacing to the client. Read from the same place the
 * limiter reads it, so the number the UI shows and the number enforced cannot drift: the client
 * used to offer a 200-file batch against a server that took 50, and everything past the limit
 * disappeared with no reason given.
 *
 * @returns {{ userMax: number, userWindowInMinutes: number }}
 */
const getFileUploadAllowance = () => {
  const { fileUploadUserMax, fileUploadUserWindowInMinutes } = getFileUploadEnvironment();
  return { userMax: fileUploadUserMax, userWindowInMinutes: fileUploadUserWindowInMinutes };
};

module.exports = {
  getFileUploadEnvironment,
  getFileUploadAllowance,
};
