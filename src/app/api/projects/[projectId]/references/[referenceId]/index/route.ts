import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { extractPdf } from '@/lib/sources/extract';
import { recordAudit } from '@/lib/security/audit';

/**
 * Indicizzazione di un PDF già caricato su Storage.
 *
 * Perché una Route Handler e non una Server Action: l'estrazione di un
 * documento di centinaia di pagine dura decine di secondi e restituisce un
 * esito strutturato. `maxDuration` la porta al limite consentito dal piano.
 *
 * Limite noto, dichiarato: il PDF viene caricato interamente in memoria. Per un
 * documento di riferimento — una specifica, una norma — è accettabile; per un
 * archivio di migliaia di pagine non lo sarebbe, ed è il motivo del limite di
 * 100 MiB imposto a monte.
 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

interface ReferenceRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  kind: 'link' | 'pdf';
  storage_path: string | null;
  status: string;
  title: string;
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; referenceId: string }> },
) {
  const { projectId, referenceId } = await context.params;

  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  // ---------------------------------------------------------------------
  // Autorizzazione esplicita, oltre alla RLS
  // ---------------------------------------------------------------------
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id')
    .eq('id', projectId)
    .maybeSingle<{ id: string; organization_id: string }>();

  if (!project || project.organization_id !== organization.id) {
    return NextResponse.json({ error: 'Progetto non trovato.' }, { status: 404 });
  }

  const { data: reference } = await supabase
    .from('reference_sources')
    .select('id, organization_id, project_id, kind, storage_path, status, title')
    .eq('id', referenceId)
    .maybeSingle<ReferenceRow>();

  if (!reference || reference.organization_id !== organization.id) {
    return NextResponse.json({ error: 'Fonte non trovata.' }, { status: 404 });
  }

  if (reference.kind !== 'pdf' || !reference.storage_path) {
    return NextResponse.json({ error: 'La fonte non è un PDF.' }, { status: 400 });
  }

  if (reference.status === 'indexing') {
    return NextResponse.json({ error: 'Indicizzazione già in corso.' }, { status: 409 });
  }

  await supabase
    .from('reference_sources')
    .update({ status: 'indexing', error_message: null })
    .eq('id', referenceId);

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from('project-sources')
      .download(reference.storage_path);

    if (downloadError || !blob) throw new Error('PDF non reperibile nello storage.');

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const extraction = await extractPdf(bytes);

    // Una nuova indicizzazione sostituisce la precedente: i blocchi vecchi
    // descriverebbero un documento che non è più quello.
    await supabase.from('reference_chunks').delete().eq('reference_id', referenceId);

    if (extraction.chunks.length > 0) {
      const rows = extraction.chunks.map((chunk) => ({
        reference_id: referenceId,
        organization_id: organization.id,
        project_id: reference.project_id,
        chunk_index: chunk.chunkIndex,
        page: chunk.page,
        heading: chunk.heading,
        content: chunk.content,
        terms: chunk.terms,
      }));

      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('reference_chunks').insert(rows.slice(i, i + 200));
        if (error) throw new Error(`Salvataggio dei blocchi fallito: ${error.message}`);
      }
    }

    const indicizzato = extraction.chunks.length > 0;

    await supabase
      .from('reference_sources')
      .update({
        status: indicizzato ? 'indexed' : 'failed',
        chunk_count: extraction.chunks.length,
        page_count: extraction.pageCount,
        indexed_at: indicizzato ? new Date().toISOString() : null,
        error_message: extraction.warnings.join(' ') || null,
      })
      .eq('id', referenceId);

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'reference.indexed',
      entityType: 'reference_source',
      entityId: referenceId,
      metadata: {
        title: reference.title,
        pages: extraction.pageCount,
        chunks: extraction.chunks.length,
      },
    });

    return NextResponse.json({
      ok: indicizzato,
      chunks: extraction.chunks.length,
      pageCount: extraction.pageCount,
      detectedTitle: extraction.detectedTitle,
      warnings: extraction.warnings,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);

    await supabase
      .from('reference_sources')
      .update({ status: 'failed', error_message: message })
      .eq('id', referenceId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
