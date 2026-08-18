'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import {
  FORMATI,
  type FormatoKey,
  type FormatoStampa,
  formatoLibro,
  pagineStimate,
  parolePerPagina,
} from '@/lib/editorial/pagine';

/**
 * Formato di stampa scelto per la stima delle pagine.
 *
 * La scelta è unica per tutta la pagina, non per riga: capitoli misurati in
 * formati diversi non sarebbero confrontabili, ed è il confronto la ragione per
 * cui si guarda un indice.
 */

interface Contesto {
  formato: FormatoStampa;
  setFormato: (key: FormatoKey) => void;
}

const FormatoContext = createContext<Contesto | null>(null);

export function FormatoStampaProvider({
  children,
  trim,
}: {
  children: React.ReactNode;
  /** Misure rifilate del libro, quando la copertina è già stata salvata. */
  trim: { widthMm: number; heightMm: number } | null;
}) {
  const formati = useMemo(
    () => FORMATI.map((formato) => (formato.key === 'libro' ? formatoLibro(trim) : formato)),
    [trim],
  );

  const [scelto, setScelto] = useState<FormatoKey>('libro');
  const formato = formati.find((f) => f.key === scelto) ?? formati[0]!;

  const valore = useMemo<Contesto>(() => ({ formato, setFormato: setScelto }), [formato]);

  return (
    <FormatoContext.Provider value={valore}>
      <FormatoSelettore formati={formati} scelto={scelto} onScegli={setScelto} />
      {children}
    </FormatoContext.Provider>
  );
}

function FormatoSelettore({
  formati,
  scelto,
  onScegli,
}: {
  formati: FormatoStampa[];
  scelto: FormatoKey;
  onScegli: (key: FormatoKey) => void;
}) {
  const attivo = formati.find((f) => f.key === scelto) ?? formati[0]!;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span id="formato-stampa" className="font-medium text-foreground">
        Pagine stimate in
      </span>

      <div role="group" aria-labelledby="formato-stampa" className="flex flex-wrap gap-1">
        {formati.map((formato) => (
          <button
            key={formato.key}
            type="button"
            aria-pressed={formato.key === scelto}
            onClick={() => onScegli(formato.key)}
            title={`${formato.widthMm} × ${formato.heightMm} mm · circa ${parolePerPagina(formato)} parole per pagina`}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs transition-colors',
              formato.key === scelto
                ? 'bg-primary/10 font-medium text-primary'
                : 'bg-surface-muted hover:bg-surface-muted/70',
            )}
          >
            {formato.label}
          </button>
        ))}
      </div>

      <span>
        {attivo.widthMm} × {attivo.heightMm} mm · circa {parolePerPagina(attivo)} parole per pagina.
        Le figure e i blocchi di codice non sono contati: il conto reale sarà maggiore, mai minore.
      </span>
    </div>
  );
}

/** Pagine stimate per un capitolo, nel formato scelto in testa alla pagina. */
export function PagineChip({ words }: { words: number }) {
  const contesto = useContext(FormatoContext);
  if (!contesto) return null;

  const pagine = pagineStimate(words, contesto.formato);
  if (pagine === 0) return null;

  return (
    <Badge
      tone="neutral"
      title={`Stima su ${words.toLocaleString('it-IT')} parole in formato ${contesto.formato.label}. Figure e codice esclusi.`}
    >
      ≈ {pagine} pag.
      <span className="sr-only"> stimate in formato {contesto.formato.label}</span>
    </Badge>
  );
}

/** Pagine stimate per l'intera opera. */
export function PagineTotali({ words }: { words: number }) {
  const contesto = useContext(FormatoContext);
  if (!contesto) return null;

  return (
    <>
      circa {pagineStimate(words, contesto.formato).toLocaleString('it-IT')} pagine in{' '}
      {contesto.formato.label}
    </>
  );
}
