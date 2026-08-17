import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getWebSearchProvider } from '@/lib/ai/registry';
import { runAgent } from '@/lib/agents/runner';
import { sourceDiscoveryAgent } from '@/lib/agents/definitions';
import type { WebCandidate } from '@/lib/agents/schemas';
import { canonicalUrl, lookupUrl } from './catalog';
import { verifyUrls, type VerifiedUrl } from './verify-url';

/**
 * Ricerca di fonti sul web da usare come base del manuale.
 *
 * Quattro passaggi, in quest'ordine, e l'ordine è la sostanza:
 *
 *   1. **si formula** che cosa cercare, a partire dall'argomento del volume;
 *   2. **si cerca**, con il motore configurato;
 *   3. **si verifica**: ogni indirizzo viene aperto. Chi non risponde cade qui,
 *      e non arriva mai sotto gli occhi di nessuno;
 *   4. **si sceglie**, fra ciò che è sopravvissuto, motivando.
 *
 * Il terzo passaggio è quello che permette di aprire la ricerca al web senza
 * perdere la garanzia dell'indice chiuso. Un motore può riferire un indirizzo
 * plausibile e inesistente; una pagina che risponde 200 esiste. Fra «esiste» e
 * «è utile» decide poi una persona, che è come dev'essere.
 */

export interface DiscoveryOutcome {
  /** Fonti proposte, già scritte in biblioteca come `proposed`. */
  proposed: number;
  /** Indirizzi cercati, prima della verifica. */
  found: number;
  /** Indirizzi caduti alla verifica: non raggiungibili o non testuali. */
  unreachable: number;
  /** Indirizzi già presenti in biblioteca o nell'indice ufficiale. */
  alreadyKnown: number;
  queries: string[];
  warnings: string[];
  estimatedCostUsd: number;
}

/** Quante pagine si verificano al massimo: oltre, si spende tempo per nulla. */
const MAX_CANDIDATES = 40;

/**
 * Che cosa cercare, ricavato dall'opera.
 *
 * Le interrogazioni sono poche e mirate. Una ricerca per ogni capitolo darebbe
 * decine di chiamate e un elenco che nessuno leggerebbe: meglio tre domande
 * buone sull'argomento del volume, e l'autore che ne aggiunge una propria
 * quando sa che cosa gli manca.
 */
export function buildQueries(input: {
  title: string;
  subtitle: string | null;
  topics: string[];
  extra?: string | null;
}): string[] {
  const argomento = [input.title, input.subtitle].filter(Boolean).join(' — ');
  const principali = input.topics.slice(0, 8).join(', ');

  const queries = [
    `Documentazione ufficiale e riferimenti tecnici per un manuale su ${argomento}.`,
    principali
      ? `Fonti autorevoli su questi argomenti, per un manuale tecnico: ${principali}.`
      : null,
    `Guide, specifiche e riferimenti API aggiornati su ${input.title}.`,
  ].filter((query): query is string => query !== null);

  if (input.extra && input.extra.trim().length > 0) {
    // L'interrogazione dell'autore viene per prima: sa lui che cosa gli manca.
    queries.unshift(input.extra.trim());
  }

  return queries;
}

export interface DiscoveryContext {
  db: SupabaseClient;
  organizationId: string;
  projectId: string;
  actorId: string | null;
}

/**
 * Esegue la ricerca e scrive in biblioteca le fonti proposte.
 *
 * Non lancia per un motore assente o una pagina irraggiungibile: sono esiti,
 * e vengono riferiti. Lancia solo se il database rifiuta la scrittura.
 */
export async function discoverSources(
  context: DiscoveryContext,
  project: { title: string; subtitle: string | null; language: string },
  topics: string[],
  extraQuery?: string | null,
): Promise<DiscoveryOutcome> {
  const warnings: string[] = [];
  const queries = buildQueries({
    title: project.title,
    subtitle: project.subtitle,
    topics,
    extra: extraQuery,
  });

  // -----------------------------------------------------------------------
  // 1-2 · Ricerca
  // -----------------------------------------------------------------------
  const { provider, degraded } = getWebSearchProvider();
  if (degraded) warnings.push(degraded);

  const trovati = new Map<string, string>();
  let costo = 0;

  for (const query of queries) {
    const esito = await provider.search({ query, maxResults: 12 });
    costo += esito.estimatedCostUsd;
    warnings.push(...esito.warnings);

    for (const hit of esito.hits) {
      const chiave = canonicalUrl(hit.url);
      if (chiave === null || trovati.has(chiave)) continue;
      trovati.set(chiave, hit.url);
    }
  }

  const found = trovati.size;

  // -----------------------------------------------------------------------
  // Ciò che già si conosce non va né verificato né riproposto
  // -----------------------------------------------------------------------
  const { data: esistenti } = await context.db
    .from('reference_sources')
    .select('url')
    .eq('organization_id', context.organizationId)
    .not('url', 'is', null)
    .returns<{ url: string }[]>();

  const conosciuti = new Set<string>();
  for (const riga of esistenti ?? []) {
    const chiave = canonicalUrl(riga.url);
    if (chiave !== null) conosciuti.add(chiave);
  }

  const daVerificare: string[] = [];
  let alreadyKnown = 0;

  for (const [chiave, url] of trovati) {
    if (conosciuti.has(chiave) || lookupUrl(url) !== null) {
      alreadyKnown += 1;
      continue;
    }
    if (daVerificare.length < MAX_CANDIDATES) daVerificare.push(url);
  }

  if (daVerificare.length === 0) {
    return {
      proposed: 0,
      found,
      unreachable: 0,
      alreadyKnown,
      queries,
      warnings: [
        ...warnings,
        found === 0
          ? 'Nessun indirizzo trovato.'
          : 'Tutti gli indirizzi trovati erano già noti alla biblioteca o all’indice ufficiale.',
      ],
      estimatedCostUsd: costo,
    };
  }

  // -----------------------------------------------------------------------
  // 3 · Verifica: qui cade ciò che non esiste
  // -----------------------------------------------------------------------
  const verificati = await verifyUrls(daVerificare);
  const vivi = verificati.filter((esito) => esito.ok);
  const unreachable = verificati.length - vivi.length;

  if (unreachable > 0) {
    warnings.push(
      `${unreachable} indirizzi scartati perché non raggiungibili o non testuali: ` +
        'non vengono proposti.',
    );
  }

  if (vivi.length === 0) {
    return {
      proposed: 0,
      found,
      unreachable,
      alreadyKnown,
      queries,
      warnings,
      estimatedCostUsd: costo,
    };
  }

  // -----------------------------------------------------------------------
  // 4 · Selezione motivata
  // -----------------------------------------------------------------------
  const candidates: WebCandidate[] = vivi.map((esito) => ({
    url: esito.url,
    // Il titolo è quello letto dalla pagina, non quello dichiarato dal motore.
    title: (esito.title ?? esito.domain).slice(0, 300),
    domain: esito.domain,
    isOfficial: esito.isOfficial,
    isCommunity: esito.isCommunity,
    excerpt: esito.excerpt?.slice(0, 1000) ?? null,
  }));

  const result = await runAgent(
    sourceDiscoveryAgent,
    {
      projectTitle: project.title,
      subtitle: project.subtitle,
      language: project.language,
      topics: topics.slice(0, 60),
      candidates,
    },
    {
      db: context.db,
      organizationId: context.organizationId,
      projectId: context.projectId,
      chapterId: null,
      workflowRunId: null,
      stepName: 'ricerca-fonti-web',
    },
  );

  warnings.push(...result.warnings);

  // Un modello può restituire un URL che non gli era stato dato. Non è una
  // possibilità teorica: è il motivo per cui la selezione viene ricondotta
  // all'elenco verificato invece di essere creduta sulla parola.
  const perUrl = new Map(vivi.map((esito) => [esito.url, esito]));
  const scelte = result.output.selected.filter((voce) => perUrl.has(voce.url));

  if (scelte.length < result.output.selected.length) {
    warnings.push(
      `${result.output.selected.length - scelte.length} proposte scartate: indirizzi non ` +
        'presenti fra quelli verificati.',
    );
  }

  // -----------------------------------------------------------------------
  // Scrittura in biblioteca, come proposte
  // -----------------------------------------------------------------------
  const now = new Date().toISOString();
  const righe = scelte.map((voce) => {
    const verificato = perUrl.get(voce.url) as VerifiedUrl;
    return {
      organization_id: context.organizationId,
      project_id: context.projectId,
      kind: 'link' as const,
      scope: 'project' as const,
      title: voce.title.slice(0, 300) || verificato.domain,
      url: voce.url,
      publisher: verificato.domain,
      is_authoritative: verificato.isOfficial,
      status: 'proposed' as const,
      added_by: 'ricerca_web' as const,
      rationale: voce.rationale,
      discovery_query: queries.join(' · ').slice(0, 2000),
      web_kind: voce.kind,
      priority: voce.priority,
      http_status: verificato.status,
      verified_at: now,
      created_by: context.actorId,
    };
  });

  for (let i = 0; i < righe.length; i += 50) {
    const { error } = await context.db.from('reference_sources').insert(righe.slice(i, i + 50));
    if (error) throw new Error(`Salvataggio delle fonti proposte fallito: ${error.message}`);
  }

  return {
    proposed: righe.length,
    found,
    unreachable,
    alreadyKnown,
    queries,
    warnings,
    estimatedCostUsd: costo + result.estimatedCostUsd,
  };
}
