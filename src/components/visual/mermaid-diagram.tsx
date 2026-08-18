'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Disegna un diagramma Mermaid.
 *
 * Il sorgente è prodotto dal codice, non da un modello: è esatto per
 * costruzione, e resta consultabile sotto il disegno invece di essere nascosto.
 * È la prova di ciò che si sta guardando.
 *
 * La libreria pesa: viene caricata su richiesta, solo dove un diagramma esiste
 * davvero. Se il disegno non riesce, il sorgente torna in primo piano con il
 * motivo — un riquadro vuoto non direbbe se manca il diagramma o se è la resa
 * ad aver fallito.
 */
export function MermaidDiagram({
  source,
  title,
  className,
  mostraSorgente = true,
}: {
  source: string;
  title?: string | null;
  className?: string;
  /** Falso nelle anteprime piccole, dove il sorgente non entrerebbe. */
  mostraSorgente?: boolean;
}) {
  const reactId = useId();
  const identificativo = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;

  const [svg, setSvg] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    setSvg(null);
    setErrore(null);

    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          // Il sorgente è di produzione nostra, ma la resa resta comunque
          // sanificata: nessuna eccezione per la fiducia.
          securityLevel: 'strict',
          theme: 'neutral',
          flowchart: { useMaxWidth: true, htmlLabels: false },
        });
        const { svg: disegnato } = await mermaid.render(identificativo, source);
        if (vivo.current) setSvg(disegnato);
      } catch (error) {
        if (vivo.current) {
          setErrore(error instanceof Error ? error.message : 'Errore sconosciuto.');
        }
      }
    })();

    return () => {
      vivo.current = false;
    };
  }, [source, identificativo]);

  return (
    <div className={className}>
      {svg ? (
        <div
          role="img"
          aria-label={title ?? 'Diagramma'}
          className="[&_svg]:h-auto [&_svg]:w-full overflow-x-auto rounded-lg border border-border-subtle bg-surface-muted p-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : errore === null ? (
        <div className="rounded-lg border border-border-subtle bg-surface-muted p-3 text-xs text-muted-foreground">
          Disegno del diagramma in corso…
        </div>
      ) : (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          Il diagramma non è stato disegnato: {errore} Il sorgente qui sotto resta valido.
        </p>
      )}

      {mostraSorgente ? (
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Sorgente Mermaid
        </summary>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-border-subtle bg-surface-muted p-3 text-[11px] leading-tight">
          <code>{source}</code>
        </pre>
      </details>
      ) : null}
    </div>
  );
}
