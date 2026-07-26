import { useCallback } from 'react';

/**
 * Creates a callback ref that focuses the popover input, transfers the command text as
 * a search prefix, and clears the textarea.
 *
 * `adoptComposerText` is false when the popover was opened by a button rather than by
 * typing the command: the composer then holds the user's draft, and taking it over
 * would silently empty their message.
 */
const useInitPopoverInput = ({
  inputRef,
  textAreaRef,
  commandChar,
  setSearchValue,
  setOpen,
  adoptComposerText = true,
}: {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  commandChar: string;
  setSearchValue: (value: string) => void;
  setOpen: (value: boolean) => void;
  adoptComposerText?: boolean;
}) =>
  useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (!node) {
        return;
      }
      node.focus();
      setOpen(true);
      const textarea = textAreaRef.current;
      if (!textarea || !adoptComposerText) {
        return;
      }
      const text = textarea.value;
      if (text.length > 0 && text[0] === commandChar) {
        if (text.length > 1) {
          setSearchValue(text.slice(1));
        }
        textarea.value = '';
        textarea.setSelectionRange(0, 0);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    [inputRef, textAreaRef, commandChar, setSearchValue, setOpen, adoptComposerText],
  );

export default useInitPopoverInput;
