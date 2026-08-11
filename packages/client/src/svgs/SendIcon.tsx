import { JSX } from 'react/jsx-runtime';
import { cn } from '~/utils';

export default function SendIcon({
  size = 24,
  className = '',
}: {
  size?: number | undefined;
  className?: string | undefined;
}): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox={'0 0 24 24'}
      fill="none"
      /* ink-label, not raw white/black: the dark theme's ink circle is
         #F0F0F0 and its label token is #171717 — raw black measured wrong. */
      className={cn('text-ink-label', className)}
      aria-hidden="true"
    >
      <path
        d="M7 11L12 6L17 11M12 18V7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
