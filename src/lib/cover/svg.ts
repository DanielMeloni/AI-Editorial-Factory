import { BRAND_FONT_STACK } from '@/lib/cover/brand';

/**
 * Composizione tipografica dentro un SVG.
 *
 * Sta in un modulo proprio perché la usano due cose diverse — la copertina e
 * l'anteprima dei corsi — e una di queste funzioni è la neutralizzazione dei
 * caratteri XML. Duplicarla significherebbe correggerla una volta sola su due,
 * ed è esattamente il tipo di funzione che non si può correggere a metà.
 */

export interface TextStyle {
  size: number;
  weight: string;
  fill: string;
  letterSpacing?: number;
  lineHeight?: number;
  maxLines?: number;
  anchor?: 'start' | 'middle' | 'end';
}

export function svgText(x: number, y: number, content: string, style: TextStyle): string {
  return (
    `<text x="${round2(x)}" y="${round2(y)}" font-family="${BRAND_FONT_STACK}" ` +
    `font-size="${style.size}" font-weight="${style.weight}" fill="${style.fill}"` +
    (style.letterSpacing ? ` letter-spacing="${style.letterSpacing}"` : '') +
    (style.anchor ? ` text-anchor="${style.anchor}"` : '') +
    `>${content}</text>`
  );
}

/**
 * Manda a capo il testo stimando la larghezza dei caratteri.
 *
 * È una stima: senza metriche del font non esiste un calcolo esatto, e per
 * un'anteprima è sufficiente.
 */
export function wrapSvgText(
  content: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle,
): string[] {
  const larghezzaCarattere = style.size * 0.52;
  const perRiga = Math.max(1, Math.floor(width / larghezzaCarattere));
  const lineHeight = style.lineHeight ?? style.size * 1.25;

  const parole = content.split(/\s+/);
  const righe: string[] = [];
  let corrente = '';

  for (const parola of parole) {
    const tentativo = corrente ? `${corrente} ${parola}` : parola;
    if (tentativo.length <= perRiga) {
      corrente = tentativo;
    } else {
      if (corrente) righe.push(corrente);
      corrente = parola;
    }
  }
  if (corrente) righe.push(corrente);

  const limite = style.maxLines ?? righe.length;
  const visibili = righe.slice(0, limite);
  if (righe.length > limite && visibili.length > 0) {
    visibili[visibili.length - 1] = `${visibili[visibili.length - 1]!.slice(0, -1)}…`;
  }

  return visibili.map((riga, index) => svgText(x, y + index * lineHeight, riga, style));
}

/** Un titolo con `<script>` dentro non deve poter alterare l'SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
