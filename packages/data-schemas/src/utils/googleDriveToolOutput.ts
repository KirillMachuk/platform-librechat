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

  for (const [key, item] of Object.entries(value)) {
    const next = sanitizeValue(item);
    if (next !== item) {
      if (!changed) {
        result = { ...value };
        changed = true;
      }
      result[key] = next;
    }
  }

  const toolCall = result.tool_call;
  if (
    result.type === 'tool_call' &&
    isRecord(toolCall) &&
    typeof toolCall.name === 'string' &&
    GOOGLE_DRIVE_TOOL_NAMES.has(toolCall.name) &&
    Object.prototype.hasOwnProperty.call(toolCall, 'output') &&
    toolCall.output !== GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED
  ) {
    if (!changed) {
      result = { ...value };
    }
    result.tool_call = {
      ...toolCall,
      output: GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
    };
    changed = true;
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
