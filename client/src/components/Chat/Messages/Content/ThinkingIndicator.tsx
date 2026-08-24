import { memo } from 'react';
import { useLocalize } from '~/hooks';

/**
 * Shimmering «Thinking…» label shown while the latest reply has no content yet
 * (a non-reasoning model before its first token, or Deep Research before the
 * plan card). Replaces the pulsing dot (design book §6.12, round 22 item 5).
 * Visible only under a `.submitting` ancestor, mirroring the old dot's gating,
 * so a finished-but-empty message never shows a stuck label.
 */
const ThinkingIndicator = memo(() => {
  const localize = useLocalize();
  return <span className="thinking-shimmer">{localize('com_ui_thinking_indicator')}</span>;
});

export default ThinkingIndicator;
