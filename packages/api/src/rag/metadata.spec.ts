import axios from 'axios';
import { extractDocMetadata, parseDocMetadata } from './metadata';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const SERVICE_RESPONSE = {
  file_id: 'f-1',
  doc_metadata: {
    doc_type: 'договор',
    parties: ['Ромашка', 'Юнифуд'],
    primary_date: '2024-01-15',
    primary_location: 'Минск',
    identifiers: [
      { type: 'DOC_NO', value: '312/24' },
      { type: 'EMAIL', value: 'lease@romashka.by' },
    ],
    columns: [],
    /* Сервис — обобщённый разбор документа и отдаёт шире хранимой формы. */
    entities: [{ type: 'ORG', value: 'Ромашка' }],
    dates: ['2024-01-15', '2030-09-01'],
    amounts: [{ value: 45000, currency: 'BYN' }],
  },
};

const params = {
  file: Buffer.from('%PDF-1.4'),
  fileId: 'f-1',
  filename: 'Договор.pdf',
  contentType: 'application/pdf',
  jwtToken: 'jwt',
  ragApiUrl: 'http://doc-gateway:8000',
};

describe('parseDocMetadata', () => {
  it('переводит ответ сервиса в хранимую форму', () => {
    expect(parseDocMetadata(SERVICE_RESPONSE)).toEqual({
      docType: 'договор',
      parties: ['Ромашка', 'Юнифуд'],
      primaryDate: '2024-01-15',
      primaryLocation: 'Минск',
      identifiers: [{ type: 'DOC_NO', value: '312/24' }],
      columns: [],
    });
  });

  it('не хранит поля, которых не читают фильтр и карточка', () => {
    const parsed = parseDocMetadata(SERVICE_RESPONSE) as Record<string, unknown>;
    expect(parsed.entities).toBeUndefined();
    expect(parsed.dates).toBeUndefined();
    expect(parsed.amounts).toBeUndefined();
  });

  it('не хранит контакты: они опознают СТОРОНУ, а не документ, и это ПДн в карточке', () => {
    /* Телефон/почту/УНП находит лексическое плечо Ф2 прямо в тексте (замер: строка-иголка 1.00),
     * поэтому дублировать их в метаданных незачем. */
    const parsed = parseDocMetadata(SERVICE_RESPONSE);
    expect(parsed?.identifiers.map((id) => id.type)).toEqual(['DOC_NO']);
  });

  it('отбрасывает идентификаторы неизвестного типа и битые записи', () => {
    const parsed = parseDocMetadata({
      doc_metadata: {
        doc_type: 'иное',
        identifiers: [
          { type: 'DOC_NO', value: '5' },
          { type: 'SOMETHING_NEW', value: 'x' },
          { type: 'EMAIL' },
          'мусор',
        ],
      },
    });
    expect(parsed?.identifiers).toEqual([{ type: 'DOC_NO', value: '5' }]);
  });

  it('пустой/битый ответ → null, а не полупустая запись', () => {
    expect(parseDocMetadata(undefined)).toBeNull();
    expect(parseDocMetadata({})).toBeNull();
    expect(parseDocMetadata({ doc_metadata: {} })).toBeNull();
    expect(parseDocMetadata({ doc_metadata: { doc_type: 42 } })).toBeNull();
  });

  it('отсутствующие место/дата = null (неизвестно), а не пустая строка', () => {
    const parsed = parseDocMetadata({ doc_metadata: { doc_type: 'таблица', columns: ['a', 'b'] } });
    expect(parsed).toEqual({
      docType: 'таблица',
      parties: [],
      primaryDate: null,
      primaryLocation: null,
      identifiers: [],
      columns: ['a', 'b'],
    });
  });
});

describe('extractDocMetadata', () => {
  beforeEach(() => jest.clearAllMocks());

  it('шлёт файл в /metadata сервиса и возвращает разобранные метаданные', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: SERVICE_RESPONSE });
    const result = await extractDocMetadata(params);
    expect(result?.docType).toBe('договор');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const [url, , config] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('http://doc-gateway:8000/metadata');
    expect((config?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt');
  });

  it('fail-open: сбой сети → null, исключение НЕ пробрасывается (индексация не должна падать)', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(extractDocMetadata(params)).resolves.toBeNull();
  });

  it('fail-open: backpressure 503 сервиса → null', async () => {
    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 503, data: { error: { type: 'docgw_busy' } } },
      message: 'Request failed with status code 503',
    });
    await expect(extractDocMetadata(params)).resolves.toBeNull();
  });

  it('fail-open: осмысленный ответ без метаданных → null', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { file_id: 'f-1' } });
    await expect(extractDocMetadata(params)).resolves.toBeNull();
  });
});
