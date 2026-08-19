'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { getTextProvider } from '@/lib/ai/registry';
import { createClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/ingest/markdown';
import { recordAudit } from '@/lib/security/audit';
import { istruzioniEditoriali } from '@/lib/editorial/direzione';
import { istruzioniBrief } from '@/lib/editorial/brief';
import { rebuildBibliography } from '@/lib/bibliography/actions';

const outlineSchema = z.object({
  parts: z.array(z.object({
    title: z.string().min(2).max(200),
    chapters: z.array(z.object({
      title: z.string().min(2).max(300),
      objective: z.string().min(10).max(800),
    })).min(1).max(12),
  })).min(1).max(8),
});

export interface StructureCommandResult {
  ok: boolean;
  message: string;
  href?: string;
}

/** Genera e salva la prima struttura editoriale partendo dalle fonti disponibili. */
export async function createManualStructure(projectId: string): Promise<StructureCommandResult> {
  const user = await requireUser();
  const organization = await requireOrganization();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, subtitle, description, author, volume, language, level, tone, register, style_notes, work_shape, target_pages, scope, out_of_scope, audience')
    .eq('id', projectId)
    .maybeSingle<{
      id: string; organization_id: string; title: string; subtitle: string | null;
      description: string | null; author: string; volume: string | null; language: string;
      level: 'base' | 'intermediate' | 'advanced'; tone: string; register: string;
      style_notes: string | null;
      work_shape: string; target_pages: number | null; scope: string | null;
      out_of_scope: string | null; audience: string | null;
    }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const { count: existingChapters } = await supabase
    .from('chapters')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', project.id);
  if ((existingChapters ?? 0) > 0) {
    return {
      ok: true,
      message: 'La struttura del manuale esiste già.',
      href: `/projects/${project.id}/structure`,
    };
  }

  const [{ data: references }, { data: referenceChunks }, { data: sourceChunks }] = await Promise.all([
    supabase
      .from('reference_sources')
      .select('id, title, kind, publisher, note')
      .or(`project_id.eq.${project.id},project_id.is.null`)
      .neq('status', 'proposed')
      .limit(50),
    supabase
      .from('reference_chunks')
      .select('reference_id, heading, content, page')
      .or(`project_id.eq.${project.id},project_id.is.null`)
      .order('chunk_index', { ascending: true })
      .limit(80),
    supabase
      .from('source_chunks')
      .select('heading_path, content')
      .eq('project_id', project.id)
      .order('chunk_index', { ascending: true })
      .limit(80),
  ]);

  if ((references?.length ?? 0) === 0 && (sourceChunks?.length ?? 0) === 0) {
    return { ok: false, message: 'Aggiungi almeno una fonte o un archivio indicizzato.' };
  }

  const referenceTitles = (references ?? [])
    .map((reference) => `- ${reference.title}${reference.publisher ? ` — ${reference.publisher}` : ''}`)
    .join('\n');
  const evidence = [
    ...(referenceChunks ?? []).map((chunk) =>
      `${chunk.heading ? `## ${chunk.heading}\n` : ''}${chunk.content}`,
    ),
    ...(sourceChunks ?? []).map((chunk) =>
      `${chunk.heading_path?.length ? `## ${chunk.heading_path.join(' > ')}\n` : ''}${chunk.content}`,
    ),
  ].join('\n\n').slice(0, 60_000);

  const { provider, degraded } = getTextProvider('curriculum');
  if (provider.name === 'mock') {
    return {
      ok: false,
      message: degraded ?? 'Configura AI_AGENT_CURRICULUM con un provider reale.',
    };
  }

  try {
    const generated = await provider.generateStructured(
      {
        system:
          'Sei il Curriculum Agent di una casa editrice tecnica. Progetti un indice progressivo, ' +
          'senza inventare argomenti estranei alle fonti. Ogni capitolo ha un obiettivo concreto. ' +
          'Rispondi in italiano e rispetta esattamente lo schema JSON richiesto.',
        prompt: [
          `Manuale: ${project.title}${project.subtitle ? ` — ${project.subtitle}` : ''}`,
          project.description ? `Descrizione: ${project.description}` : '',
          `Lingua: ${project.language}`,
          '',
          // Il livello non cambia solo la scrittura: cambia quali capitoli
          // esistono. Un indice avanzato che ripassa i fondamenti sarebbe un
          // indice base con un'altra copertina.
          istruzioniEditoriali({
            level: project.level,
            tone: project.tone,
            register: project.register,
            styleNotes: project.style_notes,
          }),
          '',
          // Il brief viene dopo la direzione perché la vincola: un indice può
          // essere impeccabile per tono e registro e sbagliato per ampiezza.
          istruzioniBrief({
            workShape: project.work_shape,
            targetPages: project.target_pages,
            scope: project.scope,
            outOfScope: project.out_of_scope,
            audience: project.audience,
          }),
          '',
          'Fonti disponibili:',
          referenceTitles || '- Archivio del manoscritto',
          '',
          'Estratti:',
          evidence,
          '',
          'Crea da 2 a 6 parti, con capitoli in progressione interna al livello dichiarato: '
            + 'la progressione è dentro il volume, non dal principiante all’esperto.',
        ].filter(Boolean).join('\n'),
        temperature: 0.2,
        maxOutputTokens: 6000,
      },
      outlineSchema,
    );

    const { data: manifests } = await supabase
      .from('project_manifests')
      .select('version')
      .eq('project_id', project.id)
      .order('version', { ascending: false })
      .limit(1)
      .returns<{ version: number }[]>();
    const version = (manifests?.[0]?.version ?? 0) + 1;
    await supabase.from('project_manifests').update({ is_current: false }).eq('project_id', project.id);

    const totalChapters = generated.data.parts.reduce((sum, part) => sum + part.chapters.length, 0);
    const { data: manifest, error: manifestError } = await supabase
      .from('project_manifests')
      .insert({
        project_id: project.id,
        organization_id: organization.id,
        version,
        title: project.title,
        subtitle: project.subtitle,
        author: project.author,
        volume: project.volume,
        structure: generated.data,
        stats: { parts: generated.data.parts.length, chapters: totalChapters, generatedFromSources: true },
        discrepancies: [],
        is_current: true,
        generated_by: user.id,
      })
      .select('id')
      .single<{ id: string }>();
    if (manifestError || !manifest) throw new Error(manifestError?.message ?? 'Manifesto non creato.');

    let orderIndex = 0;
    for (const [partIndex, part] of generated.data.parts.entries()) {
      const { data: insertedPart, error: partError } = await supabase
        .from('publication_parts')
        .insert({
          project_id: project.id,
          organization_id: organization.id,
          manifest_id: manifest.id,
          kind: 'part',
          number: partIndex + 1,
          title: part.title,
          order_index: partIndex + 1,
          source_path: null,
        })
        .select('id')
        .single<{ id: string }>();
      if (partError || !insertedPart) throw new Error(partError?.message ?? 'Parte non creata.');

      for (const chapter of part.chapters) {
        orderIndex += 1;
        const baseSlug = slugify(chapter.title) || `capitolo-${orderIndex}`;
        const content = `# ${chapter.title}\n\n## Obiettivo\n\n${chapter.objective}\n`;
        const { data: insertedChapter, error: chapterError } = await supabase
          .from('chapters')
          .insert({
            project_id: project.id,
            organization_id: organization.id,
            part_id: insertedPart.id,
            kind: 'part',
            number: orderIndex,
            label: String(orderIndex),
            title: chapter.title,
            slug: `${baseSlug}-${orderIndex}`,
            order_index: orderIndex,
            status: 'draft',
            word_count: content.split(/\s+/).filter(Boolean).length,
            heading_count: 2,
          })
          .select('id')
          .single<{ id: string }>();
        if (chapterError || !insertedChapter) throw new Error(chapterError?.message ?? 'Capitolo non creato.');

        const { data: chapterVersion, error: versionError } = await supabase
          .from('chapter_versions')
          .insert({
            chapter_id: insertedChapter.id,
            project_id: project.id,
            organization_id: organization.id,
            version_no: 1,
            origin: 'original',
            content_md: content,
            content_hash: createHash('sha256').update(content).digest('hex'),
            summary: chapter.objective,
            word_count: content.split(/\s+/).filter(Boolean).length,
            created_by: user.id,
          })
          .select('id')
          .single<{ id: string }>();
        if (versionError || !chapterVersion) throw new Error(versionError?.message ?? 'Versione non creata.');
        await supabase.from('chapters').update({ current_version_id: chapterVersion.id }).eq('id', insertedChapter.id);
      }
    }

    await recordAudit({
      organizationId: organization.id,
      actorId: user.id,
      action: 'structure.generated',
      entityType: 'project',
      entityId: project.id,
      metadata: { provider: generated.provider, model: generated.model, parts: generated.data.parts.length, chapters: totalChapters },
    });
    // La bibliografia nasce insieme all'indice, anche vuota: un capitolo che
    // compare a metà lavoro sembrerebbe un'aggiunta improvvisata.
    await rebuildBibliography(project.id);

    revalidatePath(`/projects/${project.id}/sources`);
    revalidatePath(`/projects/${project.id}/structure`);
    return {
      ok: true,
      message: `Struttura creata: ${generated.data.parts.length} parti e ${totalChapters} capitoli.`,
      href: `/projects/${project.id}/structure`,
    };
  } catch (error) {
    return { ok: false, message: `Creazione della struttura fallita: ${(error as Error).message}` };
  }
}
