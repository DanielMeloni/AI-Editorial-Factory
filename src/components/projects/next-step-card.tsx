import Link from 'next/link';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { FlowWheel } from '@/components/projects/flow-wheel';
import type { ProgressoProgetto } from '@/lib/projects/progress';

/**
 * Il processo in cima alla panoramica.
 *
 * A sinistra l'anello delle fasi, a destra dove si è e cosa fare adesso: la
 * figura dice a colpo d'occhio a che punto siamo, l'elenco dice cosa
 * significa. Una sola azione in evidenza — se ne mostrassimo tre saremmo
 * tornati al problema di partenza, sapere tutto tranne da dove cominciare.
 *
 * Ogni fase è raggiungibile sia dal settore sia dalla riga: il disegno è un
 * modo di navigare, non un'illustrazione da guardare.
 */
export function NextStepCard({ progresso, volumeId }: { progresso: ProgressoProgetto; volumeId?: string }) {
  const { prossima, fasi, completate } = progresso;
  const hrefConVolume = (href: string) => volumeId ? `${href}?volume=${volumeId}` : href;

  return (
    <Card className={cn(prossima ? 'border-warning/40' : 'border-success/40')}>
      <CardContent className="flex flex-col items-center gap-6 p-5 md:flex-row md:items-start">
        <FlowWheel fasi={fasi} correnteKey={prossima?.key ?? null} completate={completate} />

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {prossima ? `Prossimo passo · ${prossima.label}` : 'Tutto fatto'}
            </p>
            <p className="text-base font-medium text-foreground">
              {prossima
                ? prossima.azione
                : 'Ogni fase è conclusa: il volume è pronto da pubblicare.'}
            </p>
            <Link
              href={hrefConVolume(prossima ? prossima.href : fasi[fasi.length - 1]!.href)}
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'mt-2')}
            >
              {prossima ? `Vai a ${prossima.label}` : 'Apri l’anteprima'}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>

          <ol className="divide-y divide-border-subtle border-t border-border-subtle">
            {fasi.map((fase, indice) => {
              const corrente = fase.key === prossima?.key;
              return (
                <li key={fase.key}>
                  <Link
                    href={hrefConVolume(fase.href)}
                    aria-current={corrente ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-3 px-1 py-2 text-sm transition-colors hover:bg-surface-muted',
                      corrente ? 'font-medium text-warning' : 'text-muted-foreground',
                      fase.fatta && !corrente && 'text-foreground',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        fase.fatta
                          ? 'bg-success-surface text-success'
                          : corrente
                            ? 'bg-warning-surface text-warning'
                            : 'bg-surface-muted text-muted-foreground',
                      )}
                    >
                      {fase.fatta ? <Check className="size-3" /> : indice + 1}
                    </span>

                    <span className="min-w-0 flex-1 truncate">{fase.label}</span>

                    {fase.dettaglio ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fase.dettaglio}
                      </span>
                    ) : null}

                    <span className="sr-only">
                      {fase.fatta ? 'conclusa' : corrente ? 'prossimo passo' : 'da fare'}
                    </span>

                    {corrente ? (
                      <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : fase.fatta ? null : (
                      <Circle className="size-2 shrink-0 text-border-strong" aria-hidden="true" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
