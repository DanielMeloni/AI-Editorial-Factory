import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * A che punto è l'opera, e cosa conviene fare adesso.
 *
 * Le schede del progetto mostrano ognuna una parte del lavoro, ma nessuna dice
 * da dove si comincia né cosa manca: chi apre un progetto a distanza di giorni
 * deve ricostruirlo guardandosi intorno. Qui lo stato viene letto una volta e
 * tradotto in una sola frase — il prossimo passo — con il collegamento che ci
 * porta.
 *
 * Le fasi sono in ordine di dipendenza, non di importanza: non si crea un
 * indice senza fonti, non si scrive un capitolo senza indice, non si approva
 * ciò che non è stato scritto.
 */

export interface FaseProgetto {
  key: string;
  label: string;
  /** Cosa fare, se la fase non è ancora conclusa. */
  azione: string;
  href: string;
  fatta: boolean;
  /** Dettaglio numerico, quando aiuta a capire quanto manca. */
  dettaglio: string | null;
}

export interface ProgressoProgetto {
  fasi: FaseProgetto[];
  /** La prima fase non conclusa: è il prossimo passo. */
  prossima: FaseProgetto | null;
  completate: number;
}

export async function getProjectProgress(projectId: string): Promise<ProgressoProgetto> {
  const supabase = await createClient();
  const base = `/projects/${projectId}`;

  const [fonti, capitoli, revisioni, copertina, grafiche, anteprima] = await Promise.all([
    supabase
      .from('project_sources')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId),
    supabase
      .from('chapters')
      .select('status, kind')
      .eq('project_id', projectId)
      .returns<{ status: string; kind: string }[]>(),
    supabase
      .from('review_requests')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'pending'),
    supabase
      .from('cover_projects')
      .select('id, front_asset_id')
      .eq('project_id', projectId)
      .limit(1)
      .maybeSingle<{ id: string; front_asset_id: string | null }>(),
    supabase
      .from('visual_assets')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .in('kind', ['cover_front', 'cover_spine', 'cover_back'])
      .eq('status', 'pending_approval'),
    supabase
      .from('exports')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('chapter_id', null)
      .eq('status', 'ready'),
  ]);

  const elenco = capitoli.data ?? [];
  // I capitoli di chiusura sono generati da codice e non attendono nessuno:
  // contarli fra quelli da scrivere farebbe sembrare il lavoro più lungo.
  const daScrivere = elenco.filter(
    (capitolo) => capitolo.kind !== 'back_matter' && capitolo.status === 'draft',
  ).length;
  const approvati = elenco.filter(
    (capitolo) => capitolo.status === 'approved' || capitolo.status === 'published',
  ).length;
  const totali = elenco.filter((capitolo) => capitolo.kind !== 'back_matter').length;

  const fasi: FaseProgetto[] = [
    {
      key: 'fonti',
      label: 'Fonti',
      azione: 'Carica l’archivio del manoscritto o aggiungi documenti alla biblioteca',
      href: `${base}/sources`,
      fatta: (fonti.count ?? 0) > 0,
      dettaglio: `${fonti.count ?? 0} archivi`,
    },
    {
      key: 'struttura',
      label: 'Struttura',
      azione: 'Crea la struttura del manuale dalle fonti',
      href: `${base}/structure`,
      fatta: totali > 0,
      dettaglio: totali > 0 ? `${totali} capitoli` : null,
    },
    {
      key: 'stesura',
      label: 'Stesura e audit',
      azione:
        daScrivere === 1
          ? 'Avvia l’audit sull’ultimo capitolo ancora in bozza'
          : `Avvia l’audit sui capitoli ancora in bozza`,
      href: `${base}/structure`,
      fatta: totali > 0 && daScrivere === 0,
      dettaglio: totali > 0 ? `${totali - daScrivere} su ${totali} lavorati` : null,
    },
    {
      key: 'revisioni',
      label: 'Revisioni',
      azione: 'Decidi le revisioni in attesa: il workflow è sospeso finché non lo fai',
      href: `${base}/reviews`,
      fatta: (revisioni.count ?? 0) === 0,
      dettaglio: (revisioni.count ?? 0) > 0 ? `${revisioni.count} in attesa` : null,
    },
    {
      key: 'copertina',
      label: 'Copertina',
      azione: copertina.data
        ? 'Genera le grafiche e approva quelle che ti convincono'
        : 'Imposta formato, dorso e testi della copertina',
      href: `${base}/cover-studio`,
      fatta: Boolean(copertina.data?.front_asset_id) && (grafiche.count ?? 0) === 0,
      dettaglio:
        (grafiche.count ?? 0) > 0 ? `${grafiche.count} grafiche da approvare` : null,
    },
    {
      key: 'anteprima',
      label: 'Anteprima',
      azione: 'Rivedi il volume composto finora',
      href: `${base}/preview`,
      fatta: (anteprima.count ?? 0) > 0 && approvati > 0,
      dettaglio: approvati > 0 ? `${approvati} capitoli nel volume` : null,
    },
  ];

  return {
    fasi,
    prossima: fasi.find((fase) => !fase.fatta) ?? null,
    completate: fasi.filter((fase) => fase.fatta).length,
  };
}

/**
 * Stato di ciascuna scheda del progetto, per colorare la barra di navigazione.
 *
 * Tre stati e non sei: **pronto** quando la fase è conclusa, **attesa** quando
 * tocca a te — è la prima fase non conclusa, quella su cui il lavoro si è
 * fermato — e **bloccata** per ciò che dipende da fasi precedenti e oggi non si
 * può fare. Le schede che non corrispondono a una fase, come le esecuzioni e le
 * pubblicazioni, restano neutre: colorarle direbbe qualcosa che non è vero.
 */
export type StatoScheda = 'pronto' | 'attesa' | 'bloccata';

/** Quale fase governa quale scheda. Due schede possono condividerne una. */
const SCHEDA_PER_FASE: Record<string, string> = {
  sources: 'fonti',
  structure: 'struttura',
  reviews: 'revisioni',
  'cover-studio': 'copertina',
  preview: 'anteprima',
};

export function statiSchede(progresso: ProgressoProgetto): Record<string, StatoScheda> {
  const stati: Record<string, StatoScheda> = {};

  for (const [segmento, chiaveFase] of Object.entries(SCHEDA_PER_FASE)) {
    const fase = progresso.fasi.find((voce) => voce.key === chiaveFase);
    if (!fase) continue;
    stati[segmento] = fase.fatta
      ? 'pronto'
      : fase.key === progresso.prossima?.key
        ? 'attesa'
        : 'bloccata';
  }

  // La struttura porta con sé la stesura: finché restano capitoli in bozza la
  // scheda non è «pronta», anche se l'indice esiste.
  const stesura = progresso.fasi.find((voce) => voce.key === 'stesura');
  if (stesura && stati.structure === 'pronto' && !stesura.fatta) {
    stati.structure = stesura.key === progresso.prossima?.key ? 'attesa' : 'bloccata';
  }

  return stati;
}
