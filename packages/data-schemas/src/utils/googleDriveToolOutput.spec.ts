import {
  GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
  sanitizeGoogleDriveToolOutputs,
} from './googleDriveToolOutput';

describe('sanitizeGoogleDriveToolOutputs', () => {
  it.each([
    'search_files_mcp_google-drive',
    'get_file_metadata_mcp_google-drive',
    'read_file_content_mcp_google-drive',
  ])('redacts %s output', (name) => {
    const content = [
      {
        type: 'tool_call',
        tool_call: { name, output: 'restricted Google data' },
      },
    ];

    const sanitized = sanitizeGoogleDriveToolOutputs(content) as typeof content;

    expect(sanitized[0].tool_call.output).toBe(GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED);
    expect(content[0].tool_call.output).toBe('restricted Google data');
  });

  it('redacts nested subagent Google Drive output', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: {
          name: 'subagent',
          output: 'summary',
          subagent_content: [
            {
              type: 'tool_call',
              tool_call: {
                name: 'read_file_content_mcp_google-drive',
                output: 'nested restricted data',
              },
            },
          ],
        },
      },
    ];

    const sanitized = sanitizeGoogleDriveToolOutputs(content) as typeof content;

    expect(sanitized[0].tool_call.subagent_content[0].tool_call.output).toBe(
      GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
    );
  });

  it('redacts Google Drive output inside resumable-stream run-step events', () => {
    const eventData = {
      result: {
        id: 'step-1',
        type: 'tool_call',
        tool_call: {
          name: 'read_file_content_mcp_google-drive',
          args: '{"fileId":"kept-for-provenance"}',
          output: 'restricted Redis data',
        },
      },
    };

    const sanitized = sanitizeGoogleDriveToolOutputs(eventData) as typeof eventData;

    expect(sanitized.result.tool_call.output).toBe(GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED);
    expect(sanitized.result.tool_call.args).toContain('kept-for-provenance');
    expect(eventData.result.tool_call.output).toBe('restricted Redis data');
  });

  it('redacts legacy Assistants function output', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'read_file_content_mcp_google-drive',
            arguments: '{"fileId":"kept-for-provenance"}',
            output: 'restricted legacy Drive data',
          },
        },
      },
    ];

    const sanitized = sanitizeGoogleDriveToolOutputs(content) as typeof content;

    expect(sanitized[0].tool_call.function.output).toBe(GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED);
    expect(sanitized[0].tool_call.function.arguments).toContain('kept-for-provenance');
    expect(content[0].tool_call.function.output).toBe('restricted legacy Drive data');
  });

  it('does not change unrelated or lookalike tools', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: { name: 'read_file_content_mcp_other-drive', output: 'keep me' },
      },
      {
        type: 'tool_call',
        tool_call: { name: 'read_file_content_mcp_google-drive-copy', output: 'keep me too' },
      },
    ];

    expect(sanitizeGoogleDriveToolOutputs(content)).toBe(content);
  });

  it('does not redact lookalike data nested inside another tool call arguments', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: {
          name: 'database_import',
          args: {
            payload: {
              type: 'tool_call',
              tool_call: {
                name: 'read_file_content_mcp_google-drive',
                output: 'ordinary imported data',
              },
            },
          },
          output: 'import completed',
        },
      },
    ];

    expect(sanitizeGoogleDriveToolOutputs(content)).toBe(content);
    expect(content[0].tool_call.args.payload.tool_call.output).toBe('ordinary imported data');
  });

  it('does not redact lookalike data returned by another tool', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: {
          name: 'database_export',
          args: '{}',
          output: {
            type: 'tool_call',
            tool_call: {
              name: 'read_file_content_mcp_google-drive',
              output: 'ordinary exported data',
            },
          },
        },
      },
    ];

    expect(sanitizeGoogleDriveToolOutputs(content)).toBe(content);
    expect(content[0].tool_call.output.tool_call.output).toBe('ordinary exported data');
  });

  it('does not redact lookalike data inside legacy function arguments or unrelated output', () => {
    const content = [
      {
        type: 'tool_call',
        tool_call: {
          id: 'call-2',
          type: 'function',
          function: {
            name: 'database_import',
            arguments: {
              type: 'tool_call',
              tool_call: {
                name: 'read_file_content_mcp_google-drive',
                output: 'ordinary legacy argument data',
              },
            },
            output: {
              type: 'tool_call',
              tool_call: {
                name: 'read_file_content_mcp_google-drive',
                output: 'ordinary legacy output data',
              },
            },
          },
        },
      },
    ];

    expect(sanitizeGoogleDriveToolOutputs(content)).toBe(content);
    expect(content[0].tool_call.function.arguments.tool_call.output).toBe(
      'ordinary legacy argument data',
    );
    expect(content[0].tool_call.function.output.tool_call.output).toBe(
      'ordinary legacy output data',
    );
  });
});
