import { memo } from 'react';
import ThinkingIndicator from '../ThinkingIndicator';

/** Streaming placeholder. The label paragraph must be a DIRECT child of
 *  `.prose` — exactly like the reply's first paragraph — so `.prose >
 *  :first-child { margin-top: 0 }` applies to both and the first token paints
 *  on the very line the label occupied. The old `div.absolute` wrapper broke
 *  that chain: the paragraph kept prose's 1.25em (20px) top margin while the
 *  real first paragraph got 0, so the reply "jumped" 20px above the label
 *  (owner, round 24 item 1). In-flow rendering also gives the placeholder the
 *  real 26px line box, so the swap changes nothing below it. */
const EmptyTextPart = memo(({ conversationId }: { conversationId?: string | null }) => {
  return (
    <div className="text-message flex flex-col items-start gap-3 overflow-visible">
      <div className="markdown prose dark:prose-invert light w-full break-words">
        <p className="submitting relative">
          <ThinkingIndicator conversationId={conversationId} />
        </p>
      </div>
    </div>
  );
});

export default EmptyTextPart;
