import mongoose, { Schema } from 'mongoose';
import type { IMessage } from '~/types/message';

const messageSchema: Schema<IMessage> = new Schema(
  {
    messageId: {
      type: String,
      required: true,
      index: true,
      meiliIndex: true,
    },
    conversationId: {
      type: String,
      index: true,
      required: true,
      meiliIndex: true,
    },
    user: {
      type: String,
      index: true,
      required: true,
      default: null,
      meiliIndex: true,
    },
    model: {
      type: String,
      default: null,
    },
    endpoint: {
      type: String,
    },
    conversationSignature: {
      type: String,
    },
    clientId: {
      type: String,
    },
    invocationId: {
      type: Number,
    },
    parentMessageId: {
      type: String,
    },
    tokenCount: {
      type: Number,
    },
    summaryTokenCount: {
      type: Number,
    },
    sender: {
      type: String,
      meiliIndex: true,
    },
    text: {
      type: String,
      meiliIndex: true,
    },
    summary: {
      type: String,
    },
    isCreatedByUser: {
      type: Boolean,
      required: true,
      default: false,
      // Indexed (filter-only) so the admin analytics search can return only
      // employee requests. See MESSAGE_MEILI_SEARCHABLE_ATTRIBUTES — it is kept
      // out of searchable attributes so its value can't pollute relevance.
      meiliIndex: true,
    },
    isTemporary: {
      type: Boolean,
      default: false,
    },
    unfinished: {
      type: Boolean,
      default: false,
    },
    error: {
      type: Boolean,
      default: false,
    },
    finish_reason: {
      type: String,
    },
    feedback: {
      type: {
        rating: {
          type: String,
          enum: ['thumbsUp', 'thumbsDown'],
          required: true,
        },
        tag: {
          type: mongoose.Schema.Types.Mixed,
          required: false,
        },
        text: {
          type: String,
          required: false,
        },
      },
      default: undefined,
      required: false,
    },
    _meiliIndex: {
      type: Boolean,
      required: false,
      select: false,
      default: false,
    },
    files: { type: [{ type: mongoose.Schema.Types.Mixed }], default: undefined },
    content: {
      type: [{ type: mongoose.Schema.Types.Mixed }],
      default: undefined,
      meiliIndex: true,
    },
    thread_id: {
      type: String,
    },
    /* frontend components */
    iconURL: {
      type: String,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    contextMeta: {
      type: {
        calibrationRatio: { type: Number },
        encoding: { type: String },
      },
      _id: false,
      default: undefined,
    },
    attachments: { type: [{ type: mongoose.Schema.Types.Mixed }], default: undefined },
    /**
     * Skill names the user invoked manually via the `$` popover on this turn.
     * UI metadata only — `SkillPills` on the frontend renders these on
     * the user message bubble so the selection persists through reload and
     * shows in history. Runtime skill resolution lives separately on the
     * request body, not on the message itself.
     */
    manualSkills: { type: [String], default: undefined },
    /**
     * Skill names auto-primed on this turn because their frontmatter declares
     * `always-apply: true`. Persisted at turn time (not reconstructed on
     * render) because `Skill.alwaysApply` is mutable — if an admin flips the
     * flag off later, historical turns must still show the pinned badges on
     * the user bubble to preserve the audit trail of what actually ran.
     */
    alwaysAppliedSkills: { type: [String], default: undefined },
    /**
     * Machine-readable Deep-Research provenance (task #21): which DR artifact this
     * message IS ('plan' card, 'clarify' questions, user 'start'/'cancel' command,
     * final 'report'). Set only by the DR runner at message creation. The client mounts
     * cards and the backend routes follow-ups on this field — display text alone must
     * never be able to arm live controls or route a turn into Deep Research.
     */
    drKind: {
      type: String,
      enum: ['plan', 'clarify', 'start', 'cancel', 'report'],
      default: undefined,
    },
    /*
    attachments: {
      type: [
        {
          file_id: String,
          filename: String,
          filepath: String,
          expiresAt: Date,
          width: Number,
          height: Number,
          type: String,
          conversationId: String,
          messageId: {
            type: String,
            required: true,
          },
          toolCallId: String,
        },
      ],
      default: undefined,
    },
    */
    expiredAt: {
      type: Date,
    },
    addedConvo: {
      type: Boolean,
      default: undefined,
    },
    tenantId: {
      type: String,
      index: true,
      // Indexed (filter-only) so the admin analytics search can stay
      // tenant-isolated: Meili queries bypass the Mongoose tenant middleware,
      // so cross-user search MUST filter on this attribute explicitly.
      meiliIndex: true,
    },
  },
  { timestamps: true },
);

messageSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });
messageSchema.index({ createdAt: 1 });
messageSchema.index({ messageId: 1, user: 1, tenantId: 1 }, { unique: true });

// AI usage analytics: feed of user requests (newest first) and per-employee filter.
// Lead with the always-present equality field so the createdAt sort is index-served.
// When multitenancy ships and every query carries tenantId, add tenant-prefixed variants.
messageSchema.index({ isCreatedByUser: 1, createdAt: -1 });
messageSchema.index({ user: 1, isCreatedByUser: 1, createdAt: -1 });

// index for MeiliSearch sync operations
messageSchema.index({ _meiliIndex: 1, isTemporary: 1, expiredAt: 1 });

export default messageSchema;
