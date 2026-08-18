'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/guards';
import { requireOrganization } from '@/lib/auth/organization';
import { createClient } from '@/lib/supabase/server';
import { recordAudit } from '@/lib/security/audit';

/**
 * Capitolo di bibliografia.
 *
 * I capitoli non citano più le fonti nel testo. Raccoglierle tutte in un
 * capitolo solo ha due conseguenze che valgono la scelta: la lettura non viene
 * interrotta da indirizzi che nessuno digita, e l'elenco si aggiorna in un
 * posto invece che in trenta code di capitolo — dove, inevitabilmente, alcune
 * resterebbero indietro.
 *
 * Il capitolo è **generato da codice**, non da un modello. Un elenco di fonti è
 * un fatto: si legge dal registro delle fonti e si formatta. Chiederlo a un
 * modello significherebbe accettare che ogni tanto ne inventi una, ed è
 * esattamente l'errore che una bibliografia non può permettersi.
 */

const SLUG = 'bibliografia';
/** La bibliografia sta in fondo: un indice ordinale alto la tiene lì. */
const ORDINE = 9_000;

export interface BibliographyResult {
  ok: boolean;
  message: string;
  chapterId?: string;
}

interface FonteRiga {
  kind: 'link' | 'pdf';
  title: string;
  url: string | null;
  publisher: string | null;
  note: string | null;
  original_filename: string | null;
  page_count: number | null;
  is_authoritative: boolean;
  status: string;
}

/** Una voce bibliografica, nella forma in cui si legge su carta. */
function voce(fonte: FonteRiga): string {
  const parti = [`**${fonte.title.trim()}**`];
  if (fonte.publisher?.trim()) parti.push(fonte.publisher.trim());

  if (fonte.kind === 'pdf') {
    const documento = [
      fonte.original_filename?.trim() || 'documento PDF',
      fonte.page_count ? `${fonte.page_count} pagine` : '',
    ]
      .filter(Boolean)
      .join(', ');
    parti.push(documento);
  } else if (fonte.url?.trim()) {
    parti.push(`<${fonte.url.trim()}>`);
  }

  const riga = `- ${parti.join(' — ')}`;
  return fonte.note?.trim() ? `${riga}\n  ${fonte.note.trim()}` : riga;
}

function componiBibliografia(fonti: FonteRiga[], titoloOpera: string): string {
  const ufficiali = fonti.filter((fonte) => fonte.is_authoritative);
  const altre = fonti.filter((fonte) => !fonte.is_authoritative);

  const righe: string[] = [
    '# Bibliografia',
    '',
    `Le fonti su cui si basa «${titoloOpera}». I capitoli non riportano indirizzi nel testo: ` +
      'ogni riferimento è raccolto qui.',
    '',
  ];

  if (fonti.length === 0) {
    // Un elenco vuoto dichiarato è un'informazione; un capitolo assente è un
    // dubbio su cosa sia successo.
    righe.push(
      'Nessuna fonte è ancora registrata per quest’opera. L’elenco si popola dalla scheda ' +
        'Fonti e dalle proposte accettate durante gli audit.',
      '',
    );
    return righe.join('\n');
  }

  const ordina = (elenco: FonteRiga[]) =>
    [...elenco].sort((a, b) => a.title.localeCompare(b.title, 'it'));

  if (ufficiali.length > 0) {
    righe.push(
      '## Documentazione ufficiale e fonti autorevoli',
      '',
      ...ordina(ufficiali).map(voce),
      '',
    );
  }
  if (altre.length > 0) {
    righe.push('## Altre fonti consultate', '', ...ordina(altre).map(voce), '');
  }

  const nonIndicizzate = fonti.filter((fonte) => fonte.status !== 'indexed').length;
  if (nonIndicizzate > 0) {
    righe.push(
      '',
      '> **NOTA**',
      '>',
      `> ${nonIndicizzate} fonti su ${fonti.length} non sono ancora indicizzate: compaiono ` +
        'nell’elenco ma il loro contenuto non ha contribuito alla stesura.',
      '',
    );
  }

  return righe.join('\n');
}

/**
 * Crea o aggiorna il capitolo di bibliografia.
 *
 * Non sovrascrive: come ogni altro capitolo, una nuova stesura è una nuova
 * versione. Se il contenuto non è cambiato non ne crea nessuna — un elenco
 * identico non è una revisione.
 */
export async function rebuildBibliography(projectId: string): Promise<BibliographyResult> {
  const user = await requireUser();
  const organization = await requireOrganization();

  if (!z.string().uuid().safeParse(projectId).success) {
    return { ok: false, message: 'Progetto non valido.' };
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, organization_id, title')
    .eq('id', projectId)
    .maybeSingle<{ id: string; organization_id: string; title: string }>();

  if (!project || project.organization_id !== organization.id) {
    return { ok: false, message: 'Progetto non trovato.' };
  }

  const { data: fonti } = await supabase
    .from('reference_sources')
    .select(
      'kind, title, url, publisher, note, original_filename, page_count, is_authoritative, status',
    )
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .neq('status', 'failed')
    .returns<FonteRiga[]>();

  const contenuto = componiBibliografia(fonti ?? [], project.title);
  const contentHash = createHash('sha256').update(contenuto).digest('hex');
  const wordCount = contenuto.split(/\s+/).filter(Boolean).length;

  const { data: esistente } = await supabase
    .from('chapters')
    .select('id, current_version_id')
    .eq('project_id', projectId)
    .eq('slug', SLUG)
    .maybeSingle<{ id: string; current_version_id: string | null }>();

  let chapterId = esistente?.id ?? null;

  if (!chapterId) {
    const { data: creato, error } = await supabase
      .from('chapters')
      .insert({
        project_id: projectId,
        organization_id: organization.id,
        part_id: null,
        kind: 'back_matter',
        number: null,
        label: 'Bibliografia',
        title: 'Bibliografia',
        slug: SLUG,
        order_index: ORDINE,
        status: 'draft',
        word_count: wordCount,
        heading_count: 1,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !creato) {
      return { ok: false, message: `Creazione del capitolo non riuscita: ${error?.message ?? ''}` };
    }
    chapterId = creato.id;
  } else if (esistente?.current_version_id) {
    const { data: corrente } = await supabase
      .from('chapter_versions')
      .select('content_hash')
      .eq('id', esistente.current_version_id)
      .maybeSingle<{ content_hash: string }>();

    if (corrente?.content_hash === contentHash) {
      return {
        ok: true,
        chapterId,
        message: `Bibliografia già aggiornata: ${(fonti ?? []).length} fonti.`,
      };
    }
  }

  const { data: ultima } = await supabase
    .from('chapter_versions')
    .select('version_no')
    .eq('chapter_id', chapterId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle<{ version_no: number }>();

  const { data: versione, error: erroreVersione } = await supabase
    .from('chapter_versions')
    .insert({
      chapter_id: chapterId,
      project_id: projectId,
      organization_id: organization.id,
      version_no: (ultima?.version_no ?? 0) + 1,
      // Nessun modello ha scritto questo testo: è composto dal registro delle
      // fonti, e dichiararlo «proposta AI» sarebbe falso.
      origin: 'original',
      content_md: contenuto,
      content_hash: contentHash,
      summary: `${(fonti ?? []).length} fonti registrate.`,
      word_count: wordCount,
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>();

  if (erroreVersione || !versione) {
    return { ok: false, message: `Salvataggio non riuscito: ${erroreVersione?.message ?? ''}` };
  }

  await supabase
    .from('chapters')
    .update({ current_version_id: versione.id, word_count: wordCount })
    .eq('id', chapterId);

  await recordAudit({
    organizationId: organization.id,
    actorId: user.id,
    action: 'bibliography.rebuilt',
    entityType: 'chapter',
    entityId: chapterId,
    metadata: { sources: (fonti ?? []).length },
  });

  revalidatePath(`/projects/${projectId}/structure`);

  return {
    ok: true,
    chapterId,
    message: `Bibliografia aggiornata: ${(fonti ?? []).length} fonti.`,
  };
}
