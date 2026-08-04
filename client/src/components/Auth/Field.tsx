import { cn } from '~/utils';

/** Canon §6.4: label above the control, field 36 high (48 on a phone), radius
 *  12, `control` border for the mandatory 3:1, focus is an `acc` border plus a
 *  3px `acc-soft` ring and never an outline, error is an `errc` border with an
 *  `err-soft` ring and the reason under the field. */
const base =
  'h-12 w-full rounded-xl border bg-surface-primary px-3 text-[15px] text-text-primary placeholder:text-text-tertiary focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-45 sm:h-9 sm:text-sm';

export const authFieldClassName = (hasError?: boolean) =>
  cn(
    base,
    hasError
      ? 'border-border-destructive focus-visible:border-border-destructive focus-visible:ring-err-soft'
      : 'border-border-control focus-visible:border-border-focus focus-visible:ring-ring-primary-soft',
  );

export const errorId = (id: string) => `${id}-error`;

export function AuthField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <label htmlFor={id} className="text-[15px] text-text-primary sm:text-sm">
        {label}
      </label>
      {children}
      {error != null && error !== '' && (
        <span id={errorId(id)} role="alert" className="text-[12.5px] text-text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
