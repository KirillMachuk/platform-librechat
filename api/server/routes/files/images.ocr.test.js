const express = require('express');
const request = require('supertest');

/**
 * A plain chat image is uploaded to `/files/images` with no tool resource — the
 * one path every screenshot and photo takes. It must offer the picture to the
 * OCR gate first: text that passes reaches the model through the anonymizer and
 * is masked, and is legible to models that cannot see images at all. Text that
 * fails must leave the native path untouched.
 *
 * This suite covers the wiring, not the gate itself (see routing.spec.ts): that
 * the route asks, that it asks BEFORE the image is stored, and that the answer
 * reaches the file record either way.
 */
jest.mock('~/server/services/Files/process', () => ({
  processAgentFileUpload: jest.fn(async ({ res }) => res.status(200).json({ agent: true })),
  processImageFile: jest.fn(async ({ res, text }) => res.status(200).json({ text: text ?? null })),
  attemptImageOcr: jest.fn(async () => null),
  filterFile: jest.fn(),
}));

jest.mock('~/server/middleware/roles/capabilities', () => ({
  canManageResourceType: jest.fn(() => true),
}));
jest.mock('~/server/services/PermissionService', () => ({ checkPermission: jest.fn(() => true) }));
jest.mock('~/models', () => ({ getAgent: jest.fn() }));

const {
  processImageFile,
  processAgentFileUpload,
  attemptImageOcr,
} = require('~/server/services/Files/process');

const router = require('~/server/routes/files/images');

const RECEIPT = 'ООО «Ромашка» Кассовый чек Хлеб Молоко Сыр ИТОГО 19,65';

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1', tenantId: 't1' };
    req.file = { originalname: 'shot.png', path: '/tmp/shot.png', mimetype: 'image/png' };
    req.file_id = 'server-file-id';
    req.config = {};
    next();
  });
  app.use('/images', router);
  return app;
};

const upload = (body = {}) => request(buildApp()).post('/images').send(body);

describe('POST /files/images — the OCR gate on a plain chat image', () => {
  it('offers the uploaded image to the gate', async () => {
    await upload({ file_id: 'client-id' });
    expect(attemptImageOcr).toHaveBeenCalledTimes(1);
    expect(attemptImageOcr.mock.calls[0][0]).toMatchObject({
      file: expect.objectContaining({ originalname: 'shot.png' }),
      file_id: 'server-file-id',
    });
  });

  it('passes accepted text to the stored image so the model reads words, not pixels', async () => {
    attemptImageOcr.mockResolvedValueOnce({ text: RECEIPT, bytes: 120 });
    const res = await upload({ file_id: 'client-id' });
    expect(res.status).toBe(200);
    expect(processImageFile.mock.calls[0][0].text).toBe(RECEIPT);
  });

  it('leaves the native path untouched when the gate rejects the text', async () => {
    attemptImageOcr.mockResolvedValueOnce(null);
    await upload({ file_id: 'client-id' });
    expect(processImageFile.mock.calls[0][0].text).toBeNull();
  });

  it('reads the picture before storing it, which consumes the upload', async () => {
    const order = [];
    attemptImageOcr.mockImplementationOnce(async () => {
      order.push('ocr');
      return null;
    });
    processImageFile.mockImplementationOnce(async ({ res }) => {
      order.push('store');
      return res.status(200).json({});
    });
    await upload({ file_id: 'client-id' });
    expect(order).toEqual(['ocr', 'store']);
  });

  it('does not run the gate twice when the image carries a tool resource', async () => {
    await upload({ file_id: 'client-id', tool_resource: 'context' });
    expect(processAgentFileUpload).toHaveBeenCalledTimes(1);
    expect(attemptImageOcr).not.toHaveBeenCalled();
    expect(processImageFile).not.toHaveBeenCalled();
  });
});
