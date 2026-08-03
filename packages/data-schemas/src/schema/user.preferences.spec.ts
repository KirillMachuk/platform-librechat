import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type * as t from '~/types';
import userSchema from '~/schema/user';

let mongoServer: MongoMemoryServer;
let User: mongoose.Model<t.IUser>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  User = mongoose.models.User || mongoose.model<t.IUser>('User', userSchema);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const employeeWithPreferences = async () => {
  const created = await User.create({ email: 'employee@example.com', provider: 'local' });
  await User.findByIdAndUpdate(created._id, {
    $set: { 'preferences.autoScroll': 'true', 'preferences.color-theme': 'dark' },
  });
  return created._id;
};

/**
 * Preferences are stored as a Map, and a Map is invisible to `JSON.stringify` — it
 * serializes to `{}`. Everything that puts a user document on the wire has to flatten it,
 * or an employee's settings arrive empty and the feature silently does nothing.
 */
describe('preferences on the wire', () => {
  it('survives JSON serialization out of a hydrated document', async () => {
    const id = await employeeWithPreferences();
    const hydrated = await User.findById(id);

    const sent = JSON.parse(JSON.stringify(hydrated!.toObject({ flattenMaps: true })));

    expect(sent.preferences).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });

  it('would arrive empty without flattening — the reason the option is there', async () => {
    const id = await employeeWithPreferences();
    const hydrated = await User.findById(id);

    const sent = JSON.parse(JSON.stringify(hydrated!.toObject()));

    expect(sent.preferences).toEqual({});
  });

  it('survives JSON serialization out of a lean query', async () => {
    const id = await employeeWithPreferences();
    const lean = await User.findById(id).lean<t.IUser>();

    const sent = JSON.parse(JSON.stringify(lean));

    expect(sent.preferences).toEqual({ autoScroll: 'true', 'color-theme': 'dark' });
  });
});
