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
/** Deck aspects: 16:9 fills the host exactly, 4:3 overflows it by a third. */
const ASPECTS = [
  { label: '16:9 deck', slideHeight: 540 },
  { label: '4:3 deck', slideHeight: 720 },
];

/** Stand-in for the vendor UMD bundle — see the note above. */
const fakeVendorBundle = (slideHeight: number) => `
window.pptxPreview = {
  init: function (container, options) {
    return {
      preview: function () {
        var host = document.createElement('div');
        host.className = 'pptx-preview-wrapper';
        host.style.cssText = 'position:relative;overflow:auto;background:#000;margin:0 auto;' +
          'width:' + options.width + 'px;height:' + options.height + 'px;';
        for (var i = 0; i < ${SLIDE_COUNT}; i++) {
          var slide = document.createElement('div');
          slide.className = 'pptx-preview-slide-wrapper pptx-preview-slide-wrapper-' + i;
          slide.style.cssText = 'position:relative;overflow:hidden;background:#fff;' +
            'width:' + options.width + 'px;height:${slideHeight}px;' +
            'margin:0 auto ${SLIDE_GAP}px;';
          slide.textContent = 'Slide ' + (i + 1);
          host.appendChild(slide);
        }
        container.appendChild(host);
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
) {
  await page.setViewportSize({ width, height: 800 });
  /* Integrity is computed over the real bundle; a stand-in would be rejected by
     SRI before it ever runs, so the attribute goes with it. */
  const html = (await buildDocument()).replace(/\s(?:integrity|crossorigin)="[^"]*"/g, '');
  await page.route(VENDOR_URL, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fakeVendorBundle(slideHeight) }),
  );
  await page.setContent(html, { waitUntil: 'load' });
  await expect(page.locator('.lc-slide-wrap')).toHaveCount(1, { timeout: 15000 });
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
  for (const { label: aspect, slideHeight } of ASPECTS) {
    for (const { label, width } of [
      { label: 'panel width', width: 700 },
      { label: 'phone width', width: 375 },
    ]) {
      test(`shows every slide of the deck, not just the first one — ${aspect}, ${label}`, async ({
        page,
      }) => {
        await openRenderedDeck(page, width, slideHeight);
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
        /* And the deck is taller than the host the renderer sized for itself —
           without that, a 16:9 deck could pass while nothing was neutralised. */
        expect(documentHeight).toBeGreaterThan(HOST_H * scale);
      });
    }
  }
});
