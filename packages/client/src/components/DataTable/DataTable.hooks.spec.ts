import { renderHook, act, waitFor } from '@testing-library/react';
import { useDebounced, useOptimizedRowSelection } from './DataTable.hooks';

describe('DataTable Hooks', () => {
  describe('useDebounced', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return the initial value immediately', () => {
      const { result } = renderHook(() => useDebounced('initial', 300));
      expect(result.current).toBe('initial');
    });

    it('should update value after the delay', () => {
      const { result, rerender } = renderHook(({ value, delay }) => useDebounced(value, delay), {
        initialProps: { value: 'initial', delay: 300 },
      });

      expect(result.current).toBe('initial');

      rerender({ value: 'updated', delay: 300 });

      // Value should still be initial before delay
      expect(result.current).toBe('initial');

      // Advance timer past the delay
      act(() => {
        jest.advanceTimersByTime(300);
      });

      expect(result.current).toBe('updated');
    });

    it('should reset timer on rapid changes', () => {
      const { result, rerender } = renderHook(({ value, delay }) => useDebounced(value, delay), {
        initialProps: { value: 'initial', delay: 300 },
      });

      rerender({ value: 'change1', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      rerender({ value: 'change2', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      rerender({ value: 'change3', delay: 300 });
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Should still be initial because timer keeps resetting
      expect(result.current).toBe('initial');

      // Advance past the full delay
      act(() => {
        jest.advanceTimersByTime(300);
      });

      // Should now be the last value
      expect(result.current).toBe('change3');
    });

    it('should handle different data types', () => {
      // Test with number
      const { result: numberResult } = renderHook(() => useDebounced(42, 100));
      expect(numberResult.current).toBe(42);

      // Test with object
      const obj = { foo: 'bar' };
      const { result: objectResult } = renderHook(() => useDebounced(obj, 100));
      expect(objectResult.current).toEqual({ foo: 'bar' });

      // Test with array
      const arr = [1, 2, 3];
      const { result: arrayResult } = renderHook(() => useDebounced(arr, 100));
      expect(arrayResult.current).toEqual([1, 2, 3]);
    });

    it('should handle zero delay', () => {
      const { result, rerender } = renderHook(({ value, delay }) => useDebounced(value, delay), {
        initialProps: { value: 'initial', delay: 0 },
      });

      rerender({ value: 'updated', delay: 0 });

      act(() => {
        jest.advanceTimersByTime(0);
      });

      expect(result.current).toBe('updated');
    });
  });

  describe('useOptimizedRowSelection', () => {
    it('should initialize with empty object by default', () => {
      const { result } = renderHook(() => useOptimizedRowSelection());
      const [selection] = result.current;
      expect(selection).toEqual({});
    });

    it('should initialize with provided selection', () => {
      const initialSelection = { row1: true, row2: true };
      const { result } = renderHook(() => useOptimizedRowSelection(initialSelection));
      const [selection] = result.current;
      expect(selection).toEqual({ row1: true, row2: true });
    });

    it('should update selection state', () => {
      const { result } = renderHook(() => useOptimizedRowSelection());

      act(() => {
        const [, setSelection] = result.current;
        setSelection({ row1: true });
      });

      const [selection] = result.current;
      expect(selection).toEqual({ row1: true });
    });

    it('should return tuple with selection and setter', () => {
      const { result } = renderHook(() => useOptimizedRowSelection());
      const [selection, setSelection] = result.current;

      expect(typeof selection).toBe('object');
      expect(typeof setSelection).toBe('function');
    });

    it('should support functional updates', () => {
      const { result } = renderHook(() => useOptimizedRowSelection({ existing: true }));

      act(() => {
        const [, setSelection] = result.current;
        setSelection((prev) => ({ ...prev, new: true }));
      });

      const [selection] = result.current;
      expect(selection).toEqual({ existing: true, new: true });
    });
  });
});
