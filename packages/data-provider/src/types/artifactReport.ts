import { z } from 'zod';

export const artifactFormatSchema = z.enum(['pptx', 'docx', 'xlsx', 'pdf', 'csv']);

/**
 * Authenticated Code API download route used for server-owned preview files.
 * Keep this relative and exact: artifact reports originate in an LLM sandbox,
 * so an arbitrary URL must never become a browser fetch target.
 */
export const safeArtifactPreviewPathSchema = z
  .string()
  .regex(
    /^\/(?:[A-Za-z0-9._~-]+\/)*api\/files\/code\/download\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{21}$/,
    'Preview filepath must be an authenticated same-origin Code API path',
  );

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
    delivery: z.enum(['preview_only', 'requested']).optional(),
    filepath: safeArtifactPreviewPathSchema.optional(),
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
    qaChecks: z.array(artifactQACheckSchema).min(1),
    issues: z.array(artifactIssueSchema),
    changeLog: z.array(artifactChangeSchema),
    skillVersion: z.string().min(1),
    repairIterations: z.number().int().min(0).max(2),
  })
  .passthrough()
  .superRefine((report, context) => {
    if (report.status !== 'ready') {
      return;
    }

    const hasFailedCheck = report.qaChecks.some((check) => check.status === 'failed');
    const hasCriticalIssue = report.issues.some((issue) => issue.severity === 'critical');
    if (!hasFailedCheck && !hasCriticalIssue) {
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['status'],
      message: 'Ready reports cannot contain failed QA checks or critical issues',
    });
  });

export type TArtifactFormat = z.infer<typeof artifactFormatSchema>;
export type TArtifactJob = z.infer<typeof artifactJobSchema>;
export type TArtifactPreviewAsset = z.infer<typeof artifactPreviewAssetSchema>;
export type TArtifactQACheck = z.infer<typeof artifactQACheckSchema>;
export type TArtifactIssue = z.infer<typeof artifactIssueSchema>;
export type TArtifactChange = z.infer<typeof artifactChangeSchema>;
export type TArtifactReport = z.infer<typeof artifactReportSchema>;

/**
 * Return the trusted rendered preview for an editable presentation.
 * The server injects `filepath` only after matching the report asset to an
 * actual output from the same tool call; the schema additionally constrains
 * it to the authenticated same-origin download route.
 */
export function getVerifiedPresentationPreviewAsset(
  report: TArtifactReport | null | undefined,
): TArtifactPreviewAsset | undefined {
  if (report?.format !== 'pptx') {
    return undefined;
  }

  return report.previewAssets.find(
    (asset) =>
      asset.kind === 'pdf' &&
      typeof asset.filepath === 'string' &&
      safeArtifactPreviewPathSchema.safeParse(asset.filepath).success,
  );
}
