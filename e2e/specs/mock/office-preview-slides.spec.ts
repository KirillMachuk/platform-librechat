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
 * DOM shape measured from `pptx-preview@1.0.7` against a real deck: ONE host
 * div sized to the init box with its own `overflow: auto`, every slide in flow
 * inside it. The subject under test is our own wrap-and-scale pass, which owns
 * every pixel the user sees; the stand-in only has to hold the shape it wraps.
 */

const VENDOR_URL = 'https://cdn.jsdelivr.net/npm/pptx-preview@**';
const SLIDE_COUNT = 6;
const NATIVE_W = 960;
const NATIVE_H = 540;
/** pptx-preview separates slides with this bottom margin. */
const SLIDE_GAP = 10;

/** Stand-in for the vendor UMD bundle — see the note above. */
const fakeVendorBundle = `
window.pptxPreview = {
  init: function (container, options) {
    return {
      preview: function () {
        var host = document.createElement('div');
        host.className = 'pptx-preview-wrapper';
        host.style.cssText = 'position:relative;overflow:auto;width:' +
          options.width + 'px;height:' + options.height + 'px;';
        for (var i = 0; i < ${SLIDE_COUNT}; i++) {
          var slide = document.createElement('div');
          slide.className = 'pptx-preview-slide-wrapper pptx-preview-slide-wrapper-' + i;
          slide.style.cssText = 'position:relative;overflow:hidden;background:#fff;' +
            'width:' + options.width + 'px;height:' + options.height + 'px;' +
            'margin:0 0 ${SLIDE_GAP}px;';
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

async function openRenderedDeck(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  /* Integrity is computed over the real bundle; a stand-in would be rejected by
     SRI before it ever runs, so the attribute goes with it. */
  const html = (await buildDocument()).replace(/\s(?:integrity|crossorigin)="[^"]*"/g, '');
  await page.route(VENDOR_URL, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: fakeVendorBundle }),
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

test.describe('bundled PPTX preview', () => {
  for (const { label, width } of [
    { label: 'panel width', width: 700 },
    { label: 'phone width', width: 375 },
  ]) {
    test(`shows every slide of the deck, not just the first one — ${label}`, async ({ page }) => {
      await openRenderedDeck(page, width);
      const { documentHeight, horizontalOverflow, boxes } = await slideGeometry(page);

      expect(boxes).toHaveLength(SLIDE_COUNT);
      /* The defect: the wrap was sized from the host's own 540px box, so slides
         2..N were clipped by its `overflow: hidden` — painted, sized, and
         invisible. Height alone is therefore not enough; each slide has to sit
         below the previous one inside a document tall enough to reach it. */
      const scale = boxes[0].width / NATIVE_W;
      const expectedStride = (NATIVE_H + SLIDE_GAP) * scale;
      boxes.forEach((box, index) => {
        expect(box.height).toBeGreaterThan(NATIVE_H * scale * 0.9);
        if (index > 0) {
          expect(box.top - boxes[index - 1].top).toBeGreaterThan(expectedStride * 0.9);
        }
      });
      expect(documentHeight).toBeGreaterThan(boxes[SLIDE_COUNT - 1].top);
      /* Scaling is width-driven: the deck fits the panel across, never spills. */
      expect(horizontalOverflow).toBe(false);
      expect(boxes[0].width).toBeLessThanOrEqual(width);
    });
  }
});
