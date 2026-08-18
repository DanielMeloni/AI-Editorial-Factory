import Link from 'next/link';
import type { FaseProgetto } from '@/lib/projects/progress';

/**
 * Il processo come anello: sei fasi, ognuna cliccabile.
 *
 * La forma circolare non è decorazione. Il lavoro su un manuale è ciclico —
 * si torna alle fonti, si riapre un capitolo, si rigenera l'anteprima — e una
 * barra dritta suggerirebbe una fine che non c'è. L'anello dice che si gira.
 *
 * Il colore distingue tre stati, non sei fasi: verde concluso, giallo ciò che
 * aspetta te, grigio ciò che non si può ancora fare. Sono gli stessi tre colori
 * della barra di navigazione — usarne altri qui racconterebbe due storie dello
 * stesso lavoro.
 */

const CX = 150;
const CY = 150;
const R_EST = 132;
const R_INT = 74;
/** Distacco fra i settori, in gradi. */
const STACCO = 3;

function punto(raggio: number, gradi: number): [number, number] {
  const rad = ((gradi - 90) * Math.PI) / 180;
  return [CX + raggio * Math.cos(rad), CY + raggio * Math.sin(rad)];
}

function settore(indice: number, totale: number): string {
  const passo = 360 / totale;
  const a0 = indice * passo + STACCO / 2;
  const a1 = (indice + 1) * passo - STACCO / 2;
  const [x0, y0] = punto(R_EST, a0);
  const [x1, y1] = punto(R_EST, a1);
  const [x2, y2] = punto(R_INT, a1);
  const [x3, y3] = punto(R_INT, a0);
  const grande = a1 - a0 > 180 ? 1 : 0;
  return (
    `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
    `A ${R_EST} ${R_EST} 0 ${grande} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `L ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
    `A ${R_INT} ${R_INT} 0 ${grande} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
  );
}

export function FlowWheel({
  fasi,
  correnteKey,
  completate,
}: {
  fasi: FaseProgetto[];
  correnteKey: string | null;
  completate: number;
}) {
  return (
    <svg
      viewBox="0 0 300 300"
      className="h-auto w-full max-w-[280px] shrink-0"
      role="group"
      aria-label="Fasi del progetto"
    >
      {fasi.map((fase, indice) => {
        const corrente = fase.key === correnteKey;
        const passo = 360 / fasi.length;
        const [tx, ty] = punto((R_EST + R_INT) / 2, indice * passo + passo / 2);

        const fondo = fase.fatta
          ? 'var(--success)'
          : corrente
            ? 'var(--warning)'
            : 'var(--surface-muted)';
        // Sul giallo il bianco non regge: l'inchiostro scuro è leggibile sia
        // nella tavolozza chiara sia in quella scura, dove il giallo schiarisce.
        const inchiostro = fase.fatta
          ? '#ffffff'
          : corrente
            ? '#16233d'
            : 'var(--muted-foreground)';

        return (
          <Link
            key={fase.key}
            href={fase.href}
            className="outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80"
          >
            <title>
              {`${indice + 1}. ${fase.label} — ${
                fase.fatta ? 'conclusa' : corrente ? 'prossimo passo' : 'da fare'
              }`}
            </title>
            <path
              d={settore(indice, fasi.length)}
              fill={fondo}
              stroke={corrente ? 'var(--warning)' : 'transparent'}
              strokeWidth={corrente ? 4 : 0}
            />
            <text
              x={tx.toFixed(1)}
              y={(ty + 5).toFixed(1)}
              textAnchor="middle"
              fontSize="17"
              fontWeight="700"
              fill={inchiostro}
              className="pointer-events-none select-none"
            >
              {indice + 1}
            </text>
          </Link>
        );
      })}

      {/* Il mozzo: quanto è concluso, senza doverlo contare sui settori. */}
      <circle cx={CX} cy={CY} r={R_INT - 8} fill="var(--surface)" />
      <text
        x={CX}
        y={CY - 2}
        textAnchor="middle"
        fontSize="28"
        fontWeight="700"
        fill="var(--foreground)"
      >
        {completate}/{fasi.length}
      </text>
      <text x={CX} y={CY + 18} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
        fasi concluse
      </text>
    </svg>
  );
}
