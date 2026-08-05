import type { Page } from '@playwright/test';

/**
 * Canon measurements taken from the live interface, ported from
 * `tools/ui_probe.js` in the workspace rather than rewritten. That probe has a
 * mutation self-test (`tools/probe_selftest.js`, twelve checks) which was run
 * and green before this port; the things it learned the hard way are carried
 * over here and named, because each of them is a false positive or a blind spot
 * that took a measurement to find.
 *
 * Every measurement reports what it looked at as well as what it found. A list
 * of offenders that comes back empty reads the same whether the screen is clean
 * or the scan reached nothing at all.
 */
export type CanonFinding = { el: string; name: string; w: number; h: number };
export type LayerFinding = { el: string; z: string };

export type CanonScan = {
  /** The canon z-index scale, read from the token layer rather than hardcoded. */
  scale: number[];
  /** Interactive elements the touch-target sweep looked at. */
  interactive: number;
  /** Elements carrying `cursor: pointer` the keyboard sweep considered. */
  pointerCursor: number;
  /** Images the layout-shift sweep looked at, after the icon-size cutoff. */
  images: number;
  /** Interactive elements whose hit area is under 44px in either direction. */
  targets: CanonFinding[];
  /** Clickable by mouse, unreachable by keyboard. */
  reachable: CanonFinding[];
  /** `z-index` outside the canon scale. */
  layers: LayerFinding[];
  /** Images that reserve no space, so loading them shifts the layout. */
  cls: CanonFinding[];
};

const TOUCH_MIN = 44;

/* Serialised rather than passed as a function so the same source runs in both
 * profiles without a bundler step. */
const MEASURE = `(() => {
  const TOUCH_MIN = ${TOUCH_MIN};
  const styles = getComputedStyle(document.documentElement);
  const scale = ['sticky','scrim-drawer','drawer','scrim-dialog','dialog','popover','toast']
    .map((name) => parseInt(styles.getPropertyValue('--c-z-' + name), 10))
    .filter((n) => Number.isFinite(n));
  const CANON_Z = new Set([0, ...scale]);

  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const where = (el) => {
    const id = el.id ? '#' + el.id : '';
    const testid = el.getAttribute('data-testid');
    return el.tagName.toLowerCase() + id + (testid ? '[data-testid=' + testid + ']' : '');
  };
  const accName = (el) => {
    const label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();
    return (el.innerText || el.textContent || '').trim().slice(0, 40);
  };

  const out = {
    scale, interactive: 0, pointerCursor: 0, images: 0,
    targets: [], reachable: [], layers: [], cls: [],
  };

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=option],[tabindex]';
  const seen = new Set();
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue;
    out.interactive += 1;
    const r = el.getBoundingClientRect();
    const key = where(el) + Math.round(r.width) + 'x' + Math.round(r.height);
    if (seen.has(key)) continue;
    /* A 1x1 element that is not itself a control is a focus-trap sentinel the
       dialog library parks in the DOM, not something anybody taps. */
    const sentinel = r.width <= 1 && r.height <= 1
      && !el.matches('a[href],button,input,select,textarea');
    if (sentinel) continue;
    /* The canon allows a small VISUAL with a hit area grown by an invisible
       ::after (the .tap-target helper, phone widths only). Measuring the
       bounding box instead would report every icon button in the app as a
       violation exactly where the rule is being obeyed. */
    const after = getComputedStyle(el, '::after');
    const grown = after.content !== 'none' && after.position === 'absolute';
    const hitW = grown ? Math.max(r.width, parseFloat(after.width) || 0) : r.width;
    const hitH = grown ? Math.max(r.height, parseFloat(after.height) || 0) : r.height;
    if (hitW < TOUCH_MIN || hitH < TOUCH_MIN) {
      seen.add(key);
      out.targets.push({
        el: where(el), name: accName(el),
        w: Math.round(hitW), h: Math.round(hitH),
      });
    }
  }

  const focusableSel = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
  const ROLE_HOST = '[role=button],[role=link],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=tab],[role=option],[role=switch],[role=checkbox],[role=radio],label';
  for (const el of document.querySelectorAll('div,span,li,p,td,section,article,img,svg')) {
    if (!visible(el)) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    out.pointerCursor += 1;
    /* The pointer cursor inherits downward, so checking the element alone
       reports every icon and label inside a button as clickable-but-not-
       focusable. */
    if (el.closest(focusableSel) || el.closest(ROLE_HOST)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    out.reachable.push({
      el: where(el), name: accName(el),
      w: Math.round(r.width), h: Math.round(r.height),
    });
  }

  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    if (Number.isFinite(z) && z > 0 && !CANON_Z.has(z)) {
      out.layers.push({ el: where(el), z: String(z) });
    }
  }

  /* Lighthouse's rule: space is reserved if both width/height attributes are
     set, or CSS gives an aspect ratio, or inline styles fix both in absolute
     units. Computed styles cannot tell an author-set height from one derived
     from the loaded file — both come back in px — so only what is reliably
     visible is checked. Icons and avatars are skipped: a shift of a couple of
     pixels is not one. */
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 24 && r.height < 24) continue;
    out.images += 1;
    const s = getComputedStyle(img);
    const hasAttrs = img.hasAttribute('width') && img.hasAttribute('height');
    const hasRatio = s.aspectRatio && s.aspectRatio.includes('/');
    const inline = img.style;
    const fixedInline =
      !!inline.width && !!inline.height && !/auto|%/.test(inline.width + inline.height);
    if (!hasAttrs && !hasRatio && !fixedInline) {
      out.cls.push({
        el: where(img), name: img.getAttribute('alt') || '',
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }
  return out;
})()`;

export const measureCanon = (page: Page): Promise<CanonScan> =>
  page.evaluate(MEASURE) as Promise<CanonScan>;

/** How a finding is named in an assertion: stable id first, visible name after. */
export const identify = (finding: CanonFinding): string => {
  const testid = finding.el.match(/\[data-testid=([^\]]+)\]/);
  return testid ? testid[1] : finding.name;
};
