import { mcpConfig } from './mcpConfig';
import { PENDING_STALE_MS } from '~/flow/manager';

/**
 * Guards the OAuth flow-state grace period (E-H8 part 2): the TTL of a stored
 * MCP OAuth flow MUST outlive the window during which the user is allowed to
 * complete the flow. Otherwise a callback arriving near the deadline finds no
 * flow and the authorization is dropped early. `mcpConfig` enforces this by
 * clamping OAUTH_FLOW_TTL to at least OAUTH_HANDLING_TIMEOUT plus a grace
 * margin; these tests lock that invariant in.
 */
describe('mcpConfig OAuth flow TTL grace', () => {
  it('keeps OAUTH_FLOW_TTL strictly greater than the OAuth handling timeout', () => {
    expect(mcpConfig.OAUTH_FLOW_TTL).toBeGreaterThan(mcpConfig.OAUTH_HANDLING_TIMEOUT);
  });

  it('keeps OAUTH_FLOW_TTL at least as long as the PENDING reuse window', () => {
    expect(mcpConfig.OAUTH_FLOW_TTL).toBeGreaterThanOrEqual(PENDING_STALE_MS);
  });

  it('leaves a positive grace margin over the handling timeout', () => {
    const grace = mcpConfig.OAUTH_FLOW_TTL - mcpConfig.OAUTH_HANDLING_TIMEOUT;
    expect(grace).toBeGreaterThanOrEqual(60 * 1000);
  });
});
