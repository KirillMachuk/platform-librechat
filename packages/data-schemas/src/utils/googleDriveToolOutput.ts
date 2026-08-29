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

function sanitizeLegacyFunctionCall(
  functionCall: Record<string, unknown>,
): Record<string, unknown> {
  if (
    typeof functionCall.name !== 'string' ||
    !GOOGLE_DRIVE_TOOL_NAMES.has(functionCall.name) ||
    !Object.prototype.hasOwnProperty.call(functionCall, 'output') ||
    functionCall.output === GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED
  ) {
    return functionCall;
  }

  return {
    ...functionCall,
    output: GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
  };
}

function sanitizeToolCall(toolCall: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  let result = toolCall;
  const isLegacyFunctionCall = toolCall.type === 'function' && isRecord(toolCall.function);

  for (const [key, item] of Object.entries(toolCall)) {
    /** Tool arguments and ordinary tool output are payload data, not content-part containers. */
    if (key === 'args' || key === 'output') {
      continue;
    }

    const next =
      key === 'function' && isLegacyFunctionCall
        ? sanitizeLegacyFunctionCall(item as Record<string, unknown>)
        : sanitizeValue(item);
    if (next !== item) {
      if (!changed) {
        result = { ...toolCall };
        changed = true;
      }
      result[key] = next;
    }
  }

  if (
    typeof result.name === 'string' &&
    GOOGLE_DRIVE_TOOL_NAMES.has(result.name) &&
    Object.prototype.hasOwnProperty.call(result, 'output') &&
    result.output !== GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED
  ) {
    if (!changed) {
      result = { ...toolCall };
    }
    result.output = GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED;
    changed = true;
  }

  return changed ? result : toolCall;
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
  const isToolCallEnvelope = value.type === 'tool_call' && isRecord(value.tool_call);

  for (const [key, item] of Object.entries(value)) {
    const next =
      key === 'tool_call' && isToolCallEnvelope
        ? sanitizeToolCall(item as Record<string, unknown>)
        : sanitizeValue(item);
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
