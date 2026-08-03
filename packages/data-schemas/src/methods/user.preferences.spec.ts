import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type * as t from '~/types';
import { createUserMethods } from './user';
import userSchema from '~/schema/user';

let mongoServer: MongoMemoryServer;
let User: mongoose.Model<t.IUser>;
let methods: ReturnType<typeof createUserMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  User = mongoose.models.User || mongoose.model<t.IUser>('User', userSchema);
  methods = createUserMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const createEmployee = async () => {
  const user = await User.create({ email: 'employee@example.com', provider: 'local' });
  return user._id.toString();
};

const readPreferences = async (userId: string) => {
  const user = await User.findById(userId).lean<t.IUser>();
  const raw = user?.preferences as unknown;
  return raw instanceof Map ? Object.fromEntries(raw) : raw;
};

describe('updateUserPreferences', () => {
  it('stores settings for an account that has never saved any', async () => {
    const userId = await createEmployee();

    await methods.updateUserPreferences(userId, { autoScroll: 'true', 'color-theme': 'dark' });

    expect(await readPreferences(userId)).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });

  it('merges by key, so a second device does not wipe what the first one saved', async () => {
    const userId = await createEmployee();
    await methods.updateUserPreferences(userId, { autoScroll: 'true', enterToSend: 'false' });

    await methods.updateUserPreferences(userId, { 'color-theme': 'dark' });

    expect(await readPreferences(userId)).toEqual({
      autoScroll: 'true',
      enterToSend: 'false',
      'color-theme': 'dark',
    });
  });

  it('lets a later write replace the value of a key it does send', async () => {
    const userId = await createEmployee();
    await methods.updateUserPreferences(userId, { 'color-theme': 'dark' });

    await methods.updateUserPreferences(userId, { 'color-theme': 'light' });

    expect(await readPreferences(userId)).toEqual({ 'color-theme': 'light' });
  });

  it('keeps what is saved when there is nothing to change', async () => {
    const userId = await createEmployee();
    await methods.updateUserPreferences(userId, { autoScroll: 'true' });

    const user = await methods.updateUserPreferences(userId, {});

    expect(user).not.toBeNull();
    expect(await readPreferences(userId)).toEqual({ autoScroll: 'true' });
  });

  it('returns the merged settings to the caller, not just the ones it sent', async () => {
    const userId = await createEmployee();
    await methods.updateUserPreferences(userId, { autoScroll: 'true' });

    const user = await methods.updateUserPreferences(userId, { enterToSend: 'false' });
    const raw = user?.preferences as unknown;
    const merged = raw instanceof Map ? Object.fromEntries(raw) : raw;

    expect(merged).toEqual({ autoScroll: 'true', enterToSend: 'false' });
  });

  it('reports a missing account rather than creating one', async () => {
    const strangerId = new mongoose.Types.ObjectId().toString();

    const user = await methods.updateUserPreferences(strangerId, { autoScroll: 'true' });

    expect(user).toBeNull();
    expect(await User.countDocuments({})).toBe(0);
  });

  it('does not touch settings belonging to another employee', async () => {
    const first = await createEmployee();
    const second = (
      await User.create({ email: 'second@example.com', provider: 'local' })
    )._id.toString();
    await methods.updateUserPreferences(first, { 'color-theme': 'dark' });

    await methods.updateUserPreferences(second, { 'color-theme': 'light' });

    expect(await readPreferences(first)).toEqual({ 'color-theme': 'dark' });
    expect(await readPreferences(second)).toEqual({ 'color-theme': 'light' });
  });
});
