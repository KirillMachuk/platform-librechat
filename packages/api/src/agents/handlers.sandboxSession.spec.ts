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
type FileRef = {
  id: string;
  name: string;
  storage_session_id?: string;
  session_id?: string;
  resource_id?: string;
  kind?: string;
  version?: number;
};

class FakeSandbox {
  private sessions = new Map<string, Map<string, string>>();
  private seq = 0;
  /** Every session id handed to the mocks, in call order. */
  readSessions: Array<string | undefined> = [];
  writeSessions: Array<string | undefined> = [];
  /** Session each write actually landed in, in call order. */
  writeTargets: string[] = [];
  /** Session each code execution actually landed in, in call order. */
  execTargets: string[] = [];
  /** File refs handed to each write, in call order. */
  writeFiles: Array<FileRef[] | undefined> = [];

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
    return [...fs.keys()].map((name) => ({
      id: `file-${name}`,
      name,
      storage_session_id: sid,
      resource_id: `file-${name}`,
      kind: 'user',
      version: 1,
    }));
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

  /** Mirrors a plain `/exec` POST: what a code-execution tool sends. */
  exec({ code, session_id, files }: { code: string; session_id?: string; files?: FileRef[] }): {
    stdout: string;
    stderr: string;
    session_id: string;
    files: FileRef[];
  } {
    const { sid, fs } = this.resolve(session_id, files);
    this.execTargets.push(sid);
    let stdout = '';
    let stderr = '';
    const write = /^WRITE (\S+) (.*)$/.exec(code);
    const read = /^READ (\S+)$/.exec(code);
    if (write) {
      fs.set(write[1], write[2]);
      stdout = 'written\n';
    } else if (read) {
      const content = fs.get(read[1]);
      if (content == null) {
        stderr = `cat: ${read[1]}: No such file or directory`;
      } else {
        stdout = content;
      }
    }
    return { stdout, stderr, session_id: sid, files: this.refs(sid, fs) };
  }

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
      this.writeFiles.push(files);
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

/**
 * Stands in for the SDK's `execute_code`. Deliberately reads ONLY
 * `_injected_files` and ignores `session_id`, because that is what the real
 * `CodeExecutor` does — it destructures `session_id` and never puts it in the
 * request body. A fake that honoured `session_id` would pass for a reason
 * production does not have.
 */
function makeExecTool(sandbox: FakeSandbox, lagTicks = 0) {
  return {
    name: 'execute_code',
    invoke: async (args: { code?: string }, config: Record<string, unknown>) => {
      const { _injected_files } = (config.toolCall ?? {}) as { _injected_files?: FileRef[] };
      /* Deterministic stand-in for network latency: yield the macrotask queue
       * a fixed number of times. A real timer made the suite slow and left the
       * jest worker holding a handle; the ordering this exposes is the same. */
      for (let i = 0; i < lagTicks; i++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const result = sandbox.exec({ code: args.code ?? '', files: _injected_files });
      return {
        content: `stdout:\n${result.stdout}\nstderr:\n${result.stderr}\n`,
        artifact: { session_id: result.session_id, files: result.files },
      };
    },
  };
}

function makeHandler(sandbox: FakeSandbox, opts: { tools?: unknown[]; user?: string } = {}) {
  const handlerReq = {
    user: { id: opts.user ?? 'user-1', _id: new Types.ObjectId(), role: 'USER', name: 'T' },
    config: {},
  } as never;
  const loadTools: ToolExecuteOptions['loadTools'] = jest.fn(async () => ({
    loadedTools: (opts.tools ?? []) as never[],
    configurable: {
      req: handlerReq,
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

  /**
   * 31.08.2026 on the stand, run `1d4605a4`: the `pptx` skill unpacked its files into the
   * run's sandbox, then `create_file` wrote a spec — and every later `bash_tool` call said
   * "No such file or directory", twice over, until the model gave up and rewrote the file
   * with a shell heredoc. Five of that run's twelve tool rounds went on the workaround,
   * which is why it hit the step ceiling.
   *
   * The two sides each keep a memory of the sandbox: the SDK seeds `codeSessionContext` on
   * the calls it knows about, and the host records what its own file authoring established.
   * The tests above only ever exercise the case where the SDK's side is EMPTY — so the
   * fallback to the host's side is enough and they pass. Here the SDK's side is NOT empty,
   * which is the ordinary shape of a real run, and picking one side means the other side's
   * files are silently dropped.
   */
  it('lets code see a file created AFTER the sandbox already had files in it', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox, { tools: [makeExecTool(sandbox)] });
    const thread = freshThread();

    /* Step 1 — code establishes the sandbox and puts a file in it, the way priming a
     * skill does before the model ever asks for a file to be written. */
    const [seeded] = await step(
      handler,
      [
        {
          id: 'call_seed',
          name: 'execute_code',
          args: { code: 'WRITE seed.txt from-the-skill' },
        } as ToolCallRequest,
      ],
      thread,
    );
    expect(seeded.status).toBe('success');
    const seededContext = {
      session_id: (seeded.artifact as { session_id?: string }).session_id,
      files: (seeded.artifact as { files?: FileRef[] }).files,
    };

    /* Step 2 — the model writes a spec file. The SDK does not seed authoring calls, so
     * this call arrives bare, exactly as it does in production. */
    const [written] = await step(
      handler,
      [
        {
          id: 'call_write_spec',
          name: 'create_file',
          args: { file_path: '/mnt/data/spec.json', content: '{"job":"pptx"}' },
        } as ToolCallRequest,
      ],
      thread,
    );
    expect(written.status).toBe('success');

    /* Step 3 — code runs over the spec. This call DOES arrive seeded (it is a tool the
     * SDK tracks), carrying the sandbox from step 1 — the state that makes the two
     * memories disagree. The user asked for one thing: read the file that was just
     * written. */
    const [ran] = await step(
      handler,
      [
        {
          id: 'call_use_spec',
          name: 'execute_code',
          args: { code: 'READ spec.json' },
          codeSessionContext: seededContext,
        } as unknown as ToolCallRequest,
      ],
      thread,
    );

    expect(String(ran.content)).not.toContain('No such file or directory');
    expect(String(ran.content)).toContain('pptx');
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
  it('lets a later STEP run code over the file an earlier step created', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox, { tools: [makeExecTool(sandbox)] });
    const thread = freshThread();

    await step(handler, [createNumbers], thread);
    const [ran] = await step(
      handler,
      [
        {
          id: 'call_exec',
          name: 'execute_code',
          args: { code: 'READ numbers.txt' },
        } as ToolCallRequest,
      ],
      thread,
    );

    expect(String(ran.content)).not.toContain('No such file or directory');
    expect(String(ran.content)).toContain('1');
  });

  it('puts a file write and a code run in the SAME step into one sandbox', async () => {
    const sandbox = new FakeSandbox();
    /* The code call is slowed down so the two land out of order. Without the
     * delay the write happens to finish first and the race hides itself. */
    const handler = makeHandler(sandbox, { tools: [makeExecTool(sandbox, 8)] });
    const lastThread = freshThread();

    const results = await step(
      handler,
      [
        createNumbers,
        {
          id: 'call_exec_same_step',
          name: 'execute_code',
          args: { code: 'WRITE report.txt hello' },
        } as ToolCallRequest,
      ],
      lastThread,
    );

    expect(results.map((r) => r.status)).toEqual(['success', 'success']);

    /* Session ids legitimately differ — inheriting files always opens a new
     * sandbox — so the thing to assert is what the user feels: after that
     * step, BOTH files are still reachable. If the two calls raced into
     * separate sandboxes, one of them is stranded and this read fails. */
    const [readBoth] = await step(
      handler,
      [
        {
          id: 'call_read_both',
          name: 'execute_code',
          args: { code: 'READ numbers.txt' },
        } as ToolCallRequest,
      ],
      lastThread,
    );
    expect(String(readBoth.content)).not.toContain('No such file or directory');

    const [readReport] = await step(
      handler,
      [
        {
          id: 'call_read_report',
          name: 'execute_code',
          args: { code: 'READ report.txt' },
        } as ToolCallRequest,
      ],
      lastThread,
    );
    expect(String(readReport.content)).toContain('hello');
  });

  it('does not hand one USER the sandbox of another on the same conversation id', async () => {
    const sandbox = new FakeSandbox();
    const thread = 'shared-conversation-id';

    const mine = makeHandler(sandbox, { user: 'user-a' });
    await step(mine, [createNumbers], thread);

    const theirs = makeHandler(sandbox, { user: 'user-b' });
    const [read] = await step(
      theirs,
      [
        {
          id: 'call_read_other_user',
          name: 'read_file',
          args: { file_path: '/mnt/data/numbers.txt' },
        } as ToolCallRequest,
      ],
      thread,
    );

    expect(read.status).toBe('error');
  });
  it('hands codeapi back the same file refs it gave us, not a trimmed copy', async () => {
    const sandbox = new FakeSandbox();
    const handler = makeHandler(sandbox);
    const thread = freshThread();

    await step(handler, [createNumbers], thread);
    await step(
      handler,
      [
        {
          id: 'call_edit_refs',
          name: 'edit_file',
          args: { file_path: '/mnt/data/numbers.txt', old_text: '1', new_text: '9' },
        } as ToolCallRequest,
      ],
      thread,
    );

    /* codeapi's own request validator reads resource_id/kind/version; the
     * platform logs "codeapi will reject with 400" when they go missing, so
     * the refs must survive the trip through the session context intact. */
    const forwarded = sandbox.writeFiles[1];
    expect(forwarded && forwarded.length).toBeGreaterThan(0);
    for (const ref of forwarded ?? []) {
      expect(typeof ref.resource_id).toBe('string');
      expect(typeof ref.kind).toBe('string');
      expect(typeof ref.version).toBe('number');
    }
  });
});
