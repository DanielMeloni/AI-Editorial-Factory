import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { composeVolume, etichettaCapitolo } from './volume';
import { exportVolumePdf } from './pdf';

/**
 * Anteprima del volume in PDF.
 *
 * Vive in un file solo, con il client passato da fuori, perché due strade
 * diversissime devono produrre lo stesso identico documento: il passaggio
 * finale del workflow, che gira con il service role, e il pulsante di
 * ricostruzione manuale, che gira con i permessi di chi lo preme. Se ognuna
 * componesse a modo suo, l'anteprima cambierebbe a seconda di chi l'ha chiesta.
 *
 * Il file è sempre lo stesso — `anteprima.pdf`, sovrascritto — e non si accumula
 * una versione per ogni capitolo approvato: qui la storia è già conservata dalle
 * versioni dei capitoli, e trenta PDF quasi identici non aggiungerebbero nulla
 * se non spazio occupato.
 */

export interface EsitoAnteprima {
  ok: boolean;
  message: string;
  storagePath?: string;
  chapters?: number;
  words?: number;
}

export async function rebuildVolumePreviewWith(
  supabase: SupabaseClient,
  input: { projectId: string; organizationId: string; actorId: string | null },
): Promise<EsitoAnteprima> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title, subtitle, author, volume')
    .eq('id', input.projectId)
    .maybeSingle<{
      id: string; organization_id: string; title: string;
      subtitle: string | null; author: string; volume: string | null;
    }>();

  if (!project || project.organization_id !== input.organizationId) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const volume = await composeVolume(supabase, input.projectId);

  const bytes = await exportVolumePdf(
    volume.chapters.map((capitolo) => ({
      label: etichettaCapitolo(capitolo),
      title: capitolo.title,
      contentMd: capitolo.contentMd,
      versionNo: capitolo.versionNo,
    })),
    {
      projectTitle: project.title,
      subtitle: project.subtitle,
      author: project.author,
      volume: project.volume,
      generatedAt: new Date().toLocaleString('it-IT'),
      pending: volume.pending.length,
    },
  );

  const storagePath = `${input.organizationId}/${input.projectId}/volume/anteprima.pdf`;

  const { error: uploadError } = await supabase.storage
    .from('publication-exports')
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    return { ok: false, message: `Salvataggio dell’anteprima non riuscito: ${uploadError.message}` };
  }

  const checksum = await sha256Hex(bytes);
  const adesso = new Date().toISOString();

  // Una riga sola per progetto: l'anteprima è uno stato, non una collezione di
  // esportazioni. Le esportazioni definitive restano quelle della scheda Export.
  const { data: esistente } = await supabase
    .from('exports')
    .select('id')
    .eq('project_id', input.projectId)
    .is('chapter_id', null)
    .eq('format', 'pdf')
    .limit(1)
    .maybeSingle<{ id: string }>();

  const riga = {
    project_id: input.projectId,
    organization_id: input.organizationId,
    chapter_id: null,
    format: 'pdf' as const,
    status: 'ready' as const,
    storage_bucket: 'publication-exports',
    storage_path: storagePath,
    byte_size: bytes.byteLength,
    checksum,
    error: null,
    requested_by: input.actorId,
    completed_at: adesso,
  };

  if (esistente) await supabase.from('exports').update(riga).eq('id', esistente.id);
  else await supabase.from('exports').insert({ ...riga, requested_at: adesso });

  return {
    ok: true,
    storagePath,
    chapters: volume.totals.chapters,
    words: volume.totals.words,
    message:
      volume.totals.chapters === 0
        ? 'Anteprima aggiornata: nessun capitolo convalidato, per ora.'
        : `Anteprima aggiornata: ${volume.totals.chapters} capitoli, ` +
          `${volume.totals.words.toLocaleString('it-IT')} parole` +
          `${volume.pending.length > 0 ? `, ${volume.pending.length} ancora da convalidare` : ''}.`,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
