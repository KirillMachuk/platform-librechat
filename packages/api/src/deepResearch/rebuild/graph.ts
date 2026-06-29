import { StateGraph, START, END } from '@langchain/langgraph';

import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { DeepResearchState, DeepResearchStateUpdate } from './state';
import type { DeepResearchTier } from './config';
import { DeepResearchStateAnnotation } from './state';
import { createScopeNode } from './nodes/scope';
import { createReportNode } from './nodes/report';
import { createResearcherNode } from './nodes/researcher';
import { routeFromSupervisor, createSupervisorNode } from './nodes/supervisor';

/** A graph node: pure `(state, config) → partial update`. Never throws. */
export type DeepResearchNode = (
  state: DeepResearchState,
  config: RunnableConfig,
) => Promise<DeepResearchStateUpdate>;

/** The four nodes, created by their factories with real deps (or stubs in tests). */
export interface DeepResearchGraphNodes {
  scope: DeepResearchNode;
  supervisor: DeepResearchNode;
  researcher: DeepResearchNode;
  report: DeepResearchNode;
}

export interface DeepResearchGraphOptions {
  /**
   * Optional durable checkpointer for cross-restart resume. NOT wired in v1: the
   * "always reports" guarantee comes from the in-graph terminal REPORT node plus the
   * run wrapper's last-snapshot fallback, NOT from durable recovery — so a process
   * kill mid-run (deploy/OOM) loses that run. A PostgresSaver here is the Phase-3 add
   * for surviving restarts of long runs.
   */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Assembles the Deep Research StateGraph:
 *
 *   START → SCOPE → SUPERVISOR ⇄ RESEARCHER
 *                       │
 *                       └─(concluded)→ REPORT → END
 *
 * SUPERVISOR is the only branch point: its `routeFromSupervisor` edge sends the
 * run to RESEARCHER while gathering, or to the terminal REPORT once it concluded
 * (LLM said complete, or the deterministic budget/round gate tripped). REPORT
 * always runs before END — there is no path to END that skips it.
 */
export function buildDeepResearchGraph(
  nodes: DeepResearchGraphNodes,
  options: DeepResearchGraphOptions = {},
) {
  const workflow = new StateGraph(DeepResearchStateAnnotation)
    .addNode('scope', nodes.scope)
    .addNode('supervisor', nodes.supervisor)
    .addNode('researcher', nodes.researcher)
    .addNode('report', nodes.report)
    .addEdge(START, 'scope')
    .addEdge('scope', 'supervisor')
    .addConditionalEdges('supervisor', routeFromSupervisor, {
      researcher: 'researcher',
      report: 'report',
    })
    .addEdge('researcher', 'supervisor')
    .addEdge('report', END);

  return workflow.compile({ checkpointer: options.checkpointer });
}

/** The compiled DR graph type — used by the run wrapper. */
export type CompiledDeepResearchGraph = ReturnType<typeof buildDeepResearchGraph>;

/** Per-node dependencies for a full DR graph (each model is pre-routed via the caller's endpoint). */
export interface DeepResearchGraphDeps {
  /** Lead model — SCOPE, SUPERVISOR, REPORT. */
  leadModel: BaseChatModel;
  /** Worker model — the RESEARCHER tool loop. */
  workerModel: BaseChatModel;
  /** Compress model — researcher digest. */
  compressModel: BaseChatModel;
  /** Report model — synthesis (typically the lead model). */
  reportModel: BaseChatModel;
  /** Retrieval tools, pre-scoped (file_search = chat-attached files only — fix ②). */
  tools: StructuredToolInterface[];
  tier: DeepResearchTier;
  /** Injected ISO timestamp (never `Date.now()` inside a node). */
  now: string;
  /** Per-run spotlighting nonce for fencing untrusted external material (H5). */
  nonce: string;
  checkpointer?: BaseCheckpointSaver;
}

/** Builds all four nodes from deps and assembles the compiled DR graph. */
export function createDeepResearchGraph(deps: DeepResearchGraphDeps) {
  return buildDeepResearchGraph(
    {
      scope: createScopeNode({ model: deps.leadModel, now: deps.now }),
      supervisor: createSupervisorNode({
        model: deps.leadModel,
        tier: deps.tier,
        now: deps.now,
        nonce: deps.nonce,
      }),
      researcher: createResearcherNode({
        model: deps.workerModel,
        compressModel: deps.compressModel,
        tools: deps.tools,
        tier: deps.tier,
        now: deps.now,
        nonce: deps.nonce,
      }),
      report: createReportNode({
        reportModel: deps.reportModel,
        tier: deps.tier,
        now: deps.now,
        nonce: deps.nonce,
      }),
    },
    { checkpointer: deps.checkpointer },
  );
}
