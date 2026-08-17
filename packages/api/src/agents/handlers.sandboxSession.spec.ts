import { Types } from 'mongoose';
import type {
  ToolExecuteBatchRequest,
  ToolExecuteResult,
  ToolCallRequest,
} from '@librechat/agents';
import { createToolExecuteHandler, ToolExecuteOptions } from './handlers';

/**
 * Sandbox session continuity across agent steps.
 *
 * The host file-authoring tools (`create_file` / `edit_file`) and the sandbox
 * branch of `read_file` all talk to the same codeapi `/exec` endpoint. codeapi
 * resolves the target sandbox from the request body (measured against the live
 * stand on 2026-08-17):
 *
 *   - `session_id` of a live session -> that sandbox is reused as-is
 *   - `files: [refs]`                -> those refs are inherited into a NEW sandbox
 *   - neither                        -> a fresh, EMPTY sandbox
 *
 * So a file written in step N is only visible in step N+1 if the handler
 * forwards the session it learned from step N. `FakeSandbox` below reproduces
 * exactly those three behaviours, which is what makes these tests meaningful:
 * a lost session is not a cosmetic difference, it is a missing file.
 */
type FileRef = { id: string; name: string; storage_session_id?: string; session_id?: string };

class FakeSandbox {
  private sessions = new Map<string, Map<string, string>>();
  private seq = 0;
  /** Every session id handed to the mocks, in call order. */
  readSessions: Array<string | undefined> = [];
  writeSessions: Array<string | undefined> = [];
  /** Session each write actually landed in, in call order. */
  writeTargets: string[] = [];

  private resolve(
    session_id?: string,
    files?: FileRef[],
  ): { sid: string; fs: Map<string, string> } {
    const sid =
      session_id != null && this.sessions.has(session_id) ? session_id : `sess-${++this.seq}`;
    if (!this.sessions.has(sid)) {
      this.sessions.set(sid, new Map());
    }
    const fs = this.sessions.get(sid)!;
    for (const ref of files ?? []) {
      const src = this.sessions.get(ref.storage_session_id ?? ref.session_id ?? '');
      const content = src?.get(ref.name);
      if (content != null) {
        fs.set(ref.name, content);
      }
    }
    return { sid, fs };
  }

  /** Read-only view: existing session plus whatever the refs carry in. */
  private peek(session_id?: string, files?: FileRef[]): Map<string, string> {
    const view = new Map(this.sessions.get(session_id ?? '') ?? []);
    for (const ref of files ?? []) {
      const content = this.sessions
        .get(ref.storage_session_id ?? ref.session_id ?? '')
        ?.get(ref.name);
      if (content != null) {
        view.set(ref.name, content);
      }
    }
    return view;
  }

  private static basename(file_path: string): string {
    return file_path.split('/').pop() ?? file_path;
  }

  private refs(sid: string, fs: Map<string, string>): FileRef[] {
    return [...fs.keys()].map((name) => ({ id: `file-${name}`, name, storage_session_id: sid }));
  }

  readSandboxFile = jest.fn(
    async ({
      file_path,
      session_id,
      files,
    }: {
      file_path: string;
      session_id?: string;
      files?: FileRef[];
    }) => {
      this.readSessions.push(session_id);
      /* A read never creates a sandbox — mirrors codeapi, where `cat` on an
       * unknown session just fails. Creating one here would silently shift
       * every later session id and make the assertions meaningless. */
      const fs = this.peek(session_id, files);
      const name = FakeSandbox.basename(file_path);
      if (!fs.has(name)) {
        throw new Error(`cat: ${file_path}: No such file or directory`);
      }
      return { content: fs.get(name)! };
    },
  );

  writeSandboxFile = jest.fn(
    async ({
      file_path,
      content,
      session_id,
      files,
    }: {
      file_path: string;
      content: string;
      session_id?: string;
      files?: FileRef[];
    }) => {
      this.writeSessions.push(session_id);
      const { sid, fs } = this.resolve(session_id, files);
      this.writeTargets.push(sid);
      fs.set(FakeSandbox.basename(file_path), content);
      return {
        stdout: `WROTE ${content.length} bytes to ${file_path}\n`,
        session_id: sid,
        files: this.refs(sid, fs),
      };
    },
  );
}

const req = {
  user: { id: 'user-1', _id: new Types.ObjectId(), role: 'USER', name: 'Test User' },
  config: {},
} as never;

function makeHandler(sandbox: FakeSandbox) {
  const loadTools: ToolExecuteOptions['loadTools'] = jest.fn(async () => ({
    loadedTools: [],
    configurable: {
      req,
      codeEnvAvailable: true,
      /* Empty on purpose: `read_file` falls through to the sandbox branch
       * (the one under test) only when no skill is in scope. */
      accessibleSkillIds: [],
      skillAuthoringAvailable: false,
      fileAuthoringToolNames: new Set(['create_file', 'edit_file']),
    },
  }));
  return createToolExecuteHandler({
    loadTools,
    readSandboxFile: sandbox.readSandboxFile,
    writeSandboxFile: sandbox.writeSandboxFile,
  });
}

/** One agent step: the graph raises exactly one ON_TOOL_EXECUTE per batch. */
function step(
  handler: ReturnType<typeof createToolExecuteHandler>,
  toolCalls: ToolCallRequest[],
  thread_id = 'thread-1',
): Promise<ToolExecuteResult[]> {
  return new Promise((resolve, reject) => {
    handler.handle('on_tool_execute', {
      toolCalls,
      metadata: { thread_id, run_id: 'run-1' },
      resolve,
      reject,
    } as unknown as ToolExecuteBatchRequest);
  });
}

const createNumbers: ToolCallRequest = {
  id: 'call_create',
  name: 'create_file',
  args: { file_path: '/mnt/data/numbers.txt', content: '1\n2\n3\n4\n5\n' },
} as ToolCallRequest;

describe('sandbox session continuity', () => {
  /* Each test gets its own conversation: the session store is keyed by
   * user+conversation and outlives a single handler, so reusing one thread id
   * would let an earlier test seed the next one. */
  let threadSeq = 0;
  const freshThread = () => `thread-${++threadSeq}`;

  it('keeps the same sandbox when a later STEP reads the file it just wrote', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox);
    const thread = freshThread();

    const [created] = await step(handler, [createNumbers], thread);
    expect(created.status).toBe('success');

    /* Separate step — the user-visible scenario: "create the file, then as a
     * SEPARATE step compute over it". */
    const [read] = await step(
      handler,
      [
        {
          id: 'call_read',
          name: 'read_file',
          args: { file_path: '/mnt/data/numbers.txt' },
        } as ToolCallRequest,
      ],
      thread,
    );

    expect(read.errorMessage ?? '').not.toMatch(/No such file or directory/);
    expect(read.status).toBe('success');
    expect(read.content).toContain('1');
  });

  it('keeps the same sandbox when a later STEP edits the file it just wrote', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox);
    const thread = freshThread();

    await step(handler, [createNumbers], thread);
    const [edited] = await step(
      handler,
      [
        {
          id: 'call_edit',
          name: 'edit_file',
          args: { file_path: '/mnt/data/numbers.txt', old_text: '1', new_text: '9' },
        } as ToolCallRequest,
      ],
      thread,
    );

    expect(edited.status).toBe('success');
    /* Compared against where step 1 actually landed, not a hard-coded id, so
     * the assertion cannot pass by counting coincidence. */
    expect(sandbox.writeTargets[1]).toBe(sandbox.writeTargets[0]);
  });

  it('keeps the same sandbox for a second file written in the same step', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox);

    const results = await step(
      handler,
      [
        createNumbers,
        {
          id: 'call_create_2',
          name: 'create_file',
          args: { file_path: '/mnt/data/report.txt', content: 'hello\n' },
        } as ToolCallRequest,
      ],
      freshThread(),
    );

    expect(results.map((r) => r.status)).toEqual(['success', 'success']);
    /* Two different paths are two different files, not two different
     * sandboxes. */
    expect(new Set(sandbox.writeTargets).size).toBe(1);
  });

  it('does not hand one conversation the sandbox of another', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox);

    await step(handler, [createNumbers], freshThread());
    const [read] = await step(
      handler,
      [
        {
          id: 'call_read_other',
          name: 'read_file',
          args: { file_path: '/mnt/data/numbers.txt' },
        } as ToolCallRequest,
      ],
      freshThread(),
    );

    expect(read.status).toBe('error');
  });
});
