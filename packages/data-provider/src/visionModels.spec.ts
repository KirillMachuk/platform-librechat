import { validateVisionModel } from './config';

/**
 * `validateVisionModel` guesses a model's capability from substrings of its name.
 * That guess drives one thing: the toast shown when someone attaches an image
 * ("this model can't read images — switch to one that can"). A wrong guess in the
 * permissive direction costs a provider error; a wrong guess in the other
 * direction tells a user their working setup is broken, which is what happened —
 * `anthropic/claude-sonnet-5`, the default model of this deployment, was absent
 * from the list, so attaching a picture advised switching to Sonnet while on it.
 *
 * The model ids below are the ones this deployment actually offers
 * (`1ma-lab/librechat.yaml`, endpoint "1ma"). The expected values are not
 * opinions: they come from OpenRouter's own catalogue, field
 * `architecture.input_modalities`. To re-check after adding a model there:
 *
 *   curl -s https://openrouter.ai/api/v1/models \
 *     | jq -r '.data[] | select(.id=="<model-id>") | .architecture.input_modalities'
 *
 * A model added to the yaml but not here is not caught by any test — the two
 * repositories are separate — so this list is the record of what was verified,
 * and the place to extend when the model line-up changes.
 */
const DEPLOYED_MODELS: ReadonlyArray<[model: string, readsImages: boolean]> = [
  ['anthropic/claude-sonnet-5', true],
  ['anthropic/claude-opus-4.8', true],
  ['openai/gpt-5.6-sol', true],
  ['openai/gpt-5.6-terra', true],
  ['openai/gpt-5.6-luna', true],
  ['google/gemini-3.1-pro-preview', true],
  ['qwen/qwen3.7-plus', true],
  ['deepseek/deepseek-v4-pro', false],
  ['deepseek/deepseek-v4-flash', false],
  ['deepseek/deepseek-v3.2', false],
  ['deepseek/deepseek-chat-v3.1', false],
  ['qwen/qwen3.7-max', false],
  ['qwen/qwen3-235b-a22b-2507', false],
];

describe('validateVisionModel against the models this deployment offers', () => {
  it.each(DEPLOYED_MODELS)('%s reads images: %s', (model, readsImages) => {
    expect(validateVisionModel({ model })).toBe(readsImages);
  });

  /**
   * The two tiers differ, so no shared `qwen3.7` prefix may be introduced as a
   * shortcut — it would start telling `max` users their images will work.
   */
  it('keeps the two Qwen tiers apart', () => {
    expect(validateVisionModel({ model: 'qwen/qwen3.7-plus' })).toBe(true);
    expect(validateVisionModel({ model: 'qwen/qwen3.7-max' })).toBe(false);
  });

  it('still answers false for an empty or unknown model', () => {
    expect(validateVisionModel({ model: '' })).toBe(false);
    expect(validateVisionModel({ model: 'some/model-nobody-has-heard-of' })).toBe(false);
  });
});
