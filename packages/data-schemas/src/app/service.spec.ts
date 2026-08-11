import type { TCustomConfig, DeepPartial } from 'librechat-data-provider';
import { AppService } from './service';

/**
 * `AppService` copies the parsed `librechat.yaml` into `AppConfig` field by field, so a block
 * that nobody lists is simply absent at runtime while the type still promises it. Nothing
 * fails: the server boots, the config dump in the start log shows the block, and every unit
 * test that hands its own object straight to the consumer keeps passing.
 *
 * That is exactly how the Auto orchestrator's mode config was lost. `appConfig.auto` was
 * always `undefined` in production, which silently took out three things at once — the admin
 * screen reported "modes not configured", switching to Smart did nothing, and the fallback
 * model list was never sent, so the promised rescue to Sonnet could not have fired. Standard
 * mode kept working only because the model spec happens to repeat its settings.
 *
 * These blocks are the ones read straight off `appConfig` elsewhere in the codebase; each
 * needs to survive the copy.
 */
describe('AppService переносит верхнеуровневые блоки конфига в AppConfig', () => {
  const config = {
    deepResearch: { activeMode: 'balanced' },
    auto: {
      spec: 'auto',
      activeMode: 'standard',
      modes: {
        standard: { model: 'deepseek/deepseek-v4-flash-0731', researcherId: 'researcher-standard' },
        smart: { model: 'anthropic/claude-opus-5', researcherId: 'researcher-smart' },
      },
    },
  } as unknown as DeepPartial<TCustomConfig>;

  it('блок auto доезжает целиком, а не по имени', async () => {
    const appConfig = await AppService({ config });

    expect(appConfig.auto).toBeDefined();
    expect(appConfig.auto?.activeMode).toBe('standard');
    expect(appConfig.auto?.modes?.smart?.model).toBe('anthropic/claude-opus-5');
    expect(appConfig.auto?.modes?.standard?.researcherId).toBe('researcher-standard');
  });

  it('блок deepResearch доезжает — тот же путь, что и у auto', async () => {
    const appConfig = await AppService({ config });

    expect(appConfig.deepResearch).toBeDefined();
  });

  it('конфиг без блока auto не выдумывает его', async () => {
    const appConfig = await AppService({ config: {} as DeepPartial<TCustomConfig> });

    expect(appConfig.auto).toBeUndefined();
  });
});
