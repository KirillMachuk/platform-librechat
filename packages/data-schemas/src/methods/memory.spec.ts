import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createMemoryMethods } from './memory';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

/** Same window conversations get, so a profile cannot outlive the chats it came from. */
const EXPECTED_RETENTION_SECONDS = 365 * 24 * 60 * 60;

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: ReturnType<typeof createMemoryMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  methods = createMemoryMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
  await mongoose.models.MemoryEntry.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('memory retention', () => {
  const userId = new mongoose.Types.ObjectId();

  it('expires an entry a year after its last write', async () => {
    const indexes = await mongoose.models.MemoryEntry.collection.indexes();
    const ttlIndex = indexes.find((index) => index.expireAfterSeconds != null);

    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.key).toEqual({ updated_at: 1 });
    expect(ttlIndex?.expireAfterSeconds).toBe(EXPECTED_RETENTION_SECONDS);
  });

  it('slides the expiry forward on every write, so an active profile never expires', async () => {
    await methods.setMemory({ userId, key: 'context', value: 'Lease lawyer', tokenCount: 3 });
    const [first] = await methods.getAllUserMemories(userId);
    const firstWrite = new Date(first.updated_at!).getTime();

    await new Promise((resolve) => setTimeout(resolve, 10));
    await methods.setMemory({
      userId,
      key: 'context',
      value: 'Lease lawyer, now also procurement',
      tokenCount: 6,
    });
    const [second] = await methods.getAllUserMemories(userId);

    expect(new Date(second.updated_at!).getTime()).toBeGreaterThan(firstWrite);
  });
});
