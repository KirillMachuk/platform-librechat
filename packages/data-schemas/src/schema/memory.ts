import { Schema } from 'mongoose';
import type { IMemoryEntry } from '~/types/memory';

/**
 * Memory entries are the one store that outlives the conversation retention sweep, so
 * without an expiry a profile written once is replayed forever. The window is the same
 * year conversations get, and it slides: every write refreshes `updated_at`, so an
 * active profile never expires and an abandoned account's does.
 */
const MEMORY_RETENTION_SECONDS = 365 * 24 * 60 * 60;

const MemoryEntrySchema: Schema<IMemoryEntry> = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true,
  },
  key: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => /^[a-z_]+$/.test(v),
      message: 'Key must only contain lowercase letters and underscores',
    },
  },
  value: {
    type: String,
    required: true,
  },
  tokenCount: {
    type: Number,
    default: 0,
  },
  updated_at: {
    type: Date,
    default: Date.now,
    expires: MEMORY_RETENTION_SECONDS,
  },
  tenantId: {
    type: String,
    index: true,
  },
});

export default MemoryEntrySchema;
