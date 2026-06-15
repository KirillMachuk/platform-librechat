import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import mongoMeili from '~/models/plugins/mongoMeili';
import messageSchema from '~/schema/message';
import {
  MEILI_CREATED_AT_TS_FIELD,
  MESSAGE_MEILI_FILTERABLE_ATTRIBUTES,
  MESSAGE_MEILI_SEARCHABLE_ATTRIBUTES,
} from '~/config/meiliAnalytics';

/**
 * Emit a numeric `createdAtTs` (epoch ms) into the Meili document so the admin
 * analytics search can range-filter by period (Meili cannot reliably range a
 * date string). The raw `createdAt` is only selected to derive this and is then
 * dropped from the indexed document.
 */
function addCreatedAtTs(object: Record<string, unknown>): Record<string, unknown> {
  const createdAt = object.createdAt;
  if (createdAt != null) {
    const ts = new Date(createdAt as string | number | Date).getTime();
    if (!Number.isNaN(ts)) {
      object[MEILI_CREATED_AT_TS_FIELD] = ts;
    }
    delete object.createdAt;
  }
  return object;
}

export function createMessageModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(messageSchema);
  if (process.env.MEILI_HOST && process.env.MEILI_MASTER_KEY) {
    messageSchema.plugin(mongoMeili, {
      mongoose,
      host: process.env.MEILI_HOST,
      apiKey: process.env.MEILI_MASTER_KEY,
      indexName: 'messages',
      primaryKey: 'messageId',
      // Analytics search: tenant-scoped, employee-only, period-filterable feed.
      filterableAttributes: MESSAGE_MEILI_FILTERABLE_ATTRIBUTES,
      searchableAttributes: MESSAGE_MEILI_SEARCHABLE_ATTRIBUTES,
      extraIndexedFields: ['createdAt'],
      transformForIndex: addCreatedAtTs,
    });
  }

  return mongoose.models.Message || mongoose.model<t.IMessage>('Message', messageSchema);
}
