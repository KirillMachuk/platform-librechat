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
    [
      'https://docs.google.com/presentation/d/slides_456-QWE/edit?usp=sharing,',
      {
        fileId: 'slides_456-QWE',
        kind: 'presentation',
        mimeType: 'application/vnd.google-apps.presentation',
        viewUrl: 'https://docs.google.com/presentation/d/slides_456-QWE/edit',
      },
    ],
    [
      'https://drive.google.com/file/d/file_789-RTY/view?usp=sharing',
      {
        fileId: 'file_789-RTY',
        kind: 'drive_file',
        mimeType: 'application/octet-stream',
        viewUrl: 'https://drive.google.com/file/d/file_789-RTY/view',
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
    'https://docs.google.com/forms/d/abc/edit',
    'https://docs.google.com/document/u/0/d/abc/edit',
    'https://docs.google.com/document/d/abc%2Fdef/edit',
    'http://drive.google.com/file/d/abc/view',
    'https://drive.google.com.evil.example/file/d/abc/view',
    'https://drive.google.com:444/file/d/abc/view',
    'https://user:pass@drive.google.com/file/d/abc/view',
    'https://drive.google.com/drive/folders/abc',
    'https://drive.google.com/file/u/0/d/abc/view',
    'https://drive.google.com/file/d/abc%2Fdef/view',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects an unsafe or unsupported URL: %s', (input) => {
    expect(parseGoogleWorkspaceUrl(input)).toBeNull();
  });
});
