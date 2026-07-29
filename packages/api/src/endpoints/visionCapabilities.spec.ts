import { extractVisionCapableIds } from './visionCapabilities';

/**
 * The point of reading capabilities off the gateway is that nobody has to edit a
 * list when the model line-up changes — so the parser has to be tolerant of
 * entries it does not understand rather than throwing the whole answer away.
 */
describe('extractVisionCapableIds', () => {
  it('keeps only the models that declare image input', () => {
    const payload = {
      data: [
        { id: 'anthropic/claude-sonnet-5', architecture: { input_modalities: ['text', 'image'] } },
        { id: 'deepseek/deepseek-v4-pro', architecture: { input_modalities: ['text'] } },
        {
          id: 'google/gemini-3.1-pro-preview',
          architecture: { input_modalities: ['text', 'image', 'video'] },
        },
      ],
    };

    expect(extractVisionCapableIds(payload)).toEqual([
      'anthropic/claude-sonnet-5',
      'google/gemini-3.1-pro-preview',
    ]);
  });

  /** A model added upstream tomorrow is classified with no code change. */
  it('picks up a model the code has never heard of', () => {
    const payload = {
      data: [{ id: 'vendor/model-from-the-future', architecture: { input_modalities: ['image'] } }],
    };

    expect(extractVisionCapableIds(payload)).toEqual(['vendor/model-from-the-future']);
  });

  it('skips entries missing an id or modalities instead of failing', () => {
    const payload = {
      data: [
        { architecture: { input_modalities: ['image'] } },
        { id: 'no/architecture' },
        { id: 'bad/modalities', architecture: { input_modalities: 'image' } },
        { id: 'good/one', architecture: { input_modalities: ['image'] } },
        null,
      ],
    };

    expect(extractVisionCapableIds(payload)).toEqual(['good/one']);
  });

  it('answers empty for a shape it does not recognise', () => {
    expect(extractVisionCapableIds(undefined)).toEqual([]);
    expect(extractVisionCapableIds(null)).toEqual([]);
    expect(extractVisionCapableIds({})).toEqual([]);
    expect(extractVisionCapableIds({ data: 'not an array' })).toEqual([]);
    expect(extractVisionCapableIds('nonsense')).toEqual([]);
  });
});
