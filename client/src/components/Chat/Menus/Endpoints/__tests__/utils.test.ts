import type { useLocalize } from '~/hooks';
import type { Endpoint } from '~/common';
import { filterItems, modelDisplayName } from '../utils';

const agentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  showMarketplace: true,
  searchAliases: ['agent marketplace', 'marketplace'],
};

const disabledAgentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: false,
  icon: null,
};

describe('model selector utilities', () => {
  it('matches endpoint search aliases', () => {
    const results = filterItems([agentsEndpoint], 'marketplace', undefined, undefined);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('matches localized Marketplace labels', () => {
    const localize = ((key: string) => {
      if (key === 'com_agents_marketplace') {
        return 'Tienda de Agentes';
      }
      if (key === 'com_ui_marketplace') {
        return 'Tienda';
      }
      return key;
    }) as ReturnType<typeof useLocalize>;

    const results = filterItems([agentsEndpoint], 'tienda', undefined, undefined, localize);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('does not match agents when there are no selectable agent options', () => {
    const results = filterItems([disabledAgentsEndpoint], 'my agents', undefined, undefined);
    expect(results).toEqual([]);
  });
});

/**
 * The admin panel curates the line-up by the catalogue's published name, so this
 * surface has to arrive at the same string — otherwise one model reads as two, and
 * an owner comparing the two screens cannot tell which row is which.
 */
describe('modelDisplayName', () => {
  const config = {
    gw: {
      order: 0,
      modelCapabilities: {
        'anthropic/claude-sonnet-5': { name: 'Anthropic: Claude Sonnet 5' },
        'anthropic/claude-opus-5': { name: 'Claude Opus 5' },
        'a/blank': { name: '   ' },
      },
    },
  } as never;

  it('uses the published name without the vendor', () => {
    expect(modelDisplayName('anthropic/claude-sonnet-5', config, 'gw')).toBe('Claude Sonnet 5');
  });

  it('leaves a published name that carries no vendor alone', () => {
    expect(modelDisplayName('anthropic/claude-opus-5', config, 'gw')).toBe('Claude Opus 5');
  });

  /** The slug minus its vendor is what this surface showed before any catalogue. */
  it('falls back to the slug when the catalogue said nothing', () => {
    expect(modelDisplayName('qwen/qwen3.7-max', config, 'gw')).toBe('qwen3.7-max');
    expect(modelDisplayName('anthropic/claude-sonnet-5', config, 'other')).toBe('claude-sonnet-5');
    expect(modelDisplayName('anthropic/claude-sonnet-5', undefined, 'gw')).toBe('claude-sonnet-5');
    expect(modelDisplayName('gpt-4o', config, 'gw')).toBe('gpt-4o');
  });

  it('ignores a blank published name rather than rendering an empty label', () => {
    expect(modelDisplayName('a/blank', config, 'gw')).toBe('blank');
  });
});
