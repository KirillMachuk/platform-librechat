import React from 'react';
import { render, screen } from '@testing-library/react';
import { RenderProbe, buildTestColumns, buildTestRows, renderDataTable } from './DataTable.testkit';

describe('DataTable.testkit', () => {
  describe('buildTestRows / buildTestColumns', () => {
    it('produces deterministic rows of the requested length', () => {
      const rows = buildTestRows(3);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({ id: 'row-0', name: 'Item 0', status: 'active' });
      expect(rows[1].status).toBe('inactive');
    });

    it('produces a stable column set with a desktopOnly column', () => {
      const cols = buildTestColumns();
      expect(cols.map((c) => c.accessorKey)).toEqual(['name', 'status', 'createdAt']);
      expect(cols[2].meta?.desktopOnly).toBe(true);
    });
  });

  describe('RenderProbe', () => {
    it('passes children through under the limit', () => {
      render(
        <RenderProbe limit={5} label="probe-test">
          <div data-testid="probe-child">ok</div>
        </RenderProbe>,
      );
      expect(screen.getByTestId('probe-child')).toBeInTheDocument();
    });

    it('throws a descriptive error when re-renders exceed the limit', () => {
      const Tree = ({ tick }: { tick: number }) => (
        <RenderProbe limit={3} label="probe-overflow">
          <span data-testid="tick">{tick}</span>
        </RenderProbe>
      );
      const original = console.error;
      console.error = jest.fn();
      try {
        const { rerender } = render(<Tree tick={0} />);
        rerender(<Tree tick={1} />);
        rerender(<Tree tick={2} />);
        expect(() => rerender(<Tree tick={3} />)).toThrow(/re-render storm/);
      } finally {
        console.error = original;
      }
    });
  });

  describe('renderDataTable', () => {
    it('mounts DataTable with stable memoised columns/data and renders the table region', () => {
      renderDataTable();
      expect(screen.getByRole('region', { name: 'com_ui_data_table' })).toBeInTheDocument();
    });
  });
});
