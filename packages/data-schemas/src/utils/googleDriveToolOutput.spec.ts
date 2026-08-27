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
});
