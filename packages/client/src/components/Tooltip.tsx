import {
  memo,
  forwardRef,
  cloneElement,
  isValidElement,
  useCallback,
  useMemo,
  useSyncExternalStore,
  RefAttributes,
  ForwardRefExoticComponent,
} from 'react';
import DOMPurify from 'dompurify';
import * as Ariakit from '@ariakit/react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '~/utils';
import './Tooltip.css';

interface TooltipAnchorProps extends Ariakit.TooltipAnchorProps {
  role?: string;
  className?: string;
  description: string;
  enableHTML?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * Isolated component that subscribes to tooltip store state independently,
 * so the anchor element never re-renders when the tooltip mounts/unmounts.
 */
const TooltipPopup = memo(function TooltipPopup({
  store,
  description,
  enableHTML,
}: {
  store: Ariakit.TooltipStore;
  description: string;
  enableHTML: boolean;
}) {
  const mounted = Ariakit.useStoreState(store, (state) => state.mounted);
  const placement = Ariakit.useStoreState(store, (state) => state.placement);

  const sanitizer = useMemo(() => {
    const instance = DOMPurify();
    instance.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName && node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return instance;
  }, []);

  const sanitizedHTML = useMemo(() => {
    if (!enableHTML) {
      return '';
    }
    try {
      return sanitizer.sanitize(description, {
        ALLOWED_TAGS: ['a', 'strong', 'b', 'em', 'i', 'br', 'code'],
        ALLOWED_ATTR: ['href', 'class', 'target', 'rel'],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
      });
    } catch (error) {
      console.error('Sanitization failed', error);
      return description;
    }
  }, [enableHTML, description, sanitizer]);

  const { x, y } = useMemo(() => {
    const dir = placement.split('-')[0];
    switch (dir) {
      case 'top':
        return { x: 0, y: -8 };
      case 'bottom':
        return { x: 0, y: 8 };
      case 'left':
        return { x: -8, y: 0 };
      case 'right':
        return { x: 8, y: 0 };
      default:
        return { x: 0, y: 0 };
    }
  }, [placement]);

  return (
    <AnimatePresence>
      {mounted === true && (
        <Ariakit.Tooltip
          gutter={4}
          alwaysVisible
          className="tooltip"
          render={
            /* Canon §5/§6.6: appearance is the 120ms step. No arrow — the
               plate hangs by the control it names, the way the owner's
               reference (GitHub's «Найти ⌘K») draws it. */
            <motion.div
              initial={{ opacity: 0, x, y }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x, y }}
              transition={{ duration: 0.12 }}
            />
          }
        >
          {enableHTML ? (
            <div
              dangerouslySetInnerHTML={{
                __html: sanitizedHTML,
              }}
            />
          ) : (
            description
          )}
        </Ariakit.Tooltip>
      )}
    </AnimatePresence>
  );
});

/* Touch devices get NO tooltip machinery at all (owner 17.08-3): iOS Safari
 * treats an element whose mouseover reveals content as hover-first — the
 * FIRST tap on a sidebar chat opened the plate instead of the chat, and the
 * plate then stuck because touch never delivers mouseleave. `(hover: none)`
 * is the boundary (the same one the Tailwind hover gate uses); on such
 * devices the anchor renders inert, so a tap is just a tap everywhere. */
const subscribeHoverNone = (onChange: () => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }
  const query = window.matchMedia('(hover: none)');
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
};
const readHoverNone = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: none)').matches;

export const TooltipAnchor: ForwardRefExoticComponent<
  Omit<TooltipAnchorProps, 'ref'> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, TooltipAnchorProps>(function TooltipAnchor(
  { description, side = 'top', className, role, enableHTML = false, ...props },
  ref,
) {
  const hoverNone = useSyncExternalStore(subscribeHoverNone, readHoverNone, () => false);
  const tooltip = Ariakit.useTooltipStore({ placement: side });

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      /* A div with role=button must answer Space as well as Enter — a real
         button does, and the 11.08 keyboard review caught the gap. */
      if (role === 'button' && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        (event.target as HTMLDivElement).click();
      }
    },
    [role],
  );

  if (hoverNone) {
    const { render: renderProp, children: anchorChildren, ...anchorProps } = props;
    if (isValidElement(renderProp)) {
      const renderElementProps = renderProp.props as {
        className?: string;
        children?: React.ReactNode;
      };
      return cloneElement(
        renderProp as React.ReactElement,
        {
          ...anchorProps,
          ref,
          role,
          className: cn(className, renderElementProps.className),
          children: renderElementProps.children ?? anchorChildren,
        } as React.HTMLAttributes<HTMLElement>,
      );
    }
    return (
      <div {...anchorProps} ref={ref} role={role} className={cn(className)}>
        {anchorChildren}
      </div>
    );
  }

  return (
    /* Canon §6.6: the plate waits 300ms — a cursor passing through a row of
       icon buttons must not fire a chain of tooltips. */
    <Ariakit.TooltipProvider store={tooltip} showTimeout={300} hideTimeout={0}>
      <Ariakit.TooltipAnchor
        {...props}
        ref={ref}
        role={role}
        onKeyDown={handleKeyDown}
        className={cn('cursor-pointer', className)}
      />
      <TooltipPopup store={tooltip} description={description} enableHTML={enableHTML} />
    </Ariakit.TooltipProvider>
  );
});
