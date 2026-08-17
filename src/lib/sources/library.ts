import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSourceIndex, catalogAsEntries, type SearchableEntry, type SourceIndex } from './match';
import { referenceEntries, type ReferenceChunk, type ReferenceForIndex } from './references';

/**
 * Costruzione dell'indice interrogabile di un progetto.
 *
 * Un solo indice, due provenienze: la documentazione ufficiale e la biblioteca.
 * Costruirne uno solo non è un dettaglio di implementazione — è ciò che rende i
 * punteggi confrontabili. Con due indici separati «0,8 nella biblioteca» e
 * «0,8 nel catalogo» non vorrebbero dire la stessa cosa, e il revisore si
 * troverebbe davanti classifiche non comparabili.
 *
 * L'ereditarietà è quella delle collane: le fonti con `project_id` nullo
 * appartengono all'organizzazione e valgono per tutti i suoi progetti.
 */

export interface ReferenceRow {
  id: string;
  title: string;
  kind: 'link' | 'pdf';
  scope: 'organization' | 'project';
  url: string | null;
  is_authoritative: boolean;
  status: string;
}

interface ChunkRow {
  reference_id: string;
  chunk_index: number;
  page: number | null;
  heading: string | null;
  content: string;
  terms: string[];
}

/** Limite di sicurezza: una biblioteca enorme non deve saturare la memoria del passaggio. */
const MAX_CHUNKS = 20_000;

/**
 * Legge le fonti indicizzate visibili a un progetto: le sue e quelle ereditate
 * dall'organizzazione.
 */
export async function loadLibraryEntries(
  db: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<{ entries: SearchableEntry[]; references: ReferenceRow[] }> {
  const { data: references, error } = await db
    .from('reference_sources')
    .select('id, title, kind, scope, url, is_authoritative, status')
    .eq('organization_id', organizationId)
    .eq('status', 'indexed')
    .or(`project_id.eq.${projectId},project_id.is.null`)
    .returns<ReferenceRow[]>();

  if (error) throw new Error(`Lettura della biblioteca fallita: ${error.message}`);
  if (!references || references.length === 0) return { entries: [], references: [] };

  const { data: chunks, error: chunkError } = await db
    .from('reference_chunks')
    .select('reference_id, chunk_index, page, heading, content, terms')
    .in(
      'reference_id',
      references.map((reference) => reference.id),
    )
    .order('chunk_index', { ascending: true })
    .limit(MAX_CHUNKS)
    .returns<ChunkRow[]>();

  if (chunkError) throw new Error(`Lettura dei blocchi fallita: ${chunkError.message}`);

  const byReference = new Map<string, ReferenceChunk[]>();
  for (const chunk of chunks ?? []) {
    const list = byReference.get(chunk.reference_id) ?? [];
    list.push({
      chunkIndex: chunk.chunk_index,
      page: chunk.page,
      heading: chunk.heading,
      content: chunk.content,
      terms: chunk.terms,
    });
    byReference.set(chunk.reference_id, list);
  }

  const entries = references.flatMap((reference) => {
    const forIndex: ReferenceForIndex = {
      id: reference.id,
      title: reference.title,
      kind: reference.kind,
      url: reference.url,
      isAuthoritative: reference.is_authoritative,
      scope: reference.scope,
    };
    return referenceEntries(forIndex, byReference.get(reference.id) ?? []);
  });

  return { entries, references };
}

/**
 * Indice completo di un progetto: documentazione ufficiale più biblioteca.
 * Quando la biblioteca è vuota il risultato coincide con l'indice ufficiale.
 */
export async function buildProjectIndex(
  db: SupabaseClient,
  organizationId: string,
  projectId: string,
): Promise<{ index: SourceIndex; libraryEntries: number; references: ReferenceRow[] }> {
  const { entries, references } = await loadLibraryEntries(db, organizationId, projectId);

  return {
    index: buildSourceIndex([...catalogAsEntries(), ...entries]),
    libraryEntries: entries.length,
    references,
  };
}
