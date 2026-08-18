import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Composizione del volume per l'anteprima.
 *
 * L'anteprima non è un'esportazione: è lo stato dell'opera in questo momento.
 * Contiene i capitoli **convalidati**, nell'ordine in cui si leggeranno, e nulla
 * di ciò che è ancora una proposta. È la ragione per cui approvare un capitolo
 * lo fa comparire: l'approvazione è l'unico gesto che lo rende parte del libro.
 *
 * I capitoli di chiusura generati da codice — la bibliografia — entrano senza
 * approvazione: non sono contenuto proposto da un modello, sono il registro
 * delle fonti formattato, e chiederne l'approvazione confonderebbe due cose
 * diverse.
 */

export interface CapitoloVolume {
  id: string;
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
  /** Capitoli esistenti ma non ancora convalidati: l'assenza va spiegata. */
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

/** Vero se il capitolo può entrare nell'anteprima. */
function ammesso(capitolo: RigaCapitolo): boolean {
  if (capitolo.status === 'approved' || capitolo.status === 'published') return true;
  // La bibliografia e gli altri capitoli di chiusura deterministici non passano
  // da un'approvazione perché non contengono testo proposto da un modello.
  return capitolo.kind === 'back_matter';
}

export async function composeVolume(
  supabase: SupabaseClient,
  projectId: string,
): Promise<VolumeComposto> {
  const { data: capitoli, error } = await supabase
    .from('chapters')
    .select('id, kind, number, label, title, order_index, status, current_version_id')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .returns<RigaCapitolo[]>();

  if (error) throw new Error(`Lettura dei capitoli fallita: ${error.message}`);

  const inclusi = (capitoli ?? []).filter(
    (capitolo) => ammesso(capitolo) && capitolo.current_version_id,
  );
  const pending = (capitoli ?? [])
    .filter((capitolo) => !ammesso(capitolo) || !capitolo.current_version_id)
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
