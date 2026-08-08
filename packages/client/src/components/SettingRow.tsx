import * as React from 'react';
import { cn } from '~/utils';

/**
 * The canonical setting row (canon §6.4, prototype screens 21–23, `.swrow`).
 *
 * A row is: an optional icon, then a text column holding a short title with an
 * optional muted explanation UNDER it, then the control — and a hairline
 * between neighbouring rows. The explanation belongs on its own line; it is not
 * an info bubble you have to hover, and it is not extra words glued onto the
 * title. That is what keeps titles short enough that they never run into the
 * control, and what keeps every control on the same axis instead of drifting
 * with the length of its label.
 *
 * Geometry, all from the prototype: row 48 high on a desktop and 56 on a phone,
 * padding 8/12, gap 12; icon 18 (20 on a phone) in `t2`; title 14 (15 on a
 * phone); explanation 12.5 in `t3` on a 1.35 line.
 */

type ControlIds = { labelId: string; descriptionId?: string };

export interface SettingRowProps {
  /** Stable id — the title and the explanation derive theirs from it. */
  id: string;
  title: React.ReactNode;
  /** The muted line under the title. Omit it when there is nothing to add. */
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /**
   * A node, or a function that receives the ids so the control can point
   * `aria-labelledby` / `aria-describedby` at text that is actually on screen.
   */
  control?: React.ReactNode | ((ids: ControlIds) => React.ReactNode);
  /**
   * Canon: on a phone a text-and-button row rarely fits on one line, so the
   * button drops under the text, into the text's column.
   */
  stackControlOnMobile?: boolean;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  id,
  title,
  description,
  icon,
  control,
  stackControlOnMobile = false,
  className,
}) => {
  const labelId = `${id}-label`;
  const descriptionId = description == null ? undefined : `${id}-description`;
  const rendered = typeof control === 'function' ? control({ labelId, descriptionId }) : control;

  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-3 border-t border-border-light px-3 py-2 first:border-t-0 md:min-h-12',
        stackControlOnMobile &&
          (icon
            ? 'max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:gap-y-2.5'
            : 'max-md:grid max-md:grid-cols-1 max-md:gap-y-2.5'),
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="shrink-0 text-text-secondary [&>svg]:size-5 md:[&>svg]:size-[18px]"
        >
          {icon}
        </span>
      )}
      <div className={cn('min-w-0 flex-1', stackControlOnMobile && icon && 'max-md:col-start-2')}>
        <div id={labelId} className="text-[15px] text-text-primary md:text-sm">
          {title}
        </div>
        {description != null && (
          <div id={descriptionId} className="mt-px text-[12.5px] leading-[1.35] text-text-tertiary">
            {description}
          </div>
        )}
      </div>
      {rendered != null && (
        <div
          className={cn(
            'shrink-0',
            stackControlOnMobile &&
              (icon ? 'max-md:col-start-2 max-md:justify-self-start' : 'max-md:justify-self-start'),
          )}
        >
          {rendered}
        </div>
      )}
    </div>
  );
};

/**
 * The frame a settings tab draws around what it stacks (prototype screens
 * 21–23, `.sbody`): 14 between neighbours — a loose row and a labelled group
 * are spaced the same — 12 above and 16 below.
 *
 * The 16 the prototype spends left and right is not repeated here: in the
 * product the dialog already pays it, 24 to the right edge and 40 of gap to the
 * section rail. The 4 that stays keeps focus rings clear of the scrolling edge.
 */
export const SETTINGS_TAB_BODY =
  'flex flex-col gap-[14px] px-1 pb-4 pt-3 text-sm text-text-primary';

/**
 * A run of rows under an optional label (`.fld`): a plain column, 5 between the
 * label and its rows and between the rows themselves.
 *
 * There is no card. In the settings screens the prototype leaves the rows as
 * loose strips, each carrying its own hairline; the bordered card it draws in
 * the agent builder (`.swgroup`) belongs to that screen, not to this one.
 */
export const SettingGroup: React.FC<{
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}> = ({ label, children, className }) => (
  <div className={cn('flex flex-col gap-[5px]', className)}>
    {/* The label is a child of the same column, so the row under it keeps the
        hairline the prototype draws there: `first:border-t-0` fires only on a
        run that really starts the column. */}
    {label != null && <div className="text-sm text-text-primary">{label}</div>}
    {children}
  </div>
);
