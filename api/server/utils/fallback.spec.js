const createSpaFallback = require('./fallback');

describe('createSpaFallback', () => {
  const run = (path) => {
    const sendIndexHtml = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), end: jest.fn() };
    createSpaFallback(sendIndexHtml)({ path }, res);
    return { sendIndexHtml, res };
  };

  it('serves the app for a client route', () => {
    const { sendIndexHtml, res } = run('/c/new');
    expect(sendIndexHtml).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('404s a missing static asset instead of poisoning the cache with index.html', () => {
    const { sendIndexHtml, res } = run('/assets/app-a1b2c3.js');
    expect(sendIndexHtml).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  /* `/uploads/...` is a storage path, not a served route — downloads go
   * through `/api/files/download/:userId/:file_id`. Answering it with the SPA
   * shell meant a middle-click or "Save link as" on a file chip put an HTML
   * page in Downloads named `.pptx`. */
  it.each([
    '/uploads/user-1/abc__deck.pptx',
    '/uploads/user-1/abc__report.docx',
    '/uploads/user-1/abc__budget.xlsx',
    '/uploads/user-1/abc__slides.pdf',
    '/uploads/user-1/abc__rows.csv',
  ])('404s a document path rather than answering with the app shell: %s', (path) => {
    const { sendIndexHtml, res } = run(path);
    expect(sendIndexHtml).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
