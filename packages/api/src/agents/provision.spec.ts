import type { StoredAgent, ProvisionDeps } from './provision';
import { provisionAgents, summarise } from './provision';
import { parseAgentDefinition } from './definitions';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const SOURCE = `---
name: researcher-standard
label: Исследователь
description: Собирает материал по теме и возвращает выжимку.
model: deepseek/deepseek-v4-flash-0731
tools: [web_search]
---
Ты — исследователь.
`;

const definition = parseAgentDefinition(SOURCE, 'r.md').definition!;

/** A real store rather than assertion-only mocks: the point of the reconciler is what the
 *  database ends up holding after repeated runs, which call-count spies cannot show. */
function makeDeps(seed: StoredAgent[] = []): ProvisionDeps & {
  store: Map<string, StoredAgent>;
  grants: unknown[];
} {
  const store = new Map(seed.map((agent) => [agent.id, agent]));
  const grants: unknown[] = [];
  let nextId = 1;
  return {
    store,
    grants,
    authorId: 'author-1',
    getAgent: async ({ id }) => store.get(id) ?? null,
    createAgent: async (data) => {
      const agent = { ...data, _id: `oid-${nextId++}` } as StoredAgent;
      store.set(agent.id, agent);
      return agent;
    },
    updateAgent: async ({ id }, data) => {
      const existing = store.get(id);
      if (!existing) {
        throw new Error('updateAgent вызван для несуществующего агента (upsert: false)');
      }
      const merged = { ...existing, ...data } as StoredAgent;
      store.set(id, merged);
      return merged;
    },
    grantPublicView: async (resourceId, grantedBy) => {
      grants.push({ resourceId, grantedBy });
    },
  };
}

describe('provisionAgents', () => {
  it('создаёт отсутствующего агента и открывает его всем на просмотр', async () => {
    const deps = makeDeps();
    const [outcome] = await provisionAgents([definition], deps);

    expect(outcome.action).toBe('created');
    expect(deps.store.get('researcher-standard')?.instructions).toBe('Ты — исследователь.');
    expect(deps.store.get('researcher-standard')?.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(deps.grants).toEqual([{ resourceId: 'oid-1', grantedBy: 'author-1' }]);
  });

  it('повторный запуск на неизменном файле ничего не пишет', async () => {
    const deps = makeDeps();
    await provisionAgents([definition], deps);
    const before = { ...deps.store.get('researcher-standard') };

    const [second] = await provisionAgents([definition], deps);

    expect(second.action).toBe('unchanged');
    expect(second.changed).toEqual([]);
    expect(deps.store.get('researcher-standard')).toEqual(before);
  });

  it('правка файла перекрывает запись и называет изменённые поля', async () => {
    const deps = makeDeps();
    await provisionAgents([definition], deps);
    const edited = parseAgentDefinition(
      SOURCE.replace('Ты — исследователь.', 'Ты — исследователь. Ищи второй источник.'),
      'r.md',
    ).definition!;

    const [outcome] = await provisionAgents([edited], deps);

    expect(outcome.action).toBe('updated');
    expect(outcome.changed).toEqual(['instructions']);
    expect(deps.store.get('researcher-standard')?.instructions).toContain('второй источник');
  });

  it('ручная правка в базе (дрейф) возвращается к файлу', async () => {
    const deps = makeDeps();
    await provisionAgents([definition], deps);
    const drifted = deps.store.get('researcher-standard')!;
    deps.store.set('researcher-standard', { ...drifted, instructions: 'кто-то поправил в UI' });

    const [outcome] = await provisionAgents([definition], deps);

    expect(outcome.action).toBe('updated');
    expect(deps.store.get('researcher-standard')?.instructions).toBe('Ты — исследователь.');
  });

  it('dry run сообщает о расхождении, но ничего не меняет', async () => {
    const deps = makeDeps();
    const [outcome] = await provisionAgents([definition], deps, { dryRun: true });

    expect(outcome.action).toBe('created');
    expect(deps.store.size).toBe(0);
    expect(deps.grants).toEqual([]);
  });

  it('shared: false не выдаёт публичных прав', async () => {
    const deps = makeDeps();
    const priv = parseAgentDefinition(
      SOURCE.replace('tools:', 'shared: false\ntools:'),
      'r.md',
    ).definition!;

    await provisionAgents([priv], deps);

    expect(deps.store.size).toBe(1);
    expect(deps.grants).toEqual([]);
  });

  it('падение одного агента не мешает остальным примениться', async () => {
    const deps = makeDeps();
    const broken = { ...definition, id: 'broken' };
    deps.createAgent = async (data) => {
      if (data.id === 'broken') {
        throw new Error('модель не в allowlist');
      }
      const agent = { ...data, _id: 'oid-x' } as StoredAgent;
      deps.store.set(agent.id, agent);
      return agent;
    };

    const outcomes = await provisionAgents([broken, definition], deps);

    expect(outcomes[0]).toMatchObject({ id: 'broken', action: 'failed' });
    expect(outcomes[0].error).toContain('allowlist');
    expect(outcomes[1].action).toBe('created');
    expect(deps.store.has('researcher-standard')).toBe(true);
  });

  it('сводка считает исходы', () => {
    expect(
      summarise([
        { id: 'a', action: 'created', changed: [] },
        { id: 'b', action: 'unchanged', changed: [] },
        { id: 'c', action: 'failed', changed: [], error: 'x' },
      ]),
    ).toBe('создано 1, обновлено 0, без изменений 1, ошибок 1');
  });
});
