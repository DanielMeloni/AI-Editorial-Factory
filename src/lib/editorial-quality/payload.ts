import type { ArtifactKind } from './types';
import { FORMATTER_ARTIFACT_KINDS } from './types';

export interface EditorialArtifact<T = unknown> {
  kind: ArtifactKind;
  payload: T;
  approved: boolean;
}

export interface FormatterPayload {
  manuscript: string;
  assets: unknown[];
  metadata: Record<string, unknown>;
}

/**
 * Il formatter riceve una whitelist positiva. Un nuovo artifact kind resta
 * escluso finché questa funzione non viene modificata deliberatamente.
 */
export function buildFormatterPayload(artifacts: EditorialArtifact[]): FormatterPayload {
  const allowed = new Set<ArtifactKind>(FORMATTER_ARTIFACT_KINDS);
  const forbidden = artifacts.filter((artifact) => allowed.has(artifact.kind) && !artifact.approved);
  if (forbidden.length > 0) throw new Error('Il payload contiene artefatti pubblicabili non approvati.');

  const manuscript = artifacts.filter((artifact) => artifact.kind === 'manuscript_content');
  if (manuscript.length !== 1 || typeof manuscript[0]?.payload !== 'string') {
    throw new Error('Il formatter richiede esattamente un MANUSCRIPT_CONTENT approvato.');
  }

  const metadata = artifacts.find((artifact) => artifact.kind === 'publication_metadata');
  return {
    manuscript: manuscript[0].payload,
    assets: artifacts.filter((artifact) => artifact.kind === 'approved_asset').map((artifact) => artifact.payload),
    metadata: metadata && typeof metadata.payload === 'object' && metadata.payload !== null
      ? metadata.payload as Record<string, unknown>
      : {},
  };
}

