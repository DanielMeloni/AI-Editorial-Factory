import { z } from 'zod';
import { analyzeMarkdown, slugify } from '@/lib/ingest/markdown';

/**
 * Derivazione di lezione e articolo dal capitolo approvato.
 *
 * Regola non negoziabile: **la trasformazione non altera il significato
 * tecnico**. Ciò che si può estrarre viene estratto alla lettera; ciò che
 * richiede scrittura resta dichiarato come da completare, invece di essere
 * inventato.
 *
 * Un obiettivo didattico verosimile ma falso è peggio di un obiettivo assente:
 * il primo passa la revisione distratta, il secondo no.
 */

// ---------------------------------------------------------------------------
// Contratti
// ---------------------------------------------------------------------------

export const lessonSchema = z.object({
  title: z.string().min(1),
  objectives: z.array(z.string()).max(20),
  prerequisites: z.array(z.string()).max(20),
  explanation: z.string(),
  demonstration: z.object({
    intro: z.string(),
    code: z.array(z.object({ language: z.string().nullable(), content: z.string() })).max(20),
  }),
  lab: z.object({ intro: z.string(), steps: z.array(z.string()).max(30) }),
  quiz: z.array(
    z.object({
      question: z.string(),
      /** Vuoto quando le opzioni vanno ancora scritte da una persona. */
      options: z.array(z.string()).max(6),
      answerIndex: z.number().int().nullable(),
      sourceLine: z.number().int().nullable(),
      needsAuthoring: z.boolean(),
    }),
  ).max(20),
  summary: z.string(),
  finalAssignment: z.string(),
  /** Elenco esplicito di ciò che una persona deve ancora scrivere. */
  pendingAuthoring: z.array(z.string()),
});

export type Lesson = z.infer<typeof lessonSchema>;

export const articleSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  metaDescription: z.string().max(160),
  introduction: z.string(),
  body: z.string(),
  codeBlocks: z.array(z.object({ language: z.string().nullable(), content: z.string() })).max(30),
  images: z.array(z.object({ src: z.string(), alt: z.string() })).max(30),
  conclusion: z.string(),
  callToAction: z.string(),
  seo: z.object({
    keywords: z.array(z.string()).max(15),
    readingTimeMinutes: z.number().int().positive(),
    wordCount: z.number().int().nonnegative(),
    canonicalHint: z.string().nullable(),
  }),
  pendingAuthoring: z.array(z.string()),
});

export type Article = z.infer<typeof articleSchema>;

// ---------------------------------------------------------------------------
// Estrazione delle sezioni
// ---------------------------------------------------------------------------

interface Sezione {
  heading: string;
  level: number;
  body: string;
  line: number;
}

/** Divide il documento nelle sue sezioni di secondo livello e oltre. */
export function splitSections(markdown: string): Sezione[] {
  const righe = markdown.split(/\r?\n/);
  const sezioni: Sezione[] = [];

  let corrente: Sezione | null = null;
  let inFence = false;
  let marker = '';

  for (let i = 0; i < righe.length; i += 1) {
    const riga = righe[i]!;

    const fence = /^(\s{0,3})(`{3,}|~{3,})/.exec(riga);
    if (fence) {
      const m = fence[2]!;
      if (!inFence) {
        inFence = true;
        marker = m;
      } else if (m.startsWith(marker[0]!) && m.length >= marker.length) {
        inFence = false;
      }
    }

    const titolo = !inFence ? /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(riga) : null;

    if (titolo) {
      if (corrente) sezioni.push(corrente);
      corrente = {
        heading: titolo[2]!.trim(),
        level: titolo[1]!.length,
        body: '',
        line: i + 1,
      };
      continue;
    }

    if (corrente) corrente.body += `${riga}\n`;
  }

  if (corrente) sezioni.push(corrente);
  return sezioni.map((s) => ({ ...s, body: s.body.trim() }));
}

/** Cerca una sezione il cui titolo contenga una delle parole indicate. */
function trovaSezione(sezioni: Sezione[], parole: string[]): Sezione | null {
  return (
    sezioni.find((sezione) =>
      parole.some((parola) => sezione.heading.toLowerCase().includes(parola)),
    ) ?? null
  );
}

/** Trasforma un testo in un elenco di voci, da elenco puntato o da righe. */
function toElenco(testo: string): string[] {
  const voci = testo
    .split('\n')
    .map((riga) => riga.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim())
    .filter((riga) => riga.length > 0 && !riga.startsWith('```'));

  return voci.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Lezione
// ---------------------------------------------------------------------------

export function deriveLesson(
  contentMd: string,
  meta: { title: string; chapterLabel: string | null },
): Lesson {
  const analisi = analyzeMarkdown(contentMd);
  const sezioni = splitSections(contentMd);
  const daScrivere: string[] = [];

  const sezObiettivi = trovaSezione(sezioni, ['obiettiv', 'imparerai', 'goals']);
  const sezPrerequisiti = trovaSezione(sezioni, ['prerequisit', 'requisit', 'prima di']);
  const sezEsempio = trovaSezione(sezioni, ['esempio', 'demo', 'in pratica']);
  const sezEsercizi = trovaSezione(sezioni, ['esercizi', 'laboratorio', 'lab', 'prova tu']);
  const sezRiepilogo = trovaSezione(sezioni, ['riepilogo', 'conclusion', 'sommario']);

  const objectives = sezObiettivi ? toElenco(sezObiettivi.body) : [];
  if (objectives.length === 0) {
    daScrivere.push(
      'Obiettivi didattici: il capitolo non dichiara una sezione «Obiettivi». Vanno scritti a mano.',
    );
  }

  const prerequisites = sezPrerequisiti ? toElenco(sezPrerequisiti.body) : [];
  if (prerequisites.length === 0) {
    daScrivere.push('Prerequisiti: non dichiarati nel capitolo.');
  }

  // La spiegazione è il corpo del capitolo, esclusa la parte dimostrativa.
  const esclusi = new Set(
    [sezObiettivi, sezPrerequisiti, sezEsempio, sezEsercizi, sezRiepilogo]
      .filter(Boolean)
      .map((s) => s!.heading),
  );

  const explanation = sezioni
    .filter((sezione) => !esclusi.has(sezione.heading))
    .map((sezione) => `## ${sezione.heading}\n\n${sezione.body}`)
    .join('\n\n')
    .trim();

  const lab = sezEsercizi
    ? { intro: 'Esercizi proposti dal capitolo.', steps: toElenco(sezEsercizi.body) }
    : { intro: '', steps: [] };
  if (lab.steps.length === 0) {
    daScrivere.push('Laboratorio: il capitolo non propone esercizi.');
  }

  // Le domande del quiz nascono dalle affermazioni verificabili del capitolo:
  // il fatto da verificare è reale, le opzioni di risposta vanno scritte.
  const quiz = analisi.headings
    .filter((heading) => heading.level === 2)
    .slice(0, 5)
    .map((heading) => ({
      question: `Che cosa afferma il capitolo riguardo a «${heading.text}»?`,
      options: [] as string[],
      answerIndex: null,
      sourceLine: heading.line,
      needsAuthoring: true,
    }));

  if (quiz.length > 0) {
    daScrivere.push(
      `Quiz: ${quiz.length} domande impostate sui titoli del capitolo. Opzioni e risposta corretta vanno scritte.`,
    );
  }

  return lessonSchema.parse({
    title: meta.chapterLabel ? `${meta.chapterLabel} — ${meta.title}` : meta.title,
    objectives,
    prerequisites,
    explanation,
    demonstration: {
      intro: sezEsempio?.body.split('```')[0]?.trim() ?? '',
      code: analisi.codeBlocks.slice(0, 20).map((blocco) => ({
        language: blocco.language,
        content: blocco.content,
      })),
    },
    lab,
    quiz,
    summary: sezRiepilogo?.body ?? '',
    finalAssignment: '',
    pendingAuthoring: [
      ...daScrivere,
      ...(sezRiepilogo ? [] : ['Riepilogo: assente nel capitolo.']),
      'Compito finale: da definire in base al percorso del corso.',
    ],
  });
}

// ---------------------------------------------------------------------------
// Articolo
// ---------------------------------------------------------------------------

/** Parole più frequenti, escluse quelle vuote di significato. */
const PAROLE_VUOTE = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'a', 'da', 'in', 'con', 'su',
  'per', 'tra', 'fra', 'e', 'o', 'ma', 'che', 'non', 'come', 'più', 'anche', 'quando', 'del',
  'della', 'dei', 'delle', 'nel', 'nella', 'al', 'alla', 'si', 'sono', 'essere', 'viene',
  'questo', 'questa', 'ogni', 'solo', 'può', 'deve', 'the', 'and', 'for', 'with',
]);

export function extractKeywords(text: string, limit = 10): string[] {
  const conteggi = new Map<string, number>();

  for (const parola of text.toLowerCase().match(/[\p{L}][\p{L}\p{N}_-]{3,}/gu) ?? []) {
    if (PAROLE_VUOTE.has(parola)) continue;
    conteggi.set(parola, (conteggi.get(parola) ?? 0) + 1);
  }

  return [...conteggi.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'it'))
    .slice(0, limit)
    .map(([parola]) => parola);
}

/** Tempo di lettura stimato: circa 200 parole al minuto. */
export function readingTime(words: number): number {
  return Math.max(1, Math.round(words / 200));
}

export function deriveArticle(
  contentMd: string,
  meta: { title: string; author: string; projectTitle: string },
): Article {
  const analisi = analyzeMarkdown(contentMd);
  const sezioni = splitSections(contentMd);
  const daScrivere: string[] = [];

  // L'introduzione è il testo che precede il primo titolo di secondo livello.
  const primoTitolo = sezioni[0];
  const testaBruta = primoTitolo
    ? contentMd.split(/\r?\n/).slice(0, primoTitolo.line - 1).join('\n')
    : contentMd;

  const introduction = testaBruta
    .replace(/^#\s+.+$/m, '')
    .replace(/^---[\s\S]*?---/, '')
    .trim();

  if (introduction.length < 40) {
    daScrivere.push('Introduzione: il capitolo entra subito nel merito, serve un incipit per il web.');
  }

  const sezRiepilogo = sezioni.find((sezione) =>
    ['riepilogo', 'conclusion', 'sommario'].some((parola) =>
      sezione.heading.toLowerCase().includes(parola),
    ),
  );

  const body = sezioni
    .filter((sezione) => sezione !== sezRiepilogo)
    .map((sezione) => `## ${sezione.heading}\n\n${sezione.body}`)
    .join('\n\n')
    .trim();

  const conclusion = sezRiepilogo?.body ?? '';
  if (!conclusion) daScrivere.push('Conclusione: il capitolo non ha una sezione di chiusura.');

  // La meta description viene ricavata dal testo reale, troncata sul confine
  // di parola: nessuna frase inventata.
  const testoPiano = introduction.replace(/[#*`>_[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const metaDescription =
    testoPiano.length <= 155
      ? testoPiano
      : `${testoPiano.slice(0, 152).replace(/\s+\S*$/, '')}…`;

  if (metaDescription.length < 50) {
    daScrivere.push('Meta description: troppo breve per essere utile, va riscritta.');
  }

  daScrivere.push('Call to action: da decidere in base alla destinazione dell’articolo.');

  return articleSchema.parse({
    title: meta.title,
    slug: slugify(meta.title) || 'articolo',
    metaDescription,
    introduction,
    body,
    codeBlocks: analisi.codeBlocks.slice(0, 30).map((blocco) => ({
      language: blocco.language,
      content: blocco.content,
    })),
    images: analisi.figures.slice(0, 30).map((figura) => ({ src: figura.src, alt: figura.alt })),
    conclusion,
    callToAction: '',
    seo: {
      keywords: extractKeywords(`${meta.title} ${contentMd}`),
      readingTimeMinutes: readingTime(analisi.wordCount),
      wordCount: analisi.wordCount,
      canonicalHint: null,
    },
    pendingAuthoring: daScrivere,
  });
}
