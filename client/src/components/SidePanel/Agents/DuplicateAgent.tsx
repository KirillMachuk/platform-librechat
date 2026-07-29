import { CopyPlus } from 'lucide-react';
import { useFormState } from 'react-hook-form';
import { useToastContext, Button } from '@librechat/client';
import { useAgentPanelContext } from '~/Providers/AgentPanelContext';
import { useDuplicateAgentMutation } from '~/data-provider';
import { isEphemeralAgent } from '~/common';
import { useLocalize } from '~/hooks';

export default function DuplicateAgent({ agent_id }: { agent_id: string }) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { setCurrentAgentId } = useAgentPanelContext();
  /**
   * The builder has no draft storage, so switching the panel to the copy throws
   * away whatever is unsaved in the form. The copy is made server-side from the
   * *persisted* agent, so it never contained those edits anyway — staying put is
   * the only outcome that loses nothing.
   */
  const { isDirty } = useFormState();

  const duplicateAgent = useDuplicateAgentMutation({
    onSuccess: ({ agent }) => {
      if (isDirty) {
        showToast({
          message: localize('com_ui_agent_duplicated_stayed'),
          status: 'success',
        });
        return;
      }
      showToast({
        message: localize('com_ui_agent_duplicated'),
        status: 'success',
      });
      setCurrentAgentId(agent.id);
    },
    onError: (error) => {
      console.error(error);
      showToast({
        message: localize('com_ui_agent_duplicate_error'),
        status: 'error',
      });
    },
  });

  if (isEphemeralAgent(agent_id)) {
    return null;
  }

  const handleDuplicate = () => {
    duplicateAgent.mutate({ agent_id });
  };

  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={localize('com_ui_duplicate_agent')}
      title={localize('com_ui_duplicate_agent')}
      type="button"
      /** Each tap creates a real agent; without this a double tap creates two. */
      disabled={duplicateAgent.isLoading}
      onClick={handleDuplicate}
    >
      <div className="flex w-full items-center justify-center gap-2 text-primary">
        <CopyPlus className="size-4" />
      </div>
    </Button>
  );
}
