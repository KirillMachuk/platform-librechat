import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadAgentDefinitions } from './directory';

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

function makeFile(dir: string, name: string, agentName: string, body = 'Промпт.'): void {
  fs.writeFileSync(
    path.join(dir, name),
    `---\nname: ${agentName}\ndescription: Описание\nmodel: m\n---\n${body}\n`,
    'utf8',
  );
}

describe('loadAgentDefinitions', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('читает все .md и возвращает определения', async () => {
    makeFile(dir, 'a.md', 'researcher-standard');
    makeFile(dir, 'b.md', 'researcher-smart');

    const result = await loadAgentDefinitions({ env: { AGENT_DEFINITIONS_DIR: dir } });

    expect(result.errors).toEqual([]);
    expect(result.definitions.map((d) => d.id).sort()).toEqual([
      'researcher-smart',
      'researcher-standard',
    ]);
  });

  it('игнорирует файлы не .md', async () => {
    makeFile(dir, 'a.md', 'researcher-standard');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'не определение', 'utf8');

    const result = await loadAgentDefinitions({ env: { AGENT_DEFINITIONS_DIR: dir } });

    expect(result.definitions).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('два файла с одним именем — ошибка, а не гонка за последним', async () => {
    makeFile(dir, 'a.md', 'researcher-standard', 'Первый.');
    makeFile(dir, 'z.md', 'researcher-standard', 'Второй.');

    const result = await loadAgentDefinitions({ env: { AGENT_DEFINITIONS_DIR: dir } });

    expect(result.definitions).toHaveLength(1);
    expect(result.errors.join(' ')).toContain('уже занято файлом a.md');
  });

  it('ошибка в одном файле не отменяет остальные', async () => {
    makeFile(dir, 'good.md', 'researcher-standard');
    fs.writeFileSync(path.join(dir, 'bad.md'), 'без шапки', 'utf8');

    const result = await loadAgentDefinitions({ env: { AGENT_DEFINITIONS_DIR: dir } });

    expect(result.definitions.map((d) => d.id)).toEqual(['researcher-standard']);
    expect(result.errors.join(' ')).toContain('нет YAML-шапки');
  });

  it('каталога нет и он не задавался — тихо ничего', async () => {
    const result = await loadAgentDefinitions({
      projectRoot: path.join(dir, 'пусто'),
      env: {},
    });

    expect(result.definitions).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('каталог ЗАДАН, но отсутствует — это ошибка, а не тишина', async () => {
    const missing = path.join(dir, 'нет-такого');

    const result = await loadAgentDefinitions({ env: { AGENT_DEFINITIONS_DIR: missing } });

    expect(result.definitions).toEqual([]);
    expect(result.errors.join(' ')).toContain('недоступен');
  });
});
