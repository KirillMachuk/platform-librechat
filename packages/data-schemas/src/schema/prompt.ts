import { Schema } from 'mongoose';
import { Constants } from 'librechat-data-provider';
import type { IPrompt } from '~/types';

const promptSchema: Schema<IPrompt> = new Schema(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      ref: 'PromptGroup',
      required: true,
      index: true,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    prompt: {
      type: String,
      required: true,
      maxlength: [
        Constants.PROMPT_MAX_LENGTH as number,
        `Prompt cannot be longer than ${Constants.PROMPT_MAX_LENGTH} characters`,
      ],
    },
    type: {
      type: String,
      enum: ['text', 'chat'],
      required: true,
    },
    tenantId: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

promptSchema.index({ createdAt: 1, updatedAt: 1 });

export default promptSchema;
