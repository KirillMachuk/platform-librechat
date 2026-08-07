import * as api from '~/index';

/**
 * The Express routes reach these through `@librechat/api`, so a handler that exists in its
 * own module but is missing from the barrel is not a type error and not a unit-test
 * failure — it is a server that will not boot, with `X is not a function` thrown at
 * require time. That happened once: the admin handler for the Auto orchestrator was
 * written, tested and wired to a route while the barrel never re-exported it, and the
 * first thing to notice was the e2e suite failing to start the app at all.
 */
describe('публичная поверхность пакета', () => {
  const REQUIRED_BY_ROUTES = [
    'createAutoSettingsHandlers',
    'createDeepResearchSettingsHandlers',
    'createAdminConfigHandlers',
    'createModelCatalogueHandlers',
    'loadAgentDefinitions',
    'provisionAgents',
    'summarise',
  ] as const;

  it.each(REQUIRED_BY_ROUTES)('%s экспортируется из пакета', (name) => {
    expect(typeof (api as unknown as Record<string, unknown>)[name]).toBe('function');
  });
});
