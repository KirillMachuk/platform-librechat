import { z } from 'zod';

export const artifactFormatSchema = z.enum(['pptx', 'docx', 'xlsx', 'pdf', 'csv']);

export const artifactJobSchema = z
  .object({
    format: artifactFormatSchema,
    audience: z.string().min(1),
    goal: z.string().min(1),
    sourceFileIds: z.array(z.string()),
    templateFileId: z.string().optional(),
    immutableElements: z.array(z.string()),
    locale: z.string().min(2),
    filename: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
  })
  .passthrough()
  .superRefine((job, context) => {
    if (!job.filename.toLowerCase().endsWith(`.${job.format}`)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['filename'],
        message: `Filename must end in .${job.format}`,
      });
    }
  });

export const artifactPreviewAssetSchema = z
  .object({
    filename: z.string().min(1),
    kind: z.enum(['pdf', 'image']),
  })
  .passthrough();

export const artifactQACheckSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(['passed', 'warning', 'failed']),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  })
  .passthrough();

export const artifactIssueSchema = z
  .object({
    code: z.string().min(1),
    severity: z.enum(['warning', 'critical']),
    message: z.string().min(1),
    target: z.string().optional(),
  })
  .passthrough();

export const artifactChangeSchema = z
  .object({
    target: z.string().min(1),
    summary: z.string().min(1),
  })
  .passthrough();

/**
 * Optional metadata emitted next to an authored file. Every object is
 * passthrough by design: clients may read known fields, but must preserve
 * unknown optional fields added by newer artifact skills.
 */
export const artifactReportSchema = z
  .object({
    status: z.enum(['ready', 'needs_review']),
    format: artifactFormatSchema,
    sourceFileIds: z.array(z.string()),
    previewAssets: z.array(artifactPreviewAssetSchema),
    qaChecks: z.array(artifactQACheckSchema),
    issues: z.array(artifactIssueSchema),
    changeLog: z.array(artifactChangeSchema),
    skillVersion: z.string().min(1),
    repairIterations: z.number().int().min(0).max(2),
  })
  .passthrough();

export type TArtifactFormat = z.infer<typeof artifactFormatSchema>;
export type TArtifactJob = z.infer<typeof artifactJobSchema>;
export type TArtifactPreviewAsset = z.infer<typeof artifactPreviewAssetSchema>;
export type TArtifactQACheck = z.infer<typeof artifactQACheckSchema>;
export type TArtifactIssue = z.infer<typeof artifactIssueSchema>;
export type TArtifactChange = z.infer<typeof artifactChangeSchema>;
export type TArtifactReport = z.infer<typeof artifactReportSchema>;
