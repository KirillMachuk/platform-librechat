import { Schema } from 'mongoose';
import type { IProject } from '~/types';

const projectSchema: Schema<IProject> = new Schema(
  {
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    user: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: '',
    },
    instructions: {
      type: String,
      default: '',
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  { timestamps: true },
);

projectSchema.index({ projectId: 1, user: 1, tenantId: 1 }, { unique: true });
projectSchema.index({ user: 1, updatedAt: -1 });

export default projectSchema;
