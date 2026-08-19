import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Composizione del volume per l'anteprima.
 *
 * L'anteprima non è un'esportazione: è lo stato dell'opera in questo momento.
 * Contiene **tutto ciò che è stato scritto**, nell'ordine in cui si leggerà, e
 * distingue ciò che è approvato da ciò che è ancora una bozza invece di
 * nasconderlo. Vedere il volume per intero è la ragione per cui esiste
 * un'anteprima; sapere cosa è già deciso è la ragione per cui la distinzione
 * resta visibile.
 *
 * Le **derivazioni** — articoli e corsi — chiedono invece i soli capitoli
 * approvati, ed è per questo che il filtro è un parametro e non una regola
 * fissa: pubblicare partendo da una bozza aggirerebbe il controllo umano, che
 * per un'anteprima interna non è in gioco.
 */

export interface CapitoloVolume {
  id: string;
  /** Falso per i capitoli scritti ma non ancora approvati. */
  approvato: boolean;
  kind: string;
  number: number | null;
  label: string | null;
  title: string;
  orderIndex: number;
  contentMd: string;
  versionNo: number;
  wordCount: number;
}

export interface VolumeComposto {
  chapters: CapitoloVolume[];
  totals: { chapters: number; words: number };
  /** Capitoli senza alcun testo: sono gli unici che restano fuori. */
  pending: { title: string; status: string }[];
}

interface RigaCapitolo {
  id: string;
  kind: string;
  number: number | null;
  label: string | null;
  title: string;
  order_index: number;
  status: string;
  current_version_id: string | null;
}

/** Vero se il capitolo è stato approvato da una persona. */
function approvato(capitolo: RigaCapitolo): boolean {
  if (capitolo.status === 'approved' || capitolo.status === 'published') return true;
  // La bibliografia e gli altri capitoli di chiusura deterministici non passano
  // da un'approvazione perché non contengono testo proposto da un modello:
  // contarli come non approvati li marchierebbe come bozze senza motivo.
  return capitolo.kind === 'back_matter';
}

export async function composeVolume(
  supabase: SupabaseClient,
  projectId: string,
  opzioni: { soloApprovati?: boolean } = {},
): Promise<VolumeComposto> {
  const { data: capitoli, error } = await supabase
    .from('chapters')
    .select('id, kind, number, label, title, order_index, status, current_version_id')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .returns<RigaCapitolo[]>();

  if (error) throw new Error(`Lettura dei capitoli fallita: ${error.message}`);

  const soloApprovati = opzioni.soloApprovati ?? false;

  const inclusi = (capitoli ?? []).filter(
    (capitolo) =>
      Boolean(capitolo.current_version_id) && (!soloApprovati || approvato(capitolo)),
  );
  const pending = (capitoli ?? [])
    .filter(
      (capitolo) =>
        !capitolo.current_version_id || (soloApprovati && !approvato(capitolo)),
    )
    .map((capitolo) => ({ title: capitolo.title, status: capitolo.status }));

  if (inclusi.length === 0) {
    return { chapters: [], totals: { chapters: 0, words: 0 }, pending };
  }

  const { data: versioni } = await supabase
    .from('chapter_versions')
    .select('id, content_md, version_no, word_count')
    .in(
      'id',
      inclusi.map((capitolo) => capitolo.current_version_id!),
    )
    .returns<{ id: string; content_md: string; version_no: number; word_count: number }[]>();

  const perId = new Map((versioni ?? []).map((versione) => [versione.id, versione]));

  const chapters: CapitoloVolume[] = [];
  for (const capitolo of inclusi) {
    const versione = perId.get(capitolo.current_version_id!);
    if (!versione) continue;
    chapters.push({
      id: capitolo.id,
      approvato: approvato(capitolo),
      kind: capitolo.kind,
      number: capitolo.number,
      label: capitolo.label,
      title: capitolo.title,
      orderIndex: capitolo.order_index,
      contentMd: versione.content_md,
      versionNo: versione.version_no,
      wordCount: versione.word_count,
    });
  }

  return {
    chapters,
    totals: {
      chapters: chapters.length,
      words: chapters.reduce((somma, capitolo) => somma + capitolo.wordCount, 0),
    },
    pending,
  };
}

/** L'etichetta con cui il capitolo si presenta nell'indice e in testata. */
export function etichettaCapitolo(capitolo: CapitoloVolume): string {
  if (capitolo.kind === 'appendix') return `Appendice ${capitolo.label ?? ''}`.trim();
  if (capitolo.kind === 'back_matter') return capitolo.label ?? capitolo.title;
  if (capitolo.number !== null) return `Capitolo ${capitolo.number}`;
  return capitolo.label ?? '';
}
