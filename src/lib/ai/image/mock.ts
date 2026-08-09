import { deflateSync } from 'fflate';
import type { ImageProvider, ImageRequest, ImageResult } from '../types';

/**
 * Provider visuale mock.
 *
 * Produce un PNG reale — non un segnaposto rotto — con un colore derivato in
 * modo deterministico dal prompt: lo stesso prompt dà sempre la stessa
 * immagine. Serve a percorrere per intero il flusso di generazione,
 * approvazione e conservazione degli asset senza consumare crediti.
 *
 * L'immagine non contiene testo, coerentemente con la regola secondo cui il
 * testo importante non va mai generato dentro un'immagine.
 */
export class MockImageProvider implements ImageProvider {
  readonly name = 'mock';

  constructor(readonly model: string = 'mock-image-1') {}

  async generate(request: ImageRequest): Promise<ImageResult> {
    const seed = request.seed ?? hashString(request.prompt);
    const width = clamp(request.width, 16, 2048);
    const height = clamp(request.height, 16, 2048);

    return {
      provider: this.name,
      model: this.model,
      bytes: renderPng(width, height, seed),
      mimeType: 'image/png',
      width,
      height,
      seed,
      estimatedCostUsd: 0,
      warnings: ['Immagine prodotta dal provider mock: nessun modello è stato interpellato.'],
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Costruisce un PNG con una sfumatura diagonale a due tinte derivate dal seme. */
function renderPng(width: number, height: number, seed: number): Uint8Array {
  const r1 = (seed >>> 16) & 0xff;
  const g1 = (seed >>> 8) & 0xff;
  const b1 = seed & 0xff;

  const rows = new Uint8Array(height * (width * 3 + 1));
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rows[offset] = 0; // filtro «none»
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const t = (x / width + y / height) / 2;
      rows[offset] = Math.round(r1 * (1 - t) + 255 * t * 0.25);
      rows[offset + 1] = Math.round(g1 * (1 - t) + 255 * t * 0.25);
      rows[offset + 2] = Math.round(b1 * (1 - t) + 255 * t * 0.25);
      offset += 3;
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // profondità
  ihdr[9] = 2; // colore RGB
  // 10-12: compressione, filtro, interlacciamento — tutti 0

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const png = new Uint8Array(total);
  let position = 0;
  for (const part of parts) {
    png.set(part, position);
    position += part.length;
  }
  return png;
}
