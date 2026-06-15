import analyticsTopicSchema from '~/schema/analyticsTopic';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type * as t from '~/types';

export function createAnalyticsTopicModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(analyticsTopicSchema);
  return (
    mongoose.models.AnalyticsTopic ||
    mongoose.model<t.IAnalyticsTopic>('AnalyticsTopic', analyticsTopicSchema)
  );
}
