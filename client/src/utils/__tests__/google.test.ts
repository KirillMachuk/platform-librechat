import { parseGoogleWorkspaceUrl } from '../google';

describe('parseGoogleWorkspaceUrl', () => {
  it.each([
    [
      'https://docs.google.com/document/d/doc_123-ABC/edit?tab=t.0#heading=h.test',
      {
        fileId: 'doc_123-ABC',
        kind: 'document',
        mimeType: 'application/vnd.google-apps.document',
        viewUrl: 'https://docs.google.com/document/d/doc_123-ABC/edit',
      },
    ],
    [
      'https://docs.google.com/spreadsheets/d/sheet_987-XYZ/view',
      {
        fileId: 'sheet_987-XYZ',
        kind: 'spreadsheet',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        viewUrl: 'https://docs.google.com/spreadsheets/d/sheet_987-XYZ/edit',
      },
    ],
  ])('normalizes a supported Google Workspace URL', (input, expected) => {
    expect(parseGoogleWorkspaceUrl(input)).toEqual(expected);
  });

  it.each([
    'http://docs.google.com/document/d/abc/edit',
    'https://evil.docs.google.com/document/d/abc/edit',
    'https://docs.google.com.evil.example/document/d/abc/edit',
    'https://docs.google.com:444/document/d/abc/edit',
    'https://user:pass@docs.google.com/document/d/abc/edit',
    'https://docs.google.com/presentation/d/abc/edit',
    'https://docs.google.com/document/u/0/d/abc/edit',
    'https://docs.google.com/document/d/abc%2Fdef/edit',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects an unsafe or unsupported URL: %s', (input) => {
    expect(parseGoogleWorkspaceUrl(input)).toBeNull();
  });
});
