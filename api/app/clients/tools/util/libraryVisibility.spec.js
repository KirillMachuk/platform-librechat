/**
 * Правило видимости библиотеки на НАСТОЯЩЕМ Mongo (mongodb-memory-server): семантика
 * missing-vs-null, `$ne: true` на отсутствующем поле и сравнение дат — это поведение базы,
 * и мок его не докажет.
 *
 * Пять судеб файла:
 *   вечный (без даты)            → ВИДЕН (как и до ретеншна);
 *   temp-чат                     → НИКОГДА не виден (приватность);
 *   retention, срок не истёк     → ВИДЕН — под `retentionMode: ALL` дату несёт каждый файл,
 *                                  и правило «expiredAt: null» опустошало всю библиотеку
 *                                  (воспроизведено на лабе);
 *   retention, срок истёк        → не виден (ждёт свипа — не показываем то, что вот-вот умрёт);
 *   легаси с датой без маркера   → не виден (temp-статус неизвестен: fail-closed, приватность
 *                                  важнее полноты; повторная загрузка возвращает файл).
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { fileSchema } = require('@librechat/data-schemas');
const { withLibraryVisibility } = require('./librarySearch');

describe('withLibraryVisibility — судьбы файла на настоящем Mongo', () => {
  let mongoServer;
  let File;
  const user = new mongoose.Types.ObjectId();

  const IN_A_YEAR = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const YESTERDAY = new Date(Date.now() - 24 * 3600 * 1000);

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    File = mongoose.models.File || mongoose.model('File', fileSchema);
    await File.create(
      [
        { file_id: 'eternal', temporary: false },
        { file_id: 'temp-chat', temporary: true, expiredAt: IN_A_YEAR },
        { file_id: 'retention-alive', temporary: false, expiredAt: IN_A_YEAR },
        { file_id: 'retention-expired', temporary: false, expiredAt: YESTERDAY },
        { file_id: 'legacy-dated', expiredAt: IN_A_YEAR },
        { file_id: 'legacy-eternal' },
      ].map((file) => ({
        user,
        filename: `${file.file_id}.pdf`,
        filepath: `/uploads/${file.file_id}.pdf`,
        bytes: 1,
        object: 'file',
        type: 'application/pdf',
        usage: 0,
        source: 'local',
        embedded: true,
        ...file,
      })),
    );
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  it('видимы: вечные (включая легаси) и живые retention-файлы; скрыты: temp, истёкшие, легаси с датой', async () => {
    const visible = await File.find(withLibraryVisibility({ user, embedded: true }), {
      file_id: 1,
    }).lean();
    expect(visible.map((f) => f.file_id).sort()).toEqual([
      'eternal',
      'legacy-eternal',
      'retention-alive',
    ]);
  });

  it('temp-файл не виден даже при живой дате — приватность не зависит от срока', async () => {
    const visible = await File.find(
      withLibraryVisibility({ user, embedded: true, file_id: 'temp-chat' }),
    ).lean();
    expect(visible).toHaveLength(0);
  });

  it('сохраняет прочие условия запроса и не затирает $or фильтров видимостью', async () => {
    const query = withLibraryVisibility({
      user,
      embedded: true,
      $or: [{ file_id: 'retention-alive' }, { file_id: 'temp-chat' }],
    });
    expect(query.$and).toHaveLength(2);
    const visible = await File.find(query, { file_id: 1 }).lean();
    expect(visible.map((f) => f.file_id)).toEqual(['retention-alive']);
  });
});
