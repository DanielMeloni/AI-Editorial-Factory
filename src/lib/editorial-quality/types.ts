import { z } from 'zod';

export const ARTIFACT_KINDS = [
  'manuscript_content',
  'qa_metadata',
  'evidence',
  'internal_notes',
  'visual_spec',
  'approved_asset',
  'publication_metadata',
] as const;

export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const FORMATTER_ARTIFACT_KINDS = [
  'manuscript_content',
  'approved_asset',
  'publication_metadata',
] as const satisfies readonly ArtifactKind[];

export const DEPTH_LEVELS = ['core', 'guided', 'optional', 'advanced'] as const;
export const depthLevelSchema = z.enum(DEPTH_LEVELS);
export type DepthLevel = z.infer<typeof depthLevelSchema>;

export const audienceProfileSchema = z.object({
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  goal: z.string().trim().min(10).max(2000),
  allowedPrerequisites: z.array(z.string().trim().min(2).max(300)).max(30),
  jargonBudget: z.number().int().min(0).max(100),
  quickWinMaxPages: z.number().int().min(1).max(200),
  advancedContentPolicy: z.enum(['inline', 'callout', 'appendix', 'next_volume']),
  requireUiScreenshots: z.boolean(),
  requireExpectedStateVisuals: z.boolean(),
});

export type AudienceProfile = z.infer<typeof audienceProfileSchema>;

export const entityKindSchema = z.enum([
  'project_display_name',
  'project_id',
  'repository',
  'workspace',
  'dataset',
  'service_account',
  'other',
]);

export const canonicalEntitySchema = z.object({
  id: z.string().min(1).max(100),
  kind: entityKindSchema,
  displayName: z.string().trim().min(1).max(300),
  aliases: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  forbiddenAliases: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
});

export type CanonicalEntity = z.infer<typeof canonicalEntitySchema>;

export const QUALITY_GATE_NAMES = [
  'leakage',
  'completeness',
  'audience_fit',
  'entity_consistency',
  'visual_qa',
  'layout_preflight',
] as const;

export type QualityGateName = (typeof QUALITY_GATE_NAMES)[number];

export interface QualityIssue {
  gate: QualityGateName;
  code: string;
  severity: 'warning' | 'blocking';
  message: string;
  line: number | null;
  excerpt: string | null;
}

export interface QualityGateResult {
  gate: QualityGateName;
  passed: boolean;
  issues: QualityIssue[];
}

export interface PublicationPreflightResult {
  passed: boolean;
  status:
    | 'publishable'
    | 'needs_content_fix'
    | 'needs_source_fix'
    | 'needs_visual_fix'
    | 'needs_layout_fix';
  gates: QualityGateResult[];
  blockingIssues: QualityIssue[];
}

