/**
 * iOS Safari chrome sync (owner 17.08-2, mechanism proven in the msg8 widget):
 * the TOP status area follows `<meta name="theme-color">`, the BOTTOM URL pill
 * samples the page's own html/body background near the edge — overlay strips
 * never tint anything and were abandoned there after real-device testing.
 *
 * The static media-keyed metas in index.html serve the very first paint; they
 * follow the OS scheme. The app's theme is its own setting, and whenever the
 * two diverge (dark OS + light app) the OS-keyed meta painted a dark,
 * translucent murk over a light page. This runtime meta is inserted FIRST in
 * <head> — per the HTML spec the first matching meta wins — and carries the
 * ACTIVE theme's CHAT color, read from the `--c-card` token (owner 17.08-4:
 * the bars follow the conversation surface like ChatGPT's, not the sidebar) after the
 * theme class flips, so there is exactly one source of truth for the color.
 * The bottom pill needs no JS at all: html/body backgrounds are var(--c-card)
 * in the stylesheet and flip with the class.
 */
const RUNTIME_META_ATTR = 'data-app-theme-color';

export default function syncSafariChrome(): void {
  if (typeof document === 'undefined') {
    return;
  }
  const head = document.head;
  if (!head) {
    return;
  }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--c-card').trim();
  if (!color) {
    return;
  }
  let meta = head.querySelector<HTMLMetaElement>(`meta[name="theme-color"][${RUNTIME_META_ATTR}]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.setAttribute(RUNTIME_META_ATTR, '1');
  }
  meta.setAttribute('content', color);
  if (head.firstChild !== meta) {
    head.insertBefore(meta, head.firstChild);
  }
}
