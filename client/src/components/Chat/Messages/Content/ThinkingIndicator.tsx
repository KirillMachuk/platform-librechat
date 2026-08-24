import { memo } from 'react';
import { useLocalize } from '~/hooks';

/**
 * Shimmering «Thinking…» label shown while the latest reply has no content yet
 * (a non-reasoning model before its first token, or Deep Research before the
 * plan card). Replaces the pulsing dot (design book §6.12, round 22 item 5).
 * Visible only under a `.submitting` ancestor, mirroring the old dot's gating
 * exactly — including two legacy EmptyText paths in Part.tsx (AGENT_UPDATE
 * tail, whitespace-only last part) that hardcode `submitting` and could leave
 * the old dot stuck on a finished message; gating those on isSubmitting is a
 * queued follow-up.
 */
const ThinkingIndicator = memo(() => {
  const localize = useLocalize();
  return <span className="thinking-shimmer">{localize('com_ui_thinking_indicator')}</span>;
});

export default ThinkingIndicator;
