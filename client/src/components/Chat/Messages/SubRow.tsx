import { cn } from '~/utils';

type TSubRowProps = {
  children: React.ReactNode;
  classes?: string;
  subclasses?: string;
  onClick?: () => void;
};

/**
 * The row of controls under a message (sibling switcher, hover buttons, the
 * DR command row). It is a toolbar, not content, so it is kept OUT of text
 * selection: a triple-click or a drag that runs past the last line used to
 * take these empty blocks along, and the browser serialised each of them as
 * a newline — a copied message arrived with a tail of blank lines (owner,
 * 02.09: «…дай прогноз подробный\n\n\n\n\n»; measured 6 on a question and 9
 * on an answer with `tools/copy_selection_probe.js`). The copy button was
 * never affected — it copies the message's own text.
 */
export default function SubRow({ children, classes = '', onClick }: TSubRowProps) {
  return (
    <div
      className={cn('mt-1 flex select-none justify-start gap-3 empty:hidden lg:flex', classes)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
