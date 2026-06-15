import analyticsRunSchema from '~/schema/analyticsRun';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type * as t from '~/types';

export function createAnalyticsRunModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(analyticsRunSchema);
  return (
    mongoose.models.AnalyticsRun ||
    mongoose.model<t.IAnalyticsRun>('AnalyticsRun', analyticsRunSchema)
  );
}
