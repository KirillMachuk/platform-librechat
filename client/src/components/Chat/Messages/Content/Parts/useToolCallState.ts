import { useState, useEffect, useCallback } from 'react';
import { useRecoilValue } from 'recoil';
import { isError } from '~/components/Chat/Messages/Content/ToolOutput';
import { useProgress, useExpandCollapse } from '~/hooks';
import store from '~/store';

interface ToolCallState {
  showCode: boolean;
  toggleCode: () => void;
  expandStyle: React.CSSProperties;
  expandRef: React.RefObject<HTMLDivElement>;
  progress: number;
  cancelled: boolean;
  hasError: boolean;
  hasOutput: boolean;
  hasContent: boolean;
}

export default function useToolCallState(
  initialProgress: number,
  isSubmitting: boolean,
  output: string,
  hasInput: boolean,
  onExpand?: () => void,
): ToolCallState {
  const autoExpand = useRecoilValue(store.autoExpandTools);
  const hasOutput = output.length > 0;
  const hasError = hasOutput && isError(output);
  const hasContent = hasInput || hasOutput;

  const [showCode, setShowCode] = useState(() => autoExpand && hasContent);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(showCode);

  useEffect(() => {
    if (autoExpand && hasContent) {
      setShowCode(true);
    }
  }, [autoExpand, hasContent]);

  const progress = useProgress(initialProgress);
  const toggleCode = useCallback(() => {
    setShowCode((prev) => {
      const next = !prev;
      if (next) {
        onExpand?.();
      }
      return next;
    });
  }, [onExpand]);
  /**
   * The stream ended with this call still short of `progress === 1`: it was dispatched and
   * never came back. That is all this side knows — a Stop, a run that ran out of steps and
   * a dropped connection are indistinguishable from here. Callers therefore label it as the
   * outcome («Не выполнен», `com_ui_tool_call_not_run`) and not as a cause: the card used to
   * read «Отменен» over a run nobody had cancelled (stand, 31.08).
   */
  const cancelled = !isSubmitting && progress < 1 && !hasError;

  return {
    showCode,
    toggleCode,
    expandStyle,
    expandRef,
    progress,
    cancelled,
    hasError,
    hasOutput,
    hasContent,
  };
}
