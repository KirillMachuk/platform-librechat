import { FIELD_BASE, FIELD_BORDER } from '@librechat/client';
import { cn } from '~/utils';

/** Canon §6.4: label above the control, the shared field geometry, and the one
 *  thing these screens add to it — an error border with an `err-soft` ring and
 *  the reason under the field. The numbers themselves live with `Input`, which
 *  is what every other form in the product uses. */
export const authFieldClassName = (hasError?: boolean) =>
  cn(
    FIELD_BASE,
    hasError
      ? 'border-border-destructive focus-visible:border-border-destructive focus-visible:ring-err-soft'
      : FIELD_BORDER,
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
