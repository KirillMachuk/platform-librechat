import { fileTypeMeta, fileBadge, fileExtension, chipType } from '../typeMeta';

/* 12.08-3, владелец: docx рисовался КОДОМ — прежняя маска /xml/ ловила
 * подстроку внутри application/vnd.openxmlformats-…. Этот файл держит
 * каждый известный тип на своём глифе; новая ошибка сопоставления обязана
 * уронить ровно одну строку таблицы. */
describe('fileTypeMeta', () => {
  const CASES: Array<[string, string]> = [
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'com_ui_file_type_document',
    ],
    ['application/msword', 'com_ui_file_type_document'],
    ['application/vnd.oasis.opendocument.text', 'com_ui_file_type_document'],
    ['application/rtf', 'com_ui_file_type_document'],
    ['application/epub+zip', 'com_ui_file_type_document'],
    ['text/plain', 'com_ui_file_type_document'],
    ['text/markdown', 'com_ui_file_type_document'],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'com_ui_file_type_spreadsheet',
    ],
    ['application/vnd.ms-excel', 'com_ui_file_type_spreadsheet'],
    ['text/csv', 'com_ui_file_type_spreadsheet'],
    ['application/vnd.oasis.opendocument.spreadsheet', 'com_ui_file_type_spreadsheet'],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'com_ui_file_type_document',
    ],
    ['application/vnd.ms-powerpoint', 'com_ui_file_type_document'],
    ['application/pdf', 'com_ui_file_type_pdf'],
    ['image/png', 'com_ui_file_type_image'],
    ['image/heic', 'com_ui_file_type_image'],
    ['text/html', 'com_ui_file_type_web'],
    ['application/xhtml+xml', 'com_ui_file_type_web'],
    ['application/json', 'com_ui_file_type_code'],
    ['application/xml', 'com_ui_file_type_code'],
    ['text/xml', 'com_ui_file_type_code'],
    ['application/x-python', 'com_ui_file_type_code'],
    ['text/javascript', 'com_ui_file_type_code'],
    ['application/x-sh', 'com_ui_file_type_code'],
    ['application/zip', 'com_ui_file_type_archive'],
    ['application/x-7z-compressed', 'com_ui_file_type_archive'],
    ['application/gzip', 'com_ui_file_type_archive'],
    ['audio/mpeg', 'com_ui_file_type_audio'],
    ['video/mp4', 'com_ui_file_type_video'],
    ['application/octet-stream', 'com_ui_file_type_file'],
    ['', 'com_ui_file_type_file'],
  ];

  it.each(CASES)('%s → %s', (mime, labelKey) => {
    expect(fileTypeMeta(mime).labelKey).toBe(labelKey);
  });

  it('never lets the code pattern swallow an office mime', () => {
    const office = CASES.filter(([mime]) => mime.includes('officedocument'));
    for (const [mime] of office) {
      expect(fileTypeMeta(mime).labelKey).not.toBe('com_ui_file_type_code');
    }
  });
});

describe('fileBadge', () => {
  it("formats the owner's examples", () => {
    expect(fileBadge('Приложение + Акт Freepik.docx', 18944)).toEqual({
      extension: 'DOCX',
      size: '18.5 KB',
    });
    expect(fileBadge('report.pdf', 15.6 * 1024 * 1024)).toEqual({
      extension: 'PDF',
      size: '15.6 MB',
    });
    expect(fileBadge('export_base_685699.csv', 3.3 * 1024 * 1024)).toEqual({
      extension: 'CSV',
      size: '3.3 MB',
    });
  });

  it('degrades to nulls the caller can replace with the type name', () => {
    expect(fileBadge('noextension', undefined)).toEqual({ extension: null, size: null });
    expect(fileBadge(undefined, 0)).toEqual({ extension: null, size: null });
  });
});

describe('fileExtension', () => {
  it('extracts the bare lowercase extension', () => {
    expect(fileExtension('Приложение + Акт Freepik.DOCX')).toBe('docx');
    expect(fileExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns null when there is nothing to extract', () => {
    expect(fileExtension('noextension')).toBeNull();
    expect(fileExtension(undefined)).toBeNull();
    expect(fileExtension(null)).toBeNull();
  });
});

/* 19.08-3, владелец: пока файл грузится, запись живёт с браузерным MIME —
 * а для .sql/.toml и друзей браузер отдаёт '' или generic octet-stream, и
 * чип рисовал НЕ ТОТ глиф, меняя его после ответа сервера. chipType — общий
 * судья типа для глифа и подписи: бессодержательный MIME проигрывает
 * расширению имени. */
describe('chipType', () => {
  it('falls back to the extension when the MIME says nothing', () => {
    expect(chipType('', 'schema.sql')).toBe('sql');
    expect(chipType(undefined, 'notes.toml')).toBe('toml');
    expect(chipType('application/octet-stream', 'Отчёт за август.docx')).toBe('docx');
  });

  it('lets a real MIME win over the extension', () => {
    expect(chipType('application/pdf', 'misnamed.sql')).toBe('application/pdf');
  });

  it('degrades to the original mime when the name has no extension', () => {
    expect(chipType('', 'noextension')).toBe('');
    expect(chipType('application/octet-stream', 'noextension')).toBe('application/octet-stream');
  });

  it('lands the fallback on the same glyph the resolved type draws', () => {
    expect(fileTypeMeta(chipType('', 'schema.sql'))).toBe(fileTypeMeta('application/sql'));
    expect(fileTypeMeta(chipType('application/octet-stream', 'deck.pptx'))).toBe(
      fileTypeMeta('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    );
  });
});
