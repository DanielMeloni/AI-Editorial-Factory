import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { istruzioniEditoriali } from '@/lib/editorial/direzione';
import { istruzioniBrief } from '@/lib/editorial/brief';
import { composeVolume, etichettaCapitolo } from '@/lib/publish/volume';

/**
 * Il materiale da cui nascono le derivazioni.
 *
 * Articoli e corsi attingono al **manuale già approvato**, non alle fonti
 * grezze: il testo dei capitoli è passato dall'audit e da una decisione umana,
 * gli estratti no. Derivare dal materiale non verificato significherebbe
 * pubblicare senza il controllo che il resto del sistema impone.
 *
 * Quando il manuale non basta — un corso su un argomento che il volume tocca di
 * striscio — si aggiungono gli estratti delle fonti, e la differenza resta
 * visibile nel testo consegnato al modello.
 */

export interface MaterialeProgetto {
  project: {
    id: string;
    title: string;
    subtitle: string | null;
    author: string;
    language: string;
  };
  direzione: string;
  /** Titoli di capitoli approvati, nell'ordine di lettura. */
  outline: string[];
  evidence: string;
  /** Capitoli approvati disponibili: senza, non c'è nulla da derivare. */
  chapters: { id: string; title: string; label: string; contentMd: string }[];
}

const LIMITE_ESTRATTI = 80_000;

export async function raccogliMateriale(
  supabase: SupabaseClient,
  projectId: string,
  opzioni: { includiFonti?: boolean; soloCapitoli?: string[] } = {},
): Promise<MaterialeProgetto | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('id, title, subtitle, author, language, level, tone, register, style_notes, work_shape, target_pages, scope, out_of_scope, audience')
    .eq('id', projectId)
    .maybeSingle<{
      id: string; title: string; subtitle: string | null; author: string; language: string;
      level: string; tone: string; register: string; style_notes: string | null;
      work_shape: string; target_pages: number | null; scope: string | null;
      out_of_scope: string | null; audience: string | null;
    }>();

  if (!project) return null;

  // Il filtro è esplicito: articoli e corsi non possono nascere da una bozza,
  // perché pubblicare aggirando l'approvazione umana è precisamente ciò che
  // il resto del sistema impedisce.
  const volume = await composeVolume(supabase, projectId, { soloApprovati: true });

  const scelti = opzioni.soloCapitoli?.length
    ? volume.chapters.filter((capitolo) => opzioni.soloCapitoli!.includes(capitolo.id))
    : volume.chapters;

  const chapters = scelti.map((capitolo) => ({
    id: capitolo.id,
    title: capitolo.title,
    label: etichettaCapitolo(capitolo),
    contentMd: capitolo.contentMd,
  }));

  const pezzi = chapters.map((capitolo) => `## ${capitolo.label} — ${capitolo.title}\n\n${capitolo.contentMd}`);

  if (opzioni.includiFonti) {
    const { data: estratti } = await supabase
      .from('reference_chunks')
      .select('heading, content')
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order('chunk_index', { ascending: true })
      .limit(80)
      .returns<{ heading: string | null; content: string }[]>();

    for (const estratto of estratti ?? []) {
      pezzi.push(`## Fonte${estratto.heading ? ` — ${estratto.heading}` : ''}\n\n${estratto.content}`);
    }
  }

  return {
    project: {
      id: project.id,
      title: project.title,
      subtitle: project.subtitle,
      author: project.author,
      language: project.language,
    },
    direzione: [
      istruzioniEditoriali({
        level: project.level,
        tone: project.tone,
        register: project.register,
        styleNotes: project.style_notes,
      }),
      // Ambito ed esclusioni valgono anche fuori dal manuale: un articolo che
      // esce dal perimetro dell'opera promette un libro che non esiste.
      istruzioniBrief({
        workShape: project.work_shape,
        targetPages: null,
        scope: project.scope,
        outOfScope: project.out_of_scope,
        audience: project.audience,
      }),
    ]
      .filter(Boolean)
      .join('\n'),
    outline: volume.chapters.map((capitolo) => `${etichettaCapitolo(capitolo)} — ${capitolo.title}`),
    evidence: pezzi.join('\n\n').slice(0, LIMITE_ESTRATTI),
    chapters,
  };
}
