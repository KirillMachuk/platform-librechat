const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditFileUpload = require('./auditFileUpload');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function buildReq(overrides = {}) {
  return {
    user: { _id: 'user1', email: 'u@x.io', role: 'USER' },
    body: { file_id: 'f-123' },
    file: { originalname: 'report.pdf', size: 2048, mimetype: 'application/pdf' },
    ...overrides,
  };
}

describe('auditFileUpload', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records file.upload with file metadata on success', () => {
    const res = buildRes(200);
    const next = jest.fn();
    auditFileUpload(buildReq(), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).not.toHaveBeenCalled();
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.upload',
        targetType: 'file',
        targetId: 'f-123',
        actorEmail: 'u@x.io',
        outcome: 'success',
      }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      filename: 'report.pdf',
      size: 2048,
      mimetype: 'application/pdf',
    });
  });

  it('does not record a failed upload (status >= 400)', () => {
    const res = buildRes(422);
    auditFileUpload(buildReq(), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it('still records when req.file is absent (metadata omitted)', () => {
    const res = buildRes(200);
    auditFileUpload(buildReq({ file: undefined }), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0][0].metadata).toBeUndefined();
  });
});
