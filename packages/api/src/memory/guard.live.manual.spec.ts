import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Tools } from 'librechat-data-provider';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { MemoryArtifact } from 'librechat-data-provider';
import { createMemoryTool } from '~/agents/memory';
import { checkMemoryValue } from './guard';

/**
 * End-to-end proof that the write guard actually keeps personal data out of the
 * database: the real `set_memory` tool, the real screening service (a live
 * anonymizer with its NER model loaded), and a real MongoDB.
 *
 * Excluded from CI by the `.manual.spec.` suffix — it needs a screening service on
 * MEMORY_GUARD_URL. Bring one up and run:
 *
 *   python scratchpad/e2e/guard_service.py                       # real anonymizer
 *   MEMORY_GUARD_URL=http://127.0.0.1:8899/v1/classify \
 *   MEMORY_GUARD_TOKEN=e2e-token npx jest guard.live --maxWorkers=1
 */

const WORKING_PROFILE = [
  'Пользователь — юрист отдела аренды, отвечать таблицами со ссылками на пункты договора',
  'Предпочитает краткие ответы на русском языке, без вводных фраз',
  'Специалист по охране труда, нужны ссылки на нормативные акты',
  'Работает в отделе закупок, ведёт тендеры и рамочные соглашения',
];

const PERSONAL_DATA = [
  'Клиент Иван Петров просил перезвонить',
  'Контактный телефон +375291234567',
  'Адрес доставки: г. Минск, ул. Немига, д. 5, кв. 12',
  'Почта для связи: petrov.ivan@example.com',
  'Созвон с Дмитрием Волковым по вторникам',
];

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ReturnType<typeof createMethods>;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  methods = createMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('memory write guard, end to end', () => {
  const tool = () =>
    createMemoryTool({
      userId,
      setMemory: methods.setMemory,
      validKeys: ['preferences', 'context'],
    });

  it('lets every working-profile value through to the database', async () => {
    for (const value of WORKING_PROFILE) {
      const [message] = await tool().func({ key: 'context', value });
      expect(message).not.toContain('Not saved');
    }

    const stored = await methods.getAllUserMemories(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe(WORKING_PROFILE[WORKING_PROFILE.length - 1]);
  }, 60_000);

  it('keeps every personal-data value out of the database', async () => {
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'Юрист отдела аренды',
      tokenCount: 3,
    });

    for (const value of PERSONAL_DATA) {
      const [message, artifact] = await tool().func({ key: 'context', value });
      expect(message).toContain('Not saved');
      const errorArtifact = (artifact as Record<Tools.memory, MemoryArtifact>)[Tools.memory];
      expect(JSON.parse(errorArtifact.value as string).errorType).toBe('personal_data');
    }

    const stored = await methods.getAllUserMemories(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBe('Юрист отдела аренды');
    for (const value of PERSONAL_DATA) {
      expect(stored[0].value).not.toBe(value);
    }
  }, 60_000);

  it('refuses to store anything when the screening service cannot be reached', async () => {
    const url = process.env.MEMORY_GUARD_URL;
    process.env.MEMORY_GUARD_URL = 'http://127.0.0.1:1/v1/classify';

    const verdict = await checkMemoryValue('Юрист отдела аренды');

    expect(verdict.outcome).toBe('unavailable');
    process.env.MEMORY_GUARD_URL = url;
  }, 30_000);
});
