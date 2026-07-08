import { Schema } from 'mongoose';
import { Constants } from 'librechat-data-provider';
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
      maxlength: Constants.PROJECT_NAME_MAX_LENGTH as number,
    },
    description: {
      type: String,
      default: '',
      maxlength: Constants.PROJECT_DESCRIPTION_MAX_LENGTH as number,
    },
    instructions: {
      type: String,
      default: '',
      maxlength: Constants.PROJECT_INSTRUCTIONS_MAX_LENGTH as number,
    },
    icon: {
      type: String,
      default: 'Palette',
      maxlength: Constants.PROJECT_ICON_MAX_LENGTH as number,
    },
    color: {
      type: String,
      default: 'pink',
      maxlength: Constants.PROJECT_COLOR_MAX_LENGTH as number,
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
