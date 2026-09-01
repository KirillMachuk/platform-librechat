import { render, fireEvent } from '@testing-library/react';
import { FaviconImage } from '../SourceHovercard';

/**
 * The icon used to be fetched by the browser from an external service, which
 * told a third party which sites the reader's research had surfaced, and
 * arrived through a redirect — measured at ~0.8s, some domains answering 404
 * and never producing one. The label was therefore on screen next to empty
 * holes, which reads as broken (owner r28: «иконки стали появляться с
 * задержкой после надписи и это выглядит нелепо»).
 */
describe('FaviconImage — the icon comes from us, and the box is never an empty hole', () => {
  const iconOf = (c: HTMLElement) => c.querySelector('svg');
  const srcOf = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? '';

  it('asks our own backend for the icon, so the browser tells nobody what was read', () => {
    /* A relative path is the assertion: it cannot leave this origin. */
    expect(srcOf(render(<FaviconImage domain="example.com" />).container)).toBe(
      '/api/favicon?domain=example.com',
    );
  });

  it('encodes the domain instead of pasting it into the query', () => {
    expect(srcOf(render(<FaviconImage domain="пример.рф" />).container)).toBe(
      `/api/favicon?domain=${encodeURIComponent('пример.рф')}`,
    );
  });

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

  it('lets the caller size win instead of racing the default in the built CSS', () => {
    /* tailwind-merge at this version does not resolve `size-*` against
     * `size-*`, so leaving the default in place would make the winner depend on
     * stylesheet order rather than on the call site (r28 review). */
    const { container } = render(
      <FaviconImage domain="example.com" className="ml-[-6px] size-3" />,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain('size-3');
    expect(box.className).not.toContain('size-4');
    expect(box.className).toContain('ml-[-6px]');
  });

  it('keeps the caller rounding on the IMAGE, where it is visible', () => {
    /* One call site asks for `rounded-sm`; on the box it would do nothing (no
     * background, no clipping) while the icon stayed round (r28 review). */
    const { container } = render(
      <FaviconImage domain="example.com" className="size-4 rounded-sm" />,
    );
    expect(container.querySelector('img')?.className).toContain('rounded-sm');
    expect(container.querySelector('img')?.className).not.toContain('rounded-full');
  });

  it('defaults to a round icon when the caller says nothing', () => {
    const { container } = render(<FaviconImage domain="example.com" />);
    expect(container.querySelector('img')?.className).toContain('rounded-full');
  });

  it('shows the glyph again when the same slot is reused for another domain', () => {
    /* The stack mounts icons by index, so a changed source list hands this
     * instance a new domain; a stale «loaded» would leave an empty hole. */
    const { container, rerender } = render(<FaviconImage domain="example.com" />);
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(iconOf(container)).toBeNull();
    rerender(<FaviconImage domain="other.com" />);
    expect(iconOf(container)).not.toBeNull();
  });
});
