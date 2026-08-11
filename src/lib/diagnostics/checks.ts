import 'server-only';

import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

/**
 * Autodiagnosi della configurazione.
 *
 * Serve a rispondere alla domanda «perché l'applicazione dà errore?» senza
 * dover leggere i log del server. In produzione Next.js sostituisce il
 * messaggio d'errore con un digest: senza questa pagina, chi installa
 * l'applicazione resta senza indizi.
 *
 * Nessun controllo stampa mai un valore: solo se una cosa c'è o non c'è, e come
 * rimediare.
 */

export type Esito = 'ok' | 'avviso' | 'errore' | 'saltato';

export interface Controllo {
  nome: string;
  esito: Esito;
  dettaglio: string;
  rimedio?: string;
}

export interface Diagnosi {
  controlli: Controllo[];
  errori: number;
  avvisi: number;
  pronto: boolean;
}

/** Tabelle senza le quali nessuna pagina può funzionare. */
const TABELLE_FONDAMENTALI = [
  'profiles',
  'organizations',
  'organization_members',
  'projects',
  'chapters',
] as const;

/** Tabelle delle collane: la loro assenza non impedisce l'uso ordinario. */
const TABELLE_COLLANE = ['series', 'series_volumes'] as const;

export async function eseguiDiagnosi(): Promise<Diagnosi> {
  const controlli: Controllo[] = [];

  // -------------------------------------------------------------------------
  // Da dove sta girando il server
  // -------------------------------------------------------------------------
  //
  // Next.js cerca `.env.local` nella cartella da cui viene avviato. Se il
  // server parte da un'altra cartella — un secondo clone del progetto, o una
  // shell aperta altrove — il file esiste ma non viene mai letto, e ogni
  // variabile risulta assente pur essendo scritta correttamente.
  const cartella = process.cwd();
  const envLocale = join(cartella, '.env.local');
  let envPresente = false;

  try {
    await access(envLocale);
    envPresente = true;
  } catch {
    envPresente = false;
  }

  controlli.push(
    envPresente
      ? {
          nome: 'File .env.local',
          esito: 'ok',
          dettaglio: `Trovato nella cartella da cui gira il server: ${cartella}`,
        }
      : {
          nome: 'File .env.local',
          esito: 'errore',
          dettaglio: `Non presente nella cartella da cui gira il server: ${cartella}`,
          rimedio:
            'Il server è stato avviato da una cartella diversa da quella del progetto, oppure il ' +
            'file ha un altro nome. Chiudi il server, spostati nella cartella che contiene ' +
            'package.json e riavvia.',
        },
  );

  // Le variabili NEXT_PUBLIC_* vengono sostituite staticamente durante `next
  // build`: modificarle dopo la build non ha alcun effetto finché non si
  // ricostruisce. È l'inganno più frequente in produzione locale.
  const inProduzione = process.env.NODE_ENV === 'production';
  if (inProduzione) {
    controlli.push({
      nome: 'Modalità di esecuzione',
      esito: 'avviso',
      dettaglio:
        'Build di produzione. Le variabili NEXT_PUBLIC_* sono state fissate al momento della build: ' +
        'se hai modificato .env.local dopo, il valore vecchio è ancora in uso.',
      rimedio: 'Dopo ogni modifica alle NEXT_PUBLIC_*, esegui di nuovo `npm run build`.',
    });
  }

  // -------------------------------------------------------------------------
  // Variabili di ambiente
  // -------------------------------------------------------------------------
  const urlApp = process.env.NEXT_PUBLIC_APP_URL;
  controlli.push(
    urlApp
      ? { nome: 'URL dell’applicazione', esito: 'ok', dettaglio: 'NEXT_PUBLIC_APP_URL è impostata.' }
      : {
          nome: 'URL dell’applicazione',
          esito: 'errore',
          dettaglio: 'NEXT_PUBLIC_APP_URL non è impostata.',
          rimedio: 'Aggiungila a .env.local, con lo schema: http://localhost:3000',
        },
  );

  const supabaseConfigurato = isSupabaseConfigured();
  controlli.push(
    supabaseConfigurato
      ? {
          nome: 'Configurazione Supabase',
          esito: 'ok',
          dettaglio: 'URL del progetto e publishable key sono presenti.',
        }
      : {
          nome: 'Configurazione Supabase',
          esito: 'errore',
          dettaglio: 'Manca NEXT_PUBLIC_SUPABASE_URL oppure NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
          rimedio: 'Esegui `npm run check:env`: elenca ciò che manca senza stampare alcun valore.',
        },
  );

  controlli.push(
    process.env.SUPABASE_SERVICE_ROLE_KEY
      ? {
          nome: 'Chiave di servizio',
          esito: 'ok',
          dettaglio: 'SUPABASE_SERVICE_ROLE_KEY è presente.',
        }
      : {
          nome: 'Chiave di servizio',
          esito: 'avviso',
          dettaglio:
            'SUPABASE_SERVICE_ROLE_KEY non è impostata: audit log e workflow non potranno scrivere.',
          rimedio:
            'Copiala da Supabase → Project Settings → API Keys → Secret key. Mai con prefisso NEXT_PUBLIC_.',
        },
  );

  // Senza configurazione non ha senso proseguire: i controlli sul database
  // fallirebbero tutti per la stessa ragione.
  if (!supabaseConfigurato) {
    for (const nome of ['Raggiungibilità di Supabase', 'Schema del database', 'Bucket di storage']) {
      controlli.push({
        nome,
        esito: 'saltato',
        dettaglio: 'Controllo saltato: la configurazione Supabase è incompleta.',
      });
    }
    return riepiloga(controlli);
  }

  // -------------------------------------------------------------------------
  // Raggiungibilità e schema
  // -------------------------------------------------------------------------
  let raggiungibile = false;

  try {
    const supabase = await createClient();
    // Una query leggerissima: interessa solo sapere se la risposta arriva.
    const { error } = await supabase.from('organizations').select('id', { head: true, count: 'exact' }).limit(1);

    if (!error) {
      raggiungibile = true;
      controlli.push({
        nome: 'Raggiungibilità di Supabase',
        esito: 'ok',
        dettaglio: 'Il progetto risponde e lo schema è accessibile.',
      });
    } else if (/relation .* does not exist|schema cache|PGRST205|PGRST20[0-9]/i.test(error.message)) {
      raggiungibile = true;
      controlli.push({
        nome: 'Raggiungibilità di Supabase',
        esito: 'ok',
        dettaglio: 'Il progetto risponde, ma lo schema non è ancora applicato.',
      });
    } else {
      controlli.push({
        nome: 'Raggiungibilità di Supabase',
        esito: 'errore',
        dettaglio: 'Il progetto non risponde come previsto.',
        rimedio:
          'Verifica NEXT_PUBLIC_SUPABASE_URL e che il progetto non sia in pausa nel dashboard.',
      });
    }
  } catch {
    controlli.push({
      nome: 'Raggiungibilità di Supabase',
      esito: 'errore',
      dettaglio: 'Connessione al progetto non riuscita.',
      rimedio: 'Controlla l’URL del progetto e la connessione di rete.',
    });
  }

  if (raggiungibile) {
    const mancanti = await tabelleMancanti([...TABELLE_FONDAMENTALI]);

    controlli.push(
      mancanti.length === 0
        ? {
            nome: 'Schema del database',
            esito: 'ok',
            dettaglio: 'Le tabelle fondamentali esistono.',
          }
        : {
            nome: 'Schema del database',
            esito: 'errore',
            dettaglio: `Mancano ${mancanti.length} tabelle fondamentali: ${mancanti.join(', ')}.`,
            rimedio:
              'Applica le migration: `npx supabase db push`, oppure incolla supabase/setup-completo.sql ' +
              'nell’SQL Editor rispettando l’interruzione segnalata nel file.',
          },
    );

    if (mancanti.length === 0) {
      const collaneMancanti = await tabelleMancanti([...TABELLE_COLLANE]);
      controlli.push(
        collaneMancanti.length === 0
          ? {
              nome: 'Fondamenta delle collane',
              esito: 'ok',
              dettaglio: 'Le tabelle della Fase 8 sono presenti.',
            }
          : {
              nome: 'Fondamenta delle collane',
              esito: 'avviso',
              dettaglio:
                'Le migration 13 e 14 non sono state applicate. L’applicazione funziona lo stesso: le collane arrivano con la Fase 8.',
              rimedio: 'Applica le migration più recenti quando vuoi.',
            },
      );
    }
  } else {
    controlli.push({
      nome: 'Schema del database',
      esito: 'saltato',
      dettaglio: 'Controllo saltato: il progetto non è raggiungibile.',
    });
  }

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------
  //
  // `storage.buckets` ha la RLS attiva: con la publishable key l'elenco torna
  // VUOTO senza errore. Interpretarlo come «i bucket non esistono» produce un
  // falso negativo. Solo il service role vede la verità; senza, il controllo
  // resta dichiaratamente non conclusivo.
  if (!raggiungibile) {
    controlli.push({
      nome: 'Bucket di storage',
      esito: 'saltato',
      dettaglio: 'Controllo saltato: il progetto non è raggiungibile.',
    });
  } else if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    controlli.push({
      nome: 'Bucket di storage',
      esito: 'avviso',
      dettaglio:
        'Controllo non conclusivo: senza chiave di servizio l’elenco dei bucket non è leggibile, ' +
        'perché protetto da RLS.',
      rimedio:
        'Imposta SUPABASE_SERVICE_ROLE_KEY, oppure verifica a mano nel dashboard che esistano i tre bucket privati.',
    });
  } else {
    try {
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const admin = createAdminClient();
      const attesi = ['project-sources', 'generated-assets', 'publication-exports'];

      const { data, error } = await admin.storage.listBuckets();

      if (error) {
        controlli.push({
          nome: 'Bucket di storage',
          esito: 'errore',
          dettaglio: 'Lettura dei bucket non riuscita con la chiave di servizio.',
          rimedio: 'Verifica che SUPABASE_SERVICE_ROLE_KEY appartenga a questo progetto.',
        });
      } else {
        const presenti = new Set((data ?? []).map((b) => b.name));
        const mancanti = attesi.filter((nome) => !presenti.has(nome));
        const pubblici = (data ?? []).filter((b) => attesi.includes(b.name) && b.public);

        if (mancanti.length > 0) {
          controlli.push({
            nome: 'Bucket di storage',
            esito: 'errore',
            dettaglio: `Mancano ${mancanti.length} bucket: ${mancanti.join(', ')}.`,
            rimedio:
              'Li crea la migration 10. Se lo schema è già applicato, creali a mano dal dashboard ' +
              'in Storage → New bucket, lasciandoli PRIVATI.',
          });
        } else if (pubblici.length > 0) {
          controlli.push({
            nome: 'Bucket di storage',
            esito: 'errore',
            dettaglio: `${pubblici.length} bucket risultano pubblici: archivi e PDF sarebbero scaricabili da chiunque.`,
            rimedio: 'Rendili privati dal dashboard, in Storage → Configuration.',
          });
        } else {
          controlli.push({
            nome: 'Bucket di storage',
            esito: 'ok',
            dettaglio: 'I tre bucket esistono e sono privati.',
          });
        }
      }
    } catch {
      controlli.push({
        nome: 'Bucket di storage',
        esito: 'avviso',
        dettaglio: 'Controllo non riuscito.',
      });
    }
  }

  return riepiloga(controlli);
}

/** Verifica l'esistenza di una tabella con una query a costo trascurabile. */
async function tabelleMancanti(nomi: string[]): Promise<string[]> {
  const supabase = await createClient();
  const mancanti: string[] = [];

  for (const nome of nomi) {
    const { error } = await supabase.from(nome).select('*', { head: true, count: 'exact' }).limit(1);
    // Un errore di permessi significa che la tabella esiste: è la RLS a negare.
    if (error && /does not exist|schema cache|PGRST205/i.test(error.message)) {
      mancanti.push(nome);
    }
  }

  return mancanti;
}

function riepiloga(controlli: Controllo[]): Diagnosi {
  const errori = controlli.filter((c) => c.esito === 'errore').length;
  const avvisi = controlli.filter((c) => c.esito === 'avviso').length;
  return { controlli, errori, avvisi, pronto: errori === 0 };
}
