import { readFileSync } from 'fs';
import path from 'path';
import { expect, test } from '@playwright/test';
import { pptxToHtml } from '../../../packages/api/src/files/documents/html';

/**
 * The bundled PPTX renderer, exercised as a document rather than through the
 * app. `file-preview.spec.ts` covers the server-side slide list because the e2e
 * profile sets `OFFICE_PREVIEW_DISABLE_CDN`; production serves small decks
 * through this path instead, and nothing was checking its geometry — a six-slide
 * deck reached the owner showing slide 1 and empty space below it (17.08).
 *
 * The vendor bundle cannot be fetched here (no network in CI, and it is not a
 * dependency), so the request is answered with a stand-in that reproduces the
 * DOM shape of `pptx-preview@1.0.7`: ONE host div sized to the init box, black,
 * with its own `overflow: auto`, and every slide in flow inside it at the deck's
 * own aspect — 540px tall for 16:9, 720px inside the same 540px host for 4:3,
 * which is the harder case. The subject under test is our own wrap-and-scale
 * pass, which owns every pixel the user sees.
 *
 * The stand-in is an assumption about somebody else's DOM, so it is worth
 * saying how to re-check it: build the document with `pptxToHtml`, open it in a
 * browser WITH network (the vendor loads from jsdelivr, pinned by SRI), and
 * compare `.pptx-preview-wrapper` / `.pptx-preview-slide-wrapper` against the
 * shape below. That is how the shape was established in the first place, on the
 * deck this fix came from. A vendor bump changes the shape and this suite will
 * not notice — re-check it then.
 */

const VENDOR_URL = 'https://cdn.jsdelivr.net/npm/pptx-preview@**';
const SLIDE_COUNT = 6;
const NATIVE_W = 960;
/** The init box we ask the renderer for — the host is sized to it. */
const HOST_H = 540;
/** pptx-preview separates slides with this bottom margin. */
const SLIDE_GAP = 10;
/**
 * What the vendor can hand us. 1.0.7 puts every slide inside one host sized to
 * the init box — 16:9 fills it, 4:3 overflows it by a third, which is the case
 * that clips. `siblings` is the other shape a renderer could use, and it is in
 * here because the fix has to leave it alone: those slides are fixed boxes with
 * absolutely positioned content, so growing them to their content measures zero
 * and the panel comes out empty.
 */
const SHAPES = [
  { label: '16:9 deck in one host', slideHeight: 540, host: true, late: 0 },
  { label: '4:3 deck in one host', slideHeight: 720, host: true, late: 0 },
  { label: 'slides as siblings', slideHeight: 540, host: false, late: 0 },
  /* The renderer is not always finished when it says it is, and the bootstrap
     has an 8s safety net that wraps whatever exists by then. A deck that keeps
     painting afterwards has to grow the wrap with it — otherwise the tail is
     clipped for good, which is the same defect on a slower machine. */
  { label: 'deck that finishes painting late', slideHeight: 540, host: true, late: 4 },
];

/** Stand-in for the vendor UMD bundle — see the note above. */
const fakeVendorBundle = (slideHeight: number, host: boolean, late: number) => `
window.pptxPreview = {
  init: function (container, options) {
    return {
      preview: function () {
        var host = null;
        if (${host}) {
          host = document.createElement('div');
          host.className = 'pptx-preview-wrapper';
          host.style.cssText = 'position:relative;overflow:auto;background:#000;margin:0 auto;' +
            'width:' + options.width + 'px;height:' + options.height + 'px;';
          container.appendChild(host);
        }
        var addSlide = function (i) {
          var slide = document.createElement('div');
          slide.className = 'pptx-preview-slide-wrapper pptx-preview-slide-wrapper-' + i;
          slide.style.cssText = 'position:relative;overflow:hidden;background:#fff;' +
            'width:' + options.width + 'px;height:${slideHeight}px;' +
            'margin:0 auto ${SLIDE_GAP}px;';
          var inner = document.createElement('div');
          /* Absolutely positioned content, as the renderer draws it: the reason
             a slide measures zero the moment its height is set to auto. */
          inner.style.cssText = 'position:absolute;inset:0;';
          inner.textContent = 'Slide ' + (i + 1);
          slide.appendChild(inner);
          (host || container).appendChild(slide);
        };
        var upfront = ${SLIDE_COUNT} - ${late};
        for (var i = 0; i < upfront; i++) {
          addSlide(i);
        }
        if (${late} > 0) {
          setTimeout(function () {
            for (var j = upfront; j < ${SLIDE_COUNT}; j++) {
              addSlide(j);
            }
          }, 150);
        }
        return Promise.resolve({ slides: new Array(${SLIDE_COUNT}) });
      },
    };
  },
};
`;

async function openRenderedDeck(
  page: import('@playwright/test').Page,
  width: number,
  slideHeight: number,
  host: boolean,
  late: number,
) {
  await page.setViewportSize({ width, height: 800 });
  /* Integrity is computed over the real bundle; a stand-in would be rejected by
     SRI before it ever runs, so the attribute goes with it. */
  const html = (await buildDocument()).replace(/\s(?:integrity|crossorigin)="[^"]*"/g, '');
  await page.route(VENDOR_URL, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: fakeVendorBundle(slideHeight, host, late),
    }),
  );
  await page.setContent(html, { waitUntil: 'load' });
  /* One wrap around the host, or one per slide when the renderer emits them as
     siblings — the pass wraps whatever it is given. */
  await expect(page.locator('.lc-slide-wrap')).toHaveCount(host ? 1 : SLIDE_COUNT, {
    timeout: 15000,
  });
  /* Slides that land after the wrap must be waited for — the point of the case
     is what the wrap does once they do. */
  await expect(page.locator('.pptx-preview-slide-wrapper')).toHaveCount(SLIDE_COUNT, {
    timeout: 15000,
  });
}

async function buildDocument() {
  /* The e2e profile forces the server-side slide list; this spec is about the
     bundled renderer, so the switch is off for the call that builds it. */
  const disabled = process.env.OFFICE_PREVIEW_DISABLE_CDN;
  delete process.env.OFFICE_PREVIEW_DISABLE_CDN;
  try {
    const fixture = path.resolve(__dirname, '../../fixtures/files/deck-16x9.pptx');
    return await pptxToHtml(readFileSync(fixture));
  } finally {
    if (disabled !== undefined) {
      process.env.OFFICE_PREVIEW_DISABLE_CDN = disabled;
    }
  }
}

/** Geometry of every slide plus the scroll extent of the document holding them. */
async function slideGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const slides = Array.from(document.querySelectorAll('.pptx-preview-slide-wrapper'));
    return {
      documentHeight: document.documentElement.scrollHeight,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth,
      boxes: slides.map((slide) => {
        const box = slide.getBoundingClientRect();
        return { top: box.top + window.scrollY, height: box.height, width: box.width };
      }),
    };
  });
}

/**
 * Scrolls to a slide and asks the page what is painted at its centre. Layout
 * alone cannot answer this: the defect left slides 2..N laid out at the right
 * coordinates and clipped by an ancestor's `overflow: hidden`, so every
 * position-based assertion passed while the user saw nothing.
 */
async function slideIsPainted(page: import('@playwright/test').Page, index: number) {
  return page.evaluate((slideIndex) => {
    const slide = document.querySelectorAll('.pptx-preview-slide-wrapper')[slideIndex];
    if (!slide) {
      return { scrolledIntoView: false, painted: false };
    }
    const first = slide.getBoundingClientRect();
    window.scrollTo(0, first.top + window.scrollY - 40);
    const box = slide.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = Math.min(box.top + box.height / 2, window.innerHeight - 4);
    const hit = document.elementFromPoint(x, y);
    return {
      scrolledIntoView: box.top < window.innerHeight && box.bottom > 0,
      painted: !!hit && (hit === slide || slide.contains(hit)),
    };
  }, index);
}

test.describe('bundled PPTX preview', () => {
  for (const { label: shape, slideHeight, host, late } of SHAPES) {
    for (const { label, width } of [
      { label: 'panel width', width: 700 },
      { label: 'phone width', width: 375 },
    ]) {
      test(`shows every slide of the deck, not just the first one — ${shape}, ${label}`, async ({
        page,
      }) => {
        await openRenderedDeck(page, width, slideHeight, host, late);
        const { documentHeight, horizontalOverflow, boxes } = await slideGeometry(page);

        expect(boxes).toHaveLength(SLIDE_COUNT);
        const scale = boxes[0].width / NATIVE_W;
        const expectedStride = (slideHeight + SLIDE_GAP) * scale;
        boxes.forEach((box, index) => {
          expect(box.height).toBeGreaterThan(slideHeight * scale * 0.9);
          if (index > 0) {
            expect(box.top - boxes[index - 1].top).toBeGreaterThan(expectedStride * 0.9);
          }
        });
        expect(documentHeight).toBeGreaterThan(boxes[SLIDE_COUNT - 1].top);
        /* The one assertion the defect could not pass: every slide has to be
           reachable by scrolling AND actually painted there. */
        for (let index = 0; index < SLIDE_COUNT; index++) {
          const slide = await slideIsPainted(page, index);
          expect(slide.scrolledIntoView, `slide ${index + 1} scrolls into view`).toBe(true);
          expect(slide.painted, `slide ${index + 1} is painted, not clipped`).toBe(true);
        }
        /* Scaling is width-driven: the deck fits the panel across, never spills. */
        expect(horizontalOverflow).toBe(false);
        expect(boxes[0].width).toBeLessThanOrEqual(width);
        if (host) {
          /* Taller than the host the renderer sized for itself — without this a
             16:9 deck could pass while nothing had been neutralised. */
          expect(documentHeight).toBeGreaterThan(HOST_H * scale);
        }
      });
    }
  }
});
