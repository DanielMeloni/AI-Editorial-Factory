import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Letture della biblioteca e delle fonti trovate.
 *
 * Ogni query è comunque protetta dalla RLS: anche se un filtro mancasse, il
 * database non restituirebbe righe di altre organizzazioni.
 */

export interface ReferenceSourceRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  kind: 'link' | 'pdf';
  scope: 'organization' | 'project';
  title: string;
  url: string | null;
  storage_path: string | null;
  original_filename: string | null;
  byte_size: number | null;
  publisher: string | null;
  note: string | null;
  is_authoritative: boolean;
  status: 'pending' | 'indexing' | 'indexed' | 'failed' | 'proposed';
  added_by: 'manuale' | 'ricerca_web';
  rationale: string | null;
  discovery_query: string | null;
  web_kind: string | null;
  priority: number | null;
  http_status: number | null;
  verified_at: string | null;
  error_message: string | null;
  chunk_count: number;
  page_count: number | null;
  indexed_at: string | null;
  created_at: string;
}

export interface SourceSuggestionRow {
  id: string;
  chapter_id: string;
  claim_line: number;
  claim_excerpt: string;
  category: string;
  url: string | null;
  title: string;
  section: string | null;
  score: number;
  rank: number;
  matched_terms: string[];
  origin: 'catalogo_ufficiale' | 'biblioteca';
  reference_id: string | null;
  page: number | null;
  status: 'proposed' | 'accepted' | 'rejected';
  decided_at: string | null;
  created_at: string;
}

/**
 * Fonti visibili a un progetto: le sue e quelle ereditate dall'organizzazione.
 *
 * Le proposte della ricerca web restano fuori: non sono ancora fonti del
 * progetto, e mescolarle a quelle scelte renderebbe l'elenco una promessa
 * invece di un inventario.
 */
export async function listReferences(projectId: string): Promise<ReferenceSourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reference_sources')
    .select('*')
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .neq('status', 'proposed')
    .order('created_at', { ascending: false })
    .returns<ReferenceSourceRow[]>();

  if (error) throw new Error(`Lettura della biblioteca fallita: ${error.message}`);
  return data ?? [];
}

/**
 * Fonti trovate sul web e in attesa di una decisione.
 *
 * Ordinate per priorità dichiarata dalla selezione: chi apre la pagina trova
 * in cima ciò che è stato giudicato irrinunciabile.
 */
export async function listProposedReferences(projectId: string): Promise<ReferenceSourceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reference_sources')
    .select('*')
    .eq('project_id', projectId)
    .eq('status', 'proposed')
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false })
    .returns<ReferenceSourceRow[]>();

  if (error) throw new Error(`Lettura delle fonti proposte fallita: ${error.message}`);
  return data ?? [];
}

/** Un'affermazione e le fonti proposte per sostenerla. */
export interface GroupedSuggestion {
  chapterId: string;
  chapterTitle: string;
  chapterNumber: number | null;
  line: number;
  excerpt: string;
  category: string;
  status: 'proposed' | 'accepted' | 'rejected';
  candidates: SourceSuggestionRow[];
}

interface SuggestionWithChapter extends SourceSuggestionRow {
  chapters: { title: string; number: number | null } | null;
}

/**
 * Fonti trovate per un progetto, raggruppate per affermazione.
 *
 * Il raggruppamento non è un vezzo di presentazione: il revisore decide una
 * affermazione alla volta, scegliendo fra i candidati, non un candidato alla
 * volta senza sapere quali erano le alternative.
 */
export async function listSuggestions(projectId: string): Promise<GroupedSuggestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('source_suggestions')
    .select('*, chapters!inner(title, number)')
    .eq('project_id', projectId)
    .order('claim_line', { ascending: true })
    .order('rank', { ascending: true })
    .returns<SuggestionWithChapter[]>();

  if (error) throw new Error(`Lettura delle fonti proposte fallita: ${error.message}`);

  const grouped = new Map<string, GroupedSuggestion>();

  for (const row of data ?? []) {
    const key = `${row.chapter_id}:${row.claim_line}`;
    const existing = grouped.get(key);

    if (existing) {
      existing.candidates.push(row);
      // Basta che un candidato sia stato accettato perché l'affermazione lo sia.
      if (row.status === 'accepted') existing.status = 'accepted';
      continue;
    }

    grouped.set(key, {
      chapterId: row.chapter_id,
      chapterTitle: row.chapters?.title ?? 'Capitolo',
      chapterNumber: row.chapters?.number ?? null,
      line: row.claim_line,
      excerpt: row.claim_excerpt,
      category: row.category,
      status: row.status,
      candidates: [row],
    });
  }

  return [...grouped.values()].sort(
    (a, b) =>
      (a.chapterNumber ?? 9999) - (b.chapterNumber ?? 9999) ||
      a.chapterTitle.localeCompare(b.chapterTitle) ||
      a.line - b.line,
  );
}

/** Che cosa si può fare adesso su questo progetto. Serve al pulsante del passaggio successivo. */
export interface NextStep {
  /** Identificativo dell'azione, non un'etichetta: l'etichetta la sceglie l'interfaccia. */
  action: 'carica_archivio' | 'avvia_audit' | 'apri_revisione' | 'pubblica' | 'nulla';
  label: string;
  detail: string;
  /** Capitolo o revisione su cui agire, quando l'azione ne richiede uno. */
  targetId: string | null;
  href: string | null;
  available: boolean;
}

/**
 * Il passaggio successivo del progetto.
 *
 * Deciso dallo stato reale — archivio, capitoli, revisioni in attesa — e non da
 * un contatore di avanzamento: se qualcosa è già stato fatto a mano, il
 * pulsante lo sa.
 */
export async function getNextStep(projectId: string): Promise<NextStep> {
  const supabase = await createClient();

  const [{ data: chapters }, { data: pending }, { data: sources }] = await Promise.all([
    supabase
      .from('chapters')
      .select('id, title, number, status, order_index')
      .eq('project_id', projectId)
      .order('order_index', { ascending: true })
      .returns<{ id: string; title: string; number: number | null; status: string; order_index: number }[]>(),
    supabase
      .from('review_requests')
      .select('id, chapter_id')
      .eq('project_id', projectId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .returns<{ id: string; chapter_id: string }[]>(),
    supabase
      .from('project_sources')
      .select('id')
      .eq('project_id', projectId)
      .limit(1)
      .returns<{ id: string }[]>(),
  ]);

  // Una revisione in attesa viene prima di tutto: il workflow è sospeso e
  // aspetta una persona.
  if (pending && pending.length > 0) {
    return {
      action: 'apri_revisione',
      label: 'Apri la revisione in attesa',
      detail: 'Un audit è sospeso: attende una decisione umana per proseguire.',
      targetId: pending[0]!.id,
      href: `/projects/${projectId}/reviews/${pending[0]!.id}`,
      available: true,
    };
  }

  if (!sources || sources.length === 0) {
    return {
      action: 'carica_archivio',
      label: 'Carica l’archivio del manoscritto',
      detail: 'Senza i capitoli non c’è nulla da verificare.',
      targetId: null,
      href: null,
      available: true,
    };
  }

  const daAnalizzare = (chapters ?? []).find((chapter) => chapter.status === 'draft');
  if (daAnalizzare) {
    return {
      action: 'avvia_audit',
      label: `Avvia l’audit del capitolo ${daAnalizzare.number ?? ''}`.trim(),
      detail: `«${daAnalizzare.title}» non è ancora stato verificato.`,
      targetId: daAnalizzare.id,
      href: `/projects/${projectId}/chapters/${daAnalizzare.id}`,
      available: true,
    };
  }

  const approvati = (chapters ?? []).filter((chapter) => chapter.status === 'approved').length;
  if (approvati > 0) {
    return {
      action: 'pubblica',
      label: 'Vai alle pubblicazioni',
      detail: `${approvati} capitoli approvati, pronti da pubblicare.`,
      targetId: null,
      href: `/projects/${projectId}/exports`,
      available: true,
    };
  }

  return {
    action: 'nulla',
    label: 'Nessun passaggio in sospeso',
    detail: 'Tutti i capitoli sono in lavorazione o già trattati.',
    targetId: null,
    href: null,
    available: false,
  };
}
