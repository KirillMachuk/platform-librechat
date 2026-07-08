const { klona } = require('klona');
const winston = require('winston');
const traverse = require('traverse');

const SPLAT_SYMBOL = Symbol.for('splat');
const MESSAGE_SYMBOL = Symbol.for('message');
const CONSOLE_JSON_STRING_LENGTH = parseInt(process.env.CONSOLE_JSON_STRING_LENGTH) || 255;
const DEBUG_MESSAGE_LENGTH = parseInt(process.env.DEBUG_MESSAGE_LENGTH) || 150;

const sensitiveKeys = [
  // OpenAI API key: `sk-` at a word boundary, followed by the documented
  // charset for keys. `\b` keeps `task-runner`, `mask-value`, etc. from
  // being mis-redacted.
  /\b(sk-)[a-zA-Z0-9_-]+/g,
  /\b(Bearer )[^\s"']+/g, // Header: Bearer token pattern
  /\b(api-key:? )[^\s"']+/gi, // Header: API key pattern (case-insensitive; covers `Api-Key:`, `API-KEY:`)
  /\b(key=)[^\s"'&]+/g, // URL query param: sensitive key pattern (Google)
];

const NUMERIC_KEY_RE = /^\d+$/;
const LOG_CONTEXT_KEYS = ['tenantId', 'userId', 'requestId'];
const SYSTEM_TENANT_ID = '__SYSTEM__';

const REDACTED_VALUE = '[REDACTED]';
const REDACTION_TRUNCATED_KEY = '__redaction_truncated__';
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTION_ENTRIES = 50;
const DEFAULT_REDACTION_STRING_LENGTH = 8192;
const MAX_REDACTION_STRING_LENGTH = Math.max(
  CONSOLE_JSON_STRING_LENGTH,
  DEFAULT_REDACTION_STRING_LENGTH,
);
const MAX_REDACTION_BUFFER_BYTES = MAX_REDACTION_STRING_LENGTH;

/**
 * Property names whose values are redacted wholesale regardless of content.
 * Shared, verbatim, with the reference implementation in
 * `packages/data-schemas/src/config/parsers.ts` so both loggers scrub the
 * same set of sensitive keys.
 */
const sensitiveMetadataKey =
  /^(authorization|proxy-authorization|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|secret|password)$/i;
const errorStringProperties = new Set(['name', 'message', 'stack']);

/**
 * Redacts sensitive information from a console message and trims it to a specified length if provided.
 * @param {string} str - The console message to be redacted.
 * @param {number} [trimLength] - The optional length at which to trim the redacted message.
 * @returns {string} - The redacted and optionally trimmed console message.
 */
function redactMessage(str, trimLength) {
  if (!str) {
    return '';
  }

  let redacted = str;
  for (const pattern of sensitiveKeys) {
    redacted = redacted.replace(pattern, '$1[REDACTED]');
  }

  if (trimLength !== undefined && redacted.length > trimLength) {
    return `${redacted.substring(0, trimLength)}...`;
  }

  return redacted;
}

/**
 * Applies the sensitive-pattern regexes to a string, guarding against
 * scanning unbounded payloads by trimming very long values first.
 * @param {string} str - The string to redact.
 * @returns {string} - The redacted (and possibly truncated) string.
 */
function redactLogString(str) {
  if (str.length <= MAX_REDACTION_STRING_LENGTH) {
    return redactMessage(str);
  }

  const redacted = redactMessage(str.substring(0, MAX_REDACTION_STRING_LENGTH));
  return `${redacted}... [truncated ${str.length - MAX_REDACTION_STRING_LENGTH} chars]`;
}

function isPlainRecord(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSensitiveMetadataKey(key) {
  return sensitiveMetadataKey.test(key);
}

function redactRecordValue(key, value, seen, depth) {
  return isSensitiveMetadataKey(key) ? REDACTED_VALUE : redactLogValue(value, seen, depth);
}

function defineRedactedErrorProperty(error, key, value) {
  if (value === undefined) {
    return;
  }

  Object.defineProperty(error, key, {
    value: redactLogString(value),
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

function defineRedactedDescriptor(target, key, descriptor, seen, depth) {
  if (!('value' in descriptor)) {
    Object.defineProperty(target, key, descriptor);
    return;
  }

  Object.defineProperty(target, key, {
    ...descriptor,
    value:
      typeof key === 'string'
        ? redactRecordValue(key, descriptor.value, seen, depth)
        : redactLogValue(descriptor.value, seen, depth),
  });
}

function redactErrorValue(error, seen, depth) {
  const redacted = Object.create(Object.getPrototypeOf(error));
  seen.set(error, redacted);

  defineRedactedErrorProperty(redacted, 'name', error.name);
  defineRedactedErrorProperty(redacted, 'message', error.message);
  defineRedactedErrorProperty(redacted, 'stack', error.stack);

  Reflect.ownKeys(error).forEach((key) => {
    if (typeof key === 'string' && errorStringProperties.has(key)) {
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    if (descriptor === undefined) {
      return;
    }
    defineRedactedDescriptor(redacted, key, descriptor, seen, depth + 1);
  });
  return redacted;
}

function isBufferValue(value) {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
}

function getJsonValue(value) {
  const toJSON = value.toJSON;
  if (typeof toJSON !== 'function') {
    return undefined;
  }

  try {
    const jsonValue = toJSON.call(value);
    return jsonValue === value ? undefined : jsonValue;
  } catch {
    return undefined;
  }
}

function getCustomStringValue(value) {
  const toString = value.toString;
  if (typeof toString !== 'function' || toString === Object.prototype.toString) {
    return undefined;
  }

  try {
    const stringValue = toString.call(value);
    return typeof stringValue === 'string' ? stringValue : undefined;
  } catch {
    return undefined;
  }
}

function redactMapValue(value, seen, depth) {
  const redacted = new Map();
  seen.set(value, redacted);
  let count = 0;
  for (const [mapKey, mapValue] of value) {
    if (count >= MAX_REDACTION_ENTRIES) {
      redacted.set(REDACTION_TRUNCATED_KEY, 'Additional map entries omitted');
      break;
    }
    redacted.set(
      mapKey,
      typeof mapKey === 'string'
        ? redactRecordValue(mapKey, mapValue, seen, depth + 1)
        : redactLogValue(mapValue, seen, depth + 1),
    );
    count += 1;
  }
  return redacted;
}

function redactSetValue(value, seen, depth) {
  const redacted = new Set();
  seen.set(value, redacted);
  let count = 0;
  for (const setValue of value) {
    if (count >= MAX_REDACTION_ENTRIES) {
      redacted.add('Additional set values omitted');
      break;
    }
    redacted.add(redactLogValue(setValue, seen, depth + 1));
    count += 1;
  }
  return redacted;
}

function redactObjectEntries(value, seen, depth) {
  const record = value;
  let redacted;
  let count = 0;

  for (const key in record) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    if (redacted === undefined) {
      redacted = {};
      seen.set(value, redacted);
    }
    if (count >= MAX_REDACTION_ENTRIES) {
      redacted[REDACTION_TRUNCATED_KEY] = 'Additional object properties omitted';
      break;
    }
    redacted[key] = redactRecordValue(key, record[key], seen, depth + 1);
    count += 1;
  }

  return redacted;
}

function redactNonPlainValue(value, seen, depth) {
  if (isBufferValue(value)) {
    return value.length > MAX_REDACTION_BUFFER_BYTES
      ? `[REDACTED Buffer ${value.length} bytes]`
      : redactLogString(value.toString('utf8'));
  }

  if (value instanceof URL || value instanceof URLSearchParams) {
    return redactLogString(value.toString());
  }

  if (value instanceof Map) {
    return redactMapValue(value, seen, depth);
  }

  if (value instanceof Set) {
    return redactSetValue(value, seen, depth);
  }

  const jsonValue = getJsonValue(value);
  if (jsonValue !== undefined) {
    return redactLogValue(jsonValue, seen, depth + 1);
  }

  const redactedEntries = redactObjectEntries(value, seen, depth);
  if (redactedEntries !== undefined) {
    return redactedEntries;
  }

  const stringValue = getCustomStringValue(value);
  return stringValue !== undefined ? redactLogString(stringValue) : value;
}

/**
 * Recursively redacts sensitive information from an arbitrary log value.
 * Values under sensitive keys (see `sensitiveMetadataKey`) are replaced
 * wholesale; strings are pattern-redacted via `redactMessage`. Guards
 * against cycles (`seen`), unbounded depth (`MAX_REDACTION_DEPTH`), and
 * oversized collections (`MAX_REDACTION_ENTRIES`). Ported from the
 * reference implementation in
 * `packages/data-schemas/src/config/parsers.ts`; returns a redacted copy
 * without mutating the input.
 *
 * @param {unknown} value - The value to redact.
 * @param {WeakMap<object, unknown>} [seen] - Visited-node cache for cycle safety.
 * @param {number} [depth] - Current recursion depth.
 * @returns {unknown} - The redacted copy.
 */
function redactLogValue(value, seen = new WeakMap(), depth = 0) {
  if (typeof value === 'string') {
    return redactLogString(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const cached = seen.get(value);
  if (cached !== undefined) {
    return cached;
  }

  if (depth >= MAX_REDACTION_DEPTH) {
    return REDACTED_VALUE;
  }

  if (Array.isArray(value)) {
    const redacted = [];
    seen.set(value, redacted);
    const length = Math.min(value.length, MAX_REDACTION_ENTRIES);
    for (let index = 0; index < length; index++) {
      redacted.push(redactLogValue(value[index], seen, depth + 1));
    }
    if (value.length > MAX_REDACTION_ENTRIES) {
      redacted.push('Additional array values omitted');
    }
    return redacted;
  }

  if (value instanceof Error) {
    return redactErrorValue(value, seen, depth);
  }

  if (!isPlainRecord(value)) {
    return redactNonPlainValue(value, seen, depth);
  }

  return redactObjectEntries(value, seen, depth) ?? {};
}

/**
 * Redacts sensitive information from log messages at every level. Scrubs
 * `info.message`, the winston message symbol, and the splat arguments so
 * that both string patterns (via `redactMessage`) and values under
 * sensitive keys (e.g. `config.headers.Authorization` on an axios error)
 * are removed before winston interpolates or serializes them. Runs before
 * `winston.format.splat()` in the pipeline so splat objects are redacted
 * by key prior to interpolation.
 *
 * Note: Intentionally reassigns redacted copies onto the info object.
 * @param {Object} info - The log information object.
 * @returns {Object} - The modified log information object.
 */
const redactFormat = winston.format((info) => {
  if (info.message !== undefined) {
    info.message = redactLogValue(info.message);
  }

  if (info[MESSAGE_SYMBOL] !== undefined) {
    info[MESSAGE_SYMBOL] = redactLogValue(info[MESSAGE_SYMBOL]);
  }

  if (info[SPLAT_SYMBOL] !== undefined) {
    info[SPLAT_SYMBOL] = redactLogValue(info[SPLAT_SYMBOL]);
  }
  return info;
});

/**
 * Truncates long strings, especially base64 image data, within log messages.
 *
 * @param {any} value - The value to be inspected and potentially truncated.
 * @param {number} [length] - The length at which to truncate the value. Default: 100.
 * @returns {any} - The truncated or original value.
 */
const truncateLongStrings = (value, length = 100) => {
  if (typeof value === 'string') {
    return value.length > length ? value.substring(0, length) + '... [truncated]' : value;
  }

  return value;
};

/**
 * An array mapping function that truncates long strings (objects converted to JSON strings).
 * @param {any} item - The item to be condensed.
 * @returns {any} - The condensed item.
 */
const condenseArray = (item) => {
  if (typeof item === 'string') {
    return truncateLongStrings(JSON.stringify(item));
  } else if (typeof item === 'object') {
    return truncateLongStrings(JSON.stringify(item));
  }
  return item;
};

const RESERVED_LOG_KEYS = new Set(['level', 'message', 'timestamp', 'splat']);

/**
 * Extracts user-supplied metadata from a winston info object. Filters out:
 * - Reserved winston keys (`level`, `message`, `timestamp`, `splat`).
 * - Numeric-string keys (`"0"`, `"1"`, ...) that `format.splat()` can
 *   synthesize when a primitive is passed as an extra log argument.
 * - Values that are undefined, null, empty strings, functions, or symbols.
 *
 * Underscore-prefixed keys are intentionally preserved so legitimate
 * fields like MongoDB `_id` survive.
 *
 * @param {Record<string, unknown>} source - The object to extract metadata from.
 * @returns {Record<string, unknown> | undefined} - The extracted metadata, or undefined if empty.
 */
function extractMetaObject(source) {
  if (source == null || typeof source !== 'object') {
    return undefined;
  }
  const meta = {};
  for (const key of Object.keys(source)) {
    if (RESERVED_LOG_KEYS.has(key)) {
      continue;
    }
    if (NUMERIC_KEY_RE.test(key)) {
      continue;
    }
    const value = source[key];
    if (key === 'tenantId' && value === SYSTEM_TENANT_ID) {
      continue;
    }
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
      continue;
    }
    meta[key] = value;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/**
 * Formats the metadata portion of a winston info object as a compact
 * single-line JSON trailer, suitable for appending to the console message.
 * Returns an empty string when there is no meaningful metadata.
 *
 * @param {Record<string, unknown>} info - The winston info object.
 * @returns {string} - The serialized metadata, or an empty string.
 */
function formatConsoleMeta(info) {
  const meta = extractMetaObject(info);
  if (!meta) {
    return '';
  }
  const seen = new WeakSet();
  const replacer = (_key, value) => {
    if (typeof value === 'string') {
      const safe = redactMessage(value);
      return safe.length > CONSOLE_JSON_STRING_LENGTH
        ? `${safe.substring(0, CONSOLE_JSON_STRING_LENGTH)}...`
        : safe;
    }
    if (value !== null && typeof value === 'object') {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  };

  try {
    return JSON.stringify(meta, replacer);
  } catch {
    /*
     * Fall back to per-field serialization: a single unserializable field
     * shouldn't drop every other scalar in the trailer. Scalars are emitted
     * as-is; values that still fail serialization are replaced with a
     * placeholder so `provider`, `model`, etc. continue to surface.
     */
    const parts = [];
    for (const key of Object.keys(meta)) {
      const perFieldSeen = new WeakSet();
      const perFieldReplacer = (k, value) => {
        if (typeof value === 'string') {
          return replacer(k, value);
        }
        if (value !== null && typeof value === 'object') {
          if (perFieldSeen.has(value)) {
            return '[Circular]';
          }
          perFieldSeen.add(value);
        }
        return value;
      };
      try {
        parts.push(`${JSON.stringify(key)}:${JSON.stringify(meta[key], perFieldReplacer)}`);
      } catch {
        parts.push(`${JSON.stringify(key)}:"[Unserializable]"`);
      }
    }
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
  }
}

function formatRequestContext(info) {
  if (info == null || typeof info !== 'object') {
    return '';
  }
  const context = {};
  for (const key of LOG_CONTEXT_KEYS) {
    const value = info[key];
    if (key === 'tenantId' && value === SYSTEM_TENANT_ID) {
      continue;
    }
    if (typeof value === 'string' && value) {
      context[key] = value;
    }
  }
  return Object.keys(context).length > 0 ? JSON.stringify(context) : '';
}

/**
 * Formats log messages for file and debug-console transports. Three paths:
 * - `warn` / `error`: append a compact single-line JSON metadata trailer
 *   (via `formatConsoleMeta`) and pass the full line through `redactMessage`
 *   so sensitive patterns are scrubbed.
 * - `debug`: perform the detailed multi-line object traversal of
 *   `SPLAT_SYMBOL[0]`, with long-string truncation and array condensation.
 *   Redaction on this path is not applied here (debug-file consumers
 *   historically accept raw detail).
 * - Other levels: return the truncated `"<timestamp> <level>: <message>"`
 *   line with request context metadata when present.
 *
 * @param {Object} options - The options for formatting log messages.
 * @param {string} options.level - The log level.
 * @param {string} options.message - The log message.
 * @param {string} options.timestamp - The timestamp of the log message.
 * @param {Object} options.metadata - Additional metadata associated with the log message.
 * @returns {string} - The formatted log message.
 */
const debugTraverse = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  if (!message) {
    return `${timestamp} ${level}`;
  }

  if (!message?.trim || typeof message !== 'string') {
    return `${timestamp} ${level}: ${JSON.stringify(message)}`;
  }

  let msg = `${timestamp} ${level}: ${truncateLongStrings(message?.trim(), DEBUG_MESSAGE_LENGTH)}`;
  const levelStr = typeof level === 'string' ? level : String(level);
  const isErrorOrWarn = levelStr.includes('error') || levelStr.includes('warn');

  /*
   * Warn/error follow a simpler code path: append a single-line JSON
   * metadata trailer (same shape as the console formatter) and pass the
   * result through `redactMessage`. The complex object-traversal below is
   * kept for debug level only, where detailed multi-line output is the
   * intended behavior and its splat/interpolation interactions were
   * already tolerated.
   */
  if (isErrorOrWarn) {
    const trailer = formatConsoleMeta(metadata);
    const line = trailer ? `${msg} ${trailer}` : msg;
    return redactMessage(line);
  }

  try {
    if (level !== 'debug') {
      const trailer = formatRequestContext(metadata);
      return trailer ? `${msg} ${trailer}` : msg;
    }

    if (!metadata) {
      return msg;
    }

    const appendMetadataTrailer = (line) => {
      const trailer = formatRequestContext(metadata);
      return trailer ? `${line} ${trailer}` : line;
    };

    const debugValue = metadata[SPLAT_SYMBOL]?.[0];

    if (!debugValue) {
      return appendMetadataTrailer(msg);
    }

    if (debugValue && Array.isArray(debugValue)) {
      msg += `\n${JSON.stringify(debugValue.map(condenseArray))}`;
      return appendMetadataTrailer(msg);
    }

    if (typeof debugValue !== 'object') {
      msg += ` ${debugValue}`;
      return appendMetadataTrailer(msg);
    }

    msg += '\n{';

    const copy = klona(metadata);
    if (copy.tenantId === SYSTEM_TENANT_ID) {
      delete copy.tenantId;
    }
    traverse(copy).forEach(function (value) {
      if (typeof this?.key === 'symbol') {
        return;
      }

      let _parentKey = '';
      const parent = this.parent;

      if (typeof parent?.key !== 'symbol' && parent?.key) {
        _parentKey = parent.key;
      }

      const parentKey = `${parent && parent.notRoot ? _parentKey + '.' : ''}`;

      const tabs = `${parent && parent.notRoot ? '    ' : '  '}`;

      const currentKey = this?.key ?? 'unknown';

      if (this.isLeaf && typeof value === 'string') {
        const truncatedText = truncateLongStrings(value);
        msg += `\n${tabs}${parentKey}${currentKey}: ${JSON.stringify(truncatedText)},`;
      } else if (this.notLeaf && Array.isArray(value) && value.length > 0) {
        const currentMessage = `\n${tabs}// ${value.length} ${currentKey.replace(/s$/, '')}(s)`;
        this.update(currentMessage, true);
        msg += currentMessage;
        const stringifiedArray = value.map(condenseArray);
        msg += `\n${tabs}${parentKey}${currentKey}: [${stringifiedArray}],`;
      } else if (this.isLeaf && typeof value === 'function') {
        msg += `\n${tabs}${parentKey}${currentKey}: function,`;
      } else if (this.isLeaf) {
        msg += `\n${tabs}${parentKey}${currentKey}: ${value},`;
      }
    });

    msg += '\n}';
    return msg;
  } catch (e) {
    return (msg += `\n[LOGGER PARSING ERROR] ${e.message}`);
  }
});

const jsonTruncateFormat = winston.format((info) => {
  const truncateLongStrings = (str, maxLength) => {
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  };

  const seen = new WeakSet();

  const truncateObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    // Handle circular references
    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => truncateObject(item));
    }

    const newObj = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === 'string') {
        newObj[key] = truncateLongStrings(value, CONSOLE_JSON_STRING_LENGTH);
      } else {
        newObj[key] = truncateObject(value);
      }
    });
    return newObj;
  };

  return truncateObject(info);
});

module.exports = {
  redactFormat,
  redactMessage,
  debugTraverse,
  jsonTruncateFormat,
  formatConsoleMeta,
};
