import { describe, expect, it } from 'vitest';
import {
  calculateSpine,
  canLockSpine,
  estimateMmPerPageFromGrammage,
} from '@/lib/cover/spine';
import { buildIsbnBarcode, ean13CheckDigit, isbn10To13, toIsbn13 } from '@/lib/cover/barcode';
import { COVER_BACKGROUND } from '@/lib/cover/brand';
import { buildCoverPreviewSvg, computeCoverLayout } from '@/lib/cover/layout';

describe('calcolo del dorso', () => {
  it('millimetri per pagina', () => {
    const esito = calculateSpine({
      formula: 'mm_per_page',
      factor: 0.1,
      pageCount: 320,
      coverThicknessMm: 0,
    });

    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.spineMm).toBe(32);
      expect(esito.breakdown).toContain('320 pagine × 0.1 mm/pagina');
    }
  });

  it('pagine per pollice', () => {
    // 400 pagine ÷ 400 PPI = 1 pollice = 25,4 mm
    const esito = calculateSpine({
      formula: 'pages_per_inch',
      factor: 400,
      pageCount: 400,
      coverThicknessMm: 0,
    });

    expect(esito.ok).toBe(true);
    if (esito.ok) expect(esito.spineMm).toBe(25.4);
  });

  it('valore fisso imposto dal fornitore', () => {
    const esito = calculateSpine({
      formula: 'fixed',
      factor: 18.5,
      pageCount: 250,
      coverThicknessMm: 0,
    });

    expect(esito.ok).toBe(true);
    if (esito.ok) expect(esito.spineMm).toBe(18.5);
  });

  it('somma lo spessore dei cartoni per la brossura rigida', () => {
    const esito = calculateSpine({
      formula: 'mm_per_page',
      factor: 0.1,
      pageCount: 300,
      coverThicknessMm: 4,
    });

    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.spineMm).toBe(34);
      expect(esito.breakdown).toContain('4 mm di cartone');
    }
  });

  it('rifiuta un numero di pagine non valido', () => {
    for (const pageCount of [0, -10, 1.5]) {
      const esito = calculateSpine({
        formula: 'mm_per_page',
        factor: 0.1,
        pageCount,
        coverThicknessMm: 0,
      });
      expect(esito.ok).toBe(false);
    }
  });

  it('rifiuta un fattore non positivo', () => {
    const esito = calculateSpine({
      formula: 'mm_per_page',
      factor: 0,
      pageCount: 100,
      coverThicknessMm: 0,
    });
    expect(esito.ok).toBe(false);
  });

  it('arrotonda al centesimo di millimetro', () => {
    const esito = calculateSpine({
      formula: 'pages_per_inch',
      factor: 434,
      pageCount: 317,
      coverThicknessMm: 0,
    });
    expect(esito.ok).toBe(true);
    if (esito.ok) expect(esito.spineMm).toBe(Math.round(esito.spineMm * 100) / 100);
  });
});

describe('condizione per bloccare il dorso', () => {
  it('richiede sia il numero di pagine sia una larghezza calcolata', () => {
    expect(canLockSpine(320, 32)).toBe(true);
    expect(canLockSpine(null, 32)).toBe(false);
    expect(canLockSpine(320, null)).toBe(false);
    expect(canLockSpine(0, 32)).toBe(false);
    expect(canLockSpine(320, 0)).toBe(false);
  });
});

describe('stima dello spessore dalla grammatura', () => {
  it('cresce con la grammatura e con il volume della carta', () => {
    const liscia = estimateMmPerPageFromGrammage(90, 'liscia');
    const normale = estimateMmPerPageFromGrammage(90, 'normale');
    const voluminosa = estimateMmPerPageFromGrammage(90, 'voluminosa');

    expect(liscia).toBeLessThan(normale);
    expect(normale).toBeLessThan(voluminosa);
    expect(normale).toBeCloseTo(0.09, 2);
  });
});

describe('cifra di controllo EAN-13', () => {
  it.each([
    ['978030640615', 7],  // ISBN noto per la verifica dell'algoritmo
    ['400638133393', 1],
  ])('calcola %s → %i', (base, atteso) => {
    expect(ean13CheckDigit(base)).toBe(atteso);
  });

  it('la cifra rende il totale pesato un multiplo di dieci', () => {
    const base = '978886030182';
    const controllo = ean13CheckDigit(base);
    const completo = `${base}${controllo}`;

    let somma = 0;
    for (let i = 0; i < 13; i += 1) {
      somma += Number(completo[i]) * (i % 2 === 0 ? 1 : 3);
    }
    expect(somma % 10).toBe(0);
  });
});

describe('normalizzazione dell’ISBN', () => {
  it('accetta un ISBN-13 con trattini', () => {
    expect(toIsbn13('978-0-306-40615-7')).toBe('9780306406157');
  });

  it('rifiuta un ISBN-13 con cifra di controllo errata', () => {
    expect(toIsbn13('9780306406158')).toBeNull();
  });

  it('converte un ISBN-10 in ISBN-13', () => {
    expect(isbn10To13('0-306-40615-2')).toBe('9780306406157');
  });

  it('rifiuta ciò che non è un ISBN', () => {
    expect(toIsbn13('non-un-isbn')).toBeNull();
    expect(toIsbn13('12345')).toBeNull();
  });
});

describe('codice a barre', () => {
  const esito = buildIsbnBarcode('978-0-306-40615-7');

  it('produce un SVG valido con l’ISBN normalizzato', () => {
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;

    expect(esito.isbn13).toBe('9780306406157');
    expect(esito.checkDigit).toBe(7);
    expect(esito.svg.startsWith('<svg')).toBe(true);
    expect(esito.svg).toContain('</svg>');
    expect(esito.svg).toContain('aria-label="Codice a barre ISBN 9780306406157"');
  });

  it('ha larghezza coerente con i 95 moduli dello standard più le zone di quiete', () => {
    if (!esito.ok) return;
    // 95 moduli + 11 di quiete a sinistra + 7 a destra = 113 moduli × 0,33 mm
    expect(esito.widthMm).toBeCloseTo(113 * 0.33, 2);
  });

  it('rifiuta un ISBN non valido invece di produrre un codice illeggibile', () => {
    const errato = buildIsbnBarcode('9780306406158');
    expect(errato.ok).toBe(false);
    if (!errato.ok) expect(errato.reason).toMatch(/non valido/i);
  });

  it('inserisce il prezzo quando richiesto, con caratteri XML neutralizzati', () => {
    const conPrezzo = buildIsbnBarcode('9780306406157', { priceLabel: '€ 29,90 <IT>' });
    expect(conPrezzo.ok).toBe(true);
    if (conPrezzo.ok) {
      expect(conPrezzo.svg).toContain('&lt;IT&gt;');
      expect(conPrezzo.svg).not.toContain('<IT>');
    }
  });

  it('è deterministico', () => {
    const a = buildIsbnBarcode('9780306406157');
    const b = buildIsbnBarcode('978-0-306-40615-7');
    if (a.ok && b.ok) expect(a.svg).toBe(b.svg);
  });
});

describe('geometria della copertina', () => {
  const layout = computeCoverLayout({
    trimWidthMm: 170,
    trimHeightMm: 240,
    spineMm: 32,
    bleedMm: 3,
    safetyMarginMm: 5,
  });

  it('somma i tre pannelli più l’abbondanza su entrambi i lati', () => {
    // 170 + 32 + 170 + 3 + 3
    expect(layout.totalWidthMm).toBe(378);
    expect(layout.totalHeightMm).toBe(246);
  });

  it('dispone i pannelli nell’ordine di stampa: quarta, dorso, fronte', () => {
    expect(layout.back.x).toBeLessThan(layout.spine.x);
    expect(layout.spine.x).toBeLessThan(layout.front.x);
    expect(layout.back.x + layout.back.width).toBe(layout.spine.x);
    expect(layout.spine.x + layout.spine.width).toBe(layout.front.x);
  });

  it('l’area rifilata esclude l’abbondanza', () => {
    expect(layout.trimBox.x).toBe(3);
    expect(layout.trimBox.width).toBe(372);
    expect(layout.trimBox.height).toBe(240);
  });

  it('le aree sicure rientrano del margine su ogni lato', () => {
    expect(layout.frontSafe.width).toBe(160);
    expect(layout.frontSafe.height).toBe(230);
    expect(layout.frontSafe.x).toBe(layout.front.x + 5);
  });

  it('segnala quando il dorso è troppo stretto per il testo', () => {
    const stretto = computeCoverLayout({
      trimWidthMm: 148, trimHeightMm: 210, spineMm: 4, bleedMm: 3, safetyMarginMm: 5,
    });
    expect(stretto.spineTooNarrowForText).toBe(true);
    expect(layout.spineTooNarrowForText).toBe(false);
  });

  it('regge un dorso nullo, come per un ebook o una brochure', () => {
    const senzaDorso = computeCoverLayout({
      trimWidthMm: 170, trimHeightMm: 240, spineMm: 0, bleedMm: 3, safetyMarginMm: 5,
    });
    expect(senzaDorso.spine.width).toBe(0);
    expect(senzaDorso.totalWidthMm).toBe(346);
  });
});

describe('anteprima della copertina', () => {
  const layout = computeCoverLayout({
    trimWidthMm: 170, trimHeightMm: 240, spineMm: 32, bleedMm: 3, safetyMarginMm: 5,
  });

  const svg = buildCoverPreviewSvg(layout, {
    title: 'Dataform in Pratica',
    subtitle: 'Dalla prima pipeline alla produzione',
    author: 'Daniel Meloni',
    seriesName: 'Dati & Ingegneria',
    backDescription: 'Un percorso pratico per portare Dataform in produzione su BigQuery.',
    biography: 'Daniel Meloni progetta piattaforme dati.',
  });

  it('produce un SVG con il riquadro corretto', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${layout.totalWidthMm} ${layout.totalHeightMm}"`);
    expect(svg).toContain('role="img"');
  });

  it('scrive titolo, autore e collana come testo, non come immagine', () => {
    expect(svg).toContain('Dataform in Pratica');
    expect(svg).toContain('Daniel Meloni');
    // La collana è un occhiello: va in maiuscolo, come sul sito. Il maiuscolo
    // si applica prima della neutralizzazione, o l'entità si romperebbe.
    expect(svg).toContain('DATI &amp; INGEGNERIA');
  });

  it('neutralizza i caratteri XML nei testi forniti', () => {
    const pericoloso = buildCoverPreviewSvg(layout, {
      title: '<script>alert(1)</script>',
      author: 'Autore & Co.',
    });
    expect(pericoloso).not.toContain('<script>');
    expect(pericoloso).toContain('&lt;script&gt;');
    expect(pericoloso).toContain('Autore &amp; Co.');
  });

  it('omette il testo sul dorso quando è troppo stretto', () => {
    const stretto = computeCoverLayout({
      trimWidthMm: 148, trimHeightMm: 210, spineMm: 3, bleedMm: 3, safetyMarginMm: 5,
    });
    const senzaTesto = buildCoverPreviewSvg(stretto, { title: 'Titolo', author: 'Autore' });
    expect(senzaTesto).not.toContain('rotate(90');
  });

  it('non compone alcun codice a barre sulla copertina', () => {
    // Scelta editoriale, non dimenticanza: la copertina resta immagine e
    // tipografia. L'ISBN continua a esistere come dato del volume — viene
    // validato al salvataggio — ma non viene stampato qui.
    expect(svg).not.toContain('Codice a barre');
    expect(svg.match(/<svg/g)).toHaveLength(1);
  });

  it('compone il logo dello strumento senza ritagliarlo', () => {
    const conLogo = buildCoverPreviewSvg(layout, { title: 'T', author: 'A' }, {
      logoHref: 'https://esempio.test/logo.png',
    });
    expect(conLogo).toContain('<image href="https://esempio.test/logo.png"');
    // `meet`, non `slice`: un marchio non si taglia per far quadrare il riquadro.
    expect(conLogo).toContain('preserveAspectRatio="xMaxYMax meet"');
    expect(buildCoverPreviewSvg(layout, { title: 'T', author: 'A' })).not.toContain('logo.png');
  });

  it('usa la palette della collana come fondo di riserva', () => {
    const senzaGrafiche = buildCoverPreviewSvg(layout, { title: 'T', author: 'A' });
    expect(senzaGrafiche).toContain(COVER_BACKGROUND.front);
    expect(senzaGrafiche).toContain(COVER_BACKGROUND.spine);
    expect(senzaGrafiche).toContain(COVER_BACKGROUND.back);
  });

  it('può nascondere le linee guida di stampa', () => {
    const senzaGuide = buildCoverPreviewSvg(layout, { title: 'T', author: 'A' }, {
      showGuides: false,
    });
    expect(senzaGuide).not.toContain('stroke-dasharray');
  });
});
