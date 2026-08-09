import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { ArchiveRejectedError, extractArchive } from '@/lib/ingest/archive';
import { buildManifest } from '@/lib/ingest/manifest';
import { hasZipSignature } from '@/lib/sources/upload';
import { recordAudit } from '@/lib/security/audit';
import { analyzeMarkdown } from '@/lib/ingest/markdown';
import type { ProjectRow, ProjectSourceRow } from '@/lib/db/types';

/**
 * Estrazione e catalogazione di un archivio già caricato su Storage.
 *
 * Perché una Route Handler e non una Server Action: l'operazione dura decine di
 * secondi e restituisce un esito strutturato. `maxDuration` la porta al limite
 * consentito dal piano.
 *
 * Limite noto, dichiarato: l'archivio viene caricato interamente in memoria.
 * Nella Fase 3 questo passaggio diventerà uno step di un workflow durevole, che
 * lavorerà a blocchi e sopravvivrà a un riavvio. Fino ad allora un archivio
 * molto grande può eccedere il tempo massimo: l'errore viene registrato sulla
 * fonte e l'importazione può essere ripetuta.
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const SHA256_ZERO = '0'.repeat(64);

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await context.params;

  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  // ---------------------------------------------------------------------
  // Autorizzazione esplicita, oltre alla RLS
  // ---------------------------------------------------------------------
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, author, subtitle, volume')
    .eq('id', projectId)
    .maybeSingle<Pick<ProjectRow, 'id' | 'organization_id' | 'title' | 'author' | 'subtitle' | 'volume'>>();

  if (!project || project.organization_id !== organization.id) {
    return NextResponse.json({ error: 'Progetto non trovato.' }, { status: 404 });
  }

  const { data: source } = await supabase
    .from('project_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('project_id', projectId)
    .maybeSingle<ProjectSourceRow>();

  if (!source) {
    return NextResponse.json({ error: 'Fonte non trovata.' }, { status: 404 });
  }

  if (source.status === 'extracting') {
    return NextResponse.json({ error: 'Estrazione già in corso.' }, { status: 409 });
  }

  await supabase.from('project_sources').update({ status: 'extracting' }).eq('id', sourceId);
  await supabase.from('projects').update({ status: 'importing' }).eq('id', projectId);

  try {
    // -------------------------------------------------------------------
    // Lettura dell'archivio dallo storage privato
    // -------------------------------------------------------------------
    const { data: blob, error: downloadError } = await supabase.storage
      .from(source.storage_bucket)
      .download(source.storage_path);

    if (downloadError || !blob) {
      throw new Error('Archivio non reperibile nello storage.');
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());

    // Il tipo dichiarato dal browser non è attendibile: si controllano i byte.
    if (!hasZipSignature(bytes)) {
      throw new ArchiveRejectedError(
        'Il file caricato non è un archivio ZIP valido.',
        'archivio_illeggibile',
      );
    }

    const extraction = await extractArchive(bytes, { keepBinaries: false });

    if (extraction.files.length === 0) {
      throw new ArchiveRejectedError(
        'Nessun file utilizzabile nell’archivio.',
        'archivio_vuoto',
      );
    }

    // -------------------------------------------------------------------
    // Catalogazione dei file
    // -------------------------------------------------------------------
    await supabase.from('source_files').delete().eq('source_id', sourceId);

    const fileRows = extraction.files.map((file) => ({
      source_id: sourceId,
      project_id: projectId,
      organization_id: organization.id,
      original_path: file.originalPath,
      normalized_path: file.normalizedPath,
      directory: file.directory,
      filename: file.filename,
      extension: file.extension,
      kind: file.kind,
      byte_size: file.byteSize,
      sha256: file.sha256,
      text_content: file.textContent,
      word_count: file.wordCount,
      line_count: file.lineCount,
      is_ignored: file.isIgnored,
      ignore_reason: file.ignoreReason,
    }));

    const insertErrors: string[] = [];
    const BATCH = 200;
    for (let i = 0; i < fileRows.length; i += BATCH) {
      const { error } = await supabase.from('source_files').insert(fileRows.slice(i, i + BATCH));
      // Un blocco fallito non annulla l'intera importazione: viene annotato.
      if (error) insertErrors.push(`File ${i}-${i + BATCH}: ${error.message}`);
    }

    // -------------------------------------------------------------------
    // Manifesto
    // -------------------------------------------------------------------
    const manifest = buildManifest(extraction.files, {
      title: project.title,
      subtitle: project.subtitle,
      author: project.author,
      volume: project.volume,
    });

    const { data: lastManifest } = await supabase
      .from('project_manifests')
      .select('version')
      .eq('project_id', projectId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ version: number }>();

    const nextVersion = (lastManifest?.version ?? 0) + 1;

    await supabase
      .from('project_manifests')
      .update({ is_current: false })
      .eq('project_id', projectId)
      .eq('is_current', true);

    const { data: manifestRow, error: manifestError } = await supabase
      .from('project_manifests')
      .insert({
        project_id: projectId,
        organization_id: organization.id,
        source_id: sourceId,
        version: nextVersion,
        title: manifest.title,
        subtitle: manifest.subtitle,
        author: manifest.author,
        volume: manifest.volume,
        structure: { parts: manifest.parts, indexPath: manifest.indexPath },
        stats: manifest.stats,
        discrepancies: manifest.discrepancies,
        is_current: true,
        generated_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();

    if (manifestError || !manifestRow) {
      throw new Error(`Salvataggio del manifesto fallito: ${manifestError?.message ?? ''}`);
    }

    // -------------------------------------------------------------------
    // Parti e capitoli
    // -------------------------------------------------------------------
    // I capitoli si creano solo alla prima importazione. Una reimportazione
    // produce un nuovo manifesto e ne evidenzia le differenze, ma non tocca
    // capitoli e versioni già esistenti: sovrascriverli distruggerebbe le
    // revisioni approvate.
    const { count: existingChapters } = await supabase
      .from('chapters')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    let createdChapters = 0;

    if ((existingChapters ?? 0) === 0) {
      const textByPath = new Map(
        extraction.files
          .filter((f) => f.textContent !== null)
          .map((f) => [f.normalizedPath, { text: f.textContent!, sha256: f.sha256, id: f.normalizedPath }]),
      );

      const sourceFileIds = new Map<string, string>();
      const { data: storedFiles } = await supabase
        .from('source_files')
        .select('id, normalized_path')
        .eq('source_id', sourceId)
        .returns<{ id: string; normalized_path: string }[]>();

      for (const row of storedFiles ?? []) sourceFileIds.set(row.normalized_path, row.id);

      for (const part of manifest.parts) {
        const { data: partRow, error: partError } = await supabase
          .from('publication_parts')
          .insert({
            project_id: projectId,
            organization_id: organization.id,
            manifest_id: manifestRow.id,
            kind: part.kind,
            number: part.number,
            title: part.title,
            order_index: part.orderIndex,
            source_path: part.sourcePath,
          })
          .select('id')
          .single<{ id: string }>();

        if (partError || !partRow) {
          insertErrors.push(`Parte «${part.title}»: ${partError?.message ?? 'errore'}`);
          continue;
        }

        for (const chapter of part.chapters) {
          const { data: chapterRow, error: chapterError } = await supabase
            .from('chapters')
            .insert({
              project_id: projectId,
              organization_id: organization.id,
              part_id: partRow.id,
              source_file_id: sourceFileIds.get(chapter.sourcePath) ?? null,
              kind: chapter.kind,
              number: chapter.number,
              label: chapter.label,
              title: chapter.title,
              slug: `${chapter.orderIndex}-${chapter.slug}`.slice(0, 90),
              order_index: chapter.orderIndex,
              word_count: chapter.wordCount,
              code_block_count: chapter.codeBlockCount,
              heading_count: chapter.headingCount,
              figure_count: chapter.figureCount,
              placeholder_count: chapter.placeholderCount,
              link_count: chapter.linkCount,
              source_path: chapter.sourcePath,
            })
            .select('id')
            .single<{ id: string }>();

          if (chapterError || !chapterRow) {
            insertErrors.push(`Capitolo «${chapter.title}»: ${chapterError?.message ?? 'errore'}`);
            continue;
          }

          // Versione 1: il testo originale, immutabile per trigger.
          const original = textByPath.get(chapter.sourcePath);
          if (original) {
            const analysis = analyzeMarkdown(original.text);
            const { data: versionRow } = await supabase
              .from('chapter_versions')
              .insert({
                chapter_id: chapterRow.id,
                project_id: projectId,
                organization_id: organization.id,
                version_no: 1,
                origin: 'original',
                content_md: original.text,
                content_hash: original.sha256 || SHA256_ZERO,
                word_count: analysis.wordCount,
                summary: 'Testo originale importato dall’archivio.',
                created_by: user.id,
              })
              .select('id')
              .single<{ id: string }>();

            if (versionRow) {
              await supabase
                .from('chapters')
                .update({ current_version_id: versionRow.id })
                .eq('id', chapterRow.id);
            }
          }

          createdChapters += 1;
        }
      }
    }

    // -------------------------------------------------------------------
    // Esito
    // -------------------------------------------------------------------
    const allErrors = [
      ...extraction.errors,
      ...insertErrors.map((message) => ({ path: '', reason: message })),
    ];

    const status = allErrors.length > 0 ? 'partial' : 'extracted';

    await supabase
      .from('project_sources')
      .update({
        status,
        file_count: extraction.stats.extracted,
        ignored_count: extraction.stats.ignored,
        error_count: allErrors.length,
        errors: allErrors.slice(0, 200),
        error_message: null,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', sourceId);

    await supabase.from('projects').update({ status: 'ready' }).eq('id', projectId);

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'source.ingested',
      entityType: 'project_source',
      entityId: sourceId,
      metadata: {
        files: extraction.stats.extracted,
        rejected: extraction.stats.rejected,
        chapters: createdChapters,
        manifestVersion: nextVersion,
      },
    });

    return NextResponse.json({
      ok: true,
      status,
      stats: extraction.stats,
      manifest: { version: nextVersion, stats: manifest.stats },
      chaptersCreated: createdChapters,
      chaptersAlreadyPresent: (existingChapters ?? 0) > 0,
      errors: allErrors.slice(0, 50),
      discrepancies: manifest.discrepancies.slice(0, 50),
    });
  } catch (error) {
    const message =
      error instanceof ArchiveRejectedError
        ? error.message
        : 'Estrazione non riuscita. L’archivio potrebbe essere troppo grande o danneggiato.';

    // Il dettaglio tecnico resta nei log del server, non raggiunge il browser.
    console.error('Ingestione fallita', {
      sourceId,
      detail: error instanceof Error ? error.message : String(error),
    });

    await supabase
      .from('project_sources')
      .update({ status: 'failed', error_message: message })
      .eq('id', sourceId);
    await supabase.from('projects').update({ status: 'draft' }).eq('id', projectId);

    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
