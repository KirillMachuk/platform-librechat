import { useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { AgentPanelProvider, useAgentPanelContext } from '~/Providers/AgentPanelContext';
import { Panel, isEphemeralAgent } from '~/common';
import VersionPanel from './Version/VersionPanel';
import ActionsPanel from './ActionsPanel';
import AgentPanel from './AgentPanel';
import store from '~/store';

/**
 * `agentId` is the explicit builder target: `''` opens a blank form, an agent id
 * opens that agent. When omitted, the builder follows the active conversation's
 * agent (legacy side-panel behavior).
 */
export default function AgentPanelSwitch({ agentId }: { agentId?: string }) {
  return (
    <AgentPanelProvider>
      <AgentPanelSwitchWithContext agentId={agentId} />
    </AgentPanelProvider>
  );
}

function AgentPanelSwitchWithContext({ agentId }: { agentId?: string }) {
  const { activePanel, setCurrentAgentId } = useAgentPanelContext();
  const conversationAgentId = useRecoilValue(store.conversationAgentIdByIndex(0));
  const isControlled = agentId !== undefined;

  /**
   * Seeds the builder target and re-seeds only when the caller picks a different
   * agent — the in-panel agent switcher owns the selection from then on.
   */
  useEffect(() => {
    if (!isControlled) {
      return;
    }
    setCurrentAgentId(agentId);
  }, [setCurrentAgentId, agentId, isControlled]);

  useEffect(() => {
    if (isControlled) {
      return;
    }
    const agent_id = conversationAgentId ?? '';
    if (!isEphemeralAgent(agent_id)) {
      setCurrentAgentId(agent_id);
    }
  }, [setCurrentAgentId, conversationAgentId, isControlled]);

  if (activePanel === Panel.actions) {
    return <ActionsPanel />;
  }
  if (activePanel === Panel.version) {
    return <VersionPanel />;
  }
  return <AgentPanel />;
}
