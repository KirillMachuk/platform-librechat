import type { AutoConfigInput } from './auto';
import { autoOverridesFor, resolveAutoMode, isAutoSpec } from './auto';

const CONFIG: AutoConfigInput = {
  spec: 'auto',
  activeMode: 'standard',
  modes: {
    standard: {
      model: 'deepseek/deepseek-v4-flash-0731',
      researcherId: 'researcher-standard',
      instructions: 'промпт Стандарта',
    },
    smart: {
      model: 'anthropic/claude-opus-5',
      researcherId: 'researcher-smart',
      instructions: 'промпт Умного',
    },
  },
};

describe('resolveAutoMode', () => {
  it('берёт активный режим', () => {
    expect(resolveAutoMode(CONFIG)).toMatchObject({
      name: 'standard',
      model: 'deepseek/deepseek-v4-flash-0731',
      researcherId: 'researcher-standard',
    });
  });

  it('переключение админа меняет и мозг, и исследователя', () => {
    const smart = resolveAutoMode({ ...CONFIG, activeMode: 'smart' });
    expect(smart).toMatchObject({
      name: 'smart',
      model: 'anthropic/claude-opus-5',
      researcherId: 'researcher-smart',
    });
  });

  it('активный режим без описания падает на дешёвый, а не на премиальный', () => {
    const partial: AutoConfigInput = {
      spec: 'auto',
      activeMode: 'smart',
      modes: { standard: CONFIG.modes!.standard },
    };
    expect(resolveAutoMode(partial)).toMatchObject({ name: 'standard' });
  });

  it('режим без исследователя считается ОТСУТСТВУЮЩИМ, а не полурабочим', () => {
    const half: AutoConfigInput = {
      spec: 'auto',
      activeMode: 'smart',
      modes: {
        standard: CONFIG.modes!.standard,
        smart: { model: 'anthropic/claude-opus-5' },
      },
    };
    expect(resolveAutoMode(half)).toMatchObject({ name: 'standard' });
  });

  it('и если недоделан САМ дешёвый режим — не решаем ничего', () => {
    expect(
      resolveAutoMode({ spec: 'auto', activeMode: 'standard', modes: { standard: {} } }),
    ).toBeUndefined();
  });

  it('без настройки — ничего не решаем', () => {
    expect(resolveAutoMode(undefined)).toBeUndefined();
    expect(resolveAutoMode({ spec: 'auto', activeMode: 'standard' })).toBeUndefined();
  });
});

describe('autoOverridesFor', () => {
  it('применяется только к своей карточке', () => {
    expect(autoOverridesFor(CONFIG, 'auto')).toBeDefined();
    expect(autoOverridesFor(CONFIG, 'какая-то-другая')).toBeUndefined();
    expect(autoOverridesFor(CONFIG, undefined)).toBeUndefined();
  });

  it('подставляет мозг, промпт и ИМЕННО того исследователя', () => {
    expect(autoOverridesFor(CONFIG, 'auto')).toEqual({
      model: 'deepseek/deepseek-v4-flash-0731',
      instructions: 'промпт Стандарта',
      subagents: { enabled: true, allowSelf: false, agent_ids: ['researcher-standard'] },
    });
  });

  it('«позвать себя» выключено в любом режиме', () => {
    for (const activeMode of ['standard', 'smart'] as const) {
      const overrides = autoOverridesFor({ ...CONFIG, activeMode }, 'auto');
      expect(overrides?.subagents.allowSelf).toBe(false);
    }
  });

  it('нестроенная конфигурация ничего не ломает — карточка остаётся как в файле', () => {
    expect(autoOverridesFor(undefined, 'auto')).toBeUndefined();
  });

  it('имя карточки берётся из настройки, а не зашито', () => {
    const renamed: AutoConfigInput = { ...CONFIG, spec: 'помощник' };
    expect(isAutoSpec(renamed, 'помощник')).toBe(true);
    expect(isAutoSpec(renamed, 'auto')).toBe(false);
  });
});
