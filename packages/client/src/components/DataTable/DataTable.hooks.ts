import { useState, useEffect } from 'react';

export function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}

export const useOptimizedRowSelection = (initialSelection: Record<string, boolean> = {}) => {
  const [selection, setSelection] = useState(initialSelection);
  return [selection, setSelection] as const;
};
