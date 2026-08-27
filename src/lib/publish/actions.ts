'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { recordAudit } from '@/lib/security/audit';
import { checkRateLimit } from '@/lib/security/rate-limit';
import type { Citation, ExportMeta } from './markdown';
import { exportHtml } from './html';
import { exportVolumePdf, exportVolumePdfLineare, type VolumeChapterInput, type VolumeMeta } from './pdf';
import { exportEpub } from './epub';
import { deriveArticle, deriveLesson } from './derivations';
import { loadChapterPdfDesign, rebuildVolumePreviewWith, type EsitoAnteprima } from './preview';
import { scegliVersioneCompleta, type VersioneComponibile } from './volume';
import {
  audienceProfileSchema,
  buildFormatterPayload,
  inspectGeneratedPdf,
  runPublicationPreflight,
} from '@/lib/editorial-quality';

/**
 * Produzione degli output editoriali.
 *
 * Si esporta soltanto da una versione **approvata**: il senso del gate umano
 * della Fase 4 verrebbe meno se si potesse pubblicare una proposta non
 * approvata.
 *
 * I file finiscono in un bucket privato e si scaricano tramite URL firmati a
 * breve scadenza.
 */

export interface PublishResult {
  ok: boolean;
  message: string;
  exportId?: string;
}

export interface DeleteExportResult {
  ok: boolean;
  message: string;
}

const FORMATI = ['pdf', 'epub', 'html'] as const;
export type ExportFormat = (typeof FORMATI)[number];

const requestSchema = z.object({
  chapterId: z.string().uuid(),
  formats: z.array(z.enum(FORMATI)).min(1, 'Scegli almeno un formato'),
  includeDerivations: z.boolean().default(true),
});

const CONTENT_TYPE: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  html: 'text/html; charset=utf-8',
};

const ESTENSIONE: Record<ExportFormat, string> = {
  pdf: 'pdf',
  epub: 'epub',
  html: 'html',
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function publishChapter(input: {
  chapterId: string;
  formats: ExportFormat[];
  includeDerivations?: boolean;
}): Promise<PublishResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]!.message };

  const supabase = await createClient();

  // ---------------------------------------------------------------------
  // Capitolo, progetto e versione corrente
  // ---------------------------------------------------------------------
  const { data: chapter } = await supabase
    .from('chapters')
    .select('id, project_id, organization_id, number, label, title, status, current_version_id')
    .eq('id', parsed.data.chapterId)
    .maybeSingle<{
      id: string;
      project_id: string;
      organization_id: string;
      number: number | null;
      label: string | null;
      title: string;
      status: string;
      current_version_id: string | null;
    }>();

  if (!chapter || chapter.organization_id !== organization.id) {
    return { ok: false, message: 'Capitolo non trovato.' };
  }
  if (!chapter.current_version_id) {
    return { ok: false, message: 'Il capitolo non ha una versione corrente da esportare.' };
  }

  const { data: versions, error: versionsError } = await supabase
    .from('chapter_versions')
    .select(
      'id, chapter_id, version_no, content_md, origin, is_approved, word_count, parent_version_id',
    )
    .eq('chapter_id', chapter.id)
    .returns<(VersioneComponibile & { origin: string; is_approved: boolean })[]>();

  if (versionsError) {
    return { ok: false, message: `Lettura delle versioni fallita: ${versionsError.message}` };
  }
  const version = scegliVersioneCompleta(chapter.id, chapter.current_version_id, versions ?? []);
  if (!version) return { ok: false, message: 'Nessuna versione completa del capitolo reperibile.' };

  // Il gate umano della Fase 4 sarebbe inutile se si potesse esportare una
  // proposta non approvata.
  const versioneConStato = (versions ?? []).find((candidate) => candidate.id === version.id);
  if (
    !['approved', 'published'].includes(chapter.status) ||
    !versioneConStato?.is_approved
  ) {
    return {
      ok: false,
      message:
        'Pubblicazione bloccata: il capitolo e la versione corrente devono essere approvati esplicitamente.',
    };
  }

  const limite = await checkRateLimit(supabase, 'exportRun', organization.id);
  if (!limite.allowed) return { ok: false, message: limite.message };

  const { data: project } = await supabase
    .from('projects')
    .select('title, subtitle, author, volume, audience_profile')
    .eq('id', chapter.project_id)
    .maybeSingle<{
      title: string;
      subtitle: string | null;
      author: string;
      volume: string | null;
      audience_profile: unknown;
    }>();

  const { data: citazioni } = await supabase
    .from('citations')
    .select('url, title, publisher, is_official')
    .eq('chapter_id', chapter.id)
    .returns<
      { url: string; title: string | null; publisher: string | null; is_official: boolean }[]
    >();

  const citations: Citation[] = (citazioni ?? []).map((c) => ({
    url: c.url,
    title: c.title,
    publisher: c.publisher,
    isOfficial: c.is_official,
  }));

  const meta: ExportMeta = {
    title: chapter.title,
    chapterNumber: chapter.number,
    chapterLabel: chapter.label
      ? chapter.number === null
        ? `Appendice ${chapter.label}`
        : `Capitolo ${chapter.label}`
      : null,
    author: project?.author ?? '',
    projectTitle: project?.title ?? '',
    volume: project?.volume ?? null,
    versionNo: version.version_no,
    exportedAt: new Date().toISOString(),
  };
  const designPdf = await loadChapterPdfDesign(
    supabase,
    chapter.project_id,
    project?.title ?? '',
    chapter.id,
    { approvedOnly: true },
  );
  const audienceProfile = audienceProfileSchema.safeParse(project?.audience_profile);
  const preflight = runPublicationPreflight({
    manuscript: version.content_md,
    audienceProfile: audienceProfile.success ? audienceProfile.data : null,
    requireAudienceProfile: true,
    visuals: designPdf.figures.map((figure) => ({
      kind: figure.mermaidSource ? 'diagram' as const : 'illustration' as const,
      title: figure.title ?? figure.caption ?? 'Asset senza titolo',
      labels: figure.mermaidSource
        ? Array.from(figure.mermaidSource.matchAll(/\[([^\]]+)\]/g), (match) => match[1] ?? '')
        : [],
      altText: figure.altText,
      approved: true,
    })),
  });
  if (!preflight.passed) {
    const dettaglio = preflight.blockingIssues
      .slice(0, 3)
      .map((item) => `${item.line ? `riga ${item.line}: ` : ''}${item.message}`)
      .join(' · ');
    return {
      ok: false,
      message: `Pubblicazione bloccata dal preflight (${preflight.status}): ${dettaglio}`,
    };
  }
  const formatterPayload = buildFormatterPayload([
    { kind: 'manuscript_content', payload: sanitizzaContenutoExport(version.content_md), approved: true },
    ...designPdf.figures.map((figure) => ({ kind: 'approved_asset' as const, payload: figure, approved: true })),
    { kind: 'publication_metadata', payload: meta, approved: true },
  ]);
  const contenutoCompleto = formatterPayload.manuscript;

  // ---------------------------------------------------------------------
  // Derivazioni
  // ---------------------------------------------------------------------
  const outputIds: string[] = [];

  if (parsed.data.includeDerivations) {
    const lezione = deriveLesson(contenutoCompleto, {
      title: chapter.title,
      chapterLabel: meta.chapterLabel,
    });
    const articolo = deriveArticle(contenutoCompleto, {
      title: chapter.title,
      author: meta.author,
      projectTitle: meta.projectTitle,
    });

    for (const [kind, titolo, contenuto, extra] of [
      ['lesson', lezione.title, lezione, { pending: lezione.pendingAuthoring }],
      ['article', articolo.title, articolo, { slug: articolo.slug, seo: articolo.seo }],
    ] as const) {
      const { data } = await supabase
        .from('publication_outputs')
        .insert({
          project_id: chapter.project_id,
          organization_id: organization.id,
          chapter_id: chapter.id,
          chapter_version_id: version.id,
          kind,
          title: titolo,
          slug: kind === 'article' ? articolo.slug : null,
          meta: extra,
          content: contenuto,
          created_by: user.id,
        })
        .select('id')
        .single<{ id: string }>();

      if (data) outputIds.push(data.id);
    }
  }

  // ---------------------------------------------------------------------
  // File
  // ---------------------------------------------------------------------
  const base = `${organization.id}/${chapter.project_id}/exports/${chapter.id}/v${version.version_no}`;
  const nomeFile = `${(chapter.label ?? String(chapter.number ?? 'capitolo')).replace(/[^\w-]/g, '')}-${
    meta.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 50) || 'capitolo'
  }`;

  const errori: string[] = [];
  let ultimoExportId: string | undefined;

  for (const formato of parsed.data.formats) {
    const { data: exportRow, error: exportInsertError } = await supabase
      .from('exports')
      .insert({
        project_id: chapter.project_id,
        organization_id: organization.id,
        chapter_id: chapter.id,
        publication_output_id: null,
        format: formato,
        status: 'running',
        storage_bucket: 'publication-exports',
        requested_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (!exportRow) {
      errori.push(`${formato}: ${exportInsertError?.message ?? 'registrazione non riuscita'}`);
      continue;
    }

    try {
      let bytes: Uint8Array;

      switch (formato) {
        case 'html': {
          const esito = await exportHtml(contenutoCompleto, meta, { citations });
          bytes = new TextEncoder().encode(esito.html);
          break;
        }
        case 'pdf':
          bytes = await exportPdfRobusto(contenutoCompleto, meta, citations, designPdf);
          break;
        case 'epub':
          bytes = await exportEpub(contenutoCompleto, meta, { citations });
          break;
      }

      const percorso = `${base}/${nomeFile}.${ESTENSIONE[formato]}`;
      let pdfReport: Awaited<ReturnType<typeof inspectGeneratedPdf>> | null = null;

      if (formato === 'pdf') {
        const { data: previous } = await supabase
          .from('render_snapshots')
          .select('rendered_pages')
          .eq('project_id', chapter.project_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle<{ rendered_pages: unknown }>();
        const previousPages = Array.isArray(previous?.rendered_pages)
          ? previous.rendered_pages as Array<{ page: number; textHash: string }>
          : [];
        pdfReport = await inspectGeneratedPdf(bytes, previousPages);

        await supabase.from('quality_gate_results').insert({
          organization_id: organization.id,
          project_id: chapter.project_id,
          chapter_id: chapter.id,
          chapter_version_id: version.id,
          export_id: exportRow.id,
          gate: 'layout_preflight',
          status: pdfReport.passed ? 'passed' : 'failed',
          blocking_issues: pdfReport.issues.filter((issue) => issue.severity === 'blocking'),
          warnings: pdfReport.issues.filter((issue) => issue.severity === 'warning'),
        });
        if (!pdfReport.passed) {
          const detail = pdfReport.issues.slice(0, 3).map((issue) => issue.message).join(' · ');
          throw new Error(`PDF non pubblicabile: ${detail}`);
        }
      }

      const { error: uploadError } = await supabase.storage
        .from('publication-exports')
        .upload(percorso, bytes, { contentType: CONTENT_TYPE[formato], upsert: true });

      if (uploadError) throw new Error(uploadError.message);

      await supabase
        .from('exports')
        .update({
          status: 'ready',
          storage_path: percorso,
          byte_size: bytes.byteLength,
          checksum: await sha256Hex(bytes),
          preflight_status: formato === 'pdf' ? 'passed' : 'not_applicable',
          completed_at: new Date().toISOString(),
        })
        .eq('id', exportRow.id);

      if (pdfReport) {
        await supabase.from('render_snapshots').insert({
          organization_id: organization.id,
          project_id: chapter.project_id,
          export_id: exportRow.id,
          storage_bucket: 'publication-exports',
          storage_path: percorso,
          checksum: pdfReport.checksum,
          page_count: pdfReport.pageCount,
          rendered_pages: pdfReport.pages,
          visual_qa_status: 'passed',
          preflight_report: {
            issues: pdfReport.issues,
            changedPages: pdfReport.changedPages,
          },
        });
      }

      ultimoExportId = exportRow.id;
    } catch (error) {
      const messaggio = error instanceof Error ? error.message : String(error);
      // Un formato fallito non compromette gli altri.
      console.error(`Esportazione ${formato} fallita`, messaggio);
      await supabase
        .from('exports')
        .update({
          status: 'failed',
          preflight_status: formato === 'pdf' ? 'failed' : 'not_applicable',
          error: messaggio,
          completed_at: new Date().toISOString(),
        })
        .eq('id', exportRow.id);
      errori.push(`${formato}: ${messaggio}`);
    }
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'chapter.published',
    entityType: 'chapter',
    entityId: chapter.id,
    metadata: {
      formats: parsed.data.formats,
      versionNo: version.version_no,
      outputs: outputIds.length,
    },
  });

  revalidatePath(`/projects/${chapter.project_id}/exports`);

  const riusciti = parsed.data.formats.length - errori.length;

  return {
    ok: riusciti > 0,
    exportId: ultimoExportId,
    message:
      errori.length === 0
        ? `${riusciti} formati esportati dalla versione ${version.version_no}.`
        : `${riusciti} formati esportati. Non riusciti: ${errori.join(', ')}.`,
  };
}

function sanitizzaContenutoExport(markdown: string): string {
  return markdown
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\S{72,}/g, (token) => token.match(/.{1,48}/g)?.join('\u200b') ?? token);
}

async function exportPdfRobusto(
  contentMd: string,
  meta: ExportMeta,
  citations: Citation[],
  design: Awaited<ReturnType<typeof loadChapterPdfDesign>>,
): Promise<Uint8Array> {
  const capitolo: VolumeChapterInput = {
    label: meta.chapterLabel ?? '',
    title: meta.title,
    contentMd,
    versionNo: meta.versionNo,
    approved: true,
    figures: design.figures,
    citations,
  };
  const volumeMeta: VolumeMeta = {
    projectTitle: meta.projectTitle,
    volumeTitle: design.volumeTitle ?? meta.projectTitle,
    subtitle: design.subtitle,
    author: meta.author,
    volume: meta.volume,
    toolLogoDataUrl: design.toolLogoDataUrl,
    accentColor: design.accentColor,
    generatedAt: new Date(meta.exportedAt).toLocaleString('it-IT'),
    pending: 0,
    drafts: 0,
  };

  try {
    return await exportVolumePdf([capitolo], volumeMeta, { chapterExtract: true });
  } catch (error) {
    if (
      !/unsupported number|invalid image|unsupported image|image data/i.test(errorMessage(error))
    ) {
      throw error;
    }
  }

  try {
    return await exportVolumePdf([{ ...capitolo, figures: [] }], volumeMeta, { chapterExtract: true });
  } catch (error) {
    if (
      !/unsupported number|invalid image|unsupported image|image data/i.test(errorMessage(error))
    ) {
      throw error;
    }
    return exportVolumePdfLineare([{ ...capitolo, figures: [] }], volumeMeta, {
      chapterExtract: true,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** URL di download a breve scadenza. I bucket restano privati. */
export async function getExportDownloadUrl(exportId: string): Promise<string | null> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data } = await supabase
    .from('exports')
    .select('storage_bucket, storage_path, organization_id, status')
    .eq('id', exportId)
    .maybeSingle<{
      storage_bucket: string;
      storage_path: string | null;
      organization_id: string;
      status: string;
    }>();

  if (!data?.storage_path || data.organization_id !== organization.id || data.status !== 'ready') {
    return null;
  }

  const { data: firmato } = await supabase.storage
    .from(data.storage_bucket)
    .createSignedUrl(data.storage_path, 120, { download: true });

  return firmato?.signedUrl ?? null;
}

/**
 * Elimina una singola esportazione e, se non è condiviso da altre righe,
 * anche il file conservato nello Storage privato.
 */
export async function deleteExport(exportId: string): Promise<DeleteExportResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  const parsed = z.string().uuid().safeParse(exportId);
  if (!parsed.success) return { ok: false, message: 'Esportazione non valida.' };

  const supabase = await createClient();
  const { data: esportazione, error: readError } = await supabase
    .from('exports')
    .select('id, project_id, organization_id, format, status, storage_bucket, storage_path')
    .eq('id', parsed.data)
    .maybeSingle<{
      id: string;
      project_id: string;
      organization_id: string;
      format: string;
      status: string;
      storage_bucket: string;
      storage_path: string | null;
    }>();

  if (readError) {
    return { ok: false, message: `Lettura dell’esportazione fallita: ${readError.message}` };
  }
  if (!esportazione || esportazione.organization_id !== organization.id) {
    return { ok: false, message: 'Esportazione non trovata.' };
  }
  if (esportazione.status === 'running') {
    return {
      ok: false,
      message: 'Non puoi eliminare un’esportazione in corso. Attendi il termine o interrompi prima il processo.',
    };
  }

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'export.deleted',
    entityType: 'export',
    entityId: esportazione.id,
    metadata: {
      projectId: esportazione.project_id,
      format: esportazione.format,
      status: esportazione.status,
    },
  });

  const { error: deleteError } = await supabase
    .from('exports')
    .delete()
    .eq('id', esportazione.id)
    .eq('organization_id', organization.id);

  if (deleteError) {
    return { ok: false, message: `Eliminazione non riuscita: ${deleteError.message}` };
  }

  let storageWarning = false;
  if (esportazione.storage_path) {
    const { count, error: referenceError } = await supabase
      .from('exports')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization.id)
      .eq('storage_bucket', esportazione.storage_bucket)
      .eq('storage_path', esportazione.storage_path);

    if (referenceError) {
      storageWarning = true;
    } else if ((count ?? 0) === 0) {
      const { error: storageError } = await supabase.storage
        .from(esportazione.storage_bucket)
        .remove([esportazione.storage_path]);
      storageWarning = storageError !== null;
    }
  }

  revalidatePath(`/projects/${esportazione.project_id}/exports`);
  return {
    ok: true,
    message: storageWarning
      ? 'Esportazione eliminata dall’elenco. Il file privato non è stato rimosso dallo Storage e potrà essere ripulito in seguito.'
      : 'Esportazione eliminata definitivamente.',
  };
}

// ---------------------------------------------------------------------------
// Anteprima del volume
// ---------------------------------------------------------------------------

/**
 * Ricostruisce l'anteprima su richiesta.
 *
 * Il workflow la aggiorna da solo a ogni capitolo convalidato; questo pulsante
 * serve quando si è cambiato qualcosa fuori dal workflow — una modifica manuale,
 * la bibliografia rigenerata — e si vuole rivedere il volume senza avviare un
 * audit.
 */
export async function rebuildVolumePreview(projectId: string): Promise<EsitoAnteprima> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const esito = await rebuildVolumePreviewWith(supabase, {
    projectId,
    organizationId: organization.id,
    actorId: user.id,
  });

  if (esito.ok) revalidatePath(`/projects/${projectId}/preview`);
  return esito;
}

/** URL firmato dell'anteprima corrente, se esiste. */
export async function getVolumePreviewUrl(projectId: string): Promise<string | null> {
  await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const path = `${organization.id}/${projectId}/volume/anteprima.pdf`;
  const { data } = await supabase.storage.from('publication-exports').createSignedUrl(path, 3600);

  return data?.signedUrl ?? null;
}
