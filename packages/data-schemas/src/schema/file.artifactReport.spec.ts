import fileSchema from './file';

describe('file artifact report persistence', () => {
  it('keeps validated report extensions in a Mixed field', () => {
    const artifactReportPath = fileSchema.path('artifactReport');

    expect(artifactReportPath).toBeDefined();
    expect(artifactReportPath?.instance).toBe('Mixed');
  });
});
