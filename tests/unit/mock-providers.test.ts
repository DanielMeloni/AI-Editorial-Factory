import { describe, expect, it } from 'vitest';
import { MockImageProvider, hashString } from '@/lib/ai/image/mock';
import { hashInput } from '@/lib/agents/runner';

describe('provider visuale mock', () => {
  const provider = new MockImageProvider();

  it('produce un PNG valido, non un segnaposto rotto', async () => {
    const risultato = await provider.generate({ prompt: 'grafo delle dipendenze', width: 64, height: 48 });

    // Firma PNG: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(risultato.bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(risultato.mimeType).toBe('image/png');
    expect(risultato.width).toBe(64);
    expect(risultato.height).toBe(48);
  });

  it('dichiara di essere una simulazione e non addebita nulla', async () => {
    const risultato = await provider.generate({ prompt: 'x', width: 32, height: 32 });
    expect(risultato.estimatedCostUsd).toBe(0);
    expect(risultato.warnings.join(' ')).toMatch(/mock/i);
  });

  it('è deterministico: stesso prompt, stessa immagine', async () => {
    const a = await provider.generate({ prompt: 'identico', width: 32, height: 32 });
    const b = await provider.generate({ prompt: 'identico', width: 32, height: 32 });
    expect(Array.from(a.bytes)).toEqual(Array.from(b.bytes));
    expect(a.seed).toBe(b.seed);
  });

  it('prompt diversi producono immagini diverse', async () => {
    const a = await provider.generate({ prompt: 'primo', width: 32, height: 32 });
    const b = await provider.generate({ prompt: 'secondo', width: 32, height: 32 });
    expect(Array.from(a.bytes)).not.toEqual(Array.from(b.bytes));
  });

  it('rispetta il seme quando fornito', async () => {
    const risultato = await provider.generate({ prompt: 'x', width: 32, height: 32, seed: 42 });
    expect(risultato.seed).toBe(42);
  });

  it('limita le dimensioni entro un intervallo ragionevole', async () => {
    const risultato = await provider.generate({ prompt: 'x', width: 99999, height: 1 });
    expect(risultato.width).toBe(2048);
    expect(risultato.height).toBe(16);
  });
});

describe('hash dell’input degli agenti', () => {
  it('è stabile rispetto all’ordine delle chiavi', async () => {
    const a = await hashInput({ alfa: 1, beta: { x: 1, y: 2 } });
    const b = await hashInput({ beta: { y: 2, x: 1 }, alfa: 1 });
    expect(a).toBe(b);
  });

  it('cambia se cambia un valore', async () => {
    const a = await hashInput({ testo: 'originale' });
    const b = await hashInput({ testo: 'modificato' });
    expect(a).not.toBe(b);
  });

  it('ha il formato SHA-256 atteso dal vincolo del database', async () => {
    expect(await hashInput({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('conserva l’ordine degli array, che è significativo', async () => {
    const a = await hashInput({ passi: ['uno', 'due'] });
    const b = await hashInput({ passi: ['due', 'uno'] });
    expect(a).not.toBe(b);
  });
});

describe('funzione di hash del prompt', () => {
  it('restituisce un intero senza segno', () => {
    expect(hashString('qualunque cosa')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashString('x'))).toBe(true);
  });
});
