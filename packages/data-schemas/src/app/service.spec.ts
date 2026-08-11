import { EModelEndpoint, defaultAssistantsVersion } from 'librechat-data-provider';
import type { DeepPartial, TCustomConfig } from 'librechat-data-provider';
import { AppService, loadSummarizationConfig } from './service';
import logger from '~/config/winston';

jest.mock('~/config/winston', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('loadSummarizationConfig', () => {
  const warnSpy = logger.warn as jest.Mock;

  beforeEach(() => {
    warnSpy.mockClear();
  });

  it('returns undefined when no summarization config is provided', () => {
    expect(loadSummarizationConfig({} as DeepPartial<TCustomConfig>)).toBeUndefined();
  });

  it('accepts a valid token_ratio trigger', () => {
    const result = loadSummarizationConfig({
      summarization: {
        enabled: true,
        trigger: { type: 'token_ratio', value: 0.8 },
      },
    } as DeepPartial<TCustomConfig>);

    expect(result).toBeDefined();
    expect(result?.enabled).toBe(true);
    expect(result?.trigger).toEqual({ type: 'token_ratio', value: 0.8 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('emits a targeted migration warning when trigger.type is the legacy "token_count"', () => {
    const result = loadSummarizationConfig({
      summarization: {
        trigger: { type: 'token_count', value: 8000 },
      },
    } as unknown as DeepPartial<TCustomConfig>);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0][0]);
    expect(message).toContain('token_count');
    expect(message).toContain('token_ratio');
    expect(message).toContain('remaining_tokens');
    expect(message).toContain('messages_to_refine');
    expect(message).toContain('fall back');
  });

  it('falls back to the generic warning when trigger is a bare string (not an object)', () => {
    const result = loadSummarizationConfig({
      summarization: {
        trigger: 'token_count',
      },
    } as unknown as DeepPartial<TCustomConfig>);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('Invalid summarization config');
  });

  it('falls back to the generic warning for other schema violations', () => {
    const result = loadSummarizationConfig({
      summarization: {
        trigger: { type: 'token_ratio', value: 80 },
      },
    } as unknown as DeepPartial<TCustomConfig>);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('Invalid summarization config');
  });
});

describe('AppService assistants config', () => {
  it('preserves configured Assistants API versions', async () => {
    const config = {
      endpoints: {
        [EModelEndpoint.assistants]: {
          version: 'v3',
        },
        [EModelEndpoint.azureOpenAI]: {
          assistants: true,
          groups: [
            {
              group: 'azure-assistants-test',
              apiKey: 'test-key',
              instanceName: 'azure-assistants-test',
              assistants: true,
              version: '2024-02-15-preview',
              models: {
                'gpt-4': {
                  deploymentName: 'gpt-4',
                },
              },
            },
          ],
        },
        [EModelEndpoint.azureAssistants]: {
          version: 4,
        },
      },
    } as DeepPartial<TCustomConfig>;

    const result = await AppService({ config });

    expect(result.endpoints?.[EModelEndpoint.assistants]?.version).toBe('v3');
    expect(result.endpoints?.[EModelEndpoint.azureAssistants]?.version).toBe(4);
  });

  it('keeps Azure Assistants default version when only Azure OpenAI enables assistants', async () => {
    const config = {
      endpoints: {
        [EModelEndpoint.azureOpenAI]: {
          assistants: true,
          groups: [
            {
              group: 'azure-assistants-test',
              apiKey: 'test-key',
              instanceName: 'azure-assistants-test',
              assistants: true,
              version: '2024-02-15-preview',
              models: {
                'gpt-4': {
                  deploymentName: 'gpt-4',
                },
              },
            },
          ],
        },
      },
    } as DeepPartial<TCustomConfig>;

    const result = await AppService({ config });

    expect(result.endpoints?.[EModelEndpoint.azureAssistants]?.version).toBe(
      defaultAssistantsVersion.azureAssistants,
    );
  });

  /**
   * `AppService` copies the parsed config into `AppConfig` field by field, so a block nobody
   * lists is simply absent at runtime while the type still promises it. Nothing fails: the
   * server boots, the start-up config dump prints the block, and every consumer test keeps
   * passing because each hands its own object straight to the consumer.
   *
   * That is how the Auto orchestrator's mode config was lost. `appConfig.auto` was always
   * `undefined` in production, which silently took out three things at once — the admin screen
   * reported "modes not configured", switching to Smart did nothing, and the fallback model
   * list was never sent, so the promised rescue to Sonnet could not have fired. Standard mode
   * kept working only because the model spec repeats its settings.
   */
  it('surfaces auto (activeMode + per-mode models) at the top level for readers', async () => {
    const config = {
      auto: {
        spec: 'auto',
        activeMode: 'standard',
        modes: {
          standard: {
            model: 'deepseek/deepseek-v4-flash-0731',
            researcherId: 'researcher-standard',
          },
          smart: { model: 'anthropic/claude-opus-5', researcherId: 'researcher-smart' },
        },
      },
    } as unknown as DeepPartial<TCustomConfig>;

    const result = await AppService({ config });

    expect(result.auto?.activeMode).toBe('standard');
    expect(result.auto?.modes?.standard?.researcherId).toBe('researcher-standard');
    expect(result.auto?.modes?.smart?.model).toBe('anthropic/claude-opus-5');
  });

  it('does not invent an auto block when the config has none', async () => {
    const result = await AppService({ config: {} as DeepPartial<TCustomConfig> });

    expect(result.auto).toBeUndefined();
  });

  it('surfaces deepResearch (activeMode + per-mode models) at the top level for readers', async () => {
    const config = {
      deepResearch: {
        activeMode: 'balanced',
        modes: {
          balanced: {
            leadModel: 'anthropic/claude-sonnet-4.6',
            workerModel: 'anthropic/claude-sonnet-4.6',
          },
        },
      },
    } as DeepPartial<TCustomConfig>;

    const result = await AppService({ config });

    expect(result.deepResearch?.activeMode).toBe('balanced');
    expect(result.deepResearch?.modes?.balanced?.workerModel).toBe('anthropic/claude-sonnet-4.6');
  });
});
