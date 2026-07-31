import { render } from '@testing-library/react';
import { getModelBrandIcon } from '../brand';

const draw = (modelId: string | null) => {
  const icon = getModelBrandIcon(modelId);
  if (icon == null) {
    return null;
  }
  return render(<div data-testid="host">{icon}</div>).container;
};

describe('getModelBrandIcon', () => {
  it('draws the brand asset for a vendor we ship a mark for', () => {
    expect(draw('deepseek/deepseek-v4-pro')?.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/deepseek.svg',
    );
    expect(draw('openrouter/free')?.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/openrouter.png',
    );
  });

  it('draws the monochrome mark for OpenAI and Anthropic', () => {
    for (const id of ['openai/gpt-5.6-sol', 'anthropic/claude-sonnet-5']) {
      const container = draw(id);
      expect(container?.querySelector('svg')).toBeTruthy();
      expect(container?.textContent).toBe('');
    }
  });

  /**
   * `~vendor/family-latest` is a moving pointer, and the tilde is not part of the
   * vendor — left in, every one of those lost its brand mark and fell back to a
   * letter, which is exactly the row an admin most needs to recognise.
   */
  it('ignores the tilde that marks a moving pointer', () => {
    const container = draw('~anthropic/claude-sonnet-latest');

    expect(container?.querySelector('svg')).toBeTruthy();
    expect(container?.textContent).toBe('');
  });

  /**
   * A real catalogue carries dozens of vendors and we ship marks for a handful, so
   * without a stand-in two rows out of five drew no avatar at all and their labels
   * sat out of line with the rest.
   */
  it('stands in with the vendor initial for a vendor we have no mark for', () => {
    expect(draw('x-ai/grok-4.5')?.textContent).toBe('x');
    expect(draw('meta-llama/llama-4')?.textContent).toBe('m');
    expect(draw('~x-ai/grok-latest')?.textContent).toBe('x');
  });

  /**
   * Nothing at all for an id with no vendor segment: those belong to the built-in
   * endpoints, whose own icon is the better answer — an initial would replace a real
   * logo with the letter "g".
   */
  it('answers nothing for an id that carries no vendor', () => {
    expect(getModelBrandIcon('gpt-4o')).toBeNull();
    expect(getModelBrandIcon('/leading-slash')).toBeNull();
    expect(getModelBrandIcon('')).toBeNull();
    expect(getModelBrandIcon(null)).toBeNull();
  });
});
