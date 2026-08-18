import { ProviderError, type ImageProvider, type ImageRequest, type ImageResult } from '../types';
import { readErrorDetail } from '../http';

/**
 * Adapter visuale OpenAI.
 *
 * Il modello accetta soltanto tre proporzioni. Le misure di una copertina non
 * sono quelle: si sceglie la proporzione più vicina e **lo si dichiara**, invece
 * di far credere che l'immagine arrivi già nel formato richiesto. Il ritaglio
 * definitivo appartiene all'impaginato, che conosce abbondanza e margini di
 * sicurezza; il modello fornisce la materia, non la gabbia.
 */

/** Le uniche misure accettate. */
const MISURE = {
  quadrata: { etichetta: '1024x1024', width: 1024, height: 1024 },
  verticale: { etichetta: '1024x1536', width: 1024, height: 1536 },
  orizzontale: { etichetta: '1536x1024', width: 1536, height: 1024 },
} as const;

/**
 * Tariffe pubblicate per milione di token, in dollari.
 *
 * La stima usa la tariffa d'ingresso delle immagini anche per i token del
 * prompt testuale: sono pochi, e sbagliare per eccesso su un costo è meno grave
 * che sbagliare per difetto.
 */
const PREZZO_PER_MILIONE = { input: 8, output: 30 };

export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';

/** Immagini di riferimento accettate in una sola richiesta. */
const MAX_RIFERIMENTI = 8;

function estensione(mimeType: string): string {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function misuraPer(width: number, height: number): {
  scelta: (typeof MISURE)[keyof typeof MISURE];
  nota: string | null;
} {
  const rapporto = width / Math.max(height, 1);
  const scelta =
    rapporto > 1.15 ? MISURE.orizzontale : rapporto < 0.87 ? MISURE.verticale : MISURE.quadrata;

  const esatta = scelta.width === Math.round(width) && scelta.height === Math.round(height);
  return {
    scelta,
    nota: esatta
      ? null
      : `Richiesti ${Math.round(width)}×${Math.round(height)} px: il modello genera solo ` +
        `1024×1024, 1024×1536 e 1536×1024. Uso ${scelta.etichetta}, da ritagliare in impaginazione.`,
  };
}

export class OpenAIImageProvider implements ImageProvider {
  readonly name = 'openai';

  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_OPENAI_IMAGE_MODEL,
  ) {}

  async generate(request: ImageRequest): Promise<ImageResult> {
    const warnings: string[] = [];
    const { scelta, nota } = misuraPer(request.width, request.height);
    if (nota) warnings.push(nota);

    // Il modello non espone un seme: dichiararne uno sarebbe fingere una
    // riproducibilità che non c'è.
    if (request.seed !== undefined) {
      warnings.push('Il seme non è supportato da questo modello: la generazione non è ripetibile.');
    }

    const conRiferimenti = (request.references?.length ?? 0) > 0;

    const istruzioni = [
      request.prompt,
      conRiferimenti
        ? 'Le immagini allegate sono riferimenti di stile, palette e composizione: ' +
          'ispirati a quelle senza copiarne gli elementi riconoscibili.'
        : '',
      request.style ? `Stile: ${request.style}.` : '',
      request.negativePrompt ? `Da evitare: ${request.negativePrompt}.` : '',
      // Il testo di copertina è tipografia, e la tipografia la compone
      // l'impaginato: un titolo disegnato dal modello sarebbe illeggibile e
      // impossibile da correggere.
      'Non inserire testo, lettere, numeri, loghi o firme nell’immagine.',
    ]
      .filter(Boolean)
      .join('\n');

    // Con delle immagini di riferimento la richiesta cambia strada: l'endpoint
    // di generazione non le accetta, quello di modifica sì. È la differenza fra
    // «disegna qualcosa di simile a questo» e «disegna qualcosa da zero».
    const riferimenti = (request.references ?? []).slice(0, MAX_RIFERIMENTI);
    if ((request.references?.length ?? 0) > MAX_RIFERIMENTI) {
      warnings.push(
        `Ricevute ${request.references!.length} immagini di riferimento: ne uso le prime ${MAX_RIFERIMENTI}.`,
      );
    }

    let response: Response;
    try {
      response = riferimenti.length > 0
        ? await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: (() => {
              const modulo = new FormData();
              modulo.append('model', this.model);
              modulo.append('prompt', istruzioni);
              modulo.append('size', scelta.etichetta);
              modulo.append('n', '1');
              riferimenti.forEach((riferimento, indice) => {
                modulo.append(
                  'image[]',
                  new Blob([riferimento.bytes as BlobPart], { type: riferimento.mimeType }),
                  `riferimento-${indice}.${estensione(riferimento.mimeType)}`,
                );
              });
              return modulo;
            })(),
          })
        : await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              prompt: istruzioni,
              size: scelta.etichetta,
              n: 1,
            }),
          });
    } catch (error) {
      throw new ProviderError('Rete non raggiungibile.', true, this.name, error);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const detail = await readErrorDetail(response);
      throw new ProviderError(
        `OpenAI ha risposto ${response.status}${detail ? `: ${detail}` : '.'}`,
        retryable,
        this.name,
        undefined,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      data?: { b64_json?: string; revised_prompt?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const base64 = payload.data?.[0]?.b64_json;
    if (!base64) throw new ProviderError('Risposta priva di immagine.', true, this.name);

    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));

    // Il modello può riscrivere il prompt: chi rivede l'immagine ha diritto di
    // sapere che non è quello che aveva chiesto.
    const riscritto = payload.data?.[0]?.revised_prompt;
    if (riscritto && riscritto !== istruzioni) {
      warnings.push(`Il modello ha riformulato la richiesta: «${riscritto.slice(0, 300)}»`);
    }

    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    if (outputTokens === 0) {
      warnings.push('Consumo non riportato dal fornitore: il costo non è stimabile.');
    }

    return {
      provider: this.name,
      model: this.model,
      bytes,
      mimeType: 'image/png',
      width: scelta.width,
      height: scelta.height,
      seed: null,
      estimatedCostUsd:
        (inputTokens / 1e6) * PREZZO_PER_MILIONE.input +
        (outputTokens / 1e6) * PREZZO_PER_MILIONE.output,
      warnings,
    };
  }
}
