import type { AutoConfigInput } from './auto';
import { autoOverridesFor, autoRequestParams, resolveAutoMode, isAutoSpec } from './auto';

const CONFIG: AutoConfigInput = {
  spec: 'auto',
  activeMode: 'standard',
  modes: {
    standard: {
      model: 'deepseek/deepseek-v4-flash-0731',
      researcherId: 'researcher-standard',
      instructions: 'промпт Стандарта',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    },
    smart: {
      model: 'anthropic/claude-opus-5',
      researcherId: 'researcher-smart',
      instructions: 'промпт Умного',
      fallbackModels: ['anthropic/claude-sonnet-5'],
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

describe('autoRequestParams', () => {
  it('список ведёт СВОЙ мозг режима, а не чужой', () => {
    expect(autoRequestParams(CONFIG, 'auto')).toEqual({
      models: ['deepseek/deepseek-v4-flash-0731', 'anthropic/claude-sonnet-5'],
    });
    // Умный режим НЕ должен уезжать на дешёвый мозг из-за статичного списка.
    expect(autoRequestParams({ ...CONFIG, activeMode: 'smart' }, 'auto')).toEqual({
      models: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
    });
  });

  it('мозг не дублируется, если он же указан в запасных', () => {
    const dup: AutoConfigInput = {
      spec: 'auto',
      activeMode: 'standard',
      modes: {
        standard: {
          model: 'deepseek/deepseek-v4-flash-0731',
          researcherId: 'researcher-standard',
          fallbackModels: ['deepseek/deepseek-v4-flash-0731', 'anthropic/claude-sonnet-5'],
        },
      },
    };
    expect(autoRequestParams(dup, 'auto')).toEqual({
      models: ['deepseek/deepseek-v4-flash-0731', 'anthropic/claude-sonnet-5'],
    });
  });

  it('без запасных моделей маршрут не навязывается', () => {
    const bare: AutoConfigInput = {
      spec: 'auto',
      activeMode: 'standard',
      modes: { standard: { model: 'm', researcherId: 'r' } },
    };
    expect(autoRequestParams(bare, 'auto')).toBeUndefined();
  });

  it('чужой карточки не касается', () => {
    expect(autoRequestParams(CONFIG, 'другая')).toBeUndefined();
  });
});
