import { memo } from 'react';
import ThinkingIndicator from '../ThinkingIndicator';

/** Streaming placeholder — no bottom margin to match Container's structure and prevent CLS */
const EmptyTextPart = memo(({ conversationId }: { conversationId?: string | null }) => {
  return (
    <div className="text-message flex min-h-[20px] flex-col items-start gap-3 overflow-visible">
      <div className="markdown prose dark:prose-invert light w-full break-words">
        <div className="absolute">
          <p className="submitting relative">
            <ThinkingIndicator conversationId={conversationId} />
          </p>
        </div>
      </div>
    </div>
  );
});

export default EmptyTextPart;
