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
   * page in Downloads named `.pptx`. The rule is the prefix, not a list of
   * extensions: the sandbox also emits source files, macro-enabled Office
   * formats, archives and extensionless names, and every one of them was
   * reachable while the guard enumerated document types. */
  it.each([
    '/uploads/user-1/abc__deck.pptx',
    '/uploads/user-1/abc__report.docx',
    '/uploads/user-1/abc__analysis.py',
    '/uploads/user-1/abc__notes.txt',
    '/uploads/user-1/abc__deck.pptm',
    '/uploads/user-1/abc__archive.7z',
    '/uploads/user-1/abc__Makefile',
    '/uploads',
  ])('404s a storage path rather than answering with the app shell: %s', (path) => {
    const { sendIndexHtml, res } = run(path);
    expect(sendIndexHtml).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  /* The prefix must be a path segment: a client route that merely starts with
   * those letters is still the app. */
  it('serves the app for a route that only shares the prefix spelling', () => {
    const { sendIndexHtml, res } = run('/uploadsomething');
    expect(sendIndexHtml).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
