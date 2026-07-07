const { EventEmitter } = require('events');

const mockRecordAudit = jest.fn();
jest.mock('~/server/services/Audit', () => ({
  recordAudit: (...args) => mockRecordAudit(...args),
  auditRequestContext: () => ({ ip: '1.2.3.4', userAgent: 'jest' }),
}));

const auditProject = require('./auditProject');

function buildRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

function buildReq(overrides = {}) {
  return {
    method: 'POST',
    params: {},
    body: {},
    user: { _id: 'u1', email: 'u@x.io', role: 'USER' },
    ...overrides,
  };
}

describe('auditProject', () => {
  beforeEach(() => mockRecordAudit.mockClear());

  it('records project.create on POST with the name but never instructions', () => {
    const res = buildRes(201);
    auditProject(
      buildReq({ body: { name: 'Legal', instructions: 'SECRET INSTRUCTIONS' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.create', targetType: 'project' }),
    );
    expect(JSON.stringify(mockRecordAudit.mock.calls[0][0])).not.toContain(
      'SECRET INSTRUCTIONS',
    );
  });

  it('records project.update with the projectId', () => {
    const res = buildRes(200);
    auditProject(
      buildReq({ method: 'PATCH', params: { projectId: 'p1' }, body: { name: 'Renamed' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.update', targetId: 'p1' }),
    );
  });

  it('records project.delete with the projectId', () => {
    const res = buildRes(204);
    auditProject(buildReq({ method: 'DELETE', params: { projectId: 'p1' } }), res, jest.fn());
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.delete', targetId: 'p1' }),
    );
  });

  it('records project.file.upload on nested POST with file metadata', () => {
    const res = buildRes(200);
    auditProject(
      buildReq({
        params: { projectId: 'p1' },
        file: { originalname: 'contract.pdf', size: 123 },
      }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.file.upload', targetType: 'file' }),
    );
    expect(mockRecordAudit.mock.calls[0][0].metadata).toEqual({
      projectId: 'p1',
      filename: 'contract.pdf',
      size: 123,
    });
  });

  it('records project.file.delete on nested DELETE', () => {
    const res = buildRes(204);
    auditProject(
      buildReq({ method: 'DELETE', params: { projectId: 'p1', file_id: 'f9' } }),
      res,
      jest.fn(),
    );
    res.emit('finish');

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project.file.delete', targetId: 'f9' }),
    );
  });

  it('does not record failed requests (status >= 400)', () => {
    const res = buildRes(404);
    auditProject(buildReq({ method: 'DELETE', params: { projectId: 'p1' } }), res, jest.fn());
    res.emit('finish');
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
