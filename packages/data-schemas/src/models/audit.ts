import auditLogSchema from '~/schema/audit';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type * as t from '~/types';

export function createAuditLogModel(mongoose: typeof import('mongoose')) {
  applyTenantIsolation(auditLogSchema);
  return mongoose.models.AuditLog || mongoose.model<t.IAuditLog>('AuditLog', auditLogSchema);
}
