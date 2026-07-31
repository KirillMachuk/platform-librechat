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

  it('draws the brand asset for the families a catalogue carries most of', () => {
    expect(draw('nvidia/nemotron-3-ultra')?.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/nvidia.svg',
    );
    expect(draw('minimax/minimax-m2.1')?.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/minimax.svg',
    );
    expect(draw('meta-llama/llama-4')?.querySelector('img')).toHaveAttribute(
      'src',
      '/assets/meta.svg',
    );
  });

  /**
   * Drawn as components rather than loaded through `<img>`: these marks are
   * monochrome, and an `<img>` would paint them in the SVG file's own colour —
   * black, and invisible on a dark theme.
   */
  it('draws the monochrome marks as components that take the text colour', () => {
    for (const id of [
      'openai/gpt-5.6-sol',
      'anthropic/claude-sonnet-5',
      'moonshotai/kimi-k3',
      'x-ai/grok-4.5',
      'z-ai/glm-5.2',
    ]) {
      const container = draw(id);
      expect(container?.querySelector('svg')).toBeTruthy();
      expect(container?.querySelector('img')).toBeNull();
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
    expect(draw('inclusionai/ling-3.0-flash')?.textContent).toBe('i');
    expect(draw('poolside/laguna-s-2.1')?.textContent).toBe('p');
    expect(draw('~poolside/laguna-latest')?.textContent).toBe('p');
  });

  /**
   * The letter is always white, so the circle has to carry the contrast itself —
   * one grey for everyone reads the same on one theme and washes out on the other,
   * and tells no two vendors apart.
   */
  it('gives each vendor the same colour every time, and different vendors different ones', () => {
    const colorOf = (id: string) =>
      (draw(id)?.querySelector('span') as HTMLElement | null)?.style.backgroundColor;

    expect(colorOf('poolside/laguna-s-2.1')).toBe(colorOf('poolside/laguna-xs-2.1'));
    expect(colorOf('poolside/laguna-s-2.1')).not.toBe(colorOf('inclusionai/ling-3.0-flash'));
    expect(colorOf('poolside/laguna-s-2.1')).toBeTruthy();
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
