import analyticsAssignmentSchema from '~/schema/analyticsAssignment';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type * as t from '~/types';

export function createAnalyticsAssignmentModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(analyticsAssignmentSchema);
  return (
    mongoose.models.AnalyticsAssignment ||
    mongoose.model<t.IAnalyticsAssignment>('AnalyticsAssignment', analyticsAssignmentSchema)
  );
}
