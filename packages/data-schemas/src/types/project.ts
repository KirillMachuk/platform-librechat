import type { Document } from 'mongoose';

export interface IProject extends Document {
  projectId: string;
  user: string;
  name: string;
  description?: string;
  instructions?: string;
  icon?: string;
  color?: string;
  tenantId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}
