const path = require('path');
const { logger } = require('@librechat/data-schemas');
const { getCodeBaseURL } = require('@librechat/agents');
const { artifactReportSchema } = require('librechat-data-provider');
const {
  createAxiosInstance,
  getCodeApiAuthHeaders,
  buildCodeEnvDownloadQuery,
  codeServerHttpAgent,
  codeServerHttpsAgent,
} = require('@librechat/api');

const ARTIFACT_REPORT_SUFFIX = '.artifact-report.json';
const ARTIFACT_REPORT_MAX_BYTES = 256 * 1024;
const ARTIFACT_REPORT_MAX_DEPTH = 20;
const SUPPORTED_ARTIFACT_FORMATS = new Set(['pptx', 'docx', 'xlsx', 'pdf', 'csv']);

/**
 * Return the authored filename described by a report sidecar, or null
 * when the filename is ordinary user output. The format check prevents
 * an unrelated file such as `notes.artifact-report.json` from being
 * hidden from the attachment list.
 *
 * @param {string} name
 * @returns {string | null}
 */
function getArtifactReportTargetName(name) {
  if (typeof name !== 'string' || !name.toLowerCase().endsWith(ARTIFACT_REPORT_SUFFIX)) {
    return null;
  }

  const targetName = name.slice(0, -ARTIFACT_REPORT_SUFFIX.length);
  const format = path.extname(targetName).slice(1).toLowerCase();
  return SUPPORTED_ARTIFACT_FORMATS.has(format) ? targetName : null;
}

/**
 * MongoDB rejects object keys containing dots or starting with `$`.
 * Reports are model-generated input, so reject those keys before a
 * passthrough Zod schema reaches a Mixed field and breaks persistence.
 * The depth cap also keeps deliberately pathological JSON bounded.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {boolean}
 */
function hasUnsafeReportShape(value, depth = 0) {
  if (depth > ARTIFACT_REPORT_MAX_DEPTH) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeReportShape(item, depth + 1));
  }
  if (value == null || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(
    ([key, item]) =>
      key.startsWith('$') ||
      key.includes('.') ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor' ||
      hasUnsafeReportShape(item, depth + 1),
  );
}

/**
 * Parse and validate a bounded report buffer. Unknown optional fields
 * are preserved by `artifactReportSchema.passthrough()` so newer skills
 * remain compatible with older clients.
 *
 * @param {Buffer} buffer
 * @param {string} targetName
 * @returns {import('librechat-data-provider').TArtifactReport}
 */
function parseArtifactReport(buffer, targetName) {
  if (!Buffer.isBuffer(buffer) || buffer.length > ARTIFACT_REPORT_MAX_BYTES) {
    throw new Error('Artifact report exceeds the 256 KiB limit');
  }

  const raw = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
  if (hasUnsafeReportShape(raw)) {
    throw new Error('Artifact report contains unsafe object keys or nesting');
  }

  const report = artifactReportSchema.parse(raw);
  const targetFormat = path.extname(targetName).slice(1).toLowerCase();
  if (report.format !== targetFormat) {
    throw new Error(`Artifact report format ${report.format} does not match ${targetName}`);
  }
  return report;
}

/**
 * Download and validate all report sidecars from one tool result.
 * Failures are deliberately non-fatal: the authored file is still
 * delivered, but without trusted QA metadata. Sidecars themselves are
 * filtered by callers and never become user-visible attachments.
 *
 * @param {object} params
 * @param {ServerRequest} params.req
 * @param {Array<{id: string, name: string, inherited?: boolean, storage_session_id?: string, session_id?: string}>} params.files
 * @param {string} [params.session_id]
 * @returns {Promise<Map<string, import('librechat-data-provider').TArtifactReport>>}
 */
async function collectArtifactReports({ req, files, session_id }) {
  const candidates = (files ?? [])
    .map((file, index) => ({
      file,
      index,
      targetName: getArtifactReportTargetName(file.name),
    }))
    .filter(({ file, targetName }) => !file.inherited && targetName != null);

  if (candidates.length === 0) {
    return new Map();
  }

  let baseURL;
  let authHeaders;
  let downloadQuery;
  let axios;
  try {
    baseURL = getCodeBaseURL();
    authHeaders = await getCodeApiAuthHeaders(req);
    downloadQuery = buildCodeEnvDownloadQuery({
      kind: 'user',
      id: req.user.id,
    });
    axios = createAxiosInstance();
  } catch (error) {
    logger.warn(
      `[collectArtifactReports] Unable to initialize report downloads: ${error?.message ?? error}`,
    );
    return new Map();
  }

  const results = await Promise.all(
    candidates.map(async ({ file, index, targetName }) => {
      try {
        const storageSessionId = file.storage_session_id ?? file.session_id ?? session_id;
        if (!storageSessionId) {
          throw new Error('Artifact report has no storage session id');
        }
        const response = await axios({
          method: 'get',
          url: `${baseURL}/download/${storageSessionId}/${file.id}${downloadQuery}`,
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'LibreChat/1.0',
            ...authHeaders,
          },
          httpAgent: codeServerHttpAgent,
          httpsAgent: codeServerHttpsAgent,
          timeout: 5000,
          maxContentLength: ARTIFACT_REPORT_MAX_BYTES,
          maxBodyLength: ARTIFACT_REPORT_MAX_BYTES,
        });
        const buffer = Buffer.from(response.data, 'binary');
        return {
          index,
          targetName,
          report: parseArtifactReport(buffer, targetName),
        };
      } catch (error) {
        logger.warn(
          `[collectArtifactReports] Ignoring invalid report "${file.name}": ${error?.message ?? error}`,
        );
        return null;
      }
    }),
  );

  const outputNames = new Set(
    (files ?? [])
      .filter((file) => !file.inherited && getArtifactReportTargetName(file.name) == null)
      .map((file) => file.name),
  );
  const reportsByFilename = new Map();
  for (const result of results.filter(Boolean).sort((a, b) => a.index - b.index)) {
    if (!outputNames.has(result.targetName)) {
      logger.warn(
        `[collectArtifactReports] Ignoring orphan report for missing file "${result.targetName}"`,
      );
      continue;
    }
    if (reportsByFilename.has(result.targetName)) {
      logger.warn(`[collectArtifactReports] Ignoring duplicate report for "${result.targetName}"`);
      continue;
    }
    reportsByFilename.set(result.targetName, result.report);
  }
  return reportsByFilename;
}

module.exports = {
  ARTIFACT_REPORT_MAX_BYTES,
  collectArtifactReports,
  getArtifactReportTargetName,
  parseArtifactReport,
};
