import { parseAgentDefinition, toAgentUpdate, diffAgent } from './definitions';

const GOOD = `---
name: researcher-standard
label: Исследователь
description: Собирает материал по теме из нескольких источников и возвращает выжимку.
model: deepseek/deepseek-v4-flash-0731
tools:
  - web_search
  - file_search
---
Ты — исследователь. Работай по источникам, а не по памяти.
`;

describe('parseAgentDefinition', () => {
  it('разбирает шапку и берёт промпт из тела файла', () => {
    const { definition, errors } = parseAgentDefinition(GOOD, 'r.md');
    expect(errors).toEqual([]);
    expect(definition?.id).toBe('researcher-standard');
    expect(definition?.name).toBe('Исследователь');
    expect(definition?.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(definition?.tools).toEqual(['web_search', 'file_search']);
    expect(definition?.instructions).toBe(
      'Ты — исследователь. Работай по источникам, а не по памяти.',
    );
  });

  it('идентичность берётся из поля name, а НЕ из имени файла', () => {
    const { definition } = parseAgentDefinition(GOOD, 'совершенно-другое-имя.md');
    expect(definition?.id).toBe('researcher-standard');
  });

  it('без шапки — понятная ошибка, а не исключение', () => {
    const { definition, errors } = parseAgentDefinition('просто текст', 'r.md');
    expect(definition).toBeUndefined();
    expect(errors[0]).toContain('нет YAML-шапки');
  });

  it('собирает ВСЕ ошибки разом, а не первую', () => {
    const { errors } = parseAgentDefinition('---\nlabel: Без имени\n---\n', 'r.md');
    const joined = errors.join(' | ');
    expect(joined).toContain('name');
    expect(joined).toContain('description');
    expect(joined).toContain('model');
    expect(joined).toContain('пустой промпт');
  });

  it('пустое description — ошибка: без него родитель не делегирует', () => {
    const src = GOOD.replace(
      'description: Собирает материал по теме из нескольких источников и возвращает выжимку.',
      'description: "  "',
    );
    const { errors } = parseAgentDefinition(src, 'r.md');
    expect(errors.join(' ')).toContain('description');
  });

  it('отвергает name, непригодный как идентификатор', () => {
    const src = GOOD.replace('name: researcher-standard', 'name: "Исследователь Стандарт"');
    const { errors } = parseAgentDefinition(src, 'r.md');
    expect(errors.join(' ')).toContain('не годится как идентификатор');
  });

  it('allowSelf выключен, пока его явно не включили', () => {
    const src = GOOD.replace('tools:', 'subagents:\n  enabled: true\n  agent_ids: [other]\ntools:');
    const { definition } = parseAgentDefinition(src, 'r.md');
    // Наверху по умолчанию TRUE: неявный allowSelf дал бы оркестратору вторую цель
    // делегирования с ЕГО собственным промптом вместо промпта исследователя.
    expect(definition?.subagents?.allowSelf).toBe(false);
    expect(definition?.subagents?.agent_ids).toEqual(['other']);
  });

  it('allowSelf включается только явным true', () => {
    const src = GOOD.replace('tools:', 'subagents:\n  enabled: true\n  allowSelf: true\ntools:');
    const { definition } = parseAgentDefinition(src, 'r.md');
    expect(definition?.subagents?.allowSelf).toBe(true);
  });

  it('битый YAML в шапке — ошибка с текстом, а не падение', () => {
    const { errors } = parseAgentDefinition('---\nname: [не\n---\nтело\n', 'r.md');
    expect(errors[0]).toContain('шапку не удалось разобрать');
  });

  it('промпт сохраняется дословно, включая переносы и отступы', () => {
    const src = `---\nname: r\ndescription: d\nmodel: m\n---\nПервая строка\n\n  - пункт\nПоследняя\n`;
    const { definition } = parseAgentDefinition(src, 'r.md');
    expect(definition?.instructions).toBe('Первая строка\n\n  - пункт\nПоследняя');
  });
});

describe('diffAgent', () => {
  const def = parseAgentDefinition(GOOD, 'r.md').definition!;

  it('новый агент помечается как новый', () => {
    expect(diffAgent(def, null)).toEqual(['<новый агент>']);
  });

  it('неизменный файл не даёт различий — иначе каждый рестарт плодил бы версию', () => {
    expect(diffAgent(def, toAgentUpdate(def))).toEqual([]);
  });

  it('правка промпта видна как изменение instructions', () => {
    const stored = { ...toAgentUpdate(def), instructions: 'старый текст' };
    expect(diffAgent(def, stored)).toEqual(['instructions']);
  });

  it('поля вне управляемого списка не считаются расхождением', () => {
    const stored = { ...toAgentUpdate(def), avatar: { filepath: '/x.png' }, versions: [1, 2] };
    expect(diffAgent(def, stored)).toEqual([]);
  });
});
