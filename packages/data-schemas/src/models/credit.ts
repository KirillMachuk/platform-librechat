import { Model } from 'mongoose';
import { creditMonthSchema, creditPackageSchema, creditSpendSchema } from '~/schema/credit';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import type * as t from '~/types';

export function createCreditMonthModel(
  mongoose: typeof import('mongoose'),
): Model<t.ICreditMonth> {
  applyTenantIsolation(creditMonthSchema);
  return (
    mongoose.models.CreditMonth || mongoose.model<t.ICreditMonth>('CreditMonth', creditMonthSchema)
  );
}

export function createCreditPackageModel(
  mongoose: typeof import('mongoose'),
): Model<t.ICreditPackage> {
  applyTenantIsolation(creditPackageSchema);
  return (
    mongoose.models.CreditPackage ||
    mongoose.model<t.ICreditPackage>('CreditPackage', creditPackageSchema)
  );
}

export function createCreditSpendModel(
  mongoose: typeof import('mongoose'),
): Model<t.ICreditSpend> {
  applyTenantIsolation(creditSpendSchema);
  return (
    mongoose.models.CreditSpend || mongoose.model<t.ICreditSpend>('CreditSpend', creditSpendSchema)
  );
}
