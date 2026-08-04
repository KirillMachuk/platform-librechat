import type { AgentWithTools } from '~/agents/context';
import type { MCPManager } from '~/mcp/MCPManager';
import { applyContextToAgent } from '~/agents/context';

/**
 * Memory is injected into every request, so where it lands in the system prompt is
 * an economic decision, not a stylistic one: a prompt cache matches on a byte-exact
 * prefix, and one volatile paragraph at the front invalidates the cached prefix on
 * every turn. It has to sit in the dynamic tail, behind the stable instructions.
 *
 * The tail itself is marked non-cacheable by `@librechat/agents`
 * (`buildDynamicInstructionsString`); this pins the half that lives in the fork —
 * that memory arrives as run context and never touches `instructions`.
 */

const STABLE_INSTRUCTIONS = 'You are the assistant of the company. Answer in Russian.';
const MEMORY_CONTEXT =
  '# Existing memory about the user:\n1. [2026-08-04]. Юрист отдела аренды, отвечает таблицами';

const noMCP = {
  getAllServerInstructions: () => ({}),
} as unknown as MCPManager;

describe('memory placement in the prompt', () => {
  it('appends memory to the dynamic tail and leaves the stable prefix byte-identical', async () => {
    const agent = { instructions: STABLE_INSTRUCTIONS, tools: [] } as unknown as AgentWithTools;

    await applyContextToAgent({
      agent,
      sharedRunContext: MEMORY_CONTEXT,
      mcpManager: noMCP,
      agentId: 'agent-1',
    });

    expect(agent.instructions).toBe(STABLE_INSTRUCTIONS);
    expect(agent.instructions).not.toContain('memory about the user');
    expect(agent.additional_instructions).toContain('memory about the user');
  });

  it('keeps the stable prefix identical as memory changes between turns', async () => {
    const prefixes: string[] = [];

    for (const memory of ['1. Юрист отдела аренды', '1. Юрист отдела аренды, ведёт тендеры']) {
      const agent = { instructions: STABLE_INSTRUCTIONS, tools: [] } as unknown as AgentWithTools;
      await applyContextToAgent({
        agent,
        sharedRunContext: `# Existing memory about the user:\n${memory}`,
        mcpManager: noMCP,
        agentId: 'agent-1',
      });
      prefixes.push(agent.instructions ?? '');
    }

    expect(prefixes[0]).toBe(prefixes[1]);
    expect(prefixes[0]).toBe(STABLE_INSTRUCTIONS);
  });
});
