import React from 'react';
import { GitFork } from 'lucide-react';
import { useToastContext } from '@librechat/client';
import { ForkOptions } from 'librechat-data-provider';
import { useLocalize, useNavigateToConvo } from '~/hooks';
import { useForkConvoMutation } from '~/data-provider';
import { cn } from '~/utils';

/**
 * Copies the conversation up to this message into a new one, leaving the
 * original untouched.
 *
 * Upstream opens a popover here offering three tree-selection strategies plus a
 * direction checkbox — eight combinations that only make sense to someone who
 * knows how the message tree is stored. This ships the one an employee wants
 * ("continue from here in a separate chat", the visible thread up to this
 * message) as a single click, matching what ChatGPT's "Branch in new chat" does.
 */
export default function Fork({
  messageId,
  conversationId: _convoId,
  forkingSupported = false,
  latestMessageId,
  isLast = false,
}: {
  messageId: string;
  conversationId: string | null;
  forkingSupported?: boolean;
  latestMessageId?: string;
  isLast?: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { navigateToConvo } = useNavigateToConvo();

  const buttonStyle = cn(
    'hover-button tap-target flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary-alt [&_svg]:h-4 [&_svg]:w-4',
    'hover:text-text-primary hover:bg-surface-hover',
    'group-hover:visible group-focus-within:visible group-[.final-completion]:visible',
    /* Canon §6.13: the row under a message is visible ALWAYS. This used to hide
       every button but the last message's behind a hover, so half the row
       appeared and half did not — which is what it looked like: a ragged set of
       icons that came and went. `HoverButton` was fixed; these two were not. */
    'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
  );

  const forkConvo = useForkConvoMutation({
    onSuccess: (data) => {
      navigateToConvo(data.conversation);
      showToast({
        message: localize('com_ui_fork_success'),
        status: 'success',
      });
    },
    onMutate: () => {
      showToast({
        message: localize('com_ui_fork_processing'),
        status: 'info',
      });
    },
    onError: (error) => {
      /** Rate limit error (429 status code) */
      const isRateLimitError =
        (error as any)?.response?.status === 429 ||
        (error as any)?.status === 429 ||
        (error as any)?.statusCode === 429;

      showToast({
        message: isRateLimitError
          ? localize('com_ui_fork_error_rate_limit')
          : localize('com_ui_fork_error'),
        status: 'error',
      });
    },
  });

  const conversationId = _convoId ?? '';
  if (!forkingSupported || !conversationId || !messageId) {
    return null;
  }

  return (
    <button
      className={buttonStyle}
      /** A second click while the first is in flight forks the conversation twice,
       *  leaving a duplicate copy behind — cheap to hit now that one click forks. */
      disabled={forkConvo.isLoading}
      onClick={() =>
        forkConvo.mutate({
          messageId,
          conversationId,
          option: ForkOptions.DIRECT_PATH,
          splitAtTarget: false,
          latestMessageId,
        })
      }
      type="button"
      data-testid="fork-button"
      aria-label={localize('com_ui_fork_branch_here')}
      title={localize('com_ui_fork_branch_here')}
    >
      <GitFork size="19" aria-hidden="true" />
    </button>
  );
}
