import { render, fireEvent } from '@testing-library/react';
import { FaviconImage } from '../SourceHovercard';

/**
 * The icon is fetched from an external service and arrives through a redirect —
 * measured at ~0.8s, and some domains answer 404 and never produce one. The
 * label was therefore on screen next to empty holes, which reads as broken
 * (owner r28: «иконки стали появляться с задержкой после надписи и это
 * выглядит нелепо»).
 */
describe('FaviconImage — the box is never an empty hole (owner r28)', () => {
  const iconOf = (c: HTMLElement) => c.querySelector('svg');

  it('holds the box with a neutral glyph until the real icon has decoded', () => {
    const { container } = render(<FaviconImage domain="example.com" />);
    expect(iconOf(container)).not.toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    /* The image is present from the first render — the placeholder is not a
     * reason to delay the request — but it is not painted until it decodes. */
    expect(img?.className).toContain('opacity-0');
  });

  it('REPLACES the placeholder once the icon loads, never layers it underneath', () => {
    /* These icons are PNGs with transparent corners: a glyph left behind one
     * shows through it for good. */
    const { container } = render(<FaviconImage domain="example.com" />);
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(iconOf(container)).toBeNull();
    expect(container.querySelector('img')?.className).not.toContain('opacity-0');
  });

  it('keeps the glyph when the icon never arrives', () => {
    const { container } = render(<FaviconImage domain="example.com" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(iconOf(container)).not.toBeNull();
  });

  it('keeps deferring off-screen requests — a collapsed source list must not fire them all', () => {
    const { container } = render(<FaviconImage domain="example.com" />);
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy');
  });

  it('passes the caller size through, so the stacked icons keep their geometry', () => {
    const { container } = render(
      <FaviconImage domain="example.com" className="ml-[-6px] size-3" />,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain('size-3');
    expect(box.className).toContain('ml-[-6px]');
  });
});
