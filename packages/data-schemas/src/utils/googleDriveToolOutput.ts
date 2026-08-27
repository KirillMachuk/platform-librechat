const GOOGLE_DRIVE_TOOL_NAMES = new Set([
  'search_files_mcp_google-drive',
  'get_file_metadata_mcp_google-drive',
  'read_file_content_mcp_google-drive',
]);

export const GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED: string = JSON.stringify({
  status: 'not_persisted',
  provider: 'google-drive',
  requiresReread: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const sanitized = value.map((item) => {
      const next = sanitizeValue(item);
      changed ||= next !== item;
      return next;
    });
    return changed ? sanitized : value;
  }

  if (!isRecord(value)) {
    return value;
  }

  let changed = false;
  let result: Record<string, unknown> = value;

  if (
    typeof value.name === 'string' &&
    GOOGLE_DRIVE_TOOL_NAMES.has(value.name) &&
    Object.prototype.hasOwnProperty.call(value, 'output') &&
    value.output !== GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED
  ) {
    result = {
      ...value,
      output: GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
    };
    changed = true;
  }

  for (const [key, item] of Object.entries(result)) {
    const next = sanitizeValue(item);
    if (next !== item) {
      if (!changed) {
        result = { ...value };
        changed = true;
      }
      result[key] = next;
    }
  }

  return changed ? result : value;
}

/**
 * Removes Google Drive MCP results at the database boundary while keeping the
 * live in-memory tool result available to the model that requested it.
 */
export function sanitizeGoogleDriveToolOutputs(content: unknown): unknown {
  return sanitizeValue(content);
}
