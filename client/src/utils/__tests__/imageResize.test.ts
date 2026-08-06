/**
 * Tests for client-side image resizing utility
 */

import { shouldResizeImage, supportsClientResize } from '../imageResize';

// Mock browser APIs for testing
Object.defineProperty(global, 'HTMLCanvasElement', {
  value: function () {
    return {
      getContext: () => ({
        drawImage: jest.fn(),
      }),
      toBlob: jest.fn(),
    };
  },
  writable: true,
});

Object.defineProperty(global, 'FileReader', {
  value: function () {
    return {
      readAsDataURL: jest.fn(),
    };
  },
  writable: true,
});

Object.defineProperty(global, 'Image', {
  value: function () {
    return {};
  },
  writable: true,
});

describe('imageResize utility', () => {
  describe('supportsClientResize', () => {
    it('should return true when all required APIs are available', () => {
      const result = supportsClientResize();
      expect(result).toBe(true);
    });

    it('should return false when HTMLCanvasElement is not available', () => {
      const originalCanvas = global.HTMLCanvasElement;
      // @ts-ignore
      delete global.HTMLCanvasElement;

      const result = supportsClientResize();
      expect(result).toBe(false);

      global.HTMLCanvasElement = originalCanvas;
    });
  });

  describe('shouldResizeImage', () => {
    const imageOfSize = (bytes: number) => {
      const file = new File([''], 'test.jpg', { type: 'image/jpeg', lastModified: 0 });
      Object.defineProperty(file, 'size', { value: bytes, writable: false });
      return file;
    };

    it('offers a large image for resizing', () => {
      expect(shouldResizeImage(imageOfSize(100 * 1024 * 1024))).toBe(true);
    });

    /**
     * The rule used to be "smaller than a tenth of the size limit — leave it", with the
     * limit defaulting to 512 MB. That meant only images above 51 MB were ever offered,
     * while the server rejects anything over 50 MB: the feature could not fire at all.
     * A phone photo is the case it exists for, and it is single-digit megabytes.
     */
    it('offers a phone photo too, which the old size rule skipped', () => {
      expect(shouldResizeImage(imageOfSize(9 * 1024 * 1024))).toBe(true);
      expect(shouldResizeImage(imageOfSize(2 * 1024 * 1024))).toBe(true);
    });

    /** Small pictures are offered as well; `resizeImage` hands back the original
     *  untouched once it sees the dimensions already fit. */
    it('leaves the decision about dimensions to resizeImage', () => {
      expect(shouldResizeImage(imageOfSize(1024))).toBe(true);
    });

    it('should return false for non-image files', () => {
      const textFile = new File([''], 'test.txt', {
        type: 'text/plain',
        lastModified: Date.now(),
      });

      const result = shouldResizeImage(textFile);
      expect(result).toBe(false);
    });

    it('should return false for GIF files', () => {
      const gifFile = new File([''], 'test.gif', {
        type: 'image/gif',
        lastModified: Date.now(),
      });

      const result = shouldResizeImage(gifFile);
      expect(result).toBe(false);
    });
  });
});
