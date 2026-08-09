import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, TriangleAlert, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { eseguiDiagnosi, type Esito } from '@/lib/diagnostics/checks';

export const metadata: Metadata = { title: 'Diagnostica' };
export const dynamic = 'force-dynamic';

const ICONE: Record<Esito, { icona: typeof CheckCircle2; classe: string; etichetta: string }> = {
  ok: { icona: CheckCircle2, classe: 'text-success', etichetta: 'Superato' },
  avviso: { icona: TriangleAlert, classe: 'text-warning', etichetta: 'Avviso' },
  errore: { icona: XCircle, classe: 'text-danger', etichetta: 'Errore' },
  saltato: { icona: CircleDashed, classe: 'text-muted-foreground', etichetta: 'Saltato' },
};

/**
 * Pagina di diagnosi della configurazione.
 *
 * Deliberatamente accessibile senza autenticazione: se il database non è
 * raggiungibile, nemmeno l'accesso funziona, e una diagnosi dietro il login
 * sarebbe irraggiungibile proprio quando serve.
 *
 * Non espone alcun valore: riporta soltanto se una cosa è presente o assente,
 * e come rimediare. Un attaccante non apprende nulla che non scoprirebbe
 * tentando di usare l'applicazione.
 */
export default async function DiagnosticaPage() {
  const diagnosi = await eseguiDiagnosi();

  return (
    <main
      id="contenuto-principale"
      className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-12"
    >
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Diagnostica della configurazione</h1>
        <p className="text-sm text-muted-foreground">
          Verifica che l’applicazione possa funzionare. Nessun valore viene mostrato: solo che cosa
          è presente e che cosa manca.
        </p>
      </header>

      {diagnosi.pronto ? (
        <Alert tone="success" title="Configurazione completa">
          Tutti i controlli sono superati
          {diagnosi.avvisi > 0 ? `, con ${diagnosi.avvisi} avvis${diagnosi.avvisi === 1 ? 'o' : 'i'}` : ''}.
          L’applicazione può funzionare.
        </Alert>
      ) : (
        <Alert tone="danger" title={`${diagnosi.errori} problem${diagnosi.errori === 1 ? 'a' : 'i'} da risolvere`}>
          Finché restano aperti, le pagine che leggono dati falliranno con la schermata di errore.
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Controlli</CardTitle>
          <CardDescription>Eseguiti al momento del caricamento della pagina.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul className="divide-y divide-border-subtle">
            {diagnosi.controlli.map((controllo) => {
              const { icona: Icona, classe, etichetta } = ICONE[controllo.esito];
              return (
                <li key={controllo.nome} className="flex gap-3 px-5 py-3.5">
                  <Icona className={`mt-0.5 size-4 shrink-0 ${classe}`} aria-hidden="true" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {controllo.nome}
                      <span className="sr-only"> — {etichetta}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{controllo.dettaglio}</p>
                    {controllo.rimedio ? (
                      <p className="text-sm text-foreground/80">→ {controllo.rimedio}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Comandi utili</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
              npm run check:env
            </code>{' '}
            verifica le variabili di ambiente senza stampare alcun segreto.
          </p>
          <p>
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
              npx supabase db push
            </code>{' '}
            applica le migration. In alternativa, incolla{' '}
            <code className="font-mono text-xs">supabase/setup-completo.sql</code> nell’SQL Editor.
          </p>
          <p>
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
              npm run dev
            </code>{' '}
            mostra il messaggio d’errore completo nella pagina, cosa che la build di produzione non fa.
          </p>
        </CardContent>
      </Card>

      <div>
        <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>
          Torna all’applicazione
        </Link>
      </div>
    </main>
  );
}
