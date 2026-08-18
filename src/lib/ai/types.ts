import type { z } from 'zod';

/**
 * Interfaccia comune ai provider AI.
 *
 * Il dominio applicativo non importa mai un SDK specifico: parla soltanto con
 * queste interfacce. Sostituire OpenAI con Anthropic, o passare al provider
 * mock, non richiede di toccare un solo agente.
 */

export interface TextRequest {
  /** Istruzioni di sistema: ruolo e vincoli dell'agente. */
  system: string;
  /** Contenuto su cui lavorare. */
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult<T = unknown> {
  provider: string;
  model: string;
  /** Output già validato contro lo schema richiesto. */
  data: T;
  /** Testo grezzo restituito dal modello, utile per la diagnosi. */
  raw: string;
  usage: Usage;
  /** Costo stimato in dollari. Zero per il provider mock. */
  estimatedCostUsd: number;
  warnings: string[];
}

export interface TextProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Genera un output conforme allo schema fornito.
   * L'implementazione è responsabile di ottenere JSON valido dal modello e di
   * validarlo: chi chiama riceve un valore già tipizzato o un errore.
   */
  generateStructured<T>(request: TextRequest, schema: z.ZodType<T>): Promise<TextResult<T>>;
}

export interface ImageRequest {
  prompt: string;
  /**
   * Immagini da cui partire, non da copiare.
   *
   * Servono a fissare stile, palette e composizione: il modello le riceve come
   * base e produce qualcosa di coerente con esse. Senza, ogni generazione
   * ripartirebbe da una direzione visuale diversa.
   */
  references?: { bytes: Uint8Array; mimeType: string }[];
  negativePrompt?: string;
  width: number;
  height: number;
  style?: string;
  seed?: number;
}

export interface ImageResult {
  provider: string;
  model: string;
  /** Contenuto binario dell'immagine. */
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  /** Seme effettivamente usato, se il provider lo espone. */
  seed: number | null;
  estimatedCostUsd: number;
  warnings: string[];
}

export interface ImageProvider {
  readonly name: string;
  readonly model: string;
  generate(request: ImageRequest): Promise<ImageResult>;
}

/** Errore di provider: distingue ciò che ha senso ritentare da ciò che non ne ha. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly provider: string,
    override readonly cause?: unknown,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
