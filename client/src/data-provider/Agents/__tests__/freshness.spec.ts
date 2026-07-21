import { PermissionBits } from 'librechat-data-provider';

const mockUseInfiniteQuery = jest.fn();
const mockUseQuery = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useInfiniteQuery: (options: Record<string, unknown>) => mockUseInfiniteQuery(options),
  useQuery: (_key: unknown, _fn: unknown, options: Record<string, unknown>) =>
    mockUseQuery(options),
}));

import { useMarketplaceAgentsInfiniteQuery, useGetAgentCategoriesQuery } from '../queries';

/**
 * The catalog unmounts whenever the builder opens, so creating or deleting an agent
 * invalidates a query that is inactive at that moment. Opting out of the mount refetch
 * made the remount serve the stale list — the change only showed after a hard refresh.
 */
describe('marketplace agents query freshness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refetches on mount so an invalidated catalog is not served stale', () => {
    useMarketplaceAgentsInfiniteQuery({ requiredPermission: PermissionBits.VIEW });

    const options = mockUseInfiniteQuery.mock.calls[0][0];
    expect(options.refetchOnMount).not.toBe(false);
  });

  it('still avoids refetching untouched data via staleTime', () => {
    useMarketplaceAgentsInfiniteQuery({ requiredPermission: PermissionBits.VIEW });

    const options = mockUseInfiniteQuery.mock.calls[0][0];
    expect(options.staleTime).toBeGreaterThan(0);
  });

  it('lets callers still override the refetch behavior', () => {
    useMarketplaceAgentsInfiniteQuery({ requiredPermission: PermissionBits.VIEW }, {
      refetchOnMount: false,
    } as never);

    const options = mockUseInfiniteQuery.mock.calls[0][0];
    expect(options.refetchOnMount).toBe(false);
  });

  /**
   * The categories list carries the synthetic "Top Picks" tab, which appears only once an
   * agent is promoted — an invalidation that lands while the catalog is unmounted.
   */
  it('refetches categories on mount so a newly promoted tab appears', () => {
    useGetAgentCategoriesQuery();

    const options = mockUseQuery.mock.calls[0][0];
    expect(options.refetchOnMount).not.toBe(false);
  });
});
