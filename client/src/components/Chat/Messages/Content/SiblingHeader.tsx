import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import type { TMessage, TMessageContentParts } from 'librechat-data-provider';
import MessageTimestamp from '~/components/Chat/Messages/ui/MessageTimestamp';
import { useCopyToClipboard, useSiblingIdentity } from '~/hooks/Messages';
import { useBranchMessageMutation } from '~/data-provider/Messages';
import MessageIcon from '~/components/Share/MessageIcon';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SiblingHeaderProps = {
  /** The agentId from the content part (could be real agent ID or endpoint__model format) */
  agentId?: string;
  /** The messageId of the parent message */
  messageId?: string;
  /** ISO timestamp of the parent message */
  createdAt?: string | null;
  /** The conversationId */
  conversationId?: string | null;
  /** Whether a submission is in progress */
  isSubmitting?: boolean;
  /** This column's content parts, so Copy takes this answer and not the turn. */
  parts?: TMessageContentParts[];
  /** The phone's switcher already names the answer; repeating it here only
      squeezed the name to "E2E S…" to make room for the two buttons. */
  nameInSwitcher?: boolean;
};

/**
 * Both header actions share one shape: the canon control border, 30px on a
 * desktop and 44 on a phone. The phone size is not decoration — 44 is the
 * minimum a finger can hit, and at 30 these were the smallest targets on the
 * screen. Caught by the prototype's own guard, not by the app's touch sweep,
 * which only walks the chat screen and never opens a comparison.
 */
const ACTION =
  'flex h-11 flex-shrink-0 items-center gap-1.5 rounded-xl border border-border-control px-3 ' +
  'text-[15px] text-text-primary transition-colors duration-90 hover:bg-surface-hover md:h-[30px] ' +
  'md:text-[13px] ' +
  'focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-text-primary disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The header of one column in a side-by-side comparison: who wrote this answer,
 * and the two actions that belong to the answer rather than to the turn.
 *
 * Copy and "keep this one" live here on purpose. The row under the message
 * carries the turn's actions — edit the question, run it again — and a Copy
 * down there could not say which of two answers it meant.
 */
export default function SiblingHeader({
  agentId,
  messageId,
  createdAt,
  conversationId,
  isSubmitting,
  parts,
  nameInSwitcher,
}: SiblingHeaderProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isCopied, setIsCopied] = useState(false);
  const { displayName, displayEndpoint, displayModel, agent } = useSiblingIdentity(agentId);
  const copyToClipboard = useCopyToClipboard({ content: parts });

  const branchMessage = useBranchMessageMutation(conversationId ?? null, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_kept_this_answer'), status: 'success' });
    },
    onError: () => {
      showToast({ message: localize('com_ui_branch_error'), status: 'error' });
    },
  });

  const canKeep = !!messageId && !!agentId && !isSubmitting && !branchMessage.isLoading;

  const handleKeep = () => {
    if (!canKeep) {
      return;
    }
    branchMessage.mutate({ messageId, agentId });
  };

  return (
    <div className="mb-2 flex items-center justify-between gap-2 border-b border-border-light pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center overflow-hidden rounded-full">
          <MessageIcon
            message={
              {
                endpoint: displayEndpoint,
                model: displayModel,
                isCreatedByUser: false,
              } as TMessage
            }
            agent={agent || undefined}
          />
        </div>
        {!nameInSwitcher && (
          <span className="truncate text-sm font-medium text-text-primary" title={displayName}>
            {displayName}
          </span>
        )}
        <MessageTimestamp value={createdAt} />
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => copyToClipboard(setIsCopied)}
          disabled={!parts?.length}
          className={cn(ACTION, 'px-2.5')}
          aria-label={localize('com_ui_copy_this_answer')}
          title={localize('com_ui_copy_this_answer')}
        >
          {isCopied ? (
            <Check className="icon-sm" aria-hidden="true" />
          ) : (
            <Copy className="icon-sm" aria-hidden="true" />
          )}
        </button>
        {/* A word, not a branch glyph: this ends the comparison, and the audience
            is not technical — "create a branch" said nothing about that. */}
        <button
          type="button"
          onClick={handleKeep}
          disabled={!canKeep}
          className={cn(ACTION, !messageId && !agentId && 'invisible')}
          title={localize('com_ui_keep_this_answer_hint')}
        >
          {localize('com_ui_keep_this_answer')}
        </button>
      </div>
    </div>
  );
}
