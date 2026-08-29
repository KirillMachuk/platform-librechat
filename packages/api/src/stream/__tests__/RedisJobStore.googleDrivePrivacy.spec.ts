import { GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED } from '@librechat/data-schemas';
import type { Redis } from 'ioredis';
import { RedisJobStore } from '../implementations/RedisJobStore';

describe('RedisJobStore Google Drive privacy boundary', () => {
  it('sanitizes resumable chunks without mutating the live event', async () => {
    const xadd = jest.fn();
    const expire = jest.fn();
    const exec = jest.fn().mockResolvedValue([]);
    const redis = {
      pipeline: () => ({ xadd, expire, exec }),
    } as unknown as Redis;
    const store = new RedisJobStore(redis);
    const liveEvent = {
      event: 'on_run_step_completed',
      data: {
        result: {
          type: 'tool_call',
          tool_call: {
            name: 'read_file_content_mcp_google-drive',
            args: '{"fileId":"kept"}',
            output: 'private Drive content',
          },
        },
      },
    };

    await store.appendChunk('stream-1', liveEvent);

    const persisted = JSON.parse(xadd.mock.calls[0][3]) as typeof liveEvent;
    expect(persisted.data.result.tool_call.output).toBe(GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED);
    expect(persisted.data.result.tool_call.args).toContain('kept');
    expect(liveEvent.data.result.tool_call.output).toBe('private Drive content');
  });

  it('sanitizes saved run steps and leaves unrelated tools untouched', async () => {
    const set = jest.fn().mockResolvedValue('OK');
    const redis = { set } as unknown as Redis;
    const store = new RedisJobStore(redis);
    const liveRunSteps = [
      {
        id: 'step-1',
        type: 'tool_call',
        tool_call: {
          name: 'search_files_mcp_google-drive',
          output: 'private search results',
        },
      },
      {
        id: 'step-2',
        type: 'tool_call',
        tool_call: {
          name: 'read_file_content_mcp_dropbox',
          output: 'unrelated output',
        },
      },
    ];

    await store.saveRunSteps('stream-2', liveRunSteps as never);

    const persisted = JSON.parse(set.mock.calls[0][1]) as typeof liveRunSteps;
    expect(persisted[0].tool_call.output).toBe(GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED);
    expect(persisted[1].tool_call.output).toBe('unrelated output');
    expect(liveRunSteps[0].tool_call.output).toBe('private search results');
  });

  it('sanitizes the final event stored in job metadata without changing the live event', async () => {
    const evalCommand = jest.fn().mockResolvedValue(1);
    const redis = { eval: evalCommand } as unknown as Redis;
    const store = new RedisJobStore(redis);
    const liveFinalEvent = {
      final: true,
      responseMessage: {
        content: [
          {
            type: 'tool_call',
            tool_call: {
              name: 'read_file_content_mcp_google-drive',
              output: 'private final response content',
            },
          },
        ],
      },
    };

    await store.updateJob('stream-3', { finalEvent: JSON.stringify(liveFinalEvent) });

    const args = evalCommand.mock.calls[0];
    const fieldIndex = args.indexOf('finalEvent');
    const persisted = JSON.parse(args[fieldIndex + 1]) as typeof liveFinalEvent;
    expect(persisted.responseMessage.content[0].tool_call.output).toBe(
      GOOGLE_DRIVE_OUTPUT_NOT_PERSISTED,
    );
    expect(liveFinalEvent.responseMessage.content[0].tool_call.output).toBe(
      'private final response content',
    );
  });
});
