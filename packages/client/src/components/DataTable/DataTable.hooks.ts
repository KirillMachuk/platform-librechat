import { useState, useEffect, SetStateAction, Dispatch } from 'react';

export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

export const useOptimizedRowSelection = (
  initialSelection: Record<string, boolean> = {},
): readonly [Record<string, boolean>, Dispatch<SetStateAction<Record<string, boolean>>>] => {
  const [selection, setSelection] = useState(initialSelection);
  return [selection, setSelection] as const;
};

export const useKeyboardNavigation = (
  tableRef: React.RefObject<HTMLDivElement>,
  rowCount: number,
  onRowSelect?: (index: number) => void,
): {
  focusedRowIndex: number;
  setFocusedRowIndex: Dispatch<SetStateAction<number>>;
} => {
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!tableRef.current?.contains(event.target as Node)) return;

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          setFocusedRowIndex((prev) => Math.min(prev + 1, rowCount - 1));
          break;
        case 'ArrowUp':
          event.preventDefault();
          setFocusedRowIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Home':
          event.preventDefault();
          setFocusedRowIndex(0);
          break;
        case 'End':
          event.preventDefault();
          setFocusedRowIndex(rowCount - 1);
          break;
        case 'Enter':
        case ' ':
          if (focusedRowIndex >= 0 && onRowSelect) {
            event.preventDefault();
            onRowSelect(focusedRowIndex);
          }
          break;
        case 'Escape':
          setFocusedRowIndex(-1);
          (event.target as HTMLElement).blur();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [tableRef, rowCount, focusedRowIndex, onRowSelect]);

  return { focusedRowIndex, setFocusedRowIndex };
};
