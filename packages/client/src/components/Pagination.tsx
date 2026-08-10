import * as React from 'react';
import { JSX } from 'react/jsx-runtime';
import { ChevronLeft, ChevronRight, MoreHorizontal } from '~/components/icons';
import { ButtonProps, buttonVariants } from './Button';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const Pagination: {
  ({ className, ...props }: React.ComponentProps<'nav'>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.ComponentProps<'nav'>): JSX.Element => {
  const localize = useLocalize();
  return (
    <nav
      role="navigation"
      aria-label={localize('com_ui_pagination')}
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  );
};
Pagination.displayName = 'Pagination';

const PaginationContent: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLUListElement>, HTMLUListElement>, 'ref'> &
    React.RefAttributes<HTMLUListElement>
> = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>, 'ref'> &
    React.RefAttributes<HTMLLIElement>
> = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
));
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, 'size'> &
  React.ComponentProps<'a'>;

const PaginationLink: {
  ({ className, isActive, size, children, ...props }: PaginationLinkProps): JSX.Element;
  displayName: string;
} = ({
  className,
  isActive = false,
  size = 'icon',
  children,
  ...props
}: PaginationLinkProps): JSX.Element => (
  <a
    aria-current={isActive ? 'page' : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? 'outline' : 'ghost',
        size,
      }),
      className,
    )}
    {...props}
  >
    {children || <span className="sr-only">Page link</span>}
  </a>
);
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious: {
  ({ className, ...props }: React.ComponentProps<typeof PaginationLink>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>): JSX.Element => {
  /* The visible word is the accessible name — no aria-label layered on top of
     it, which is how this came to announce "Go to previous page" in English
     over a label that was itself English. */
  const localize = useLocalize();
  return (
    <PaginationLink size="default" className={cn('gap-1 pl-2.5', className)} {...props}>
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      <span>{localize('com_ui_pagination_previous')}</span>
    </PaginationLink>
  );
};
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext: {
  ({ className, ...props }: React.ComponentProps<typeof PaginationLink>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>): JSX.Element => {
  const localize = useLocalize();
  return (
    <PaginationLink size="default" className={cn('gap-1 pr-2.5', className)} {...props}>
      <span>{localize('com_ui_pagination_next')}</span>
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    </PaginationLink>
  );
};
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis: {
  ({ className, ...props }: React.ComponentProps<'span'>): JSX.Element;
  displayName: string;
} = ({ className, ...props }: React.ComponentProps<'span'>): JSX.Element => (
  <span
    aria-hidden
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = 'PaginationEllipsis';

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};
